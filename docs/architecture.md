# Architecture

`drama` is a data-first library. Scenes, casts, artifacts, evaluations and the performance trace are plain serialisable objects; the only behaviour lives in small, explicit classes. A whole performance can be dumped to JSON — with one caveat: `Actor.executor` is a function, so replaying a stored performance means re-attaching executors (see `docs/ROADMAP.md`).

## Module map

```text
types.ts ────────────────────────────────────────────────┐
  Status, RecommendedAction, Diagnosis, Criterion,        │
  Artifact, InfoItem, nextId                              │
                                                          │
scene.ts  Scene, SceneCard, SceneDesigner                 │
  imports: types                                          │
                                                          │
actor.ts  Actor, ActorContext, ActorExecutor, ToolRegistry│
  imports: types, scene (type only)                       │
                                                          │
cast.ts   Cast, Protocol, CastingDirector,                │
          deriveMinimalCast, castFromCard                 │
  imports: types, scene, actor, evaluation (type only) ───┤
                                                          │
evaluation.ts  Evaluation, Evaluator, aggregate,          │
               criterionEvaluator, actionForDiagnosis     │
  imports: types, scene (type), cast (type)               │
                                                          │
persona.ts  Persona, Audition, Auditioner,                │
            AuditionStore, roleFingerprint, dressCast     │
  imports: types; scene/actor/cast (all type only)        │
                                                          │
opencode.ts  agent markdown → Persona                     │
  imports: persona (type + createPersona)                 │
                                                          │
stage.ts  StageManager, Performance, StageEvent           │
  imports: all of the above                               │
                                                          │
trace.ts  formatPerformance, performanceTimeline          │
index.ts  public surface (re-exports every module)        │
```

Dependency direction is strictly one-way: `types → scene → actor → cast → evaluation → stage → trace`. `persona.ts` sits beside `actor.ts` on a type-only edge: `Actor.binding` references `Persona`, and `dressCast` consumes `Actor` — both erased at runtime. The other apparent cycle (`cast` ↔ `evaluation`) is type-only for the same reason — `cast.ts` imports the `Evaluation` type for `RecastContext`, and `evaluation.ts` imports the `Cast` type for `EvaluationContext`.

## Lifecycle and data flow

```text
request
  │  SceneDesigner.design()
  ▼
Scene ────────────────────────────────┐
  │  SceneDesigner.analyze()           │  (blocking unknown? → needs_input)
  ▼                                    │
Cast ◀─ CastingDirector.cast(scene)    │
  │                                    │
  │  StageManager.perform(scene, cast) │
  ▼                                    │
┌─────────────── iteration ───────────┐│
│ for step in protocol.steps:         ││
│   resolve executor (actor/override) ││
│   inputs = artifacts matching       ││
│            step.consumes            ││
│   output = executor(ActorContext)   ││
│   record ActorTurn, append artifacts││
│                                     ││
│ Evaluator.evaluate(EvaluationContext)│
│   → status, criteria, diagnosis,    ││
│     recommendedAction               ││
└─────────────────────────────────────┘│
  │                                    │
  ├─ finish ──────────────▶ finalResult│
  ├─ reperform ───────────▶ next iteration
  ├─ recast ──────────────▶ CastingDirector.cast(scene, {previous, diagnosis})
  └─ redesign_scene ──────▶ SceneDesigner.design(..., {previous, diagnosis})
                             → new Scene, artifacts cleared, recast
```

## Invariants

- **One writer per artifact.** An artifact's `producedBy` is the actor that made it; inputs are never mutated.
- **Recasts preserve what worked.** The default director extends the previous cast to fill diagnosed gaps rather than rebuilding it from the scene.
- **Actors see the world, not each other's chats.** Context is `scene + instruction + input artifacts + turn history + tools`. There is no hidden shared prompt.
- **Silence is not success.** A success criterion the evaluator never checked becomes `uncertain`, never `pass`.
- **Evaluator crashes are visible.** They become an `uncertain` evaluation with an `evaluator error: …` issue and a reperform recommendation.
- **The loop is bounded.** `maxPerformances`, `maxRecasts`, `maxRedesigns` are explicit constructor options.
- **The boundary is total.** Card normalisers coerce or ignore malformed fields rather than throwing, so bad model output cannot crash a performance.
- **Every decision is an event.** `StageEvent[]` is the ordered, machine-readable trace.
- **Context is a snapshot.** An actor receives `history` as a copy, so a retained `ActorContext` never grows to include turns recorded after the actor ran.

## Executor resolution

For each activation the `StageManager` resolves an executor in this order:

1. `options.executors[actor.name]` — per-call override (highest priority)
2. `actor.executor` — set by `functionActor` or `createLlmExecutor`
3. `options.chat` — wraps a `ChatFn` via `createLlmExecutor` (only for actors with `kind: "llm"`)
4. otherwise the actor fails with `no executor available for actor "…"`

This keeps deterministic actors and LLM actors interchangeable at the orchestration layer. Artifact inputs are explicit: a step's `consumes` lists the kinds it receives, and an empty list means no inputs. On a recast, the default deterministic `CastingDirector` keeps the actors that worked and fills the diagnosed gaps — adding an actor for each `evaluation.missingCapabilities`, or a researcher for `evaluation.missingInformation` — so a reperformance has a real chance instead of repeating the same cast. Supply a `cast` function (backed by the casting skill) for richer, scene-specific recasting.

## Wire formats

LLM skills emit YAML; the code normalises it:

- `sceneFromCard(card)` → `Scene` (accepts `snake_case` or `camelCase`; missing fields default to empty, never throw)
- `castFromCard(card)` → `Cast` (accepts `cast`/`actors`, `produces`/`expectedOutput`)

This is the only contract between the prompts and the runtime.

## Personas and dressing

A cast is functional: it consists of roles. Personas are attached in a separate step, so that changing who plays a role never changes the cast's structure.

```text
Cast (roles) ──▶ dressCast(cast, scene, { personas, auditioner, store }) ──▶ Cast (roles + bindings)
                        │
                        ├─ per persona, one casting call with all open roles
                        ├─ store hit  → bind from cache, no call        (audition_cached)
                        ├─ store miss → ask, record the answer          (auditioned)
                        └─ accepted   → bind role to persona            (persona_bound)
```

The store is keyed by `roleFingerprint` — the role's *content*, not its capability — so a refusal never becomes a declared incapacity, and a changed role spec is automatically a new question. A role nobody accepts stays a bare actor (`role_uncast`).

`StageManager.perform` dresses automatically when a roster and an auditioner are supplied (`personas` + `auditioner` in `StageOptions`), and dresses again after every recast or redesign. Audition events are folded into the performance trace. Without a roster, behaviour is unchanged. See `docs/actors.md` and the `R-PERSONA-*` requirements.
