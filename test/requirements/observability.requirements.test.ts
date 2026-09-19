import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  formatPerformance,
  functionActor,
  ok,
  performanceTimeline,
  sceneFromCard,
} from "../../src/index.ts";

describe("Observability requirements", () => {
  test("R-TRACE-1 the rendered trace names the scene, cast, activations, evaluation and result", async () => {
    const s = sceneFromCard({
      objective: "check the pipes",
      success_criteria: ["a report exists"],
      required_capabilities: ["work"],
    });
    const worker = functionActor({
      name: "pipe-checker",
      role: "pipe-checker",
      objective: "check the pipes",
      capabilities: ["work"],
      produces: "Report",
      run: () => ok([artifact("pipe-checker", "Report", "ok")]),
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "pipe-checker", instruction: "check", produces: ["Report"] }]),
    );
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: (ctx) =>
            ctx.artifacts.some((a) => a.kind === "Report")
              ? { status: "pass", evidence: "present" }
              : { status: "fail", evidence: "absent" },
        },
      ]),
    );
    const performance = await new StageManager({ evaluator }).perform(s, cast);
    const report = formatPerformance(performance);
    expect(report).toContain(s.objective);
    expect(report).toContain(cast.id);
    expect(report).toContain("pipe-checker");
    expect(report).toContain("Evaluation: pass");
    expect(report).toContain("Result: done");
  });

  test("R-TRACE-2 the timeline is one JSON record per event", async () => {
    const s = sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["work"],
    });
    const worker = functionActor({
      name: "w", role: "w", objective: "o", capabilities: ["work"], produces: "R",
      run: () => ok([artifact("w", "R", "x")]),
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "w", instruction: "go", produces: ["R"] }]),
    );
    const evaluator = new Evaluator(
      criterionEvaluator([
        { criterion: s.successCriteria[0]!, check: () => ({ status: "pass" as const, evidence: "ok" }) },
      ]),
    );
    const performance = await new StageManager({ evaluator }).perform(s, cast);
    const timeline = performanceTimeline(performance);
    expect(timeline).toHaveLength(performance.events.length);
    for (const line of timeline) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
