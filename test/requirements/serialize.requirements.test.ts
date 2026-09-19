import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  acceptAllAuditioner,
  artifact,
  createCast,
  createPersona,
  createProtocol,
  criterionEvaluator,
  deserializePerformance,
  dressCast,
  formatPerformance,
  functionActor,
  ok,
  sceneFromCard,
  serializePerformance,
} from "../../src/index.ts";
import type { Cast, Scene } from "../../src/index.ts";
import { normalizePerformance } from "./_support.ts";

function evaluatorFor(scene: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: scene.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "Report")
            ? { status: "pass" as const, evidence: "report present" }
            : { status: "fail" as const, evidence: "no report" },
      },
    ]),
  );
}

function scenario(): { s: Scene; cast: Cast } {
  const s = sceneFromCard({
    objective: "produce",
    success_criteria: ["a report exists"],
    required_capabilities: ["work"],
  });
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
  return { s, cast };
}

describe("Performance serialisation requirements", () => {
  test("R-SERIAL-1 a performance round-trips through JSON", async () => {
    const { s, cast } = scenario();
    const original = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, cast);
    const reloaded = deserializePerformance(serializePerformance(original));
    expect(reloaded).toEqual(JSON.parse(JSON.stringify(original)));
  });

  test("R-SERIAL-2 executors are dropped on write and re-attached on read", async () => {
    const { s, cast } = scenario();
    const original = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, cast);
    const json = serializePerformance(original);
    expect(json).not.toContain('"executor"');

    const worker = () => ok([artifact("worker", "Report", "reattached")]);
    const reloaded = deserializePerformance(json, { executors: { worker } });
    expect((reloaded.cast.actors[0] as { executor?: unknown }).executor).toBe(worker);
    expect((reloaded.casts[0]!.actors[0] as { executor?: unknown }).executor).toBe(worker);
  });

  test("R-SERIAL-3 persona bindings survive the round-trip", async () => {
    const { s, cast } = scenario();
    const { cast: dressed } = await dressCast(cast, s, {
      personas: [createPersona({ id: "ada", name: "Ada" })],
      auditioner: acceptAllAuditioner(),
    });
    const performance = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, dressed);
    const reloaded = deserializePerformance(serializePerformance(performance));
    expect(reloaded.cast.actors[0]!.binding?.persona.id).toBe("ada");
    expect(reloaded.cast.actors[0]!.binding?.persona.name).toBe("Ada");
  });

  test("R-SERIAL-4 a foreign or broken document is rejected with a clear error", () => {
    expect(() => deserializePerformance("not json")).toThrow("invalid performance JSON");
    expect(() => deserializePerformance('{"format":"other"}')).toThrow(
      "not a drama.performance document",
    );
    expect(() =>
      deserializePerformance(JSON.stringify({ format: "drama.performance", performance: {} })),
    ).toThrow("formatVersion");
    expect(() =>
      deserializePerformance(JSON.stringify({ format: "drama.performance", formatVersion: 1 })),
    ).toThrow("payload");
  });

  test("R-SERIAL-5 a reloaded trace renders identically", async () => {
    const { s, cast } = scenario();
    const original = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, cast);
    const reloaded = deserializePerformance(serializePerformance(original));
    expect(formatPerformance(reloaded)).toBe(formatPerformance(original));
  });

  test("R-SERIAL-6 a stored trace can be replayed with re-supplied machinery", async () => {
    const { s, cast } = scenario();
    const first = await new StageManager({ evaluator: evaluatorFor(s) }).perform(s, cast);

    // Replay: the trace gives back the scene and cast; the evaluator and the
    // executors are re-supplied, because a Performance does not carry them.
    const reloaded = deserializePerformance(serializePerformance(first), {
      executors: { worker: () => ok([artifact("worker", "Report", "done")]) },
    });
    const replay = await new StageManager({ evaluator: evaluatorFor(reloaded.scene) }).perform(
      reloaded.scene,
      reloaded.cast,
    );
    expect(normalizePerformance(replay)).toEqual(normalizePerformance(first));
  });
});
