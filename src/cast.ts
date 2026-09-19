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

/**
 * The protocol step's artifact inputs are explicit: `consumes: []` means the
 * actor receives no input artifacts. List the kinds it needs, or compute them.
 */
export interface ProtocolStep {
  id: string;
  actor: string;
  instruction: string;
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
    steps: (Array.isArray(steps) ? steps : []).map((raw, index) => {
      const step = (raw ?? {}) as ProtocolStepInput;
      return {
        id: `step-${index + 1}`,
        actor: typeof step.actor === "string" ? step.actor : "",
        instruction: typeof step.instruction === "string" ? step.instruction : "",
        consumes: readStrings(step.consumes),
        produces: readStrings(step.produces),
        optional: step.optional === true,
      };
    }),
    notes: typeof notes === "string" ? notes : "",
  };
}

export function createCast(actors: Actor[], protocol: Protocol, rationale = ""): Cast {
  return { id: nextId("cast"), actors, protocol, rationale, createdAt: Date.now() };
}

function readStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  const takenNames = new Set<string>();
  const takenRoles = new Set<string>();
  const actors: Actor[] = capabilities.map((capability) => {
    const actor = createActor({
      name: uniqueName(takenNames, slug(capability)),
      role: uniqueName(takenRoles, capability),
      objective: `Produce the best possible result for the capability: ${capability}.`,
      capabilities: [capability],
      expectedOutput: [`${pascal(capability)}Report`],
    });
    takenNames.add(actor.name);
    takenRoles.add(actor.role);
    return actor;
  });

  const steps: ProtocolStepInput[] = actors.map((actor) => ({
    actor: actor.name,
    instruction: actor.objective,
    produces: actor.expectedOutput,
  }));

  let rationale = "Derived one actor per required capability.";
  if (actors.length > 1) {
    const producerKinds = actors.flatMap((actor) => actor.expectedOutput);
    const synthesizer = createActor({
      name: uniqueName(takenNames, "synthesizer"),
      role: uniqueName(takenRoles, "synthesizer"),
      objective: "Merge every produced artifact into a single coherent answer.",
      capabilities: ["synthesis"],
      expectedOutput: ["FinalAnswer"],
      interactionPermissions: ["synthesize"],
    });
    actors.push(synthesizer);
    steps.push({
      actor: synthesizer.name,
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

export function actorFromCard(card: ActorCard): Actor {
  const source = (card ?? {}) as ActorCard;
  const name =
    typeof source.name === "string" && source.name.length > 0 ? source.name : "actor";
  const kind =
    source.kind === "llm" || source.kind === "deterministic" || source.kind === "tool"
      ? source.kind
      : undefined;
  return createActor({
    name,
    role: typeof source.role === "string" && source.role.length > 0 ? source.role : name,
    objective: typeof source.objective === "string" ? source.objective : "",
    kind,
    archetype: typeof source.archetype === "string" ? source.archetype : undefined,
    capabilities: readStrings(source.capabilities),
    tools: readStrings(source.tools),
    knowledge: readStrings(source.knowledge),
    constraints: readStrings(source.constraints),
    interactionPermissions: readStrings(source.interactionPermissions),
    expectedOutput: readStrings(source.expectedOutput ?? source.produces),
    exitCondition: typeof source.exitCondition === "string" ? source.exitCondition : undefined,
  });
}

/** Normalise a loose cast card (as emitted by a skill) into a Cast. Never throws. */
export function castFromCard(
  card: CastCard,
  options: { clock?: () => number } = {},
): Cast {
  const source = (card ?? {}) as CastCard;
  const actorCards: ActorCard[] = Array.isArray(source.cast)
    ? source.cast
    : Array.isArray(source.actors)
      ? source.actors
      : [];
  const actors = actorCards.map((entry) => actorFromCard(entry));

  const protocolCard = source.protocol;
  let steps: ProtocolStepInput[] = [];
  let notes = "";
  if (Array.isArray(protocolCard)) {
    steps = protocolCard;
  } else if (isRecord(protocolCard)) {
    if (Array.isArray(protocolCard.steps)) steps = protocolCard.steps as ProtocolStepInput[];
    if (typeof protocolCard.notes === "string") notes = protocolCard.notes;
  }

  const rationale = typeof source.rationale === "string" ? source.rationale : "";
  const cast = createCast(actors, createProtocol(steps, notes), rationale);
  return options.clock ? { ...cast, createdAt: options.clock() } : cast;
}

/**
 * Greedy capability cover: the smallest set of actors (by this heuristic) whose
 * capabilities cover every required capability. Used so that mutually
 * redundant actors flag only one of themselves rather than all of them.
 */
function cloneActor(actor: Actor): Actor {
  return {
    ...actor,
    capabilities: actor.capabilities.slice(),
    tools: actor.tools.slice(),
    knowledge: actor.knowledge.slice(),
    constraints: actor.constraints.slice(),
    interactionPermissions: actor.interactionPermissions.slice(),
    expectedOutput: actor.expectedOutput.slice(),
  };
}

function cloneCast(cast: Cast): Cast {
  return {
    ...cast,
    actors: cast.actors.map(cloneActor),
    protocol: {
      ...cast.protocol,
      steps: cast.protocol.steps.map((step) => ({
        ...step,
        consumes: step.consumes.slice(),
        produces: step.produces.slice(),
      })),
    },
  };
}

function uniqueName(taken: Set<string>, base: string): string {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function capabilityActor(
  capability: string,
  takenNames: Set<string>,
  takenRoles: Set<string>,
): Actor {
  return createActor({
    name: uniqueName(takenNames, slug(capability)),
    role: uniqueName(takenRoles, capability),
    objective: `Provide the missing capability: ${capability}.`,
    capabilities: [capability],
    expectedOutput: [`${pascal(capability)}Report`],
  });
}

function researcherActor(
  topics: string[],
  takenNames: Set<string>,
  takenRoles: Set<string>,
): Actor {
  return createActor({
    name: uniqueName(takenNames, "researcher"),
    role: uniqueName(takenRoles, "researcher"),
    objective: `Obtain the missing information: ${topics.join("; ")}.`,
    capabilities: ["research"],
    expectedOutput: ["ResearchReport"],
  });
}

/**
 * Insert new actors into an existing cast without disturbing what worked: their
 * steps run just before the synthesizer, they consume everything produced so
 * far, and — if no synthesizer exists — one is added so their output is used.
 */
function extendCast(previous: Cast, additions: Actor[]): Cast {
  const actors = [...previous.actors.map(cloneActor), ...additions];
  const steps: ProtocolStepInput[] = previous.protocol.steps.map((step) => ({
    actor: step.actor,
    instruction: step.instruction,
    consumes: step.consumes.slice(),
    produces: step.produces.slice(),
    optional: step.optional,
  }));

  const synthIndex = steps.findIndex(
    (step) =>
      actors
        .find((actor) => actor.name === step.actor)
        ?.interactionPermissions.includes("synthesize") ?? false,
  );
  const insertAt = synthIndex >= 0 ? synthIndex : steps.length;
  const priorKinds = [
    ...new Set(steps.slice(0, insertAt).flatMap((step) => step.produces ?? [])),
  ];

  steps.splice(
    insertAt,
    0,
    ...additions.map((actor) => ({
      actor: actor.name,
      instruction: actor.objective,
      consumes: priorKinds.slice(),
      produces: actor.expectedOutput.slice(),
      optional: false,
    })),
  );

  const newKinds = additions.flatMap((actor) => actor.expectedOutput);
  if (synthIndex >= 0) {
    const synthStep = steps[insertAt + additions.length]!;
    if ((synthStep.consumes ?? []).length > 0) {
      synthStep.consumes = [...synthStep.consumes!, ...newKinds];
    } else {
      // An empty consumes list means "nothing": a synthesizer that declares no
      // inputs must still consume everything produced, or its inputs vanish.
      const producerKinds = [
        ...new Set(
          steps
            .filter((_, index) => index !== insertAt + additions.length)
            .flatMap((step) => step.produces ?? []),
        ),
      ];
      synthStep.consumes = producerKinds;
    }
  } else {
    const producerKinds = [...new Set(actors.flatMap((actor) => actor.expectedOutput))];
    const takenNames = new Set(actors.map((actor) => actor.name));
    const takenRoles = new Set(actors.map((actor) => actor.role));
    const synthesizer = createActor({
      name: uniqueName(takenNames, "synthesizer"),
      role: uniqueName(takenRoles, "synthesizer"),
      objective: "Merge every produced artifact into a single coherent answer.",
      capabilities: ["synthesis"],
      expectedOutput: ["FinalAnswer"],
      interactionPermissions: ["synthesize"],
    });
    actors.push(synthesizer);
    steps.push({
      actor: synthesizer.name,
      instruction: synthesizer.objective,
      consumes: producerKinds,
      produces: ["FinalAnswer"],
    });
  }

  return createCast(actors, createProtocol(steps, previous.protocol.notes), previous.rationale);
}

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
    if (this.castFn) {
      const produced = await this.castFn(scene, ctx);
      return cloneCast(produced);
    }
    if (!ctx.previous) return deriveMinimalCast(scene);

    // Deterministic recast: extend the previous cast with the diagnosed gaps,
    // so a reperformance has a real chance instead of repeating the same cast.
    const additions: Actor[] = [];
    const takenNames = new Set(ctx.previous.actors.map((actor) => actor.name));
    const takenRoles = new Set(ctx.previous.actors.map((actor) => actor.role));
    if (ctx.diagnosis === "missing_capability") {
      const covered = new Set(ctx.previous.actors.flatMap((actor) => actor.capabilities));
      for (const capability of ctx.evaluation?.missingCapabilities ?? []) {
        if (covered.has(capability)) continue;
        const actor = capabilityActor(capability, takenNames, takenRoles);
        takenNames.add(actor.name);
        takenRoles.add(actor.role);
        covered.add(capability);
        additions.push(actor);
      }
    } else if (ctx.diagnosis === "missing_information") {
      const topics = ctx.evaluation?.missingInformation ?? [];
      if (topics.length > 0) {
        const actor = researcherActor(topics, takenNames, takenRoles);
        takenNames.add(actor.name);
        takenRoles.add(actor.role);
        additions.push(actor);
      }
    }

    if (additions.length === 0) return cloneCast(ctx.previous);
    return extendCast(ctx.previous, additions);
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
