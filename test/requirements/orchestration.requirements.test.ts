import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  artifact,
  createActor,
  createCast,
  createLlmExecutor,
  createProtocol,
  createToolRegistry,
  criterionEvaluator,
  failed,
  functionActor,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorContext, Cast, Evaluation, Scene } from "../../src/index.ts";

function scene(capabilities: string[] = ["work"]): Scene {
  return sceneFromCard({
    objective: "produce",
    success_criteria: ["a report exists"],
    required_capabilities: capabilities,
  });
}

function reportEvaluator(s: Scene, kind = "Report"): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: s.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((a) => a.kind === kind)
            ? { status: "pass", evidence: `${kind} present` }
            : { status: "fail", evidence: "no report" },
      },
    ]),
  );
}

function workerCast(
  run: (ctx: ActorContext) => ReturnType<typeof ok> | ReturnType<typeof failed>,
  produces = "Report",
): Cast {
  const worker = functionActor({
    name: "worker",
    role: "worker",
    objective: "produce",
    capabilities: ["work"],
    produces,
    run,
  });
  return createCast(
    [worker],
    createProtocol([{ actor: "worker", instruction: "produce", produces: [produces] }]),
  );
}

describe("Orchestration requirements", () => {
  test("R-ORCH-1 a deterministic actor and an LLM actor are interchangeable to the stage", async () => {
    const s = scene();
    const deterministic = functionActor({
      name: "worker",
      role: "worker",
      objective: "produce",
      capabilities: ["work"],
      produces: "Report",
      run: () => ok([artifact("worker", "Report", "det")]),
    });
    const llmActor = createActor({
      name: "worker",
      role: "worker",
      objective: "produce",
      capabilities: ["work"],
      expectedOutput: ["Report"],
      executor: createLlmExecutor(async () => "llm"),
    });
    const protocol = createProtocol([
      { actor: "worker", instruction: "produce", produces: ["Report"] },
    ]);

    const a = await new StageManager({ evaluator: reportEvaluator(s) }).perform(
      s,
      createCast([deterministic], protocol),
    );
    const b = await new StageManager({ evaluator: reportEvaluator(s) }).perform(
      s,
      createCast([llmActor], protocol),
    );
    expect(a.finalResult.status).toBe("done");
    expect(b.finalResult.status).toBe("done");
    expect(a.artifacts.map((x) => x.kind)).toEqual(b.artifacts.map((x) => x.kind));
  });

  test("R-ORCH-2 a failing optional step does not abort the iteration", async () => {
    const s = scene();
    const brittle = functionActor({
      name: "brittle",
      role: "brittle",
      objective: "assess risk",
      capabilities: ["risk"],
      produces: "Risk",
      run: () => failed("risk service down"),
    });
    const solid = functionActor({
      name: "solid",
      role: "solid",
      objective: "produce",
      capabilities: ["work"],
      produces: "Report",
      run: () => ok([artifact("solid", "Report", "done")]),
    });
    const cast = createCast(
      [brittle, solid],
      createProtocol([
        { actor: "brittle", instruction: "assess", produces: ["Risk"], optional: true },
        { actor: "solid", instruction: "produce", produces: ["Report"] },
      ]),
    );
    const performance = await new StageManager({ evaluator: reportEvaluator(s) }).perform(s, cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.iterations).toHaveLength(1);
    expect(performance.turns.map((t) => t.actor)).toEqual(["brittle", "solid"]);
  });

  test("R-ORCH-3 artifacts from a failed actor are not trusted", async () => {
    const s = scene();
    const cast = workerCast(() => failed("boom", [artifact("worker", "Ghost", "should not survive")]));
    const performance = await new StageManager({
      evaluator: reportEvaluator(s),
      maxPerformances: 1,
    }).perform(s, cast);
    expect(performance.turns[0]!.output.status).toBe("failed");
    expect(performance.artifacts).toHaveLength(0);
  });

  test("R-ORCH-4 an actor receives exactly the artifacts it declares", async () => {
    const s = scene();
    const seen: Record<string, string[]> = {};
    const p1 = functionActor({
      name: "p1", role: "p1", objective: "a", capabilities: ["a"], produces: "A",
      run: () => ok([artifact("p1", "A", "a")]),
    });
    const p2 = functionActor({
      name: "p2", role: "p2", objective: "b", capabilities: ["b"], produces: "B",
      run: () => ok([artifact("p2", "B", "b")]),
    });
    const picky = functionActor({
      name: "picky", role: "picky", objective: "c", capabilities: ["c"], produces: "C",
      run: (ctx) => {
        seen.picky = ctx.inputs.map((i) => i.kind);
        return ok([artifact("picky", "C", "c")]);
      },
    });
    const blind = functionActor({
      name: "blind", role: "blind", objective: "d", capabilities: ["d"], produces: "D",
      run: (ctx) => {
        seen.blind = ctx.inputs.map((i) => i.kind);
        return ok([artifact("blind", "D", "d")]);
      },
    });
    const cast = createCast(
      [p1, p2, picky, blind],
      createProtocol([
        { actor: "p1", instruction: "a", produces: ["A"] },
        { actor: "p2", instruction: "b", produces: ["B"] },
        { actor: "picky", instruction: "c", consumes: ["A"], produces: ["C"] },
        { actor: "blind", instruction: "d", consumes: [], produces: ["D"] },
      ]),
    );
    await new StageManager({ evaluator: reportEvaluator(s, "D") }).perform(s, cast);
    expect(seen.picky).toEqual(["A"]);
    expect(seen.blind).toEqual([]);
  });

  test("R-ORCH-5 the actor context carries everything the actor needs", async () => {
    const s = scene();
    let captured: ActorContext | undefined;
    const worker = functionActor({
      name: "worker", role: "worker", objective: "produce", capabilities: ["work"], produces: "Report",
      run: (ctx) => {
        captured = ctx;
        return ok([artifact("worker", "Report", "done")]);
      },
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce now", produces: ["Report"] }]),
    );
    await new StageManager({ evaluator: reportEvaluator(s) }).perform(s, cast);
    expect(captured!.scene.id).toBe(s.id);
    expect(captured!.actor.name).toBe("worker");
    expect(captured!.instruction).toBe("produce now");
    expect(captured!.iteration).toBe(1);
    expect(captured!.history).toEqual([]);
    expect(typeof captured!.tools.names).toBe("function");
  });

  test("R-ORCH-6 later actors see the turns that came before", async () => {
    const s = scene();
    let historyLength = -1;
    let firstActor = "";
    const first = functionActor({
      name: "first", role: "first", objective: "a", capabilities: ["a"], produces: "A",
      run: () => ok([artifact("first", "A", "a")]),
    });
    const second = functionActor({
      name: "second", role: "second", objective: "b", capabilities: ["b"], produces: "B",
      run: (ctx) => {
        historyLength = ctx.history.length;
        firstActor = ctx.history[0]!.actor;
        return ok([artifact("second", "B", "b")]);
      },
    });
    const cast = createCast(
      [first, second],
      createProtocol([
        { actor: "first", instruction: "a", produces: ["A"] },
        { actor: "second", instruction: "b", produces: ["B"] },
      ]),
    );
    await new StageManager({ evaluator: reportEvaluator(s, "B") }).perform(s, cast);
    expect(historyLength).toBe(1);
    expect(firstActor).toBe("first");
  });

  test("R-ORCH-7 the performance budget is a hard cap", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: () => ({ status: "fail" as const, evidence: "always fails" }),
        },
      ]),
    );
    const performance = await new StageManager({ evaluator, maxPerformances: 1 }).perform(
      s,
      workerCast(() => ok([artifact("worker", "Report", "done")])),
    );
    expect(performance.iterations).toHaveLength(1);
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.finalResult.reason).toBe("max performances reached");
  });

  test("R-ORCH-8 a redesign starts the artifact world over", async () => {
    const wrong = sceneFromCard({
      objective: "wrong",
      success_criteria: ["a fix exists"],
      required_capabilities: ["fix"],
    });
    const wrongActor = functionActor({
      name: "wrong", role: "wrong", objective: "solve", capabilities: ["fix"], produces: "Draft",
      run: () => ok([artifact("wrong", "Draft", "irrelevant")]),
    });
    const castA = createCast(
      [wrongActor],
      createProtocol([{ actor: "wrong", instruction: "solve", produces: ["Draft"] }]),
    );
    const rightActor = functionActor({
      name: "right", role: "right", objective: "solve", capabilities: ["fix"], produces: "Fix",
      run: () => ok([artifact("right", "Fix", "real")]),
    });
    const castB = createCast(
      [rightActor],
      createProtocol([{ actor: "right", instruction: "solve", produces: ["Fix"] }]),
    );
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "REDESIGNED",
        success_criteria: ["a fix exists"],
        required_capabilities: ["fix"],
      }),
    });
    const castingDirector = new CastingDirector({
      cast: (s) => (s.objective.startsWith("REDESIGNED") ? castB : castA),
    });
    const evaluator = new Evaluator((ctx): Evaluation => {
      const fixed = ctx.artifacts.some((a) => a.kind === "Fix");
      return {
        id: "e",
        status: fixed ? "pass" : "fail",
        criteria: [
          {
            criterion: ctx.scene.successCriteria[0]!.id,
            status: fixed ? "pass" : "fail",
            evidence: fixed ? "fix present" : "no fix",
          },
        ],
        issues: [],
        recommendedAction: fixed ? "finish" : "redesign_scene",
        diagnosis: fixed ? "unspecified" : "malformed_problem",
        createdAt: 0,
        meta: {},
      };
    });

    const performance = await new StageManager({
      evaluator,
      castingDirector,
      sceneDesigner,
    }).perform(wrong, castA);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.artifacts.map((a) => a.kind)).toEqual(["Fix"]);
  });

  test("R-ORCH-9 the event trace explains every decision", async () => {
    const s = scene();
    const worker = functionActor({
      name: "work", role: "work", objective: "produce", capabilities: ["work"], produces: "Report",
      run: () => ok([artifact("work", "Report", "done")]),
    });
    const castA = createCast(
      [worker],
      createProtocol([{ actor: "work", instruction: "produce", produces: ["Report"] }]),
    );
    const evaluator = new Evaluator((ctx): Evaluation => {
      const covered = ctx.artifacts.some((a) => a.kind === "ComplianceReport");
      return {
        id: "e",
        status: covered ? "pass" : "fail",
        criteria: [
          {
            criterion: s.successCriteria[0]!.id,
            status: covered ? "pass" : "fail",
            evidence: covered ? "ok" : "need compliance",
          },
        ],
        issues: [],
        recommendedAction: covered ? "finish" : "recast",
        diagnosis: covered ? "unspecified" : "missing_capability",
        missingCapabilities: covered ? [] : ["compliance"],
        createdAt: 0,
        meta: {},
      };
    });
    const performance = await new StageManager({
      evaluator,
      executors: {
        compliance: () => ok([artifact("compliance", "ComplianceReport", "c")]),
        synthesizer: () => ok([artifact("synthesizer", "FinalAnswer", "m")]),
      },
      maxRecasts: 2,
    }).perform(s, castA);

    const types = performance.events.map((e) => e.type);
    expect(types[0]).toBe("cast_selected");
    expect(types.at(-1)).toBe("finished");

    const decisions = performance.events.filter((e) => e.type === "decision");
    const evaluated = performance.events.filter((e) => e.type === "evaluated");
    expect(decisions).toHaveLength(evaluated.length);
    for (let i = 0; i < decisions.length; i += 1) {
      expect(performance.events.indexOf(decisions[i]!)).toBeGreaterThan(
        performance.events.indexOf(evaluated[i]!),
      );
    }
    expect(types.indexOf("recast")).toBeGreaterThan(types.indexOf("decision"));
  });

  test("R-ORCH-11 a tool failure surfaces as an actor failure", async () => {
    const s = scene();
    const worker = functionActor({
      name: "worker", role: "worker", objective: "produce", capabilities: ["work"], produces: "Report",
      run: async (ctx) => {
        await ctx.tools.call("boom", null, ctx);
        return ok([artifact("worker", "Report", "x")]);
      },
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
    );
    const tools = createToolRegistry({
      boom: () => {
        throw new Error("tool down");
      },
    });
    const performance = await new StageManager({
      evaluator: reportEvaluator(s),
      tools,
      maxPerformances: 1,
    }).perform(s, cast);
    expect(performance.turns[0]!.output.status).toBe("failed");
    expect(performance.turns[0]!.output.error).toContain("tool down");
  });

  test("R-ORCH-12 an executor override takes precedence for one performance", async () => {
    const s = scene();
    const worker = functionActor({
      name: "worker", role: "worker", objective: "produce", capabilities: ["work"], produces: "Report",
      run: () => failed("original executor fails"),
    });
    const cast = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
    );
    const performance = await new StageManager({
      evaluator: reportEvaluator(s),
      executors: { worker: () => ok([artifact("worker", "Report", "override")]) },
    }).perform(s, cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.artifacts.map((a) => a.kind)).toEqual(["Report"]);
    expect(worker.executor).toBeDefined();
  });

  test("R-ORCH-13 the shared chat function drives LLM actors only", async () => {
    const s = scene();
    const llmActor = createActor({
      name: "model", role: "model", objective: "answer", capabilities: ["work"], expectedOutput: ["Report"],
    });
    const castLlm = createCast(
      [llmActor],
      createProtocol([{ actor: "model", instruction: "answer", produces: ["Report"] }]),
    );
    const withChat = await new StageManager({
      evaluator: reportEvaluator(s),
      chat: async () => "generated report",
    }).perform(s, castLlm);
    expect(withChat.finalResult.status).toBe("done");
    expect(withChat.artifacts[0]!.content).toBe("generated report");

    const deterministicNoExecutor = createActor({
      name: "model", role: "model", objective: "answer", kind: "deterministic",
      capabilities: ["work"], expectedOutput: ["Report"],
    });
    const castDeterministic = createCast(
      [deterministicNoExecutor],
      createProtocol([{ actor: "model", instruction: "answer", produces: ["Report"] }]),
    );
    const noExecutor = await new StageManager({
      evaluator: reportEvaluator(s),
      chat: async () => "should not be used",
      maxPerformances: 1,
    }).perform(s, castDeterministic);
    expect(noExecutor.turns[0]!.output.status).toBe("failed");
    expect(noExecutor.turns[0]!.output.error).toContain("no executor available");
  });
});
