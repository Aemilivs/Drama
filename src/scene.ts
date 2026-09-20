/**
 * Scene: the problem modelled as an environment actors can act in.
 *
 * A scene may be incomplete. "Unknown" is first-class information: a scene
 * designer can say "we cannot choose a cast yet because X is unknown."
 */

import {
  type Criterion,
  type Diagnosis,
  type InfoItem,
  infoText,
  isBlocking,
  nextId,
  toInfoItems,
} from "./types";

/** A constraint as written by a scene designer. Conflicts may be declared. */
export type ConstraintItem = string | { text: string; conflictsWith?: string[] };

export interface Scene {
  id: string;
  objective: string;
  desiredOutcome: string;
  known: InfoItem[];
  unknown: InfoItem[];
  assumed: InfoItem[];
  required: InfoItem[];
  stakeholders: string[];
  constraints: ConstraintItem[];
  availableTools: string[];
  successCriteria: Criterion[];
  failureModes: string[];
  requiredCapabilities: string[];
  interactionRequirements: string[];
  unresolvedQuestions: string[];
  createdAt: number;
  meta: Record<string, unknown>;
}

/**
 * The wire form a scene designer (or an LLM skill) emits. Snake_case mirrors the
 * YAML scene card produced by the `scene-designer` skill; camelCase is accepted
 * for convenience when writing cards in TypeScript.
 */
export interface SceneCard {
  objective?: string;
  desiredOutcome?: string;
  desired_outcome?: string;
  known?: InfoItem[];
  unknown?: InfoItem[];
  assumed?: InfoItem[];
  required?: InfoItem[];
  stakeholders?: string[];
  constraints?: ConstraintItem[];
  availableTools?: string[];
  available_tools?: string[];
  successCriteria?: (Criterion | Partial<Criterion> | string)[];
  success_criteria?: (Criterion | Partial<Criterion> | string)[];
  failureModes?: string[];
  failure_modes?: string[];
  requiredCapabilities?: string[];
  required_capabilities?: string[];
  interactionRequirements?: string[];
  interaction_requirements?: string[];
  unresolvedQuestions?: string[];
  unresolved_questions?: string[];
  meta?: Record<string, unknown>;
}

export interface SceneDesignInput {
  request: string;
  context?: string;
}

export interface SceneAnalysis {
  complete: boolean;
  /** Required fields the card did not supply (e.g. `success_criteria`). */
  missing: string[];
  /** Unknowns marked as blocking. */
  blockingUnknowns: string[];
  /** Questions worth asking the user, derived from the scene. */
  questions: string[];
  /** Pairs of constraints that contradict each other. */
  constraintConflicts: [string, string][];
}

export function isScene(value: unknown): value is Scene {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.objective === "string" &&
    Array.isArray(v.successCriteria) &&
    Array.isArray(v.requiredCapabilities)
  );
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]).slice() : [];
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCriteria(input: unknown, prefix: string): Criterion[] {
  return asArray<unknown>(input).map((raw, index) => {
    if (typeof raw === "string") {
      return { id: `${prefix}-${index + 1}`, description: raw };
    }
    const criterion = (raw ?? {}) as Partial<Criterion>;
    return {
      id: typeof criterion.id === "string" ? criterion.id : `${prefix}-${index + 1}`,
      description:
        typeof criterion.description === "string"
          ? criterion.description
          : `criterion ${index + 1}`,
    };
  });
}

/** Normalise a loose scene card into a complete Scene. Never throws. */
export function sceneFromCard(
  card: SceneCard,
  options: { fallbackObjective?: string; clock?: () => number } = {},
): Scene {
  const clock = options.clock ?? Date.now;
  const source = (card ?? {}) as SceneCard;
  return {
    id: nextId("scene"),
    objective: String(source.objective ?? options.fallbackObjective ?? "").trim(),
    desiredOutcome: String(source.desiredOutcome ?? source.desired_outcome ?? ""),
    known: toInfoItems(source.known),
    unknown: toInfoItems(source.unknown),
    assumed: toInfoItems(source.assumed),
    required: toInfoItems(source.required),
    stakeholders: readStrings(source.stakeholders),
    constraints: asArray<ConstraintItem>(source.constraints),
    availableTools: readStrings(source.availableTools ?? source.available_tools),
    successCriteria: normalizeCriteria(
      source.successCriteria ?? source.success_criteria,
      "criterion",
    ),
    failureModes: readStrings(source.failureModes ?? source.failure_modes),
    requiredCapabilities: readStrings(
      source.requiredCapabilities ?? source.required_capabilities,
    ),
    interactionRequirements: readStrings(
      source.interactionRequirements ?? source.interaction_requirements,
    ),
    unresolvedQuestions: readStrings(
      source.unresolvedQuestions ?? source.unresolved_questions,
    ),
    createdAt: clock(),
    meta: isRecord(source.meta) ? source.meta : {},
  };
}

export function constraintText(constraint: ConstraintItem): string {
  if (typeof constraint === "string") return constraint;
  if (
    constraint !== null &&
    typeof constraint === "object" &&
    typeof (constraint as { text?: unknown }).text === "string"
  ) {
    return (constraint as { text: string }).text;
  }
  return String(constraint ?? "");
}

export function constraintConflictsWith(constraint: ConstraintItem): string[] {
  if (constraint === null || typeof constraint !== "object") return [];
  const declared = (constraint as { conflictsWith?: unknown }).conflictsWith;
  return Array.isArray(declared) ? declared.map((item) => String(item)) : [];
}

const NEGATION =
  /\b(must not|mustn't|should not|shouldn't|never|do not|don't|cannot|can not|can't)\b/;
const MODALITY = /\b(must|should|always|require[sd]?|need[s]?|shall)\b/;
const STOPWORDS = new Set([
  "the", "a", "an", "it", "we", "i", "you", "be", "is",
  "are", "to", "of", "and", "or", "with", "for", "on", "in", "that", "this",
]);

function constraintSignature(text: string): { predicate: string; negative: boolean } | null {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const negative = NEGATION.test(normalized);
  const positive = !negative && MODALITY.test(normalized);
  if (!negative && !positive) return null;
  const predicate = normalized
    .replace(NEGATION, " ")
    .replace(MODALITY, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && !STOPWORDS.has(word))
    .join(" ");
  if (!predicate) return null;
  return { predicate, negative };
}

/**
 * Detect contradicting constraints. Conflicts are found two ways: explicitly
 * declared via `conflictsWith`, and by comparing the polarity of otherwise
 * identical constraints ("must cache" vs "must not cache").
 */
export function detectConstraintConflicts(
  constraints: ConstraintItem[],
): [string, string][] {
  const conflicts: [string, string][] = [];
  for (let i = 0; i < constraints.length; i += 1) {
    const left = constraints[i]!;
    const leftText = constraintText(left).toLowerCase();
    for (let j = i + 1; j < constraints.length; j += 1) {
      const right = constraints[j]!;
      const rightText = constraintText(right).toLowerCase();
      const declared =
        constraintConflictsWith(left).some((t) => t.toLowerCase() === rightText) ||
        constraintConflictsWith(right).some((t) => t.toLowerCase() === leftText);
      if (declared) {
        conflicts.push([constraintText(left), constraintText(right)]);
        continue;
      }
      const a = constraintSignature(constraintText(left));
      const b = constraintSignature(constraintText(right));
      if (a && b && a.predicate === b.predicate && a.negative !== b.negative) {
        conflicts.push([constraintText(left), constraintText(right)]);
      }
    }
  }
  return conflicts;
}

export type SceneDesignFn = (
  input: SceneDesignInput & { previous?: Scene; diagnosis?: Diagnosis },
) => SceneCard | Scene | Promise<SceneCard | Scene>;

export interface SceneDesignerOptions {
  /** The LLM-backed (or deterministic) design function. Falls back to a stub. */
  design?: SceneDesignFn;
  clock?: () => number;
}

/**
 * Turns an ambiguous request into a Scene, and reports what is still missing.
 * The designer does not solve the task; it designs the stage.
 */
export class SceneDesigner {
  private readonly designFn?: SceneDesignFn;
  private readonly clock: () => number;

  constructor(options: SceneDesignerOptions = {}) {
    this.designFn = options.design;
    this.clock = options.clock ?? Date.now;
  }

  async design(
    input: string | SceneDesignInput,
    context: { previous?: Scene; diagnosis?: Diagnosis } = {},
  ): Promise<Scene> {
    const request = typeof input === "string" ? { request: input } : input;
    if (this.designFn) {
      const card = await this.designFn({ ...request, ...context });
      if (isScene(card)) return { ...card };
      return sceneFromCard(card, {
        fallbackObjective: request.request,
        clock: this.clock,
      });
    }
    return sceneFromCard(
      { objective: request.request },
      { fallbackObjective: request.request, clock: this.clock },
    );
  }

  analyze(scene: Scene): SceneAnalysis {
    const missing: string[] = [];
    if (!scene.objective.trim()) missing.push("objective");
    if (scene.successCriteria.length === 0) missing.push("success_criteria");
    if (scene.requiredCapabilities.length === 0) missing.push("required_capabilities");

    const blockingUnknowns = scene.unknown.filter(isBlocking).map(infoText);
    const constraintConflicts = detectConstraintConflicts(scene.constraints);
    const questions = [
      ...blockingUnknowns,
      ...scene.unresolvedQuestions,
      ...constraintConflicts.map(([a, b]) => `Constraints conflict: "${a}" vs "${b}"`),
    ];
    const complete =
      missing.length === 0 &&
      blockingUnknowns.length === 0 &&
      constraintConflicts.length === 0;
    return { complete, missing, blockingUnknowns, questions, constraintConflicts };
  }

  /**
   * Ask only when the missing information materially changes the architecture.
   * A missing capability list does not: casting can infer it. A blocking unknown
   * or a contradictory constraint does.
   */
  shouldAskQuestions(analysis: SceneAnalysis): boolean {
    return (
      analysis.blockingUnknowns.length > 0 ||
      analysis.constraintConflicts.length > 0 ||
      analysis.missing.includes("objective")
    );
  }
}
