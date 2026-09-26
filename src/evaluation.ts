/**
 * Evaluation: compare the produced artifacts against the scene's success
 * criteria.
 *
 * A failure does not imply "try again". The evaluation carries a diagnosis, and
 * the diagnosis decides whether to reperform, recast, or redesign the scene.
 */

import type { Artifact, Criterion, Diagnosis, RecommendedAction, Status } from "./types";
import { nextId } from "./types";
import type { Scene } from "./scene";
import type { Cast } from "./cast";

export interface ActorFailure {
  actor: string;
  step: string;
  error: string;
}

export interface EvaluationContext {
  scene: Scene;
  cast: Cast;
  artifacts: Artifact[];
  failures: ActorFailure[];
  iteration: number;
}

export interface CriterionResult {
  criterion: string;
  status: Status;
  evidence: string;
}

export interface Evaluation {
  id: string;
  status: Status;
  criteria: CriterionResult[];
  issues: string[];
  recommendedAction: RecommendedAction;
  diagnosis: Diagnosis;
  /** Capabilities the evaluator found missing — a recast should add them. */
  missingCapabilities?: string[];
  /** Information gaps a recast should resolve, e.g. with a research actor. */
  missingInformation?: string[];
  createdAt: number;
  meta: Record<string, unknown>;
}

export type EvaluatorFn = (ctx: EvaluationContext) => Evaluation | Promise<Evaluation>;

export interface CriterionCheckResult {
  status: Status;
  evidence: string;
}

export interface CriterionCheck {
  criterion: Criterion;
  check: (ctx: EvaluationContext) => CriterionCheckResult | Promise<CriterionCheckResult>;
}

/** The heart of the recasting flow: a diagnosis selects the next action. */
export function actionForDiagnosis(diagnosis: Diagnosis): RecommendedAction {
  switch (diagnosis) {
    case "missing_capability":
    case "missing_information":
      return "recast";
    case "malformed_problem":
      return "redesign_scene";
    case "bad_execution":
      return "reperform";
    default:
      return "reperform";
  }
}

/**
 * Fold criterion results into one evaluation. Criteria that the evaluator never
 * looked at become `uncertain`, so silence never masquerades as success.
 */
export function aggregate(
  scene: Scene,
  results: CriterionResult[],
  options: {
    diagnosis?: Diagnosis;
    failures?: ActorFailure[];
    issues?: string[];
    missingCapabilities?: string[];
    missingInformation?: string[];
  } = {},
): Evaluation {
  const criteria = results.map((result) => ({ ...result }));
  const issues: string[] = [...(options.issues ?? [])];

  const evaluated = new Set(criteria.map((result) => result.criterion));
  for (const criterion of scene.successCriteria) {
    if (!evaluated.has(criterion.id)) {
      criteria.push({
        criterion: criterion.id,
        status: "uncertain",
        evidence: "criterion was never evaluated",
      });
      issues.push(`Criterion "${criterion.id}" was not evaluated.`);
    }
  }

  let status: Status = "pass";
  if (criteria.some((result) => result.status === "fail")) status = "fail";
  else if (criteria.some((result) => result.status === "uncertain")) status = "uncertain";

  for (const result of criteria) {
    if (result.status !== "pass") {
      issues.push(`${result.criterion}: ${result.status} — ${result.evidence}`);
    }
  }

  const failures = options.failures ?? [];
  for (const failure of failures) {
    issues.push(
      `Actor "${failure.actor}" failed at step "${failure.step}": ${failure.error}`,
    );
  }

  const diagnosis: Diagnosis =
    options.diagnosis ?? (failures.length > 0 ? "bad_execution" : "unspecified");
  const recommendedAction: RecommendedAction =
    status === "pass" ? "finish" : actionForDiagnosis(diagnosis);

  return {
    id: nextId("evaluation"),
    status,
    criteria,
    issues,
    recommendedAction,
    diagnosis,
    missingCapabilities: options.missingCapabilities,
    missingInformation: options.missingInformation,
    createdAt: Date.now(),
    meta: { failures },
  };
}

/** Build an evaluator from one check per criterion. */
export function criterionEvaluator(checks: CriterionCheck[]): EvaluatorFn {
  return async (ctx) => {
    const results: CriterionResult[] = [];
    for (const { criterion, check } of checks) {
      const outcome = await check(ctx);
      results.push({
        criterion: criterion.id,
        status: outcome.status,
        evidence: outcome.evidence,
      });
    }
    return aggregate(ctx.scene, results, { failures: ctx.failures });
  };
}

/**
 * A criterion check that returns a *probability* rather than a status.
 *
 * A decision model (or any calibrated judge) answers a typed question with a
 * probability; drama owns the policy that turns it into a `Status`, so the
 * library stays provider-free and the host supplies only the function.
 */
export interface CalibratedCheckResult {
  /** The check's probability that the criterion passes, in [0, 1]. */
  probability: number;
  evidence: string;
}

export interface CalibratedCheck {
  criterion: Criterion;
  check: (ctx: EvaluationContext) => CalibratedCheckResult | Promise<CalibratedCheckResult>;
}

export interface CalibrationPolicy {
  /** At or above this probability the criterion passes. Default 0.8. */
  pass?: number;
  /** At or below this probability the criterion fails. Default 0.2. */
  fail?: number;
}

function threshold(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : fallback;
}

/**
 * Map a calibrated probability onto drama's three-valued status.
 *
 * A probability outside [0, 1], a non-finite one, or an inverted policy settles
 * nothing and is `uncertain` — never rounded up to `pass`.
 */
export function calibrate(probability: number, policy: CalibrationPolicy = {}): Status {
  const pass = threshold(policy.pass, 0.8);
  const fail = threshold(policy.fail, 0.2);
  if (!(fail < pass)) return "uncertain";
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) return "uncertain";
  if (probability >= pass) return "pass";
  if (probability <= fail) return "fail";
  return "uncertain";
}

/** Build an evaluator from one calibrated check per criterion. */
export function calibratedEvaluator(
  checks: CalibratedCheck[],
  policy: CalibrationPolicy = {},
): EvaluatorFn {
  return async (ctx) => {
    const results: CriterionResult[] = [];
    for (const { criterion, check } of checks) {
      const outcome = await check(ctx);
      results.push({
        criterion: criterion.id,
        status: calibrate(outcome.probability, policy),
        evidence: outcome.evidence,
      });
    }
    return aggregate(ctx.scene, results, { failures: ctx.failures });
  };
}

export function normalizeEvaluation(value: Evaluation, ctx: EvaluationContext): Evaluation {
  const criteria: CriterionResult[] = (value.criteria ?? []).map((result) => ({ ...result }));
  const issues: string[] = [...(value.issues ?? [])];

  // A criterion the evaluator never checked is uncertain — even if the
  // evaluator reported a pass. Silence must never read as success.
  const evaluated = new Set(criteria.map((result) => result.criterion));
  for (const criterion of ctx.scene.successCriteria) {
    if (!evaluated.has(criterion.id)) {
      criteria.push({
        criterion: criterion.id,
        status: "uncertain",
        evidence: "criterion was never evaluated",
      });
      issues.push(`Criterion "${criterion.id}" was not evaluated.`);
    }
  }

  const reportedStatus: Status = value.status ?? "uncertain";
  const anyFail = criteria.some((result) => result.status === "fail");
  const anyUncertain = criteria.some((result) => result.status === "uncertain");
  let status: Status = reportedStatus;
  if (reportedStatus === "pass" && (anyFail || anyUncertain)) {
    status = anyFail ? "fail" : "uncertain";
  }

  const diagnosis: Diagnosis =
    value.diagnosis ?? (ctx.failures.length > 0 ? "bad_execution" : "unspecified");
  let recommendedAction: RecommendedAction =
    value.recommendedAction ?? (status === "pass" ? "finish" : actionForDiagnosis(diagnosis));
  if (status !== "pass" && recommendedAction === "finish") {
    recommendedAction = actionForDiagnosis(diagnosis);
  }

  return {
    id: value.id ?? nextId("evaluation"),
    status,
    criteria,
    issues,
    recommendedAction,
    diagnosis,
    missingCapabilities: value.missingCapabilities,
    missingInformation: value.missingInformation,
    createdAt: value.createdAt ?? Date.now(),
    meta: value.meta ?? {},
  };
}

export class Evaluator {
  constructor(private readonly fn: EvaluatorFn) {}

  /**
   * An evaluator crash is itself an `uncertain` result with a reperform
   * recommendation — never a silent pass.
   */
  async evaluate(ctx: EvaluationContext): Promise<Evaluation> {
    try {
      const value = await this.fn(ctx);
      return normalizeEvaluation(value, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: nextId("evaluation"),
        status: "uncertain",
        criteria: [],
        issues: [`evaluator error: ${message}`],
        recommendedAction: "reperform",
        diagnosis: "unspecified",
        createdAt: Date.now(),
        meta: { error: message },
      };
    }
  }
}
