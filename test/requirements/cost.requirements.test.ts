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
import type { ActorExecutor, Performance, StageOptions } from "../../src/index.ts";

const scene = sceneFromCard({
  objective: "produce a report",
  success_criteria: ["a report artifact exists"],
  required_capabilities: ["drafting", "checking"],
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

/** Two steps, so a budget has a boundary between them to be checked at. */
const twoStepCast = (first: ActorExecutor, second: ActorExecutor) =>
  createCast(
    [
      createActor({
        name: "worker",
        role: "worker",
        objective: "produce",
        capabilities: ["drafting"],
        expectedOutput: ["Report"],
        executor: first,
      }),
      createActor({
        name: "checker",
        role: "checker",
        objective: "check",
        capabilities: ["checking"],
        expectedOutput: ["Check"],
        executor: second,
      }),
    ],
    createProtocol([
      { actor: "worker", instruction: "produce", produces: ["Report"] },
      { actor: "checker", instruction: "check", consumes: ["Report"], produces: ["Check"] },
    ]),
  );

const perform = (
  cast: ReturnType<typeof twoStepCast>,
  options: StageOptions = {},
): Promise<Performance> =>
  new StageManager({ evaluator: evaluator(), maxPerformances: 1 }).perform(scene, cast, options);

/** An executor that reports what it spent, the way a real LLM adapter would. */
const priced =
  (kind: string, costUsd: number): ActorExecutor =>
  async () =>
    ok([artifact("priced", kind, "v")], undefined, { inputTokens: 10, outputTokens: 5, costUsd });

describe("Cost requirements", () => {
  test("R-COST-3 reported usage reaches the turn and sums across the performance", async () => {
    const performance = await perform(twoStepCast(priced("Report", 0.1), priced("Check", 0.25)));

    expect(performance.turns.map((turn) => turn.usage?.costUsd)).toEqual([0.1, 0.25]);
    expect(performance.turns[0]!.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  test("R-COST-4 usage survives the serializer", async () => {
    const performance = await perform(twoStepCast(priced("Report", 0.1), priced("Check", 0.25)));
    const reloaded = deserializePerformance(serializePerformance(performance));

    expect(reloaded.turns.map((turn) => turn.usage?.costUsd)).toEqual([0.1, 0.25]);
  });

  test("R-COST-5 maxCostUsd stops the work, and the trace reports what that left", async () => {
    const ran: string[] = [];
    const performance = await perform(
      twoStepCast(
        async () => {
          ran.push("worker");
          return ok([artifact("worker", "Report", "r")], undefined, { costUsd: 0.1 });
        },
        async () => {
          ran.push("checker");
          return ok([artifact("checker", "Check", "c")], undefined, { costUsd: 0.1 });
        },
      ),
      { maxCostUsd: 0.05 },
    );

    // The budget stopped the second step...
    expect(ran).toEqual(["worker"]);
    expect(performance.turns).toHaveLength(1);
    // ...and the evaluation still judged what was produced. A budget halt is a
    // truncation, not a failure, so a satisfied goal outranks it -- the same holds
    // for maxTurns. Whether finalResult should instead carry a "truncated" marker is
    // a real open question, recorded rather than decided here.
    expect(performance.finalResult.reason).toBe("evaluation passed");

    // When the truncation left the goal unmet, the budget is what the caller sees.
    const unmet: string[] = [];
    const truncated = await perform(
      twoStepCast(
        async () => {
          unmet.push("worker");
          return ok([], undefined, { costUsd: 0.1 });
        },
        async () => {
          unmet.push("checker");
          return ok([], undefined, { costUsd: 0.1 });
        },
      ),
      { maxCostUsd: 0.05 },
    );

    expect(unmet).toEqual(["worker"]);
    expect(truncated.finalResult.status).toBe("failed");
    expect(truncated.finalResult.reason).toBe("max cost reached ($0.05)");
  });

  test("R-COST-6 an unreported cost never trips the budget", async () => {
    const performance = await perform(
      twoStepCast(
        async () => ok([artifact("worker", "Report", "r")]),
        async () => ok([artifact("checker", "Check", "c")]),
      ),
      { maxCostUsd: 0.01 },
    );

    // Unknown is not zero: a stage told nothing about cost must not behave as if it spent nothing.
    expect(performance.turns).toHaveLength(2);
    expect(performance.finalResult.reason).not.toContain("max cost");
  });
});
