import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  failed,
  functionActor,
  ok,
  sceneFromCard,
} from "../src/index.ts";
import type { Cast, Evaluation, Scene } from "../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "produce a report",
    success_criteria: ["a report exists"],
    required_capabilities: ["work"],
  });
}

function hasReport(s: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: s.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "Report")
            ? { status: "pass", evidence: "report present" }
            : { status: "fail", evidence: "no report produced" },
      },
    ]),
  );
}

function reportCast(run: () => ReturnType<typeof ok> | ReturnType<typeof failed>): Cast {
  const worker = functionActor({
    name: "worker",
    role: "worker",
    objective: "produce a report",
    capabilities: ["work"],
    produces: "Report",
    run: () => run(),
  });
  return createCast(
    [worker],
    createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
  );
}

describe("orchestration", () => {
  test("a successful performance finishes in one iteration", async () => {
    const s = scene();
    const stage = new StageManager({ evaluator: hasReport(s) });
    const performance = await stage.perform(
      s,
      reportCast(() => ok([artifact("worker", "Report", "done")])),
    );

    expect(performance.finalResult.status).toBe("done");
    expect(performance.iterations).toHaveLength(1);
    expect(performance.artifacts).toHaveLength(1);
    expect(performance.events.some((e) => e.type === "finished")).toBe(true);
    expect(performance.events.filter((e) => e.type === "actor_activated")).toHaveLength(1);
  });

  test("an actor failure triggers a reperformance that then succeeds", async () => {
    const s = scene();
    const stage = new StageManager({ evaluator: hasReport(s) });
    // an iteration-aware executor: fail on the first performance only
    const worker = functionActor({
      name: "worker",
      role: "worker",
      objective: "produce a report",
      capabilities: ["work"],
      produces: "Report",
      run: (ctx) =>
        ctx.iteration === 1
          ? failed("transient connection reset")
          : ok([artifact("worker", "Report", "done")]),
    });
    const flaky = createCast(
      [worker],
      createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"] }]),
    );

    const performance = await stage.perform(s, flaky);
    expect(performance.iterations).toHaveLength(2);
    expect(performance.iterations[0]!.decision).toBe("reperform");
    expect(performance.iterations[1]!.decision).toBe("finish");
    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns.filter((t) => t.output.status === "failed")).toHaveLength(1);
    expect(performance.events.some((e) => e.type === "actor_failed")).toBe(true);
  });

  test("an evaluator that always crashes exhausts the performance budget", async () => {
    const s = scene();
    const stage = new StageManager({
      evaluator: new Evaluator(() => {
        throw new Error("judge unavailable");
      }),
      maxPerformances: 2,
    });
    const performance = await stage.perform(
      s,
      reportCast(() => ok([artifact("worker", "Report", "done")])),
    );

    expect(performance.iterations).toHaveLength(2);
    expect(
      performance.iterations.every((i) => i.evaluation!.status === "uncertain"),
    ).toBe(true);
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.finalResult.reason).toBe("max performances reached");
  });

  test("a missing capability causes a recast and a second performance", async () => {
    const s = sceneFromCard({
      objective: "produce a drafted, expert-reviewed answer",
      success_criteria: ["expertise is present"],
      required_capabilities: ["basic", "expertise"],
    });

    const draftWorker = functionActor({
      name: "worker",
      role: "worker",
      objective: "draft",
      capabilities: ["basic"],
      produces: "Draft",
      run: () => ok([artifact("worker", "Draft", "draft")]),
    });
    const castA = createCast(
      [draftWorker],
      createProtocol([{ actor: "worker", instruction: "draft", produces: ["Draft"] }]),
    );

    const expert = functionActor({
      name: "expert",
      role: "expert",
      objective: "add expertise",
      capabilities: ["expertise"],
      produces: "Expertise",
      run: () => ok([artifact("expert", "Expertise", "expert view")]),
    });
    const castB = createCast(
      [draftWorker, expert],
      createProtocol([
        { actor: "worker", instruction: "draft", produces: ["Draft"] },
        {
          actor: "expert",
          instruction: "review the draft",
          consumes: ["Draft"],
          produces: ["Expertise"],
        },
      ]),
    );

    const attempts: number[] = [];
    const castingDirector = new CastingDirector({
      cast: (_scene, ctx) => {
        attempts.push(ctx.attempt);
        return ctx.attempt >= 2 ? castB : castA;
      },
    });

    const evaluator = new Evaluator((ctx): Evaluation => {
      const present = ctx.artifacts.some((item) => item.kind === "Expertise");
      return {
        id: "eval",
        status: present ? "pass" : "fail",
        criteria: [
          {
            criterion: s.successCriteria[0]!.id,
            status: present ? "pass" : "fail",
            evidence: present ? "expertise artifact present" : "no expertise in the cast",
          },
        ],
        issues: [],
        recommendedAction: present ? "finish" : "recast",
        diagnosis: present ? "unspecified" : "missing_capability",
        createdAt: 0,
        meta: {},
      };
    });

    const stage = new StageManager({ evaluator, castingDirector });
    const performance = await stage.perform(s, castA);

    expect(performance.casts).toHaveLength(2);
    expect(performance.casts[1]!.actors.map((a) => a.name)).toEqual(["worker", "expert"]);
    expect(attempts).toEqual([2]); // the initial cast is attempt 1; the first recast is attempt 2
    expect(performance.events.some((e) => e.type === "recast")).toBe(true);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.artifacts.some((a) => a.kind === "Expertise")).toBe(true);
  });

  test("a malformed problem causes a scene redesign", async () => {
    const wrongScene = sceneFromCard({
      objective: "solve the wrong problem",
      success_criteria: ["a fix exists"],
      required_capabilities: ["fixing"],
    });

    const wrongActor = functionActor({
      name: "wrong",
      role: "wrong",
      objective: "solve the wrong problem",
      capabilities: ["fixing"],
      produces: "Draft",
      run: () => ok([artifact("wrong", "Draft", "irrelevant")]),
    });
    const castA = createCast(
      [wrongActor],
      createProtocol([{ actor: "wrong", instruction: "solve", produces: ["Draft"] }]),
    );

    const rightActor = functionActor({
      name: "right",
      role: "right",
      objective: "solve the real problem",
      capabilities: ["fixing"],
      produces: "Fix",
      run: () => ok([artifact("right", "Fix", "the real fix")]),
    });
    const castB = createCast(
      [rightActor],
      createProtocol([{ actor: "right", instruction: "solve", produces: ["Fix"] }]),
    );

    const sceneDesigner = new SceneDesigner({
      design: (input) =>
        input.previous
          ? {
              objective: "REDESIGNED: solve the real problem",
              success_criteria: ["a fix exists"],
              required_capabilities: ["fixing"],
            }
          : {
              objective: "solve the wrong problem",
              success_criteria: ["a fix exists"],
              required_capabilities: ["fixing"],
            },
    });

    const castingDirector = new CastingDirector({
      cast: (s) => (s.objective.startsWith("REDESIGNED") ? castB : castA),
    });

    const evaluator = new Evaluator((ctx): Evaluation => {
      const fixed = ctx.artifacts.some((item) => item.kind === "Fix");
      return {
        id: "eval",
        status: fixed ? "pass" : "fail",
        criteria: [
          {
            criterion: ctx.scene.successCriteria[0]!.id,
            status: fixed ? "pass" : "fail",
            evidence: fixed ? "fix present" : "the question itself was wrong",
          },
        ],
        issues: [],
        recommendedAction: fixed ? "finish" : "redesign_scene",
        diagnosis: fixed ? "unspecified" : "malformed_problem",
        createdAt: 0,
        meta: {},
      };
    });

    const stage = new StageManager({ evaluator, castingDirector, sceneDesigner });
    const performance = await stage.perform(wrongScene, castA);

    expect(performance.scenes).toHaveLength(2);
    expect(performance.scenes[1]!.objective).toContain("REDESIGNED");
    expect(performance.events.some((e) => e.type === "redesign")).toBe(true);
    expect(performance.finalResult.status).toBe("done");
  });

  test("run() reports blocking unknowns as needs_input", async () => {
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "choose a queue",
        success_criteria: ["one queue named"],
        required_capabilities: ["research"],
        unknown: [{ text: "Do we need exactly-once delivery?", blocking: true }],
      }),
    });
    const stage = new StageManager({
      evaluator: hasReport(scene()),
      sceneDesigner,
    });
    const outcome = await stage.run("choose a queue");
    expect(outcome.kind).toBe("needs_input");
    if (outcome.kind === "needs_input") {
      expect(outcome.questions).toContain("Do we need exactly-once delivery?");
    }
  });

  test("run() designs, casts and performs when nothing blocks", async () => {
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "produce a report",
        success_criteria: ["a report exists"],
        required_capabilities: ["work"],
      }),
    });
    const stage = new StageManager({ evaluator: hasReport(scene()), sceneDesigner });
    const outcome = await stage.run("produce a report");
    expect(outcome.kind).toBe("performance");
  });

  test("an actor with no executor fails explicitly", async () => {
    const s = scene();
    const orphan = createCast(
      [
        {
          name: "ghost",
          role: "ghost",
          objective: "haunt",
          kind: "llm",
          capabilities: ["work"],
          tools: [],
          knowledge: [],
          constraints: [],
          interactionPermissions: [],
          expectedOutput: ["Report"],
        },
      ],
      createProtocol([{ actor: "ghost", instruction: "appear", produces: ["Report"] }]),
    );
    const stage = new StageManager({ evaluator: hasReport(s) });
    const performance = await stage.perform(s, orphan);
    expect(performance.turns[0]!.output.status).toBe("failed");
    expect(performance.turns[0]!.output.error).toContain("no executor available");
  });

  test("exhausting the recast budget fails truthfully", async () => {
    const s = scene();
    const evaluator = new Evaluator((): Evaluation => ({
      id: "e",
      status: "fail",
      criteria: [],
      issues: [],
      recommendedAction: "recast",
      diagnosis: "missing_capability",
      createdAt: 0,
      meta: {},
    }));
    const stage = new StageManager({ evaluator, maxRecasts: 1, maxPerformances: 5 });
    const performance = await stage.perform(
      s,
      reportCast(() => ok([artifact("worker", "Report", "done")])),
    );
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.finalResult.reason).toBe("max recasts reached");
  });

  test("exhausting the redesign budget fails truthfully", async () => {
    const s = scene();
    const evaluator = new Evaluator((): Evaluation => ({
      id: "e",
      status: "fail",
      criteria: [],
      issues: [],
      recommendedAction: "redesign_scene",
      diagnosis: "malformed_problem",
      createdAt: 0,
      meta: {},
    }));
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "again",
        success_criteria: ["r"],
        required_capabilities: ["work"],
      }),
    });
    const stage = new StageManager({
      evaluator,
      sceneDesigner,
      maxRedesigns: 1,
      maxPerformances: 5,
    });
    const performance = await stage.perform(
      s,
      reportCast(() => ok([artifact("worker", "Report", "done")])),
    );
    expect(performance.scenes).toHaveLength(2);
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.finalResult.reason).toBe("max redesigns reached");
  });

  test("a recast after a redesign restarts the attempt counter", async () => {
    const sceneA = sceneFromCard({
      objective: "original",
      success_criteria: ["done"],
      required_capabilities: ["a"],
    });
    const alpha = functionActor({
      name: "alpha",
      role: "alpha",
      objective: "work",
      capabilities: ["a"],
      produces: "A",
      run: () => ok([artifact("alpha", "A", "a")]),
    });
    const castA = createCast(
      [alpha],
      createProtocol([{ actor: "alpha", instruction: "work", produces: ["A"] }]),
    );
    const beta = functionActor({
      name: "beta",
      role: "beta",
      objective: "work",
      capabilities: ["a"],
      produces: "B",
      run: () => ok([artifact("beta", "B", "b")]),
    });
    const castB = createCast(
      [beta],
      createProtocol([{ actor: "beta", instruction: "work", produces: ["B"] }]),
    );

    const attempts: number[] = [];
    const castingDirector = new CastingDirector({
      cast: (s, ctx) => {
        attempts.push(ctx.attempt);
        return s.objective.startsWith("REDESIGNED") ? castB : castA;
      },
    });

    const recast: Evaluation = {
      id: "e", status: "fail", criteria: [], issues: [],
      recommendedAction: "recast", diagnosis: "missing_capability", createdAt: 0, meta: {},
    };
    const redesign: Evaluation = {
      id: "e", status: "fail", criteria: [], issues: [],
      recommendedAction: "redesign_scene", diagnosis: "malformed_problem", createdAt: 0, meta: {},
    };
    const finish: Evaluation = {
      id: "e", status: "pass",
      criteria: [{ criterion: "criterion-1", status: "pass", evidence: "ok" }],
      issues: [], recommendedAction: "finish", diagnosis: "unspecified", createdAt: 0, meta: {},
    };
    const evaluator = new Evaluator((ctx) =>
      ctx.iteration === 1
        ? recast
        : ctx.iteration === 2
          ? redesign
          : ctx.iteration === 3
            ? recast
            : finish,
    );
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "REDESIGNED: restated",
        success_criteria: ["done"],
        required_capabilities: ["a"],
      }),
    });

    const stage = new StageManager({
      evaluator,
      castingDirector,
      sceneDesigner,
      maxRedesigns: 1,
      maxRecasts: 2,
      maxPerformances: 5,
    });
    const performance = await stage.perform(sceneA, castA);

    expect(performance.finalResult.status).toBe("done");
    expect(performance.scenes).toHaveLength(2);
    // recast (attempt 2) -> redesign casts the new scene (attempt 1) -> recast (attempt 2)
    expect(attempts).toEqual([2, 1, 2]);
  });
});
