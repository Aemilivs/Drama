import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  calibrate,
  calibratedEvaluator,
  deriveMinimalCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { EvaluationContext, Scene } from "../../src/index.ts";

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

describe("Calibration requirements", () => {
  test("R-CALIB-1 a probability at or above the pass threshold is pass", () => {
    expect(calibrate(0.9)).toBe("pass");
    expect(calibrate(0.8)).toBe("pass");
  });

  test("R-CALIB-2 a probability at or below the fail threshold is fail", () => {
    expect(calibrate(0.1)).toBe("fail");
    expect(calibrate(0.2)).toBe("fail");
  });

  test("R-CALIB-3 a probability between the thresholds settles nothing", () => {
    expect(calibrate(0.5)).toBe("uncertain");
  });

  test("R-CALIB-4 a non-finite or out-of-range probability never becomes pass", () => {
    for (const probability of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(calibrate(probability)).toBe("uncertain");
    }
  });

  test("R-CALIB-5 the policy moves the thresholds, and an inverted policy is inert", () => {
    expect(calibrate(0.65, { pass: 0.6, fail: 0.4 })).toBe("pass");
    expect(calibrate(0.35, { pass: 0.6, fail: 0.4 })).toBe("fail");
    expect(calibrate(0.5, { pass: 0.6, fail: 0.4 })).toBe("uncertain");
    expect(calibrate(0.5, { pass: 0.2, fail: 0.8 })).toBe("uncertain");
  });

  test("R-CALIB-6 a calibrated evaluator folds into aggregate and keeps silence uncertain", async () => {
    const s = scene();
    const evaluator = new Evaluator(
      calibratedEvaluator([
        {
          criterion: s.successCriteria[0]!,
          check: async () => ({ probability: 0.9, evidence: "checked" }),
        },
      ]),
    );
    const evaluation = await evaluator.evaluate(context(s));
    expect(evaluation.criteria.find((item) => item.criterion === "criterion-1")!.status).toBe("pass");
    expect(evaluation.criteria.find((item) => item.criterion === "criterion-2")!.status).toBe(
      "uncertain",
    );
    expect(evaluation.status).toBe("uncertain");
  });
});
