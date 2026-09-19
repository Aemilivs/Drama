# Actors: roles, personas, and the audition

This note fixes the model that `drama` uses to decide **who plays what**. It exists because two forces pull in opposite directions:

1. **Casting is functional.** The point is to pick the right *roles* for the task, so that their conflicts produce the intended result. Roles are chosen from capabilities and designed disagreement.
2. **Personas are recognizable.** Users want to bring characters they know into the roster (a detective, a skeptic, `Vimes`, `Librarian`) and see them play.

The resolution is to keep those two forces **orthogonal**.

## Two axes, one binding

```
Роль (function)                 Персона (dressing)              Актёр (binding)
----------------                ------------------              ---------------
capability                      name                            role + persona
objective                       archetype (prior)               + approach
expectedOutput                  description
constraints                     personaPrompt
interactionPermissions          source
```

- **Role** — the functional slot. It answers *who should be in the cast*. It carries the capability, the local objective, the expected artifact, constraints, permissions, and the designed conflict.
- **Persona** — a recognizable performer. It answers *how the role is played*. It declares **nothing** about which roles it can play.
- **Actor** — a role dressed in a persona. `Actor.binding` records the persona and the approach.

### Invariant

> **Changing (or removing) a persona never changes the cast as a computational structure** — never which roles exist, which artifacts they produce, or the protocol order. It changes only text and manner.

This is what keeps "persona ≠ capability" honest. It is enforced by `R-PERSONA-1` and `R-PERSONA-6`.

## Nothing is declared in advance

A persona does **not** declare tags, suited roles, or a capability list. In life, performers do not know in advance how they will play a character — and a modest persona can suddenly play an unexpected role brilliantly. So the roster has no metadata to filter on, and casting never reads persona metadata to include or exclude a role.

## The audition replaces tags and pinning

The binding is discovered by **asking the persona directly**:

```ts
type Auditioner = (input: {
  roles: RoleRef[];   // all currently open roles
  persona: Persona;
  scene: Scene;
}) => Audition[] | Promise<Audition[]>;

interface Audition {
  role: string;        // the role's name (the cast slot)
  persona: string;     // persona id
  accepted: boolean;
  reason?: string;     // why it declined
  approach?: string;   // "how I'd play it" — a role-specific behavioural prior
}
```

This is a **casting call**, not a callback: each persona is asked once, with all open roles at once. Cost is `O(P)` in the roster size, never `O(P×R)`.

The answer is more than a yes/no. `approach` is *generated* by the audition, so the actor gets a role-specific behavioural prior instead of a static persona prompt.

In OpenCode the `Auditioner` is host-injected: the host spawns the persona's subagent and asks it. Core `drama` stays dependency-free and only consumes the answer — the same seam as `StageOptions.executors`.

## Cache and refusals

Auditions are cached, and refusals are remembered:

```ts
interface AuditionStore {
  get(persona: string, fingerprint: string): Audition | undefined;
  put(persona: string, fingerprint: string, audition: Audition): void;
  all(): StoredAudition[];
}
```

### The key is a role fingerprint, not a capability

`roleFingerprint` hashes the role's **content** — objective, constraints, expected artifact, permissions, role name — and deliberately excludes the capability name alone.

> Storing a refusal as "persona P cannot do capability X" would turn the negative cache into a **declared capability list** — exactly what we rejected. A persona declined *one formulation* of a role, in *one* context; a differently formulated role with the same capability is a different question and is asked again.

Because the fingerprint is content-derived, invalidation is automatic: change the role spec and the key changes.

### A refusal is not a ban

The reason is stored, and its nature matters:

| Reason | Nature | Handling |
| --- | --- | --- |
| lacks a required tool | contextual, objective | respect for this fingerprint; a new role may be asked |
| not now | temporary | TTL at the host; ask again later |
| "this is not mine" | principled | respect locally for the fingerprint, never for the capability |
| unstated | noise | cache only, no policy |

**Hard rule: never promote "declined role X" to "cannot do capability X".**

The scene is deliberately *not* part of the fingerprint: including it would make caching useless. The trade-off is acknowledged — a persona may accept in one context and decline in another, and the cache will not notice. A host that cares can scope its store per scene.

### Refusals diagnose roles

If many personas decline the same role, the problem is usually the **role**, not the personas: a vague objective, impossible constraints, an unclear artifact. Refusals are therefore a feedback signal into the existing loop: many refusals → `recast` (reformulate the role) or `redesign_scene`.

## When several accept, and when nobody does

- **Nobody accepts (or there is no persona for a role):** the role is played **without a persona** — a bare actor. The cast is still valid and the performance proceeds. The role is reported as `uncast`.
- **Several accept:** the default is deterministic — roster order wins (first accept binds the role), and a persona may play more than one role. The cache makes this stable. An LLM "director chooses among acceptors" is an optional escalation, not the default, because every added decision costs reproducibility.

## Reproducibility

Auditions are calls, so the cast is no longer statically reproducible. The guarantee is reframed:

> **Same scene and same audition answers ⇒ same cast.**

Auditions and cache hits are recorded, so a casting decision can always be explained. With a warm `AuditionStore` and a deterministic `Auditioner`, dressing is fully deterministic — which is how the requirement tests run, with no live agent spawn.

## What lives where

- **Core:** `src/persona.ts` (`Persona`, `Audition`, `Auditioner`, `AuditionStore`, `roleFingerprint`, `dressCast`, in-memory store) and `src/opencode.ts` (agent markdown → `Persona`). Pure, dependency-free, testable.
- **Host (`.opencode/`):** the `Auditioner` that spawns subagents, and a persistent `AuditionStore`.
- **Stage:** `StageManager` dresses a cast when given `personas` + `auditioner`, and folds audition events into the performance trace.

## Open question

The model is implemented; what remains is host wiring and one design increment:

- A persistent `AuditionStore` and a subagent-spawning `Auditioner` in `.opencode/`.
- First-class conflict design on roles (`stance`), so that "designed disagreement" is validated rather than implied.
