import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  failed,
  functionActor,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorContext, ActorOutput, Cast, Scene } from "../../src/index.ts";

interface Probe {
  inFlight: number;
  maxInFlight: number;
  active: Set<string>;
  overlaps: string[];
  historyLengths: Record<string, number>;
}

function makeProbe(): Probe {
  return { inFlight: 0, maxInFlight: 0, active: new Set(), overlaps: [], historyLengths: {} };
}

function probingRun(name: string, kind: string, probe: Probe) {
  return async (ctx: ActorContext): Promise<ActorOutput> => {
    probe.inFlight += 1;
    probe.maxInFlight = Math.max(probe.maxInFlight, probe.inFlight);
    if (probe.active.size > 0) probe.overlaps.push(`${name}<${[...probe.active].join("+")}`);
    probe.active.add(name);
    probe.historyLengths[name] = ctx.history.length;
    await new Promise((resolve) => setTimeout(resolve, 0));
    probe.active.delete(name);
    probe.inFlight -= 1;
    return ok([artifact(name, kind, "x")]);
  };
}

function scene(): Scene {
  return sceneFromCard({
    objective: "produce",
    success_criteria: ["C exists"],
    required_capabilities: ["a", "b", "c"],
  });
}

function evaluatorFor(target: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: target.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "C")
            ? { status: "pass" as const, evidence: "C present" }
            : { status: "fail" as const, evidence: "no C" },
      },
    ]),
  );
}

interface BuildOptions {
  failFirst?: boolean;
  firstOptional?: boolean;
}

function build(options: BuildOptions = {}): { s: Scene; cast: Cast; probe: Probe } {
  const s = scene();
  const probe = makeProbe();
  const first = functionActor({
    name: "first",
    role: "first",
    objective: "a",
    capabilities: ["a"],
    produces: "A",
    run: options.failFirst
      ? () => failed("boom")
      : probingRun("first", "A", probe),
  });
  const second = functionActor({
    name: "second",
    role: "second",
    objective: "b",
    capabilities: ["b"],
    produces: "B",
    run: probingRun("second", "B", probe),
  });
  const third = functionActor({
    name: "third",
    role: "third",
    objective: "c",
    capabilities: ["c"],
    produces: "C",
    run: probingRun("third", "C", probe),
  });
  const cast = createCast(
    [first, second, third],
    createProtocol([
      { actor: "first", instruction: "a", produces: ["A"], optional: options.firstOptional },
      { actor: "second", instruction: "b", produces: ["B"] },
      { actor: "third", instruction: "c", consumes: ["A", "B"], produces: ["C"] },
    ]),
  );
  return { s, cast, probe };
}

describe("Parallel step requirements", () => {
  test("R-PARALLEL-1 without the flag, execution stays sequential", async () => {
    const { s, cast, probe } = build();
    const performance = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, cast);

    expect(performance.finalResult.status).toBe("done");
    expect(probe.maxInFlight).toBe(1);
    expect(probe.overlaps).toHaveLength(0);
    // Sequential: each step sees the turns recorded before it.
    expect(probe.historyLengths).toEqual({ first: 0, second: 1, third: 2 });
  });

  test("R-PARALLEL-2 independent consecutive steps run concurrently", async () => {
    const { s, cast, probe } = build();
    const performance = await new StageManager({
      evaluator: evaluatorFor(s),
      parallel: true,
    }).perform(s, cast);

    expect(performance.finalResult.status).toBe("done");
    expect(probe.maxInFlight).toBe(2);
    expect(probe.overlaps).toEqual(["second<first"]);
  });

  test("R-PARALLEL-3 a dependent step never overlaps its producers", async () => {
    const { s, cast, probe } = build();
    await new StageManager({ evaluator: evaluatorFor(s), parallel: true }).perform(s, cast);
    expect(probe.overlaps.every((entry) => !entry.startsWith("third"))).toBe(true);
  });

  test("R-PARALLEL-4 turns, artifacts and events stay in declaration order", async () => {
    const { s, cast } = build();
    const performance = await new StageManager({
      evaluator: evaluatorFor(s),
      parallel: true,
    }).perform(s, cast);

    expect(performance.turns.map((turn) => turn.actor)).toEqual(["first", "second", "third"]);
    expect(performance.artifacts.map((item) => item.kind)).toEqual(["A", "B", "C"]);
    expect(
      performance.events
        .filter((event) => event.type === "actor_activated")
        .map((event) => (event as { actor: string }).actor),
    ).toEqual(["first", "second", "third"]);
  });

  test("R-PARALLEL-5 a wave shares one history snapshot", async () => {
    const { s, cast, probe } = build();
    await new StageManager({ evaluator: evaluatorFor(s), parallel: true }).perform(s, cast);
    // Peers in a wave do not see each other; the dependent step sees both.
    expect(probe.historyLengths).toEqual({ first: 0, second: 0, third: 2 });
  });

  test("R-PARALLEL-6 a required failure halts later waves; an optional one does not", async () => {
    const required = build({ failFirst: true });
    const halted = await new StageManager({
      evaluator: evaluatorFor(required.s),
      parallel: true,
      maxPerformances: 1,
    }).perform(required.s, required.cast);
    expect(required.probe.active.size).toBe(0);
    expect(halted.turns.map((turn) => turn.actor)).not.toContain("third");

    const optional = build({ failFirst: true, firstOptional: true });
    const continued = await new StageManager({
      evaluator: evaluatorFor(optional.s),
      parallel: true,
    }).perform(optional.s, optional.cast);
    expect(continued.finalResult.status).toBe("done");
    expect(continued.turns.map((turn) => turn.actor)).toContain("third");
  });

  test("R-PARALLEL-7 a parallel run is as reproducible as a sequential one", async () => {
    const runParallel = async () => {
      const { s, cast } = build();
      return new StageManager({ evaluator: evaluatorFor(s), parallel: true }).perform(s, cast);
    };
    const a = await runParallel();
    const b = await runParallel();
    expect(a.turns.map((turn) => `${turn.step}|${turn.actor}|${turn.output.status}`)).toEqual(
      b.turns.map((turn) => `${turn.step}|${turn.actor}|${turn.output.status}`),
    );
    expect(a.artifacts.map((item) => item.kind)).toEqual(b.artifacts.map((item) => item.kind));
  });

  test("R-PARALLEL-8 an actor named like a prototype member runs its own executor", async () => {
    const s = sceneFromCard({
      objective: "produce",
      success_criteria: ["X exists"],
      required_capabilities: ["x"],
    });
    const weird = functionActor({
      name: "constructor",
      role: "constructor",
      objective: "x",
      capabilities: ["x"],
      produces: "X",
      run: () => ok([artifact("constructor", "X", "v")]),
    });
    const cast = createCast(
      [weird],
      createProtocol([{ actor: "constructor", instruction: "x", produces: ["X"] }]),
    );
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: (ctx) =>
            ctx.artifacts.some((item) => item.kind === "X")
              ? { status: "pass" as const, evidence: "ok" }
              : { status: "fail" as const, evidence: "no" },
        },
      ]),
    );
    const performance = await new StageManager({ evaluator }).perform(s, cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns[0]!.output.status).toBe("ok");
  });
});
