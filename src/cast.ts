/**
 * Casting: choosing the smallest set of actors that can produce the outcome,
 * plus the interaction protocol that governs them.
 *
 * The cast is a variable, not a constant. A casting director reasons in terms of
 * capabilities and responsibilities, and may be re-invoked with a diagnosis when
 * a performance fails because a capability was missing.
 */

import type { Diagnosis } from "./types";
import { nextId } from "./types";
import type { Scene } from "./scene";
import { type Actor, type ActorKind, createActor } from "./actor";
import type { Evaluation } from "./evaluation";

export interface ProtocolStep {
  id: string;
  actor: string;
  instruction: string;
  /** Artifact kinds required as input. Empty means "all artifacts produced so far". */
  consumes: string[];
  produces: string[];
  optional: boolean;
}

export interface Protocol {
  steps: ProtocolStep[];
  notes: string;
}

export interface Cast {
  id: string;
  actors: Actor[];
  protocol: Protocol;
  rationale: string;
  createdAt: number;
}

export type CastIssueCode =
  | "missing_capability"
  | "unnecessary_actor"
  | "role_conflict"
  | "unknown_actor"
  | "unproduced_input"
  | "empty_objective"
  | "duplicate_actor";

export interface CastIssue {
  severity: "error" | "warning";
  code: CastIssueCode;
  message: string;
  actors: string[];
}

export interface MinimalityFinding {
  actor: string;
  reason: string;
}

export interface MinimalityReport {
  removable: MinimalityFinding[];
}

export interface RecastContext {
  attempt: number;
  previous?: Cast;
  evaluation?: Evaluation;
  diagnosis?: Diagnosis;
}

export type CastFn = (scene: Scene, ctx: RecastContext) => Cast | Promise<Cast>;

export interface ProtocolStepInput {
  actor: string;
  instruction: string;
  consumes?: string[];
  produces?: string[];
  optional?: boolean;
}

export function createProtocol(steps: ProtocolStepInput[], notes = ""): Protocol {
  return {
    steps: steps.map((step, index) => ({
      id: `step-${index + 1}`,
      actor: step.actor,
      instruction: step.instruction,
      consumes: step.consumes?.slice() ?? [],
      produces: step.produces?.slice() ?? [],
      optional: step.optional ?? false,
    })),
    notes,
  };
}

export function createCast(actors: Actor[], protocol: Protocol, rationale = ""): Cast {
  return { id: nextId("cast"), actors, protocol, rationale, createdAt: Date.now() };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "actor"
  );
}

function pascal(text: string): string {
  return (
    text
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join("") || "Output"
  );
}

/**
 * Deterministic fallback cast: one actor per required capability, plus a
 * synthesizer when there is more than one producer. This is a baseline, not a
 * canonical cast — the real casting intelligence lives in the casting skill.
 */
export function deriveMinimalCast(scene: Scene): Cast {
  const capabilities = scene.requiredCapabilities.length
    ? [...new Set(scene.requiredCapabilities)]
    : ["reasoning"];

  const actors: Actor[] = capabilities.map((capability) =>
    createActor({
      name: slug(capability),
      role: capability,
      objective: `Produce the best possible result for the capability: ${capability}.`,
      capabilities: [capability],
      expectedOutput: [`${pascal(capability)}Report`],
    }),
  );

  const steps: ProtocolStepInput[] = actors.map((actor) => ({
    actor: actor.name,
    instruction: actor.objective,
    produces: actor.expectedOutput,
  }));

  let rationale = "Derived one actor per required capability.";
  if (actors.length > 1) {
    const producerKinds = actors.flatMap((actor) => actor.expectedOutput);
    const synthesizer = createActor({
      name: "synthesizer",
      role: "synthesizer",
      objective: "Merge every produced artifact into a single coherent answer.",
      capabilities: ["synthesis"],
      expectedOutput: ["FinalAnswer"],
      interactionPermissions: ["synthesize"],
    });
    actors.push(synthesizer);
    steps.push({
      actor: "synthesizer",
      instruction: synthesizer.objective,
      consumes: producerKinds,
      produces: ["FinalAnswer"],
    });
    rationale += " Added a synthesizer because the scene has multiple producers.";
  }

  return createCast(
    actors,
    createProtocol(steps, "Producers run first; the synthesizer consumes their output."),
    rationale,
  );
}

export interface ActorCard {
  name: string;
  role?: string;
  objective?: string;
  kind?: ActorKind;
  archetype?: string;
  capabilities?: string[];
  tools?: string[];
  knowledge?: string[];
  constraints?: string[];
  interactionPermissions?: string[];
  expectedOutput?: string[] | string;
  produces?: string[] | string;
  exitCondition?: string;
}

export interface ProtocolCard {
  notes?: string;
  steps?: ProtocolStepInput[];
}

/** The wire form a casting director (or an LLM skill) emits. */
export interface CastCard {
  cast?: ActorCard[];
  actors?: ActorCard[];
  protocol?: ProtocolCard | ProtocolStepInput[];
  rationale?: string;
}

function asArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.slice() : [value];
}

export function actorFromCard(card: ActorCard): Actor {
  return createActor({
    name: card.name,
    role: card.role ?? card.name,
    objective: card.objective ?? "",
    kind: card.kind,
    archetype: card.archetype,
    capabilities: card.capabilities,
    tools: card.tools,
    knowledge: card.knowledge,
    constraints: card.constraints,
    interactionPermissions: card.interactionPermissions,
    expectedOutput: asArray(card.expectedOutput ?? card.produces),
    exitCondition: card.exitCondition,
  });
}

/** Normalise a loose cast card (as emitted by a skill) into a Cast. Never throws. */
export function castFromCard(
  card: CastCard,
  options: { clock?: () => number } = {},
): Cast {
  const actors = (card.cast ?? card.actors ?? []).map(actorFromCard);
  const protocolCard = card.protocol;
  const steps = Array.isArray(protocolCard) ? protocolCard : (protocolCard?.steps ?? []);
  const notes = Array.isArray(protocolCard) ? "" : (protocolCard?.notes ?? "");
  const cast = createCast(actors, createProtocol(steps, notes), card.rationale ?? "");
  return options.clock ? { ...cast, createdAt: options.clock() } : cast;
}

/**
 * Greedy capability cover: the smallest set of actors (by this heuristic) whose
 * capabilities cover every required capability. Used so that mutually
 * redundant actors flag only one of themselves rather than all of them.
 */
function capabilityCover(cast: Cast, required: string[]): Set<string> {
  const needed = new Set(required);
  const chosen = new Set<string>();
  while (needed.size > 0) {
    let best: Actor | undefined;
    let bestCount = 0;
    for (const actor of cast.actors) {
      const count = actor.capabilities.filter((capability) => needed.has(capability)).length;
      if (count > bestCount) {
        bestCount = count;
        best = actor;
      }
    }
    if (!best) break; // a required capability is owned by nobody
    for (const capability of best.capabilities) needed.delete(capability);
    chosen.add(best.name);
  }
  return chosen;
}

export class CastingDirector {
  private readonly castFn?: CastFn;

  constructor(options: { cast?: CastFn } = {}) {
    this.castFn = options.cast;
  }

  async cast(scene: Scene, ctx: RecastContext = { attempt: 1 }): Promise<Cast> {
    if (!this.castFn) return deriveMinimalCast(scene);
    const produced = await this.castFn(scene, ctx);
    return {
      ...produced,
      actors: produced.actors.slice(),
      protocol: {
        ...produced.protocol,
        steps: produced.protocol.steps.map((step) => ({
          ...step,
          consumes: step.consumes.slice(),
          produces: step.produces.slice(),
        })),
      },
    };
  }

  /** Structural checks: capabilities, roles, protocol wiring, minimality. */
  validate(scene: Scene, cast: Cast): CastIssue[] {
    const issues: CastIssue[] = [];
    const names = new Set<string>();
    const roleOwners = new Map<string, string>();

    for (const actor of cast.actors) {
      if (names.has(actor.name)) {
        issues.push({
          severity: "error",
          code: "duplicate_actor",
          message: `Duplicate actor name "${actor.name}".`,
          actors: [actor.name],
        });
      }
      names.add(actor.name);

      if (!actor.objective.trim()) {
        issues.push({
          severity: "error",
          code: "empty_objective",
          message: `Actor "${actor.name}" has no objective.`,
          actors: [actor.name],
        });
      }

      const owner = roleOwners.get(actor.role);
      if (owner !== undefined) {
        issues.push({
          severity: "error",
          code: "role_conflict",
          message: `Role "${actor.role}" is claimed by both "${owner}" and "${actor.name}".`,
          actors: [owner, actor.name],
        });
      } else {
        roleOwners.set(actor.role, actor.name);
      }
    }

    const covered = new Set(cast.actors.flatMap((actor) => actor.capabilities));
    for (const capability of scene.requiredCapabilities) {
      if (!covered.has(capability)) {
        issues.push({
          severity: "error",
          code: "missing_capability",
          message: `No actor provides the required capability "${capability}".`,
          actors: [],
        });
      }
    }

    const byName = new Map(cast.actors.map((actor) => [actor.name, actor]));
    const produced = new Set<string>();
    for (const step of cast.protocol.steps) {
      if (!byName.has(step.actor)) {
        issues.push({
          severity: "error",
          code: "unknown_actor",
          message: `Protocol step "${step.id}" references unknown actor "${step.actor}".`,
          actors: [step.actor],
        });
      }
      for (const kind of step.consumes) {
        if (!produced.has(kind)) {
          issues.push({
            severity: "error",
            code: "unproduced_input",
            message: `Protocol step "${step.id}" consumes "${kind}", which no earlier step produces.`,
            actors: [step.actor],
          });
        }
      }
      for (const kind of step.produces) produced.add(kind);
    }

    for (const finding of this.minimality(scene, cast).removable) {
      issues.push({
        severity: "warning",
        code: "unnecessary_actor",
        message: `Actor "${finding.actor}" looks unnecessary: ${finding.reason}.`,
        actors: [finding.actor],
      });
    }

    return issues;
  }

  /**
   * Minimality is a first-class check. An actor is flagged when it is never
   * activated, or when it is not needed to cover the scene's capabilities and
   * nothing consumes its output. Capability coverage is computed globally so
   * that mutually redundant actors flag only one of themselves.
   */
  minimality(scene: Scene, cast: Cast): MinimalityReport {
    const removable: MinimalityFinding[] = [];
    const referenced = new Set(cast.protocol.steps.map((step) => step.actor));
    const consumedKinds = new Set(cast.protocol.steps.flatMap((step) => step.consumes));
    const coverage = capabilityCover(
      cast,
      scene.requiredCapabilities.length
        ? scene.requiredCapabilities
        : cast.actors.flatMap((actor) => actor.capabilities),
    );

    for (const actor of cast.actors) {
      if (!referenced.has(actor.name)) {
        removable.push({
          actor: actor.name,
          reason: "it is never referenced by an interaction step",
        });
        continue;
      }
      if (actor.interactionPermissions.includes("synthesize")) continue;

      const neededForCoverage = coverage.has(actor.name);
      const outputConsumed = actor.expectedOutput.some((kind) => consumedKinds.has(kind));
      if (!neededForCoverage && !outputConsumed) {
        removable.push({
          actor: actor.name,
          reason:
            "its capabilities are already covered by other actors and nothing consumes its output",
        });
      }
    }

    return { removable };
  }
}
