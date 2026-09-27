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
  performanceToOtlp,
  performanceToSpans,
  sceneFromCard,
} from "../../src/index.ts";
import type { Cast, Performance, Scene } from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "produce X, then try Y",
    success_criteria: ["X exists"],
    required_capabilities: ["x", "y"],
  });
}

function evaluatorFor(target: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator([
      {
        criterion: target.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "X")
            ? { status: "pass" as const, evidence: "present" }
            : { status: "fail" as const, evidence: "missing" },
      },
    ]),
  );
}

/** A performance with one successful turn (with usage) and one failed turn. */
async function mixedPerformance(): Promise<Performance> {
  const target = scene();
  const cast = createCast(
    [
      functionActor({
        name: "x",
        role: "x",
        objective: "produce X",
        capabilities: ["x"],
        produces: "X",
        run: () =>
          ok([artifact("x", "X", "value")], undefined, {
            inputTokens: 12,
            outputTokens: 3,
            costUsd: 0.001,
          }),
      }),
      functionActor({
        name: "y",
        role: "y",
        objective: "try Y",
        capabilities: ["y"],
        produces: "Y",
        run: () => failed("engine exploded"),
      }),
    ],
    createProtocol([
      { actor: "x", instruction: "produce X", produces: ["X"] },
      { actor: "y", instruction: "try Y", produces: ["Y"] },
    ]),
  );
  return new StageManager({ evaluator: evaluatorFor(target), maxPerformances: 1 }).perform(
    target,
    cast,
  );
}

/** A performance that stopped at a gate nobody answered. */
async function pausedPerformance(): Promise<Performance> {
  const target = sceneFromCard({
    objective: "deploy",
    success_criteria: ["deployed"],
    required_capabilities: ["deploy"],
  });
  const cast: Cast = createCast(
    [
      functionActor({
        name: "deploy",
        role: "deploy",
        objective: "deploy",
        capabilities: ["deploy"],
        produces: "Deployment",
        run: () => ok([artifact("deploy", "Deployment", "v1")]),
      }),
    ],
    createProtocol([
      { actor: "deploy", instruction: "deploy", produces: ["Deployment"], gate: true },
    ]),
  );
  return new StageManager({ evaluator: evaluatorFor(target), maxPerformances: 1 }).perform(
    target,
    cast,
  );
}

describe("OpenTelemetry export requirements", () => {
  test("R-OTEL-1 a performance becomes a root span, one per iteration and one per turn", async () => {
    const performance = await mixedPerformance();
    const spans = performanceToSpans(performance);

    expect(spans).toHaveLength(4);
    const [root, iteration, ...turns] = spans;
    expect(root!.parentSpanId).toBeUndefined();
    expect(root!.name).toBe(`performance ${performance.id}`);
    expect(iteration!.parentSpanId).toBe(root!.spanId);
    expect(iteration!.name).toBe("iteration 1");
    expect(turns.map((span) => span.name)).toEqual(["x (step-1)", "y (step-2)"]);
    for (const turn of turns) expect(turn.parentSpanId).toBe(iteration!.spanId);

    // One trace, and every span is distinct.
    expect(new Set(spans.map((span) => span.traceId)).size).toBe(1);
    expect(new Set(spans.map((span) => span.spanId)).size).toBe(4);
  });

  test("R-OTEL-2 the mapping is deterministic and does not touch the performance", async () => {
    const performance = await mixedPerformance();
    const before = JSON.stringify(performance);
    const first = performanceToSpans(performance);
    const second = performanceToSpans(performance);

    expect(second).toEqual(first);
    expect(JSON.stringify(performance)).toBe(before);
    // Ids come from the performance's own values, not from a random source.
    const again = performanceToSpans(await mixedPerformance());
    expect(again.map((span) => span.spanId)).not.toEqual(first.map((span) => span.spanId));
  });

  test("R-OTEL-3 status, timing and usage land on the right span", async () => {
    const performance = await mixedPerformance();
    const spans = performanceToSpans(performance);
    const okTurn = spans.find((span) => span.name === "x (step-1)")!;
    const failedTurn = spans.find((span) => span.name === "y (step-2)")!;

    expect(okTurn.status.code).toBe("STATUS_CODE_OK");
    expect(failedTurn.status).toEqual({ code: "STATUS_CODE_ERROR", message: "engine exploded" });

    const attribute = (span: typeof okTurn, key: string) =>
      span.attributes.find((entry) => entry.key === key)?.value;
    expect(attribute(okTurn, "drama.usage.input_tokens")?.intValue).toBe("12");
    expect(attribute(okTurn, "drama.usage.cost_usd")?.doubleValue).toBe(0.001);
    expect(attribute(okTurn, "drama.artifact.kinds")?.stringValue).toBe("X");

    const recorded = performance.turns.find((turn) => turn.actor === "x")!;
    expect(okTurn.startTimeUnixNano).toBe(String(Math.round(recorded.startedAt * 1_000_000)));
    expect(okTurn.endTimeUnixNano).toBe(String(Math.round(recorded.endedAt * 1_000_000)));
  });

  test("R-OTEL-4 the document is OTLP-shaped and wraps exactly those spans", async () => {
    const performance = await mixedPerformance();
    const document = performanceToOtlp(performance, { serviceName: "drama-tests" });

    expect(document.resourceSpans).toHaveLength(1);
    const resource = document.resourceSpans[0]!;
    expect(resource.resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "drama-tests" },
    });
    expect(resource.scopeSpans).toHaveLength(1);
    const scope = resource.scopeSpans[0]!;
    expect(scope.scope.name).toBe("drama");
    expect(scope.spans).toEqual(performanceToSpans(performance));
    for (const span of scope.spans) expect(span.kind).toBe("SPAN_KIND_INTERNAL");
  });

  test("R-OTEL-5 a paused performance is neither an error nor a success, and names its gate", async () => {
    const performance = await pausedPerformance();
    expect(performance.finalResult.status).toBe("paused");

    const spans = performanceToSpans(performance);
    const root = spans[0]!;
    expect(root.status.code).toBe("STATUS_CODE_UNSET");
    expect(root.status.message).toBe(performance.finalResult.reason);
    expect(
      root.attributes.find((entry) => entry.key === "drama.result.status")?.value.stringValue,
    ).toBe("paused");
    expect(root.attributes.find((entry) => entry.key === "drama.gate.step")?.value.stringValue).toBe(
      "step-1 (iteration 1)",
    );

    // No turn ran: the root and its one (unfinished) iteration, nothing below.
    expect(spans).toHaveLength(2);
    expect(spans.filter((span) => span.parentSpanId && span.name !== "iteration 1")).toHaveLength(0);
    expect(root.startTimeUnixNano).toBe("0");
  });
});
