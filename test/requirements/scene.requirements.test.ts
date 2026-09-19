import { describe, expect, test } from "bun:test";
import {
  SceneDesigner,
  detectConstraintConflicts,
  sceneFromCard,
} from "../../src/index.ts";
import type { Scene, SceneCard } from "../../src/index.ts";

describe("Scene requirements", () => {
  test("R-SCENE-2 snake_case and camelCase cards normalise identically", () => {
    const camel: SceneCard = {
      objective: "o",
      desiredOutcome: "d",
      known: ["k"],
      unknown: ["u"],
      assumed: ["a"],
      required: ["r"],
      successCriteria: ["c1", "c2"],
      requiredCapabilities: ["a", "b"],
      availableTools: ["t"],
      failureModes: ["f"],
      interactionRequirements: ["i"],
      unresolvedQuestions: ["q"],
    };
    const snake: SceneCard = {
      objective: "o",
      desired_outcome: "d",
      known: ["k"],
      unknown: ["u"],
      assumed: ["a"],
      required: ["r"],
      success_criteria: ["c1", "c2"],
      required_capabilities: ["a", "b"],
      available_tools: ["t"],
      failure_modes: ["f"],
      interaction_requirements: ["i"],
      unresolved_questions: ["q"],
    };
    const a = sceneFromCard(camel);
    const b = sceneFromCard(snake);
    expect(b.desiredOutcome).toBe(a.desiredOutcome);
    expect(b.successCriteria.map((c) => c.description)).toEqual(
      a.successCriteria.map((c) => c.description),
    );
    expect(b.requiredCapabilities).toEqual(a.requiredCapabilities);
    expect(b.availableTools).toEqual(a.availableTools);
    expect(b.failureModes).toEqual(a.failureModes);
    expect(b.interactionRequirements).toEqual(a.interactionRequirements);
    expect(b.unresolvedQuestions).toEqual(a.unresolvedQuestions);
  });

  test("R-SCENE-4 a missing objective is the structural gap that forces a question", () => {
    const designer = new SceneDesigner();
    const scene = sceneFromCard({ success_criteria: ["c"], required_capabilities: ["a"] });
    const analysis = designer.analyze(scene);
    expect(analysis.missing).toContain("objective");
    expect(designer.shouldAskQuestions(analysis)).toBe(true);
  });

  test("R-SCENE-5 a declared conflict is found whichever side declares it", () => {
    const forward = detectConstraintConflicts([
      { text: "Keep data local", conflictsWith: ["Replicate globally"] },
      "Replicate globally",
    ]);
    const backward = detectConstraintConflicts([
      "Keep data local",
      { text: "Replicate globally", conflictsWith: ["Keep data local"] },
    ]);
    expect(forward).toHaveLength(1);
    expect(backward).toHaveLength(1);
  });

  test("R-SCENE-6 polarity detection is order-independent and subject-aware", () => {
    const positive = "The service must cache responses";
    const negative = "The service must not cache responses";
    expect(detectConstraintConflicts([positive, negative])).toHaveLength(1);
    expect(detectConstraintConflicts([negative, positive])).toHaveLength(1);
    expect(
      detectConstraintConflicts([
        "The service must cache responses",
        "The service should cache responses",
      ]),
    ).toHaveLength(0);
  });

  test("R-SCENE-8 a designer that returns a Scene is used as-is", async () => {
    const provided: Scene = sceneFromCard({
      objective: "provided",
      success_criteria: ["c"],
      required_capabilities: ["a"],
    });
    const designer = new SceneDesigner({ design: () => provided });
    const scene = await designer.design("ignored");
    expect(scene.id).toBe(provided.id);
    expect(scene.objective).toBe("provided");
  });

  test("R-SCENE-9 redesign receives the previous scene and the diagnosis", async () => {
    const previous = sceneFromCard({
      objective: "old",
      success_criteria: ["c"],
      required_capabilities: ["a"],
    });
    let seen: { previous?: Scene; diagnosis?: string } = {};
    const designer = new SceneDesigner({
      design: (input) => {
        seen = { previous: input.previous, diagnosis: input.diagnosis };
        return { objective: "new", success_criteria: ["c"], required_capabilities: ["a"] };
      },
    });
    await designer.design("x", { previous, diagnosis: "malformed_problem" });
    expect(seen.previous).toBe(previous);
    expect(seen.diagnosis).toBe("malformed_problem");
  });
});
