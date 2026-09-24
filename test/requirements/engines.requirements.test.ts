import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  artifact,
  createActor,
  createCast,
  createEngineExecutor,
  createProtocol,
  createToolRegistry,
  criterionEvaluator,
  sceneFromCard,
} from "../../src/index.ts";
import type { ActorContext, EngineRequest, Scene } from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "review the migration",
    success_criteria: ["a review artifact exists"],
    required_capabilities: ["migration_review"],
  });
}

function analyticsActor(executor: ReturnType<typeof createEngineExecutor>) {
  return createActor({
    name: "analyst",
    role: "migration analyst",
    objective: "Assess the migration",
    question: "Is the risk real?",
    capabilities: ["migration_review"],
    expectedOutput: ["RiskReport"],
    executor,
  });
}

function context(actor = analyticsActor(createEngineExecutor({ invoke: () => ({ artifacts: [] }) }))): ActorContext {
  return {
    scene: scene(),
    actor,
    instruction: "analyse",
    inputs: [artifact("author", "Brief", "migrate the billing table")],
    history: [],
    tools: createToolRegistry(),
    iteration: 1,
  };
}

describe("Engine adapter requirements", () => {
  test("R-ENGINE-1 an engine result becomes artifacts, and the engine gets the real prompt", async () => {
    let seen: EngineRequest | undefined;
    const executor = createEngineExecutor({
      invoke: (request) => {
        seen = request;
        return { artifacts: [{ kind: "RiskReport", content: { risks: ["backfill"] } }] };
      },
    });

    const output = await executor(context(analyticsActor(executor)));

    expect(output.status).toBe("ok");
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0]!.kind).toBe("RiskReport");
    expect(output.artifacts[0]!.producedBy).toBe("analyst");
    expect(output.artifacts[0]!.content).toEqual({ risks: ["backfill"] });

    // The engine sees exactly what a model would see.
    expect(seen!.prompt).toContain("Task: analyse");
    expect(seen!.prompt).toContain("Question to answer: Is the risk real?");
    expect(seen!.messages.length).toBeGreaterThan(0);
    expect(seen!.iteration).toBe(1);
    expect(seen!.inputs.map((item) => item.kind)).toEqual(["Brief"]);
    expect(seen!.actor.name).toBe("analyst");
  });

  test("R-ENGINE-2 a throwing engine fails the actor instead of the stage", async () => {
    const executor = createEngineExecutor({
      invoke: () => {
        throw new Error("engine exploded");
      },
    });

    const output = await executor(context(analyticsActor(executor)));
    expect(output.status).toBe("failed");
    expect(output.error).toContain("engine exploded");
  });

  test("R-ENGINE-3 a malformed or empty result is a failure, and garbage entries are dropped", async () => {
    const empty = createEngineExecutor({ invoke: () => ({ artifacts: [] }) });
    expect((await empty(context(analyticsActor(empty)))).status).toBe("failed");

    const nothing = createEngineExecutor({ invoke: () => undefined as never });
    expect((await nothing(context(analyticsActor(nothing)))).status).toBe("failed");

    const noisy = createEngineExecutor({
      invoke: () => ({
        artifacts: [
          null,
          undefined,
          {},
          { kind: "" },
          { kind: "RiskReport", content: "the only usable one" },
        ] as never,
      }),
    });
    const output = await noisy(context(analyticsActor(noisy)));
    expect(output.status).toBe("ok");
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0]!.content).toBe("the only usable one");
  });

  test("R-ENGINE-4 an engine-backed actor drives a real performance", async () => {
    const executor = createEngineExecutor({
      invoke: () => ({ artifacts: [{ kind: "RiskReport", content: { risks: ["backfill"] } }] }),
    });
    const actor = analyticsActor(executor);
    const cast = createCast(
      [actor],
      createProtocol([{ actor: "analyst", instruction: "analyse", produces: ["RiskReport"] }]),
    );
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: scene().successCriteria[0]!,
          check: (ctx) =>
            ctx.artifacts.some((item) => item.kind === "RiskReport")
              ? { status: "pass", evidence: "review present" }
              : { status: "fail", evidence: "no review" },
        },
      ]),
    );

    const performance = await new StageManager({ evaluator }).perform(scene(), cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.turns[0]!.output.status).toBe("ok");
    expect(performance.artifacts.map((item) => item.kind)).toEqual(["RiskReport"]);
  });

  test("R-ENGINE-5 the producer can be named after the engine", async () => {
    const executor = createEngineExecutor({
      producer: "langgraph",
      invoke: () => ({ artifacts: [{ kind: "RiskReport", content: "ok" }] }),
    });
    const output = await executor(context(analyticsActor(executor)));
    expect(output.artifacts[0]!.producedBy).toBe("langgraph");
  });
});
