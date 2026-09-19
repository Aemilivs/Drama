# drama and task-graph engineering

drama is a task-graph engine with a casting layer. This note maps it, item by item, to the
task-graph discipline in the `graph-engineering` skill
(`references/task-graphs.md`, "Task Graphs: Orchestrating Agents") and to the workspace
principles in `~/.config/opencode/docs/AGENTS.md`.

Read it when asking "are we doing graph engineering correctly?", or before adding a feature that
touches routing.

## The mapping

| Doctrine | Where it lives in drama | Status |
| --- | --- | --- |
| **Nodes are jobs; an edge exists only when a job reads another's result** | A `Protocol` step is a job; the edge is expressed as artifacts (`consumes` / `produces`), never as a bare order. | ✅ |
| **Fake edges** | `planWaves` computes true independence; `independent_steps` warns when steps that never read each other were serialized. The incident example's two analysts are exactly such a pair — and the warning says so. | ✅ detector |
| **Diamond: split → parallel workers → verify → merge** | A cast is a set of roles; `parallel: true` runs independent steps in waves; the synthesizer is the merge. | ✅ |
| **Verify in a separate context** | Each actor runs its own executor with its own prompt; the only shared input is artifacts plus a history *snapshot*. | ⚠️ Host obligation — drama cannot force a fresh session. See below. |
| **Diverse skeptics** | `stance.opposes` / `toYield` express designed opposition; the casting skill requires *different questions* per verifier. | ✅ doctrine, skill-enforced |
| **Stop rule: split only what never reads each other** | Casts are derived per scene and must be the minimal sufficient set; `minimality` reports removable actors; `parallel` is opt-in, so sequential work stays sequential. | ✅ |
| **Never merge without one owner** | `deriveMinimalCast` adds a synthesizer; `no_merge_owner` warns when several actors produce terminal artifacts. | ✅ |
| **Human gate on irreversible edges** | `ProtocolStep.gate` + `StageOptions.approve`; gates **fail closed** (no approver, a throw, or a false all deny) and a trace event records the decision. | ✅ |
| **Judge on numbers that cannot argue back** | `criterionEvaluator` checks artifacts deterministically; the casting skill prefers a test runner or compiler as verifier. The serialized `Performance` is the record. | ✅ |
| **Guardrail 1 — every loop has a maximum** | `maxPerformances` (reperform), `maxRecasts`, `maxRedesigns`, `maxTurns`. | ✅ |
| **Guardrail 2 — one writer per file** | `ProtocolStep.owns`; `owns_conflict` rejects overlapping globs inside a wave. | ✅ |
| **Guardrail 3 — routing in written steps, the model fills jobs** | The protocol is data; the casting skill designs the cast from the scene; `/graph` is the Level-2 runner. | ✅ |
| **Guardrail 4 — hard cap on spawning** | `maxTurns` caps actor executions; OpenCode caps delegation with `subagent_depth`; `/graph` caps with `caps.maxAgents`. | ✅ |
| **Dry run first** | `planWaves` previews the schedule; gates have no auto-approve. | ✅ |

## The one thing drama cannot enforce

**A separate verifier context is the host's job.** drama guarantees that a verifier is a
different actor with a different prompt, and that the shared state is artifacts plus a history
snapshot — not the producer's session. Turning that into a *fresh* context means the injected
executor must start a new session (in OpenCode: a fresh subagent) for each actor. The same seam
serves auditions: a project tool cannot spawn a subagent, so the orchestrator does.

Wiring that obligation away is the difference between "the verifier is a different actor" and
"the verifier is a different context". Both matter; only the second satisfies the doctrine.

## Encoding rules in a cast

- Express a dependency as `consumes`, never as a step order.
- If two steps never read each other, let them be a wave — do not serialize them "for clarity".
- Declare `owns` for anything that writes; overlapping globs must be separated by a real edge.
- Gate what cannot be undone, and only that.
- Cast several verifiers with different questions when robustness is a success criterion.
