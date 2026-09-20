# Roadmap

## Status

Core primitive complete and tested.

- [x] `Scene` / `SceneDesigner` with known/unknown/assumed/required, conflict detection, question gating
- [x] `Actor` with executors, tools, deterministic and LLM kinds
- [x] `Cast` / `Protocol` / `CastingDirector` with capability coverage, role-conflict and minimality checks
- [x] Capability-aware default recast: fills diagnosed `missingCapabilities` / `missingInformation` while keeping the actors that worked
- [x] `Evaluator` / `Evaluation` with diagnoses and recommended actions
- [x] `StageManager` / `Performance` with explicit, bounded reperform/recast/redesign loop and event trace
- [x] `formatPerformance` trace renderer
- [x] `sceneFromCard` / `castFromCard` wire normalisers
- [x] Scene Designer and Casting Director OpenCode skills
- [x] `drama` OpenCode tool: validates Scene/Cast cards (scene analysis, cast validation) with no model
- [x] Deterministic end-to-end example with a single-shot baseline comparison
- [x] Behavioural test suite
- [x] Formalized requirement suite with a traceability matrix (`docs/requirements.md`)
- [x] Personas and auditions: roles are functional, personas declare nothing, binding is discovered by asking and cached (`docs/actors.md`)
- [x] Dressing wired into `StageManager`: a performance dresses its cast and folds audition events into the trace
- [x] OpenCode agent adapter: `agents/*.md` → `Persona` (`src/opencode.ts`)
- [x] First-class designed conflict: `Actor.stance`, validated as `dangling_stance` / `stance_before_target` / `unused_conflict_yield`
- [x] A runnable, offline-safe LLM adapter example over `fetch` (`examples/llm/run.ts`)
- [x] A persistent, file-backed `AuditionStore` for the host (`.opencode/lib/audition-store.ts`)
- [x] A host casting call: `renderCastingCall` + `parseAuditionAnswer` (`.opencode/lib/audition-prompt.ts`), with the subagent spawn performed by the orchestrator — proven by a recorded, live run (`examples/audition/run.ts`) against Vimes, Feegle and Librarian.
- [x] Selection among acceptors: `askAll` gathers every approach and a `select` hook chooses, with the choice traced (`persona_selected`) and both knobs exposed through `StageManager`.

## Next (only if a real use case demands it)

- [x] A JSON (de)serialiser for `Performance` (`src/serialize.ts`): executors are re-attached by actor name on load, and a replay re-supplies the evaluator.
- [x] Optional parallel step execution: `parallel: true` runs independent consecutive steps in waves, order-preserving and opt-in (`R-PARALLEL-*`).
- [x] Guardrails borrowed from the `/graph` runner: step `gate` (human approval, fail-closed), `owns` write globs with one-writer-per-wave validation, `maxConcurrency`/`maxTurns` caps, `planWaves` dry-run preview (`R-GUARD-*`).

## Next

Nothing is planned. The three items above were the deferred list; each is now done or explicitly not required. What would justify new work is a concrete scene that the framework cannot express today.

## Explicit non-goals

- No persistence layer, scheduler, or queue.
- No universal/canonical cast. Casts are always derived from the scene.
- No provider SDKs or runtime dependencies.
- No theatrical terminology where plain engineering terms are clearer.
