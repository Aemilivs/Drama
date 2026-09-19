import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  functionActor,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorContext, Cast, Evaluation, Performance, Scene } from "../../src/index.ts";
import { normalizePerformance } from "./_support.ts";

function scene(capabilities = ["work"]): Scene {
  return sceneFromCard({
    objective: "produce",
    success_criteria: ["a report exists"],
    required_capabilities: capabilities,
  });
}

/** Fails on iteration 1, passes afterwards: exercises reperformance deterministically. */
function retryEvaluator(s: Scene): Evaluator {
  return new Evaluator((ctx): Evaluation => {
    const done = ctx.iteration >= 2;
    return {
      id: "e",
      status: done ? "pass" : "fail",
      criteria: [
        {
          criterion: s.successCriteria[0]!.id,
          status: done ? "pass" : "fail",
          evidence: done ? "ok" : "retry",
        },
      ],
      issues: [],
      recommendedAction: done ? "finish" : "reperform",
      diagnosis: done ? "unspecified" : "bad_execution",
      createdAt: 0,
      meta: {},
    };
  });
}

function retryScenario(): { s: Scene; cast: Cast; stage: StageManager } {
  const s = scene(["work", "summarise"]);
  const producer = functionActor({
    name: "producer",
    role: "producer",
    objective: "produce a report",
    capabilities: ["work"],
    produces: "Report",
    run: () => ok([artifact("producer", "Report", "report")]),
  });
  const consumer = functionActor({
    name: "consumer",
    role: "consumer",
    objective: "summarise",
    capabilities: ["summarise"],
    produces: "Summary",
    run: () => ok([artifact("consumer", "Summary", "summary")]),
  });
  const cast = createCast(
    [producer, consumer],
    createProtocol([
      { actor: "producer", instruction: "produce", produces: ["Report"] },
      {
        actor: "consumer",
        instruction: "summarise",
        consumes: ["Report"],
        produces: ["Summary"],
      },
    ]),
  );
  return { s, cast, stage: new StageManager({ evaluator: retryEvaluator(s) }) };
}

describe("Determinism and cost requirements", () => {
  test("R-DET-1 the same production twice is structurally identical", async () => {
    const a = retryScenario();
    const b = retryScenario();
    const first = await a.stage.perform(a.s, a.cast);
    const second = await b.stage.perform(b.s, b.cast);
    expect(normalizePerformance(second)).toEqual(normalizePerformance(first));
  });

  test("R-DET-2 a passing performance activates each step exactly once", async () => {
    const s = scene();
    const worker = functionActor({
      name: "worker",
      role: "worker",
      objective: "produce",
      capabilities: ["work"],
      produces: "Report",
      run: () => ok([artifact("worker", "Report", "done")]),
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
    );
    const evaluator = new Evaluator(() => ({
      id: "e",
      status: "pass" as const,
      criteria: [{ criterion: s.successCriteria[0]!.id, status: "pass" as const, evidence: "ok" }],
      issues: [],
      recommendedAction: "finish" as const,
      diagnosis: "unspecified" as const,
      createdAt: 0,
      meta: {},
    }));
    const performance = await new StageManager({ evaluator }).perform(s, cast);

    expect(performance.iterations).toHaveLength(1);
    expect(performance.events.filter((e) => e.type === "actor_activated")).toHaveLength(
      cast.protocol.steps.length,
    );

    // In a multi-iteration run, no (iteration, actor) activation is repeated.
    const run = retryScenario();
    const repeated = await run.stage.perform(run.s, run.cast);
    const keys = repeated.events
      .filter((e) => e.type === "actor_activated")
      .map((e) => `${(e as { iteration: number }).iteration}:${(e as { actor: string }).actor}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("R-DET-3 every artifact and turn id is unique within a performance", async () => {
    const run = retryScenario();
    const performance = await run.stage.perform(run.s, run.cast);
    const artifactIds = performance.artifacts.map((a) => a.id);
    const turnIds = performance.turns.map((t) => t.id);
    expect(new Set(artifactIds).size).toBe(artifactIds.length);
    expect(new Set(turnIds).size).toBe(turnIds.length);
  });

  test("R-COST-1 the number of executor calls equals the number of turns", async () => {
    const s = scene();
    let calls = 0;
    const worker = functionActor({
      name: "worker",
      role: "worker",
      objective: "produce",
      capabilities: ["work"],
      produces: "Report",
      run: (_ctx: ActorContext) => {
        calls += 1;
        return ok([artifact("worker", "Report", "done")]);
      },
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
    );
    const evaluator = new Evaluator(() => ({
      id: "e",
      status: "pass" as const,
      criteria: [{ criterion: s.successCriteria[0]!.id, status: "pass" as const, evidence: "ok" }],
      issues: [],
      recommendedAction: "finish" as const,
      diagnosis: "unspecified" as const,
      createdAt: 0,
      meta: {},
    }));
    const performance: Performance = await new StageManager({ evaluator }).perform(s, cast);
    expect(calls).toBe(performance.turns.length);
    expect(calls).toBe(1);
  });

  test("R-COST-2 no turn ever receives the same artifact twice", async () => {
    const run = retryScenario();
    const performance = await run.stage.perform(run.s, run.cast);

    for (const turn of performance.turns) {
      expect(new Set(turn.inputIds).size).toBe(turn.inputIds.length);
    }

    // Across a reperformance, artifacts accumulate: the consumer of "Report"
    // sees both the first and the second one, and both are distinct.
    const secondIterationConsumer = performance.turns.find(
      (turn) => turn.actor === "consumer" && turn.iteration === 2,
    )!;
    expect(secondIterationConsumer.inputIds).toHaveLength(2);
    expect(new Set(secondIterationConsumer.inputIds).size).toBe(2);
  });
});
