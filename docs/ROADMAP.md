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

## Next (only if a real use case demands it)

- [ ] A persistent `AuditionStore` in `.opencode/` so refusals survive sessions, plus an `Auditioner` that spawns the persona's subagent.
- [ ] First-class conflict design on roles (`stance`), so "designed disagreement" is validated rather than implied.
- [ ] A runnable LLM adapter example (one provider) guarded by an env var, kept out of the offline test path.
- [ ] A JSON (de)serialiser for `Performance` to support replay from a stored trace.
- [ ] Optional parallel step execution for protocol steps with no shared artifact dependency.

## Explicit non-goals

- No persistence layer, scheduler, or queue.
- No universal/canonical cast. Casts are always derived from the scene.
- No provider SDKs or runtime dependencies.
- No theatrical terminology where plain engineering terms are clearer.
