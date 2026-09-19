# Roadmap

## Status

Core primitive complete and tested.

- [x] `Scene` / `SceneDesigner` with known/unknown/assumed/required, conflict detection, question gating
- [x] `Actor` with executors, tools, deterministic and LLM kinds
- [x] `Cast` / `Protocol` / `CastingDirector` with capability coverage, role-conflict and minimality checks
- [x] `Evaluator` / `Evaluation` with diagnoses and recommended actions
- [x] `StageManager` / `Performance` with explicit, bounded reperform/recast/redesign loop and event trace
- [x] `formatPerformance` trace renderer
- [x] `sceneFromCard` / `castFromCard` wire normalisers
- [x] Scene Designer and Casting Director OpenCode skills
- [x] Deterministic end-to-end example with a single-shot baseline comparison
- [x] Behavioural test suite

## Next (only if a real use case demands it)

- [ ] A runnable LLM adapter example (one provider) guarded by an env var, kept out of the offline test path.
- [ ] An `opencode` tool wrapper so an agent can invoke `StageManager.run` directly and receive the trace.
- [ ] A JSON (de)serialiser for `Performance` to support replay from a stored trace.
- [ ] Optional parallel step execution for protocol steps with no shared artifact dependency.

## Explicit non-goals

- No persistence layer, scheduler, or queue.
- No universal/canonical cast. Casts are always derived from the scene.
- No provider SDKs or runtime dependencies.
- No theatrical terminology where plain engineering terms are clearer.
