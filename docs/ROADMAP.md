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

## Decision models — built, and explicitly bounded

- [x] The calibration policy: `calibrate` / `calibratedEvaluator` in `src/evaluation.ts` (`R-CALIB-1..6`), plus a `"decision"` `ActorKind` (`R-ACTOR-6`).
- [x] The host-side path: `examples/providers/kev.ts` (a System One `DecisionFn` over plain `fetch`) and `bun run setup:kev`, which installs, starts and verifies a local Kev, then writes the config `decisionFromEnv` reads (`R-KEV-1..3`).
- [x] The research and the executed performance: [`decision-models.md`](decision-models.md), [`examples/decision-models/run.ts`](../examples/decision-models/run.ts).

Deliberately not built: no provider client or `Distribution` type in `src/`, and no "supported decision models" list — the contract is the wire format.

## LangGraph integration — verified, not adapted

A drama ([`examples/langgraph/run.ts`](../examples/langgraph/run.ts)) evaluated the LangGraph path and filed the accepted work as epic `drama-vfu` (`bd show drama-vfu`). Verdict: **no adapter and no dependency** — the `createEngineExecutor` seam is sufficient, and the thing that was wrong is the recipe.

- [x] `drama-vfu.1` — the recipe is corrected and date-stamped ([`engines.md`](engines.md) §1): `createAgent` instead of the deprecated `createReactAgent`, the real Node 20 floor, and the `msg.text` trap, with `responseFormat` / `structuredResponse` for typed content.
- [x] `drama-vfu.2` — `bun run verify:engines`: installs the pinned LangGraph packages outside the repo, runs a real graph (fake model, no key) through the seam, and exits non-zero on drift or on an install failure. A docs-integrity checker: no dependency, and neither `tsc` nor `bun test` ever touches it.
- [x] `drama-vfu.3` — the reverse direction is documented in [`engines.md`](engines.md): a performance as a LangGraph node or tool, the `RunOutcome` union a node must handle, and what a checkpointer can and cannot carry.

Structured output and durable resume stay with `drama-gas.4` and `drama-gas.6`.

## Agent-engine primitives — `drama-gas`

- [x] `drama-gas.4` — an optional per-kind artifact **content contract**, validated on the LLM path (`R-CONTRACT-1..6`).
- [x] `drama-gas.6` — a gate nobody is there to answer **pauses**; the paused `Performance` is the ordinary serialization, and `resume` continues it (`R-RESUME-1..6`).
- [ ] `drama-gas.5` — export a performance trace as OpenTelemetry-shaped spans.

Streaming, memory/RAG, an MCP client, per-actor model routing and deployment stay non-goals.

## Explicit non-goals

- No persistence layer, scheduler, or queue.
- No universal/canonical cast. Casts are always derived from the scene.
- No provider SDKs or runtime dependencies.
- No theatrical terminology where plain engineering terms are clearer.
