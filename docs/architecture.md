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
stage.ts  StageManager, Performance, StageEvent           │
  imports: all of the above                               │
                                                          │
trace.ts  formatPerformance, performanceTimeline          │
index.ts  public surface (re-exports every module)        │
```

Dependency direction is strictly one-way: `types → scene → actor → cast → evaluation → stage → trace`. The only apparent cycle (`cast` ↔ `evaluation`) is type-only — `cast.ts` imports the `Evaluation` type for `RecastContext`, and `evaluation.ts` imports the `Cast` type for `EvaluationContext`. Both are erased at runtime.

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
- **Actors see the world, not each other's chats.** Context is `scene + instruction + input artifacts + turn history + tools`. There is no hidden shared prompt.
- **Silence is not success.** A success criterion the evaluator never checked becomes `uncertain`, never `pass`.
- **Evaluator crashes are visible.** They become an `uncertain` evaluation with an `evaluator error: …` issue and a reperform recommendation.
- **The loop is bounded.** `maxPerformances`, `maxRecasts`, `maxRedesigns` are explicit constructor options.
- **Every decision is an event.** `StageEvent[]` is the ordered, machine-readable trace.

## Executor resolution

For each activation the `StageManager` resolves an executor in this order:

1. `options.executors[actor.name]` — per-call override (highest priority)
2. `actor.executor` — set by `functionActor` or `createLlmExecutor`
3. `options.chat` — wraps a `ChatFn` via `createLlmExecutor` (only for actors with `kind: "llm"`)
4. otherwise the actor fails with `no executor available for actor "…"`

This keeps deterministic actors and LLM actors interchangeable at the orchestration layer. Note: the default deterministic `CastingDirector` derives the cast purely from the scene, so a recast for an unchanged scene returns the same cast — a no-op that consumes budget. Supply a `cast` function (backed by the casting skill) for capability-aware recasting.

## Wire formats

LLM skills emit YAML; the code normalises it:

- `sceneFromCard(card)` → `Scene` (accepts `snake_case` or `camelCase`; missing fields default to empty, never throw)
- `castFromCard(card)` → `Cast` (accepts `cast`/`actors`, `produces`/`expectedOutput`)

This is the only contract between the prompts and the runtime.
