# Test requirements

Each test in `test/requirements/` is a **formalized requirement**: a behaviour the framework promises, expressed as an abstract statement, pinned to a concrete example, and enforced by a test whose name carries the requirement id.

```
abstract requirement  →  concrete example  →  test (R-<area>-<n>)
```

IDs are stable labels. Numbers not listed below are requirements already enforced by the earlier behavioural suite in `test/*.test.ts`; the requirement files extend coverage rather than replace it.

Run everything with `bun test`.

## Scene — `test/requirements/scene.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-SCENE-2 | The wire form is case-agnostic: `snake_case` and `camelCase` cards describe the same scene. | Same card written both ways normalises to equal fields. |
| R-SCENE-4 | A missing objective is the one structural gap that forces a question. | Card with criteria and capabilities but no objective → `missing` includes `objective`, `shouldAskQuestions` true. |
| R-SCENE-5 | A declared constraint conflict is found whichever side declares it. | `conflictsWith` on the left, then on the right → one conflict both ways. |
| R-SCENE-6 | Polarity conflict detection is order-independent and subject-aware. | `must cache` / `must not cache` → conflict in either order; `must` / `should` → no conflict. |
| R-SCENE-8 | A designer that returns a Scene is used unchanged. | `designFn` returns a built Scene → the id survives. |
| R-SCENE-9 | Redesign receives the previous scene and the diagnosis. | `design(..., { previous, diagnosis })` → the designer observes both. |

## Actor — `test/requirements/actor.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-ACTOR-2 | The rendered prompt contains the whole actor card. | System message carries role, objective, knowledge, constraints, permissions, expected output; user message carries instruction and inputs. |
| R-ACTOR-3 | A plain-text model reply still yields a well-formed artifact. | Chat returns a bare string → one artifact of the actor's expected kind, attributed to the actor. |
| R-ACTOR-4 | A custom parser can produce structured artifacts. | Chat returns JSON, parser builds an object-valued artifact. |
| R-ACTOR-5 | Tools are callable by name and unknown tools fail loudly. | Registry doubles a number; a missing tool rejects with `unknown tool`. |

## Casting — `test/requirements/casting.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-CAST-1 | The cast is derived from the scene, not a canonical template. | One capability → one actor; two capabilities → two producers plus a synthesizer. |
| R-CAST-5 | An actor whose output is consumed is necessary even if its capability is not required. | Producer's capability is not in `requiredCapabilities`, but the reviewer consumes its output → not removable. |
| R-CAST-6 | `validate` reports unknown actors, empty objectives and duplicate names. | Three malformed casts each surface their specific error code. |
| R-CAST-7 | Consuming an artifact produced by a later step is an error. | Step 1 consumes `BReport`, step 2 produces it → `unproduced_input`. |
| R-CAST-8 | Cast cards accept aliases and both protocol shapes. | `actors`/`cast`, `produces`/`expectedOutput`, protocol as array or object. |
| R-CAST-9 | A derived cast is always internally valid. | Four capability sets → zero validation errors and zero removable actors each. |

## Evaluation — `test/requirements/evaluation.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-EVAL-1 | A reported status is honoured unless a checked criterion contradicts it. | Explicit `uncertain` with passing criteria stays `uncertain`; explicit `fail` stays `fail`. |
| R-EVAL-5 | Async criterion checks are awaited and their evidence preserved. | Async check returns `async ok`; sync check returns `sync fail`; both evidence strings survive. |
| R-EVAL-6 | Actor failures become issues and default the diagnosis to `bad_execution`. | Failing criterion plus a failure record → `reperform`, issue names the actor and error. |
| R-EVAL-7 | A `finish` recommendation cannot survive a non-passing status. | Evaluator reports `fail` + `finish` → action becomes `reperform`. |
| R-EVAL-8 | Diagnosed gaps survive normalisation. | `missingCapabilities` / `missingInformation` present on the result. |

## Orchestration — `test/requirements/orchestration.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-ORCH-1 | Deterministic and LLM actors are interchangeable to the stage. | Same cast shape with a function executor and with `createLlmExecutor` → both `done`, same artifact kinds. |
| R-ORCH-2 | A failing optional step does not abort the iteration. | Brittle optional step fails, solid step runs, performance completes. |
| R-ORCH-3 | Artifacts from a failed actor are not trusted. | `failed(...)` carrying artifacts → performance artifacts stay empty. |
| R-ORCH-4 | An actor receives exactly the artifacts it declares. | `consumes: ["A"]` → `["A"]`; `consumes: []` → no inputs, even with other artifacts present. |
| R-ORCH-5 | The actor context carries everything the actor needs. | Scene, actor, instruction, iteration, history snapshot, tools. |
| R-ORCH-6 | Later actors see the turns that came before. | Second actor sees one prior turn, belonging to the first. |
| R-ORCH-7 | The performance budget is a hard cap. | `maxPerformances: 1` with a failing evaluation → one iteration, truthful failure reason. |
| R-ORCH-8 | A redesign starts the artifact world over. | Pre-redesign `Draft` is discarded; final artifacts are only the post-redesign `Fix`. |
| R-ORCH-9 | The event trace explains every decision. | `cast_selected` first, `finished` last, one `evaluated` before each `decision`, `recast` after a decision. |
| R-ORCH-11 | A tool failure surfaces as an actor failure. | Throwing tool → actor turn `failed` with the tool's error. |
| R-ORCH-12 | An executor override takes precedence for one performance. | Actor's own executor fails; per-call override succeeds; the actor is unchanged. |
| R-ORCH-13 | The shared chat function drives LLM actors only. | `chat` serves a `kind: "llm"` actor; a deterministic actor with no executor fails instead of silently using chat. |

## Observability — `test/requirements/observability.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-TRACE-1 | The rendered trace names the scene, cast, activations, evaluation and result. | `formatPerformance` output contains objective, cast id, actor name, `Evaluation: pass`, `Result: done`. |
| R-TRACE-2 | The timeline is one JSON record per event. | `performanceTimeline(performance).length === performance.events.length`, every line parses. |

## Cross-cutting — `test/requirements/cross.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-X-1 | A recast does not mutate the previous cast. | JSON snapshot of the previous cast is byte-identical after a recast. |
| R-X-2 | A redesign does not mutate the original scene. | JSON snapshot of the original scene is byte-identical after a redesign. |

## Persona and audition — `test/requirements/persona.requirements.test.ts`

See [`docs/actors.md`](actors.md) for the model. Roles are functional; personas declare nothing; the binding is discovered by asking and remembered in a store.

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-PERSONA-1 | A persona declares no fit; only its answer decides. | Two personas with opposite, misleading metadata bind identically for the same answer. |
| R-PERSONA-2 | A declining persona is not bound; an accepting one is. | Ada declines `researcher`; Bob accepts with an `approach`. |
| R-PERSONA-3 | Nobody accepting leaves the role persona-less and unchanged. | Silent decline → no bindings, artifact kinds unchanged. |
| R-PERSONA-4 | Auditions are a casting call: one per persona, roles batched. | `maxAuditions: 1` → one call carrying both roles; accept-all asks only the first persona. |
| R-PERSONA-5 | Identical audition answers yield an identical cast. | Two runs produce the same role→persona map. |
| R-PERSONA-6 | `approach` reaches the prompt and never changes the artifact kinds. | System prompt contains persona name, persona prompt and approach; `expectedOutput` is untouched. |
| R-PERSONA-7 | A cache hit does not call the auditioner again. | Second dressing makes zero calls; every audition is `cached`. |
| R-PERSONA-8 | A refusal is scoped to the role, not the capability. | Same capability, different objective → asked again and accepted. |
| R-PERSONA-9 | Changing the role spec invalidates the cache. | A changed objective is re-auditioned and bound. |
| R-PERSONA-10 | The refusal reason is kept and never becomes a capability ban. | The stored entry has the reason, is keyed by role fingerprint, and has no capability field. |
| R-PERSONA-11 | An all-declined cast is still valid and reported as uncast. | `uncast` lists both roles; `validate` reports no errors. |
| R-PERSONA-12 | A cache hit is recorded in the trace. | Second run → all auditions `cached: true`, two `audition_cached` events. |
| R-PERSONA-13 | A performance dresses its cast and traces the binding. | `perform` with a roster → every actor bound, `cast_selected` first, `persona_bound` present, `finished` last. |
| R-PERSONA-14 | Without a roster the performance is unchanged. | No bindings and no audition events. |
| R-PERSONA-15 | A recast dresses the newly added roles. | The added `compliance` actor is bound; dressing runs again after the recast. |
| R-PERSONA-16 | Re-dressing never keeps a stale binding. | A previously bound actor that is now declined has its binding cleared and is reported `uncast`. |
| R-PERSONA-17 | The fingerprint includes the slot name. | Identical content under a different name is a different question and is asked again; a cache hit is labelled with the role it was applied to. |

## OpenCode agent adapter — `test/requirements/opencode.requirements.test.ts`

An OpenCode agent is a persona: its description is a delegation trigger, its body is a system prompt, and it declares no capability.

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-OCAGENT-1 | A folded description and the body are parsed; model and mode are kept. | `description: >-` with indented lines → joined text; body → `prompt`; `model`/`mode` extracted. |
| R-OCAGENT-2 | The id comes from the caller and the name is title-cased. | `leonard-of-quirm` → id kept, name `Leonard Of Quirm`. |
| R-OCAGENT-3 | `<example>` blocks never leak into the description. | The trigger paragraph survives; the examples do not. |
| R-OCAGENT-4 | Parsing is total. | No frontmatter, an unclosed fence, and an empty string all parse without throwing. |
| R-OCAGENT-5 | An agent persona declares no capabilities and binds only by audition. | No `capabilities`/`tags` field; `dressCast` binds it from the answer. |
| R-OCAGENT-6 | A whole agents directory becomes a roster. | Two definitions → two personas with `source: opencode-agent`. |
| R-OCAGENT-7 | Quotes are only stripped when they wrap the whole value. | An unquoted trailing apostrophe survives; a fully quoted scalar is unquoted. |
| R-OCAGENT-8 | Leading blank lines and key case do not defeat the parser. | Blank lines before `---` still parse; `Description:`/`Mode:` are read. |

## Property — `test/requirements/properties.requirements.test.ts`

Seeded (`mulberry32`) so any failure is reproducible from its case index.

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-PROP-1 | Any derived cast is valid and minimal, for arbitrary capability sets. | 30 seeded capability sets from a corpus that includes slug-collapsing names (`a b` / `a-b`, `!!!` / `???`) → zero validation errors, zero removable actors each. |
| R-PROP-2 | Any recast stays valid, minimal and capability-preserving. | 30 seeded recasts (capability and information gaps) → valid, minimal, no `unproduced_input`, every previously covered capability still covered, every surviving actor kept. |
| R-PROP-3 | Card normalisers are total on arbitrary partial input. | 30 seeded junk-typed partial Scene/Cast cards (including arrays with `null`/`undefined`/`{}` elements), plus `null`/`undefined`, never throw, always yield arrays, and preserve a fully-populated card. |
| R-PROP-4 | Scene analysis is total over malformed information items. | `unknown: [null, undefined, {}, { text: null }, { text: "real", blocking: true }]` → `analyze` does not throw and reports `["real"]`. |

## Determinism and cost — `test/requirements/determinism.requirements.test.ts`

| ID | Requirement (abstract) | Concrete example |
| --- | --- | --- |
| R-DET-1 | The same production twice is structurally identical. | Two runs of a two-iteration scenario normalise (ids/timestamps stripped) to equal fingerprints. |
| R-DET-2 | A passing performance activates each step exactly once. | `actor_activated` count equals `protocol.steps.length`; no `(iteration, actor)` pair repeats. |
| R-DET-3 | Every artifact and turn id is unique within a performance. | Id sets have no duplicates. |
| R-COST-1 | The number of executor calls equals the number of turns. | A counting executor is invoked exactly once per recorded turn — no hidden calls. |
| R-COST-2 | No turn ever receives the same artifact twice. | Across a reperformance the consumer of `Report` receives two *distinct* reports. |

## Findings

Requirements are not just documentation — writing them surfaces bugs. So far:

- **R-ORCH-5 exposed a live-array aliasing bug.** `ActorContext.history` was the live `turns` array, so a context retained by an actor grew to include the actor's own turn after execution. Fixed by passing a snapshot (`turns.slice()`), which also makes the context safe to retain.
- **R-PROP-1/R-PROP-2 surfaced actor-name collisions.** Capabilities that slug to the same name (`a b` / `a-b`, or the all-punctuation fallback `!!!` / `???`) produced duplicate actors. `deriveMinimalCast` now uniquifies actor names and roles, and the synthesizer too.
- **R-PROP-3 forced the normalisers to become total.** `sceneFromCard`, `castFromCard`, `actorFromCard` and `createProtocol` now coerce or ignore wrong-typed fields instead of throwing, so malformed LLM output degrades gracefully at the boundary.
- **R-PROP-4 closed a totality hole the first hardening pass missed.** `toInfoItems` accepted arrays but let `null`/`undefined` elements through, and `SceneDesigner.analyze` then dereferenced them — reachable from `StageManager.run`, and producible by YAML that emits an empty sequence item. Information lists are now sanitised element-by-element, and `infoText`/`isBlocking` tolerate junk too.
- **R-PROP-2 and B1 (review) closed two recast collision paths.** `extendCast` uniquified the added synthesizer's name but not its role; it now uniquifies both.
- **R-PERSONA-16 caught a stale binding.** Because `CastingDirector` clones actors (including their `binding`) on recast, re-dressing could leave a role bound to a persona that no longer accepted it, and the role was omitted from `uncast`. `dressCast` now strips incoming bindings before dressing.
- **R-PERSONA-17 caught an incomplete fingerprint.** `roleFingerprint` omitted the slot name, so two differently named roles with identical content shared a cache entry and a cache hit was labelled with the wrong role. The name is now hashed and cached records are relabelled to the role they were applied to.
- **R-OCAGENT-7/8 hardened the adapter.** A single leading *or* trailing quote was stripped (corrupting unquoted scalars), and frontmatter after leading blank lines or with uppercase keys was silently skipped.

## Adding a requirement

1. State it abstractly in this file and give a concrete example.
2. Add a test named `R-<area>-<n>: <statement>` in the matching `test/requirements/*.test.ts`.
3. Make the test fail if the behaviour is removed — not if a symbol disappears.
4. If the test cannot pass, the requirement or the code is wrong: fix one, and record the outcome under Findings.
