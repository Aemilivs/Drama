import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  aggregate,
  criterionEvaluator,
  deriveMinimalCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { CriterionResult, Evaluation, EvaluationContext, Scene } from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c1", "c2"],
    required_capabilities: ["a"],
  });
}

function context(s: Scene): EvaluationContext {
  return { scene: s, cast: deriveMinimalCast(s), artifacts: [], failures: [], iteration: 1 };
}

const pass = (criterion: string): CriterionResult => ({
  criterion,
  status: "pass",
  evidence: "ok",
});

describe("Evaluation requirements", () => {
  test("R-EVAL-1 a reported status is honoured unless a checked criterion contradicts it", async () => {
    const s = scene();

    const explicitlyUncertain = new Evaluator(
      (): Evaluation => ({
        id: "e",
        status: "uncertain",
        criteria: [pass("criterion-1"), pass("criterion-2")],
        issues: [],
        recommendedAction: "reperform",
        diagnosis: "unspecified",
        createdAt: 0,
        meta: {},
      }),
    );
    expect((await explicitlyUncertain.evaluate(context(s))).status).toBe("uncertain");

    const explicitlyFailed = new Evaluator(
      (): Evaluation => ({
        id: "e",
        status: "fail",
        criteria: [pass("criterion-1"), pass("criterion-2")],
        issues: ["actor crashed"],
        recommendedAction: "reperform",
        diagnosis: "bad_execution",
        createdAt: 0,
        meta: {},
      }),
    );
    expect((await explicitlyFailed.evaluate(context(s))).status).toBe("fail");
  });

  test("R-EVAL-5 async criterion checks are awaited and their evidence preserved", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: async () => ({ status: "pass" as const, evidence: "async ok" }),
        },
        {
          criterion: s.successCriteria[1]!,
          check: () => ({ status: "fail" as const, evidence: "sync fail" }),
        },
      ]),
    );
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.criteria.find((c) => c.criterion === "criterion-1")!.evidence).toBe("async ok");
    expect(evaluation.criteria.find((c) => c.criterion === "criterion-2")!.evidence).toBe("sync fail");
    expect(evaluation.status).toBe("fail");
  });

  test("R-EVAL-6 actor failures become issues and default the diagnosis to bad_execution", () => {
    const s = scene();
    const evaluation = aggregate(
      s,
      [pass("criterion-1"), { criterion: "criterion-2", status: "fail", evidence: "no output" }],
      { failures: [{ actor: "worker", step: "step-1", error: "boom" }] },
    );
    expect(evaluation.diagnosis).toBe("bad_execution");
    expect(evaluation.recommendedAction).toBe("reperform");
    expect(evaluation.issues.join(" ")).toContain("worker");
    expect(evaluation.issues.join(" ")).toContain("boom");
  });

  test("R-EVAL-7 a finish recommendation cannot survive a non-passing status", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      (): Evaluation => ({
        id: "e",
        status: "fail",
        criteria: [{ criterion: "criterion-1", status: "fail", evidence: "x" }],
        issues: [],
        recommendedAction: "finish",
        diagnosis: "bad_execution",
        createdAt: 0,
        meta: {},
      }),
    );
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.status).toBe("fail");
    expect(evaluation.recommendedAction).toBe("reperform");
  });

  test("R-EVAL-8 diagnosed gaps survive normalisation", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      (): Evaluation => ({
        id: "e",
        status: "fail",
        criteria: [],
        issues: [],
        recommendedAction: "recast",
        diagnosis: "missing_capability",
        missingCapabilities: ["compliance"],
        missingInformation: ["traffic volume"],
        createdAt: 0,
        meta: {},
      }),
    );
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.missingCapabilities).toEqual(["compliance"]);
    expect(evaluation.missingInformation).toEqual(["traffic volume"]);
  });
});
