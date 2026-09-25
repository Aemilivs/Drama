import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createActor,
  createCast,
  createProtocol,
  criterionEvaluator,
  deserializePerformance,
  ok,
  sceneFromCard,
  serializePerformance,
} from "../../src/index.ts";
import type { ActorContext, ActorExecutor, Performance } from "../../src/index.ts";

const scene = sceneFromCard({
  objective: "produce a report",
  success_criteria: ["a report artifact exists"],
  required_capabilities: ["drafting", "reviewing"],
});

const evaluator = () =>
  new Evaluator(
    criterionEvaluator([
      {
        // The scene's own Criterion object: the evaluator matches results by id,
        // so a look-alike string would leave the criterion unevaluated.
        criterion: scene.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "Report")
            ? { status: "pass", evidence: "report present" }
            : { status: "fail", evidence: "no report" },
      },
    ]),
  );

/**
 * Two steps whose second consumes the first's output, so they cannot share a wave
 * and the abort lands cleanly between them.
 */
const twoStepCast = (first: ActorExecutor, second: ActorExecutor) =>
  createCast(
    [
      createActor({
        name: "drafter",
        role: "drafter",
        objective: "draft",
        capabilities: ["drafting"],
        expectedOutput: ["Draft"],
        executor: first,
      }),
      createActor({
        name: "finisher",
        role: "finisher",
        objective: "finish",
        capabilities: ["reviewing"],
        expectedOutput: ["Report"],
        executor: second,
      }),
    ],
    createProtocol([
      { actor: "drafter", instruction: "draft", produces: ["Draft"] },
      { actor: "finisher", instruction: "finish", consumes: ["Draft"], produces: ["Report"] },
    ]),
  );

const soloCast = (executor: ActorExecutor) =>
  createCast(
    [
      createActor({
        name: "solo",
        role: "solo",
        objective: "produce the report",
        capabilities: ["drafting", "reviewing"],
        expectedOutput: ["Report"],
        executor,
      }),
    ],
    createProtocol([{ actor: "solo", instruction: "produce", produces: ["Report"] }]),
  );

const run = (cast: ReturnType<typeof twoStepCast>, signal?: AbortSignal): Promise<Performance> =>
  new StageManager({ evaluator: evaluator() }).perform(scene, cast, { signal });

describe("Cancellation requirements", () => {
  test("R-ABORT-1 an already-aborted signal runs nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const seen: string[] = [];

    const performance = await run(
      twoStepCast(
        async () => {
          seen.push("drafter");
          return ok([artifact("drafter", "Draft", "d")]);
        },
        async () => {
          seen.push("finisher");
          return ok([artifact("finisher", "Report", "r")]);
        },
      ),
      controller.signal,
    );

    expect(seen).toEqual([]);
    expect(performance.turns).toHaveLength(0);
    expect(performance.finalResult.status).toBe("aborted");
  });

  test("R-ABORT-2 aborting mid-performance keeps what was produced and starts nothing new", async () => {
    const controller = new AbortController();
    const seen: string[] = [];

    const performance = await run(
      twoStepCast(
        async () => {
          seen.push("drafter");
          controller.abort();
          return ok([artifact("drafter", "Draft", "d1")]);
        },
        async () => {
          seen.push("finisher");
          return ok([artifact("finisher", "Report", "r1")]);
        },
      ),
      controller.signal,
    );

    expect(seen).toEqual(["drafter"]);
    expect(performance.finalResult.status).toBe("aborted");
    expect(performance.artifacts.map((item) => item.kind)).toEqual(["Draft"]);
  });

  test("R-ABORT-3 the signal an attempt sees follows the performance signal", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;

    const performance = await run(
      soloCast(async (ctx: ActorContext) => {
        received = ctx.signal;
        controller.abort();
        return ok([artifact("solo", "Report", "r")]);
      }),
      controller.signal,
    );

    // Each attempt gets its own signal -- it has to cover its timeout too -- so this
    // is not the same object; what matters is that cancelling the performance fires it.
    expect(received).toBeDefined();
    expect(received!.aborted).toBe(true);
    expect(performance.finalResult.status).toBe("done");

    // A signal that never fires leaves the attempt's own signal clean.
    let quiet: AbortSignal | undefined;
    const undisturbed = await run(
      soloCast(async (ctx: ActorContext) => {
        quiet = ctx.signal;
        return ok([artifact("solo", "Report", "r")]);
      }),
      new AbortController().signal,
    );
    expect(quiet!.aborted).toBe(false);
    expect(undisturbed.finalResult.status).toBe("done");
  });

  test("R-ABORT-4 the trace records the cancellation as an outcome, not an error", async () => {
    const controller = new AbortController();
    controller.abort();

    const performance = await run(twoStepCast(async () => ok([]), async () => ok([])), controller.signal);

    const finished = performance.events.filter((event) => event.type === "finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      status: "aborted",
      reason: "aborted before the next wave",
    });
    expect(performance.events.at(-1)!.type).toBe("finished");
  });

  test("R-ABORT-5 a canceled performance is never evaluated", async () => {
    const controller = new AbortController();
    controller.abort();

    const performance = await run(
      twoStepCast(async () => ok([artifact("drafter", "Draft", "d")]), async () => ok([])),
      controller.signal,
    );

    expect(performance.events.some((event) => event.type === "evaluated")).toBe(false);
    expect(performance.iterations.every((record) => record.evaluation === null)).toBe(true);
  });

  test("R-ABORT-6 an aborted performance round-trips through the serializer", async () => {
    const controller = new AbortController();
    controller.abort();

    const performance = await run(twoStepCast(async () => ok([]), async () => ok([])), controller.signal);
    const reloaded = deserializePerformance(serializePerformance(performance));

    expect(reloaded.finalResult.status).toBe("aborted");
    expect(reloaded.finalResult.reason).toBe("aborted before the next wave");
  });
});
