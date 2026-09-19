import { describe, expect, test } from "bun:test";
import { SceneDesigner, detectConstraintConflicts, sceneFromCard } from "../src/index.ts";

describe("scene design", () => {
  test("an incomplete request is reported as incomplete", async () => {
    const designer = new SceneDesigner();
    const scene = await designer.design("Make the checkout page better");

    expect(scene.objective).toBe("Make the checkout page better");
    const analysis = designer.analyze(scene);
    expect(analysis.complete).toBe(false);
    expect(analysis.missing).toContain("success_criteria");
    expect(analysis.missing).toContain("required_capabilities");
    // No blocking unknown was declared, so we do not pester the user.
    expect(designer.shouldAskQuestions(analysis)).toBe(false);
  });

  test("a sufficiently specified card is complete and asks nothing", async () => {
    const designer = new SceneDesigner({
      design: () => ({
        objective: "Decide whether to migrate the billing service to Postgres 16",
        desired_outcome: "A decision with evidence",
        known: ["Current version is Postgres 14"],
        unknown: ["Target read throughput"],
        assumed: ["Downtime window of 30 minutes"],
        constraints: ["No schema changes"],
        success_criteria: [
          "Names a target version",
          "Lists migration risks",
        ],
        required_capabilities: ["research", "risk_analysis"],
      }),
    });

    const scene = await designer.design("migrate billing db?");
    const analysis = designer.analyze(scene);
    expect(analysis.complete).toBe(true);
    expect(analysis.questions).toHaveLength(0);
    expect(designer.shouldAskQuestions(analysis)).toBe(false);
    expect(scene.successCriteria).toHaveLength(2);
  });

  test("a blocking unknown surfaces as a question", async () => {
    const designer = new SceneDesigner({
      design: () => ({
        objective: "Pick a queue technology",
        success_criteria: ["Names one technology"],
        required_capabilities: ["research"],
        unknown: [
          { text: "Do we need exactly-once delivery?", blocking: true },
          "Preferred cloud provider",
        ],
      }),
    });

    const scene = await designer.design("choose a queue");
    const analysis = designer.analyze(scene);
    expect(analysis.blockingUnknowns).toEqual(["Do we need exactly-once delivery?"]);
    expect(designer.shouldAskQuestions(analysis)).toBe(true);
    expect(analysis.questions).toContain("Do we need exactly-once delivery?");
  });

  test("conflicting constraints are detected from polarity", () => {
    const conflicts = detectConstraintConflicts([
      "The service must cache responses",
      "The service must not cache responses",
      "Responses should be logged",
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]![0]).toContain("must cache");
    expect(conflicts[0]![1]).toContain("must not cache");
  });

  test("conflicting constraints make the scene incomplete and worth a question", () => {
    const designer = new SceneDesigner();
    const scene = sceneFromCard({
      objective: "Design a cache",
      success_criteria: ["A design exists"],
      required_capabilities: ["design"],
      constraints: [
        { text: "Keep data local to the region", conflictsWith: ["Replicate globally"] },
        "Replicate globally",
      ],
    });
    const analysis = designer.analyze(scene);
    expect(analysis.constraintConflicts).toHaveLength(1);
    expect(analysis.complete).toBe(false);
    expect(designer.shouldAskQuestions(analysis)).toBe(true);
  });

  test("different subjects do not collapse into a false conflict", () => {
    expect(
      detectConstraintConflicts([
        "The system must cache responses",
        "The service must not cache responses",
      ]),
    ).toHaveLength(0);
  });
});
