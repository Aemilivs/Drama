import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  Evaluator,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  functionActor,
  ok,
  planWaves,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorOutput, Cast, Scene } from "../../src/index.ts";

function scene(required: string[] = ["x"]): Scene {
  return sceneFromCard({
    objective: "produce",
    success_criteria: ["X exists"],
    required_capabilities: required,
  });
}

function evaluatorFor(target: Scene, kind = "X"): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: target.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === kind)
            ? { status: "pass" as const, evidence: "present" }
            : { status: "fail" as const, evidence: "missing" },
      },
    ]),
  );
}

function worker(name: string, produces: string, run?: () => ActorOutput | Promise<ActorOutput>) {
  return functionActor({
    name,
    role: name,
    objective: name,
    capabilities: [name],
    produces,
    run: run ?? (() => ok([artifact(name, produces, "v")])),
  });
}

describe("Graph guardrail requirements", () => {
  test("R-GUARD-1 an approved gate lets the step run and is traced", async () => {
    const s = scene();
    const cast = createCast(
      [worker("x", "X")],
      createProtocol([{ actor: "x", instruction: "go", produces: ["X"], gate: true }]),
    );
    const performance = await new StageManager({
      evaluator: evaluatorFor(s),
      approve: () => true,
    }).perform(s, cast);

    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns).toHaveLength(1);
    expect(performance.events.find((event) => event.type === "gate")).toEqual({
      type: "gate",
      iteration: 1,
      step: "step-1",
      actor: "x",
      approved: true,
    });
  });

  test("R-GUARD-2 with no approver the gate fails closed and nothing runs", async () => {
    const s = scene();
    const cast = createCast(
      [worker("x", "X")],
      createProtocol([{ actor: "x", instruction: "go", produces: ["X"], gate: true }]),
    );
    const performance = await new StageManager({
      evaluator: evaluatorFor(s),
      maxPerformances: 1,
    }).perform(s, cast);

    expect(performance.finalResult.status).toBe("failed");
    expect(performance.turns).toHaveLength(0);
    expect(performance.artifacts).toHaveLength(0);
    expect(
      performance.events.some(
        (event) => event.type === "gate" && event.approved === false,
      ),
    ).toBe(true);
  });

  test("R-GUARD-3 a denied optional gate is skipped and the rest continues", async () => {
    const s = scene();
    const cast = createCast(
      [worker("x", "X"), worker("y", "Y")],
      createProtocol([
        { actor: "x", instruction: "go", produces: ["X"], gate: true, optional: true },
        { actor: "y", instruction: "go", produces: ["Y"] },
      ]),
    );
    const performance = await new StageManager({
      evaluator: evaluatorFor(s, "Y"),
      approve: () => false,
      parallel: true,
    }).perform(s, cast);

    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns.map((turn) => turn.actor)).toEqual(["y"]);
    expect(performance.artifacts.map((item) => item.kind)).toEqual(["Y"]);
  });

  test("R-GUARD-4 an approver that throws counts as denied", async () => {
    const s = scene();
    const cast = createCast(
      [worker("x", "X")],
      createProtocol([{ actor: "x", instruction: "go", produces: ["X"], gate: true }]),
    );
    const performance = await new StageManager({
      evaluator: evaluatorFor(s),
      approve: () => {
        throw new Error("no human available");
      },
      maxPerformances: 1,
    }).perform(s, cast);

    expect(performance.turns).toHaveLength(0);
    expect(
      performance.events.some((event) => event.type === "gate" && event.approved === false),
    ).toBe(true);
  });

  test("R-GUARD-5 overlapping write globs in one wave are an error", () => {
    const s = scene(["a", "b"]);
    const conflicting = createCast(
      [worker("a", "A"), worker("b", "B")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"], owns: ["src/**"] },
        { actor: "b", instruction: "go", produces: ["B"], owns: ["src/lib/**"] },
      ]),
    );
    expect(
      new CastingDirector()
        .validate(s, conflicting)
        .some((issue) => issue.code === "owns_conflict" && issue.severity === "error"),
    ).toBe(true);

    // Ordered by a real dependency: no conflict.
    const ordered = createCast(
      [worker("a", "A"), worker("b", "B")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"], owns: ["src/**"] },
        { actor: "b", instruction: "go", consumes: ["A"], produces: ["B"], owns: ["src/lib/**"] },
      ]),
    );
    expect(
      new CastingDirector().validate(s, ordered).some((issue) => issue.code === "owns_conflict"),
    ).toBe(false);
  });

  test("R-GUARD-6 maxConcurrency caps how many steps share a wave", async () => {
    const s = scene(["a", "b", "c"]);
    let inFlight = 0;
    let maxInFlight = 0;
    const probe = (name: string, kind: string) =>
      async (): Promise<ActorOutput> => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight -= 1;
        return ok([artifact(name, kind, "v")]);
      };
    const cast: Cast = createCast(
      [
        worker("a", "A", probe("a", "A")),
        worker("b", "B", probe("b", "B")),
        worker("c", "C", probe("c", "C")),
      ],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
        { actor: "c", instruction: "go", produces: ["C"] },
      ]),
    );
    await new StageManager({
      evaluator: evaluatorFor(s, "C"),
      parallel: true,
      maxConcurrency: 2,
    }).perform(s, cast);

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test("R-GUARD-7 maxTurns stops the performance with a clear reason", async () => {
    const s = scene(["a", "b", "c"]);
    const cast = createCast(
      [worker("a", "A"), worker("b", "B"), worker("c", "C")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
        { actor: "c", instruction: "go", produces: ["C"] },
      ]),
    );
    const performance = await new StageManager({
      evaluator: evaluatorFor(s, "C"),
      maxTurns: 1,
    }).perform(s, cast);

    expect(performance.turns).toHaveLength(1);
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.finalResult.reason).toContain("max turns");
  });

  test("R-GUARD-9 an independent pair declared in sequence is reported as a fake edge", () => {
    const s = scene(["a", "b", "c"]);
    const independent = createCast(
      [worker("a", "A"), worker("b", "B")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
      ]),
    );
    const found = new CastingDirector()
      .validate(s, independent)
      .find((issue) => issue.code === "independent_steps");
    expect(found?.severity).toBe("warning");
    expect(found?.message).toContain("step-1");
    expect(found?.message).toContain("step-2");

    const dependent = createCast(
      [worker("a", "A"), worker("b", "B")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", consumes: ["A"], produces: ["B"] },
      ]),
    );
    expect(
      new CastingDirector().validate(s, dependent).some((i) => i.code === "independent_steps"),
    ).toBe(false);
  });

  test("R-GUARD-10 terminal artifacts with several owners are reported", () => {
    const s = scene(["a", "b"]);
    const split = createCast(
      [worker("a", "A"), worker("b", "B")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
      ]),
    );
    const found = new CastingDirector()
      .validate(s, split)
      .find((issue) => issue.code === "no_merge_owner");
    expect(found?.severity).toBe("warning");
    expect(found?.actors.sort()).toEqual(["a", "b"]);

    const merged = createCast(
      [worker("a", "A"), worker("b", "B"), worker("c", "C")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
        { actor: "c", instruction: "go", consumes: ["A", "B"], produces: ["C"] },
      ]),
    );
    expect(
      new CastingDirector().validate(s, merged).some((i) => i.code === "no_merge_owner"),
    ).toBe(false);
  });

  test("R-GUARD-8 planWaves previews the schedule the stage will run", () => {
    const cast = createCast(
      [worker("a", "A"), worker("b", "B"), worker("c", "C")],
      createProtocol([
        { actor: "a", instruction: "go", produces: ["A"] },
        { actor: "b", instruction: "go", produces: ["B"] },
        { actor: "c", instruction: "go", consumes: ["A", "B"], produces: ["C"] },
      ]),
    );
    const ids = (waves: { id: string }[][]) => waves.map((wave) => wave.map((step) => step.id));
    expect(ids(planWaves(cast.protocol.steps))).toEqual([["step-1", "step-2"], ["step-3"]]);
    expect(ids(planWaves(cast.protocol.steps, { maxConcurrency: 1 }))).toEqual([
      ["step-1"],
      ["step-2"],
      ["step-3"],
    ]);
  });
});
