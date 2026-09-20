import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  actionForDiagnosis,
  aggregate,
  criterionEvaluator,
  deriveMinimalCast,
  sceneFromCard,
} from "../src/index.ts";
import type { CriterionResult, EvaluationContext, Scene } from "../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "produce something",
    success_criteria: ["criterion one", "criterion two"],
    required_capabilities: ["analysis"],
  });
}

function context(s: Scene): EvaluationContext {
  return {
    scene: s,
    cast: deriveMinimalCast(s),
    artifacts: [],
    failures: [],
    iteration: 1,
  };
}

const pass = (criterion: string): CriterionResult => ({ criterion, status: "pass", evidence: "ok" });

describe("evaluation", () => {
  test("all criteria passing yields pass/finish", () => {
    const s = scene();
    const evaluation = aggregate(s, [pass("criterion-1"), pass("criterion-2")]);
    expect(evaluation.status).toBe("pass");
    expect(evaluation.recommendedAction).toBe("finish");
  });

  test("a failing criterion yields fail and a reperform by default", () => {
    const s = scene();
    const evaluation = aggregate(s, [
      pass("criterion-1"),
      { criterion: "criterion-2", status: "fail", evidence: "missing answer" },
    ]);
    expect(evaluation.status).toBe("fail");
    expect(evaluation.recommendedAction).toBe("reperform");
    expect(evaluation.issues.join(" ")).toContain("missing answer");
  });

  test("an uncertain criterion yields uncertain", () => {
    const s = scene();
    const evaluation = aggregate(s, [
      pass("criterion-1"),
      { criterion: "criterion-2", status: "uncertain", evidence: "cannot tell" },
    ]);
    expect(evaluation.status).toBe("uncertain");
    expect(evaluation.recommendedAction).toBe("reperform");
  });

  test("a criterion that was never evaluated becomes uncertain", () => {
    const s = scene();
    const evaluation = aggregate(s, [pass("criterion-1")]);
    expect(evaluation.criteria.find((c) => c.criterion === "criterion-2")?.status).toBe("uncertain");
    expect(evaluation.status).toBe("uncertain");
    expect(evaluation.issues.join(" ")).toContain("was not evaluated");
  });

  test("the diagnosis, not the raw failure, chooses the action", () => {
    const s = scene();
    const results: CriterionResult[] = [
      { criterion: "criterion-1", status: "fail", evidence: "no expert in cast" },
      pass("criterion-2"),
    ];
    expect(aggregate(s, results, { diagnosis: "missing_capability" }).recommendedAction).toBe("recast");
    expect(aggregate(s, results, { diagnosis: "missing_information" }).recommendedAction).toBe("recast");
    expect(aggregate(s, results, { diagnosis: "malformed_problem" }).recommendedAction).toBe("redesign_scene");
    expect(aggregate(s, results, { diagnosis: "bad_execution" }).recommendedAction).toBe("reperform");
  });

  test("actionForDiagnosis maps every diagnosis", () => {
    expect(actionForDiagnosis("missing_capability")).toBe("recast");
    expect(actionForDiagnosis("missing_information")).toBe("recast");
    expect(actionForDiagnosis("malformed_problem")).toBe("redesign_scene");
    expect(actionForDiagnosis("bad_execution")).toBe("reperform");
    expect(actionForDiagnosis("unspecified")).toBe("reperform");
  });

  test("criterionEvaluator builds an evaluation from checks", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: () => ({ status: "pass", evidence: "present" }),
        },
        {
          criterion: s.successCriteria[1]!,
          check: () => ({ status: "fail", evidence: "absent" }),
        },
      ]),
    );
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.status).toBe("fail");
    expect(evaluation.criteria).toHaveLength(2);
  });

  test("an evaluator crash becomes uncertain, never a silent pass", async () => {
    const s = scene();
    const evaluator = new Evaluator(() => {
      throw new Error("judge exploded");
    });
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.status).toBe("uncertain");
    expect(evaluation.recommendedAction).toBe("reperform");
    expect(evaluation.issues.join(" ")).toContain("evaluator error: judge exploded");
  });
});

describe("evaluation normalisation", () => {
  test("a reported pass is downgraded when a scene criterion was never checked", async () => {
    const s = scene();
    const evaluator = new Evaluator(() => ({
      id: "e",
      status: "pass" as const,
      criteria: [{ criterion: "criterion-1", status: "pass" as const, evidence: "ok" }],
      issues: [],
      recommendedAction: "finish" as const,
      diagnosis: "unspecified" as const,
      createdAt: 0,
      meta: {},
    }));
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.status).toBe("uncertain");
    expect(evaluation.recommendedAction).toBe("reperform");
    expect(evaluation.criteria.find((c) => c.criterion === "criterion-2")?.status).toBe(
      "uncertain",
    );
  });

  test("a reported failure is preserved even with no criteria", async () => {
    const s = scene();
    const evaluator = new Evaluator(() => ({
      id: "e",
      status: "fail" as const,
      criteria: [],
      issues: ["the actor crashed before producing anything"],
      recommendedAction: "reperform" as const,
      diagnosis: "bad_execution" as const,
      createdAt: 0,
      meta: {},
    }));
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.status).toBe("fail");
    expect(evaluation.recommendedAction).toBe("reperform");
  });
});
