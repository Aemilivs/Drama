import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createActor,
  createCast,
  createProtocol,
  criterionEvaluator,
  failed,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type {
  ActorExecutor,
  Performance,
  ProtocolStepInput,
  StageOptions,
} from "../../src/index.ts";

const scene = sceneFromCard({
  objective: "produce a report",
  success_criteria: ["a report artifact exists"],
  required_capabilities: ["drafting", "reviewing"],
});

const evaluator = () =>
  new Evaluator(
    criterionEvaluator([
      {
        criterion: scene.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "Report")
            ? { status: "pass", evidence: "report present" }
            : { status: "fail", evidence: "no report" },
      },
    ]),
  );

const worker = (executor: ActorExecutor) =>
  createActor({
    name: "worker",
    role: "worker",
    objective: "produce the report",
    capabilities: ["drafting", "reviewing"],
    expectedOutput: ["Report"],
    executor,
  });

/** A single-step cast whose step can carry retry/timeout extras. */
const castFor = (executor: ActorExecutor, step: Partial<ProtocolStepInput> = {}) =>
  createCast(
    [worker(executor)],
    createProtocol([{ actor: "worker", instruction: "produce", produces: ["Report"], ...step }]),
  );

/** One performance only: step behaviour is what these requirements are about. */
const perform = (cast: ReturnType<typeof castFor>, options: StageOptions = {}): Promise<Performance> =>
  new StageManager({ evaluator: evaluator(), maxPerformances: 1 }).perform(scene, cast, options);

const never: ActorExecutor = () => new Promise(() => undefined);

describe("Step retry requirements", () => {
  test("R-STEP-RETRY-1 a retried failure reaches neither diagnosis nor the artifacts", async () => {
    let calls = 0;
    const performance = await perform(
      castFor(
        async () => {
          calls += 1;
          return calls < 3 ? failed("flaky") : ok([artifact("worker", "Report", "r")]);
        },
        { retry: { attempts: 3 } },
      ),
    );

    expect(calls).toBe(3);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.artifacts.map((item) => item.kind)).toEqual(["Report"]);
    // The two failures that were retried away must not look like failures of the step.
    expect(performance.iterations[0]!.failures).toHaveLength(0);
  });

  test("R-STEP-RETRY-2 attempts counts total calls, so 1 means no retry", async () => {
    let calls = 0;
    await perform(
      castFor(async () => {
        calls += 1;
        return failed("boom");
      }, { retry: { attempts: 1 } }),
    );

    expect(calls).toBe(1);
  });

  test("R-STEP-RETRY-3 exhaustion records exactly one failure and halts a mandatory step", async () => {
    let calls = 0;
    const performance = await perform(
      castFor(async () => {
        calls += 1;
        return failed(`attempt ${calls}`);
      }, { retry: { attempts: 2 } }),
    );

    expect(calls).toBe(2);
    expect(performance.finalResult.status).toBe("failed");
    expect(performance.iterations[0]!.failures).toHaveLength(1);
    expect(performance.iterations[0]!.failures[0]!.error).toBe("attempt 2");
  });

  test("R-STEP-RETRY-4 every executor call is its own turn", async () => {
    let calls = 0;
    const performance = await perform(
      castFor(async () => {
        calls += 1;
        return calls < 2 ? failed("flaky") : ok([artifact("worker", "Report", "r")]);
      }, { retry: { attempts: 3 } }),
    );

    // The cost requirement counts executor calls, so a retry cannot hide inside a turn.
    expect(calls).toBe(2);
    expect(performance.turns).toHaveLength(2);
    expect(performance.turns[0]!.output.status).toBe("failed");
    expect(performance.turns[1]!.output.status).toBe("ok");
  });

  test("R-STEP-RETRY-5 each retried attempt is visible in the trace, in order", async () => {
    let calls = 0;
    const performance = await perform(
      castFor(async () => {
        calls += 1;
        return calls < 3 ? failed(`attempt ${calls}`) : ok([artifact("worker", "Report", "r")]);
      }, { retry: { attempts: 3 } }),
    );

    const retries = performance.events.filter((event) => event.type === "step_retry");
    expect(retries).toHaveLength(2);
    expect(retries.map((event) => (event as { attempt: number }).attempt)).toEqual([1, 2]);
    expect(retries.map((event) => (event as { error: string }).error)).toEqual([
      "attempt 1",
      "attempt 2",
    ]);
  });

  test("R-STEP-RETRY-6 a stage default applies, and a step overrides it", async () => {
    let defaulted = 0;
    await perform(
      castFor(async () => {
        defaulted += 1;
        return failed("boom");
      }),
      { retry: { attempts: 2 } },
    );
    expect(defaulted).toBe(2);

    let overridden = 0;
    await perform(
      castFor(async () => {
        overridden += 1;
        return failed("boom");
      }, { retry: { attempts: 1 } }),
      { retry: { attempts: 4 } },
    );
    expect(overridden).toBe(1);
  });
});

describe("Step timeout requirements", () => {
  test("R-STEP-TIMEOUT-1 a hanging attempt fails instead of hanging the performance", async () => {
    const performance = await perform(castFor(never, { timeoutMs: 20 }));

    expect(performance.finalResult.status).toBe("failed");
    expect(performance.turns).toHaveLength(1);
    expect(performance.turns[0]!.output.status).toBe("failed");
    expect(performance.turns[0]!.output.error).toBe("timed out after 20ms");
  });

  test("R-STEP-TIMEOUT-2 the attempt receives a signal that fires on timeout", async () => {
    let sawAbort = false;
    const executor: ActorExecutor = (ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal?.addEventListener(
          "abort",
          () => {
            sawAbort = true;
            reject(new Error("transport stopped"));
          },
          { once: true },
        );
      });

    await perform(castFor(executor, { timeoutMs: 20 }));
    expect(sawAbort).toBe(true);
  });

  test("R-STEP-TIMEOUT-3 a timed-out optional step does not halt the performance", async () => {
    const cast = createCast(
      [
        worker(async () => ok([artifact("worker", "Report", "r")])),
        createActor({
          name: "checker",
          role: "checker",
          objective: "check",
          capabilities: ["checking"],
          expectedOutput: ["Check"],
          executor: never,
        }),
      ],
      createProtocol([
        { actor: "worker", instruction: "produce", produces: ["Report"] },
        {
          actor: "checker",
          instruction: "check",
          consumes: ["Report"],
          produces: ["Check"],
          optional: true,
          timeoutMs: 20,
        },
      ]),
    );

    const performance = await perform(cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns.at(-1)!.output.error).toBe("timed out after 20ms");
  });

  test("R-STEP-TIMEOUT-4 a timeout is retried like any other failure", async () => {
    const performance = await perform(castFor(never, { timeoutMs: 20, retry: { attempts: 2 } }));

    expect(performance.turns).toHaveLength(2);
    expect(performance.turns.every((turn) => turn.output.error === "timed out after 20ms")).toBe(
      true,
    );
    expect(performance.events.filter((event) => event.type === "step_retry")).toHaveLength(1);
  });
});
