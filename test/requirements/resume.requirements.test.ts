import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  deserializePerformance,
  functionActor,
  ok,
  serializePerformance,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorExecutor, Cast, Scene } from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "produce X, then Y behind a gate",
    success_criteria: ["X and Y exist"],
    required_capabilities: ["x", "y"],
  });
}

function evaluatorFor(target: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: target.successCriteria[0]!,
        check: (ctx) =>
          ["X", "Y"].every((kind) => ctx.artifacts.some((item) => item.kind === kind))
            ? { status: "pass" as const, evidence: "both present" }
            : { status: "fail" as const, evidence: "incomplete" },
      },
    ]),
  );
}

/** Two steps, the second gated; `calls` records every executor call. */
function setup(calls: string[] = []): { scene: Scene; cast: Cast; executors: Record<string, ActorExecutor> } {
  const target = scene();
  const make = (name: string, produces: string): ActorExecutor => async () => {
    calls.push(name);
    return ok([artifact(name, produces, `value-${name}`)]);
  };
  const executors: Record<string, ActorExecutor> = { x: make("x", "X"), y: make("y", "Y") };
  const cast = createCast(
    [
      functionActor({
        name: "x",
        role: "x",
        objective: "produce X",
        capabilities: ["x"],
        produces: "X",
        run: executors.x!,
      }),
      functionActor({
        name: "y",
        role: "y",
        objective: "produce Y",
        capabilities: ["y"],
        produces: "Y",
        run: executors.y!,
      }),
    ],
    createProtocol([
      { actor: "x", instruction: "produce X", produces: ["X"] },
      { actor: "y", instruction: "produce Y", produces: ["Y"], gate: true },
    ]),
  );
  return { scene: target, cast, executors };
}

function manager(target: Scene): StageManager {
  return new StageManager({ evaluator: evaluatorFor(target), maxPerformances: 1 });
}

describe("Gated performance resume requirements", () => {
  test("R-RESUME-1 a gate with nobody to answer it pauses, keeping what ran", async () => {
    const calls: string[] = [];
    const { scene: s, cast, executors } = setup(calls);
    const paused = await manager(s).perform(s, cast, { executors });

    expect(paused.finalResult.status).toBe("paused");
    expect(paused.finalResult.gate).toEqual({ iteration: 1, step: "step-2", actor: "y" });
    // Nothing was admitted to the gated wave, and no decision was invented.
    expect(calls).toEqual(["x"]);
    expect(paused.artifacts.map((item) => item.kind)).toEqual(["X"]);
    expect(paused.turns.map((turn) => turn.actor)).toEqual(["x"]);
    expect(paused.finalResult.evaluation).toBeNull();
    expect(paused.iterations).toHaveLength(1);
    expect(paused.iterations[0]!.evaluation).toBeNull();
  });

  test("R-RESUME-2 resuming with the approval runs on to completion in one trace", async () => {
    const calls: string[] = [];
    const { scene: s, cast, executors } = setup(calls);
    const stage = manager(s);
    const paused = await stage.perform(s, cast, { executors });
    const resumed = await stage.resume(paused, { executors, approve: () => true });

    expect(resumed.finalResult.status).toBe("done");
    expect(resumed.artifacts.map((item) => item.kind)).toEqual(["X", "Y"]);
    expect(resumed.turns.map((turn) => turn.actor)).toEqual(["x", "y"]);
    // The resumed performance is the same show: the earlier trace is still there.
    expect(resumed.id).toBe(paused.id);
    expect(resumed.events.length).toBeGreaterThan(paused.events.length);
    expect(resumed.events.slice(0, paused.events.length)).toEqual(paused.events);
  });

  test("R-RESUME-3 the paused state is the existing serialization, and reloading resumes it", async () => {
    const calls: string[] = [];
    const { scene: s, cast, executors } = setup(calls);
    const paused = await manager(s).perform(s, cast, { executors });

    const text = serializePerformance(paused, { pretty: true });
    const reloaded = deserializePerformance(text, { executors });
    expect(reloaded.finalResult.status).toBe("paused");
    expect(reloaded.finalResult.gate).toEqual(paused.finalResult.gate);

    // A reloaded performance has no executors on its cast, so they are re-attached
    // by name — the same contract a replay has.
    const resumed = await manager(s).resume(reloaded, { executors, approve: () => true });
    expect(resumed.finalResult.status).toBe("done");
    expect(resumed.artifacts.map((item) => item.kind)).toEqual(["X", "Y"]);
  });

  test("R-RESUME-4 resuming with nobody to answer pauses again, so a wait never becomes a pass", async () => {
    const calls: string[] = [];
    const { scene: s, cast, executors } = setup(calls);
    const stage = manager(s);
    const paused = await stage.perform(s, cast, { executors });
    const again = await stage.resume(paused, { executors });
    const onceMore = await stage.resume(again, { executors });

    for (const performance of [again, onceMore]) {
      expect(performance.finalResult.status).toBe("paused");
      expect(performance.finalResult.gate).toEqual({ iteration: 1, step: "step-2", actor: "y" });
      expect(performance.finalResult.evaluation).toBeNull();
    }
    // The gate was never opened, so the step never ran.
    expect(calls).toEqual(["x"]);
  });

  test("R-RESUME-5 a step that already ran is not executed again after a resume", async () => {
    const calls: string[] = [];
    const { scene: s, cast, executors } = setup(calls);
    const stage = manager(s);
    const paused = await stage.perform(s, cast, { executors });
    await stage.resume(paused, { executors, approve: () => true });

    expect(calls).toEqual(["x", "y"]);
  });

  test("R-RESUME-6 resuming something that is not paused is a clear error", async () => {
    const { scene: s, cast, executors } = setup();
    const stage = manager(s);
    const done = await stage.perform(s, cast, { executors, approve: () => true });
    expect(done.finalResult.status).toBe("done");

    await expect(stage.resume(done, { executors })).rejects.toThrow(
      "this performance is not paused at a gate",
    );
  });
});
