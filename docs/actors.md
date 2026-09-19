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

## Designed conflict

A role may declare its **stance** — the role it exists to challenge, and what the disagreement should yield:

```ts
stance: { opposes: "analysis", toYield: "Critique" }
```

This is what *"their conflicts produce the intended result"* looks like as code. The casting director validates the design: the target must exist (`dangling_stance`), the challenger must run after its targets have produced (`stance_before_target`), every target must actually run (`stance_target_inactive`), and the conflict must yield something a later step consumes (`unused_conflict_yield`). A stance is a property of a derived role, not a catalogue entry — it does not fix which roles exist.

## Nothing is declared in advance

A persona does **not** declare tags, suited roles, or a capability list. In life, performers do not know in advance how they will play a character — and a modest persona can suddenly play an unexpected role brilliantly. So the roster has no metadata to filter on, and casting never reads persona metadata to include or exclude a role.

## Where crystallisation is legitimate

Roles and personas crystallise differently, and confusing the two is the failure mode this model exists to prevent:

- **Roles are derived per scene — never predefined.** A fixed "continuation director" role, or a canonical Planner → Researcher → Critic → Executor, is a declared cast. Roles come from `requiredCapabilities` via the casting skill (or the deterministic fallback) every time.
- **Personas may be a curated roster.** Recognisability is the roster's whole point: a named character can be reused across scenes. But a persona still declares nothing and still auditions for every role.

So the lever for shaping behaviour is **not** a new role — it is an example in the casting prompt that teaches how to *derive* the role for a class of scene. Examples teach derivation, not answers.

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
| not now | temporary | the host owns a TTL; the core stores only the reason |
| "this is not mine" | principled | respect locally for the fingerprint, never for the capability |
| unstated | noise | cache only, no policy |

**Hard rule: never promote "declined role X" to "cannot do capability X".**

The scene is deliberately *not* part of the fingerprint: including it would make caching useless. The trade-off is acknowledged — a persona may accept in one context and decline in another, and the cache will not notice. A host that cares can scope its store per scene.

### Refusals diagnose roles

If many personas decline the same role, the problem is usually the **role**, not the personas: a vague objective, impossible constraints, an unclear artifact. Refusals are therefore a feedback signal into the existing loop: many refusals → `recast` (reformulate the role) or `redesign_scene`.

## When several accept, and when nobody does

- **Nobody accepts (or there is no persona for a role):** the role is played **without a persona** — a bare actor. The cast is still valid and the performance proceeds. The role is reported as `uncast`.
- **Several accept:** how many are asked and who is chosen are two separate knobs.
  - `askAll: false` (the default) stops as soon as every role has an acceptor — cheap.
  - `askAll: true` asks everyone, so every approach is recorded and every acceptor becomes a candidate. Use it when the *approaches themselves* are the value.
  - `select` chooses among the candidates. The default is roster order; it may return `undefined` to leave the role uncast, and it is where an LLM "director" would go.
  - When more than one accepted, the choice is traced as `persona_selected` carrying the full candidate list — the alternatives are visible rather than silently discarded.

  A persona may play more than one role, and the cache makes all of this stable.

## Reproducibility

Auditions are calls, so the cast is no longer statically reproducible. The guarantee is reframed:

> **Same scene and same audition answers ⇒ same cast.**

Auditions and cache hits are recorded, so a casting decision can always be explained. With a warm `AuditionStore` and a deterministic `Auditioner`, dressing is fully deterministic — which is how the requirement tests run, with no live agent spawn.

## What lives where

- **Core:** `src/persona.ts` (`Persona`, `Audition`, `Auditioner`, `AuditionStore`, `roleFingerprint`, `dressCast`, in-memory store) and `src/opencode.ts` (agent markdown → `Persona`). Pure, dependency-free, testable.
- **Host (`.opencode/`):** the casting call the orchestrator performs — `renderCastingCall` / `parseAuditionAnswer` (`.opencode/lib/audition-prompt.ts`) plus a persistent `AuditionStore` (`.opencode/lib/audition-store.ts`). A project tool cannot spawn a subagent, so the spawn itself belongs to the orchestrating agent; `examples/audition/run.ts` records a real run against Vimes, Feegle and Librarian.
- **Stage:** `StageManager` dresses a cast when given `personas` + `auditioner`, and folds audition events into the performance trace.

## Open question

The model is implemented end to end: personas, auditions, caching, designed conflict, a host casting call, and selection among acceptors. What remains is host wiring, not design:

- Cross-process coordination of the file store (it is last-write-wins within a session; one instance per session owns the file).
- A live `Auditioner` adapter that spawns the persona's subagent from the orchestrator — the spawn itself cannot live in a project tool.
