/**
 * Personas and auditions.
 *
 * A role is a functional slot. A persona is a recognizable performer that
 * declares nothing about which roles it can play. The binding between them is
 * discovered by asking the persona directly — an audition — and remembered in
 * an AuditionStore so it is cheap and reproducible.
 *
 * See docs/actors.md.
 */

import type { Scene } from "./scene";
import type { Actor, ActorBinding } from "./actor";
import type { Cast } from "./cast";

export type PersonaSource =
  | { kind: "builtin" }
  | { kind: "opencode-agent"; ref: string }
  | { kind: "custom"; ref?: string };

/**
 * A recognizable performer. Deliberately declares no capabilities, tags or
 * suited roles: casting must never filter personas by metadata.
 */
export interface Persona {
  id: string;
  name: string;
  /** Optional behavioural prior (Detective, Skeptic, Architect...). */
  archetype?: string;
  description?: string;
  /** Voice / heuristics overlay appended to the actor prompt. */
  personaPrompt?: string;
  source?: PersonaSource;
}

export function createPersona(
  partial: Partial<Persona> & Pick<Persona, "id" | "name">,
): Persona {
  return {
    id: partial.id,
    name: partial.name,
    archetype: partial.archetype,
    description: partial.description,
    personaPrompt: partial.personaPrompt,
    source: partial.source ?? { kind: "builtin" },
  };
}

/** The functional description of a role, presented to personas verbatim. */
export interface RoleRef {
  name: string;
  role: string;
  objective: string;
  capabilities: string[];
  expectedOutput: string[];
  constraints: string[];
  interactionPermissions: string[];
}

export function roleRefOf(actor: Actor): RoleRef {
  return {
    name: actor.name,
    role: actor.role,
    objective: actor.objective,
    capabilities: actor.capabilities.slice(),
    expectedOutput: actor.expectedOutput.slice(),
    constraints: actor.constraints.slice(),
    interactionPermissions: actor.interactionPermissions.slice(),
  };
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A content-addressed key for a role, used to cache auditions.
 *
 * It hashes the role's content — name, role, objective, capabilities, expected
 * artifact, constraints, permissions — and deliberately NOT the capability
 * alone: a refusal for one formulation of a role must not become a declared
 * incapacity for the whole capability.
 */
export function roleFingerprint(role: RoleRef): string {
  return fnv1a(
    JSON.stringify({
      name: role.name,
      role: role.role,
      objective: role.objective,
      capabilities: [...role.capabilities].sort(),
      expectedOutput: [...role.expectedOutput].sort(),
      constraints: [...role.constraints].sort(),
      interactionPermissions: [...role.interactionPermissions].sort(),
    }),
  );
}

/** One persona's answer about one role. */
export interface Audition {
  /** The role's name (the cast slot), not the capability. */
  role: string;
  persona: string;
  accepted: boolean;
  /** Why the persona declined, if it did. Kept, never promoted to a ban. */
  reason?: string;
  /** "How I'd play it" — a role-specific behavioural prior. */
  approach?: string;
}

export interface AuditionRecord extends Audition {
  /** True when the answer came from the store rather than a live audition. */
  cached: boolean;
}

/**
 * Asks a persona, in one casting call, about all currently open roles.
 * In OpenCode this is host-injected and spawns the persona's subagent.
 */
export type Auditioner = (input: {
  roles: RoleRef[];
  persona: Persona;
  scene: Scene;
}) => Audition[] | Promise<Audition[]>;

/** A deterministic fallback: every persona accepts every role. */
export function acceptAllAuditioner(): Auditioner {
  return ({ roles, persona }) =>
    roles.map((role) => ({ role: role.name, persona: persona.id, accepted: true }));
}

export interface StoredAudition extends Audition {
  fingerprint: string;
}

export interface AuditionStore {
  get(persona: string, fingerprint: string): Audition | undefined;
  put(persona: string, fingerprint: string, audition: Audition): void;
  all(): StoredAudition[];
}

export function createMemoryAuditionStore(seed: StoredAudition[] = []): AuditionStore {
  const entries = new Map<string, StoredAudition>();
  const key = (persona: string, fingerprint: string) => `${persona}::${fingerprint}`;
  for (const entry of seed) {
    entries.set(key(entry.persona, entry.fingerprint), { ...entry });
  }
  return {
    get: (persona, fingerprint) => {
      const entry = entries.get(key(persona, fingerprint));
      return entry ? { ...entry } : undefined;
    },
    put: (persona, fingerprint, audition) => {
      entries.set(key(persona, fingerprint), { ...audition, persona, fingerprint });
    },
    all: () => [...entries.values()].map((entry) => ({ ...entry })),
  };
}

export type AuditionEvent =
  | { type: "auditioned"; persona: string; role: string; accepted: boolean; reason?: string }
  | { type: "audition_cached"; persona: string; role: string; accepted: boolean }
  | { type: "persona_bound"; role: string; persona: string; approach?: string }
  | { type: "role_uncast"; role: string };

export interface DressOptions {
  /** The roster. Order is significant: first accept binds the role. */
  personas: Persona[];
  auditioner: Auditioner;
  /** Where auditions are cached. Defaults to an in-memory store. */
  auditionStore?: AuditionStore;
  /** Hard cap on how many personas are asked. Defaults to the roster size. */
  maxAuditions?: number;
  onEvent?: (event: AuditionEvent) => void;
}

export interface DressedCast {
  cast: Cast;
  auditions: AuditionRecord[];
  events: AuditionEvent[];
  /** Roles that no persona accepted (played without a persona). */
  uncast: string[];
  /** Personas that bound to no role. */
  unused: string[];
}

/**
 * Dress a cast: bind personas to the cast's roles by auditioning them.
 * Roles are never added or removed — only dressed. A role nobody accepts is
 * left as a bare actor.
 */
export async function dressCast(
  cast: Cast,
  scene: Scene,
  options: DressOptions,
): Promise<DressedCast> {
  const store = options.auditionStore ?? createMemoryAuditionStore();
  const personas = options.personas.slice();
  const maxAuditions = options.maxAuditions ?? personas.length;

  const bindings = new Map<string, ActorBinding>();
  const auditions: AuditionRecord[] = [];
  const events: AuditionEvent[] = [];
  let asked = 0;

  const emit = (event: AuditionEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };

  const openRoles = () => cast.actors.filter((actor) => !bindings.has(actor.name));

  for (const persona of personas) {
    if (asked >= maxAuditions) break;
    const roles = openRoles();
    if (roles.length === 0) break;

    const toAsk: RoleRef[] = [];
    for (const actor of roles) {
      const ref = roleRefOf(actor);
      const fingerprint = roleFingerprint(ref);
      const cached = store.get(persona.id, fingerprint);
      if (!cached) {
        toAsk.push(ref);
        continue;
      }
      auditions.push({ ...cached, role: actor.name, cached: true });
      emit({
        type: "audition_cached",
        persona: persona.id,
        role: actor.name,
        accepted: cached.accepted,
      });
      if (cached.accepted) {
        bindings.set(actor.name, {
          persona,
          approach: cached.approach,
          from: "cache",
        });
        emit({
          type: "persona_bound",
          role: actor.name,
          persona: persona.id,
          approach: cached.approach,
        });
      }
    }

    if (toAsk.length === 0) continue;

    const answers = await options.auditioner({ roles: toAsk, persona, scene });
    asked += 1;

    for (const answer of answers) {
      const actor = cast.actors.find((candidate) => candidate.name === answer.role);
      if (!actor) continue;
      const fingerprint = roleFingerprint(roleRefOf(actor));
      store.put(persona.id, fingerprint, answer);
      auditions.push({ ...answer, persona: persona.id, cached: false });
      emit({
        type: "auditioned",
        persona: persona.id,
        role: actor.name,
        accepted: answer.accepted,
        reason: answer.reason,
      });
      if (answer.accepted && !bindings.has(actor.name)) {
        bindings.set(actor.name, {
          persona,
          approach: answer.approach,
          from: "audition",
        });
        emit({
          type: "persona_bound",
          role: actor.name,
          persona: persona.id,
          approach: answer.approach,
        });
      }
    }
  }

  const dressedActors = cast.actors.map((actor) => {
    // Strip any binding carried in from an earlier dressing: a role that is not
    // re-bound now must not keep a stale persona.
    const bare: Actor = { ...actor };
    delete bare.binding;
    const binding = bindings.get(actor.name);
    return binding ? { ...bare, binding } : bare;
  });

  const uncast = cast.actors
    .filter((actor) => !bindings.has(actor.name))
    .map((actor) => actor.name);
  for (const role of uncast) emit({ type: "role_uncast", role });

  const boundPersonaIds = new Set([...bindings.values()].map((b) => b.persona.id));
  const unused = personas
    .filter((persona) => !boundPersonaIds.has(persona.id))
    .map((persona) => persona.id);

  return {
    cast: { ...cast, actors: dressedActors },
    auditions,
    events,
    uncast,
    unused,
  };
}
