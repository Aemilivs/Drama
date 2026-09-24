# drama

**Scene-Casting for LLM workflows.** Don't ask one actor to be the whole theatre. Design the
scene, cast the smallest troupe that can carry it, and let the result emerge from their
interaction.

`zero runtime dependencies` · `195 tests` · `TypeScript on Bun` · `MIT`

```text
Traditional                          Scene-Casting

  Task ──▶ Agent ──▶ Answer           Task
                                       │
                                       ▼
                                      Scene ────────▶ model the problem as an environment
                                       │
                                       ▼
                                      Cast ─────────▶ the smallest set of actors + a protocol
                                       │
                                       ▼
                                      Performance ──▶ actors pursue local goals, exchange artifacts
                                       │
                                       ▼
                                      Evaluation ───▶ judge artifacts against the scene's criteria
                                       │
                                       ▼
                                      Result ───────▶ finish · reperform · recast · redesign
```

**Contents** · [1. The hypothesis](#1-the-hypothesis) · [2. How this repository cashes it out](#2-how-this-repository-cashes-it-out) · [3. Putting it on stage](#3-putting-it-on-stage) · [4. Under the hood](#4-under-the-hood)

---

## 1. The hypothesis

> **A hard problem is not solved by a bigger prompt.** It is solved by putting the right roles
> in one room, giving each a local objective, and letting their disagreements produce the result.

A single prompt forces one model to be planner, researcher, critic and author at once. The parts
you most need to inspect are exactly the parts a monologue hides: who objected, on what evidence,
and what changed afterwards.

`drama` makes those parts primitives — a **Scene** (the problem), a **Cast** (who acts), a
**Protocol** (how they interact), a **Performance** (what happened) and an **Evaluation**
(whether it worked) — and keeps orchestration explicit rather than buried in prose.

The rule that keeps it honest:

> The goal is not *more agents*. The goal is **the smallest cast capable of producing the
> outcome.**

An actor is a participant with a responsibility and an interface — not a model. It may be an
LLM, a deterministic function, a test suite, a compiler, a search, or a database query. `drama`
will happily run a one-actor cast when that is what the scene needs.

## 2. How this repository cashes it out

### Four moves, in order

| Move | What happens | Primitive |
| --- | --- | --- |
| **Design the scene** | The request becomes an environment: objective, known/unknown/assumed, constraints, success criteria, required capabilities, failure modes. It may stay incomplete on purpose. | `SceneDesigner` → `Scene` |
| **Cast** | The scene is turned into the smallest sufficient set of roles plus an explicit protocol. | `CastingDirector` → `Cast` |
| **Perform** | Actors pursue local objectives and exchange named artifacts. | `StageManager` → `Performance` |
| **Evaluate & diagnose** | Artifacts are judged against the criteria; the verdict chooses the next move. | `Evaluator` → `Evaluation` |

### Failure is a diagnosis, not a retry

```text
Performance ──▶ Evaluation ──▶ failure ──▶ diagnosis
                                             ├── bad_execution       → reperform
                                             ├── missing_capability  → recast
                                             ├── missing_information → recast (add a research actor)
                                             └── malformed_problem   → redesign the scene
```

A failed attempt does not automatically mean "try again". If the cast lacked a capability,
retrying is wasted — the system recasts. If the *question* was wrong, it returns to scene design.
Every loop is bounded by an explicit budget.

### Roles are derived; personas audition

There is **no canonical cast** — no Planner → Researcher → Critic → Executor. Roles are derived
from the scene's capabilities every time.

Personas are the other axis: recognisable performers that change *how* a role is played, never
*which* role exists. A persona declares nothing about its fit; binding is discovered by asking it
directly (an audition), and the answer is cached against a content-derived fingerprint of the
role — so a refusal is scoped to one formulation of a role, never to a capability:

```ts
import { dressCast, createPersona, acceptAllAuditioner } from "./src/index.ts";

// `cast` and `scene` come from the casting step above.
const dressed = await dressCast(cast, scene, {
  personas: [createPersona({ id: "vimes", name: "Vimes" })],
  auditioner: acceptAllAuditioner(),   // or a real casting call
});

dressed.cast.actors.map((actor) => `${actor.name} as ${actor.binding?.persona.name ?? "—"}`);
dressed.uncast;    // roles nobody would play — still performed, without a persona
dressed.events;   // every audition, cache hit and binding, in order
```

When several personas accept, `askAll` gathers every approach and `select` chooses — and the
choice is traced with the full candidate list, so discarded alternatives stay visible.

### Disagreement is a tool, not an accident

A role may declare what it exists to challenge:

```ts
stance: { opposes: "analysis", toYield: "Critique" }
```

The casting director validates the design — the target must exist, the challenger must run after
its targets have produced, and the conflict must yield something a later step consumes. Disagreement
becomes something the framework can check instead of hope for.

### The trace is the product

Every activation, input, output, evaluation and decision is recorded. You can read it, render it,
store it and replay it:

```ts
formatPerformance(performance)                    // human-readable, ordered trace
serializePerformance(performance)                 // versioned JSON document
deserializePerformance(json, { executors })       // back to a Performance, executors re-attached
```

### Guardrails

Borrowed from the task-graph discipline: a step may declare `gate: true` (irreversible → explicit
approval, failing closed), and `owns` path globs (two writers may not share a wave). Waves are
opt-in (`parallel: true`), order-preserving, and bounded by `maxConcurrency` / `maxTurns`.
`planWaves` previews the schedule; `independent_steps` reports serialized steps that never read
each other; `no_merge_owner` reports terminal artifacts with several owners.

### The proof

[`examples/incident-rca/run.ts`](examples/incident-rca/run.ts) is a complete, deterministic
performance. A checkout service starts returning 500s after a deploy.

- A **single generic answer** blames the loudest symptom — *"the database is overloaded, scale it
  up"*. **0/4 criteria.**
- The **cast** — metrics analyst, change researcher, skeptic, synthesizer — rules the symptom out
  and converges on the real cause: a bcrypt cost increase slowed login and exhausted the
  connection pool. **4/4 criteria.**

The difference is one actor whose local objective is to *falsify* the others.

## 3. Putting it on stage

### Requirements

- **Bun** (tested on 1.3) — the runtime, the test runner and the package manager.
- Nothing else. `drama` has zero runtime dependencies; TypeScript types are dev-only.

### Try it in this repository

```bash
bun install          # dev types only (TypeScript, @types/bun, @opencode-ai/plugin)
bun test             # 195 tests
bun run example      # the end-to-end incident performance
bun run typecheck    # tsc --noEmit
```

Three runnable examples, all offline by default:

| Example | What it shows |
| --- | --- |
| [`examples/incident-rca/run.ts`](examples/incident-rca/run.ts) | single answer vs cast, on a real-feeling incident |
| [`examples/audition/run.ts`](examples/audition/run.ts) | a recorded casting call against three real agents |
| [`examples/llm/run.ts`](examples/llm/run.ts) | the production LLM path (self-explains when unconfigured) |
| [`examples/anthropic/run.ts`](examples/anthropic/run.ts) | the same production, on Claude |

### Use it as a library

The public surface is [`src/index.ts`](src/index.ts) (`exports` maps `drama` → `./src/index.ts`):

```ts
import {
  StageManager, Evaluator, CastingDirector, SceneDesigner,
  createCast, createProtocol, functionActor, sceneFromCard,
  criterionEvaluator, artifact, ok, formatPerformance,
} from "drama"; // in-repo: from "./src/index.ts"

const scene = sceneFromCard({
  objective: "Review this migration for data-loss risk",
  success_criteria: ["Names a concrete data-loss scenario", "Proposes a mitigation"],
  required_capabilities: ["migration_analysis"],
});

const analyst = functionActor({
  name: "analyst", role: "migration analyst", objective: "Analyse the migration",
  capabilities: ["migration_analysis"], produces: "RiskReport",
  run: () => ok([artifact("analyst", "RiskReport", {
    risks: ["backfill on a live table"],
    mitigation: "backfill in batches behind a feature flag",
  })]),
});

const cast = createCast(
  [analyst],
  createProtocol([{ actor: "analyst", instruction: "analyse", produces: ["RiskReport"] }]),
);

const report = (ctx) =>
  ctx.artifacts.find((a) => a.kind === "RiskReport")?.content as
    | { risks: string[]; mitigation?: string }
    | undefined;

// Two criteria, two checks: a criterion left unchecked is `uncertain`, not a pass.
const evaluator = new Evaluator(criterionEvaluator([
  { criterion: scene.successCriteria[0]!, check: (ctx) =>
      report(ctx)?.risks.length
        ? { status: "pass", evidence: "data-loss scenario named" }
        : { status: "fail", evidence: "no scenario named" } },
  { criterion: scene.successCriteria[1]!, check: (ctx) =>
      report(ctx)?.mitigation
        ? { status: "pass", evidence: "mitigation proposed" }
        : { status: "fail", evidence: "no mitigation proposed" } },
]));

const stage = new StageManager({ evaluator });

const performance = await stage.perform(scene, cast);
console.log(performance.finalResult.status);  // "done" | "failed"
console.log(formatPerformance(performance));  // full, ordered trace
```

To run the **whole lifecycle** — design, cast, perform, evaluate, recast — call `stage.run(request)`.
It returns `{ kind: "needs_input", questions }` when a blocking unknown must be resolved first,
otherwise `{ kind: "performance", performance }`.

### Wire in a real model

Any model enters through one function; non-LLM actors need no adapter at all:

```ts
import { createLlmExecutor, functionActor } from "drama";

const researcher = functionActor({
  name: "researcher", role: "researcher", objective: "Find prior art",
  capabilities: ["research"], produces: "ResearchReport",
  run: createLlmExecutor(async (messages) => myModel(messages)),
});
```

Provider adapters are plain `fetch` with no dependency, and live in [`examples/providers/`](examples/providers):

| Adapter | File | Run it |
| --- | --- | --- |
| OpenAI-compatible | [`openai-compatible.ts`](examples/providers/openai-compatible.ts) | `DRAMA_LLM_BASE_URL=… DRAMA_LLM_API_KEY=… DRAMA_LLM_MODEL=… bun run examples/llm/run.ts` |
| Anthropic (Claude) | [`anthropic.ts`](examples/providers/anthropic.ts) | `ANTHROPIC_API_KEY=… ANTHROPIC_MODEL=claude-opus-5-5 bun run examples/anthropic/run.ts` |

**Claude is not OpenAI-compatible.** The endpoint, the auth header, the required `max_tokens` and
the placement of the system prompt (a top-level parameter — there is no `"system"` role inside
`messages`) all differ, which is why it gets its own adapter. Both are recipes to copy, not code the
library carries: drama still ships no provider integrations of its own.

### Bring your own engine

An actor needs one thing — an `executor` — so **no framework is specially supported and all of
them work**. `createEngineExecutor` is the whole integration surface: the engine gets exactly the
prompt a model would get, and returns artifact kinds. Recipes for LangGraph, the OpenAI Agents SDK,
Google ADK, CrewAI and Mastra: [`docs/engines.md`](docs/engines.md).

### Use it from OpenCode

Copy (or symlink) the `.opencode/` directory into a project and the same loop is available to an
agent:

| Path | Role |
| --- | --- |
| [`.opencode/skills/scene-designer/SKILL.md`](.opencode/skills/scene-designer/SKILL.md) | request → Scene Card (YAML) |
| [`.opencode/skills/casting-director/SKILL.md`](.opencode/skills/casting-director/SKILL.md) | Scene Card → cast + protocol (YAML) |
| [`.opencode/tools/drama.ts`](.opencode/tools/drama.ts) | `analyze_scene` / `validate_cast` — a model-free design gate over the skills' output |
| [`.opencode/lib/audition-prompt.ts`](.opencode/lib/audition-prompt.ts) | render a casting call, parse the answer |
| [`.opencode/lib/audition-store.ts`](.opencode/lib/audition-store.ts) | persist auditions and refusals across sessions |

The skills' YAML maps directly onto the code via `sceneFromCard` and `castFromCard`, so the same
loop can be driven by an agent or embedded in a program. A project tool cannot spawn a subagent,
so the audition itself is performed by the orchestrating agent — the libraries are the pure halves.

## 4. Under the hood

### Core abstractions

| Concept | What it is | Where |
| --- | --- | --- |
| `Scene` | The problem as an environment: objective, known/unknown/assumed, constraints, success criteria, required capabilities, failure modes. May be incomplete by design. | `src/scene.ts` |
| `SceneDesigner` | Turns a request into a `Scene`, and reports what is still missing. Asks questions only when the gap changes the architecture. | `src/scene.ts` |
| `Actor` | Role + local objective + capabilities + tools + constraints + permissions + expected artifact + exit condition. | `src/actor.ts` |
| `Cast` / `Protocol` | The chosen actors and the explicit interaction between them — including designed opposition and write claims. | `src/cast.ts` |
| `CastingDirector` | Derives the cast and protocol from a scene; validates coverage, roles, conflict, writes and minimality; handles recasts. | `src/cast.ts` |
| `Evaluator` / `Evaluation` | Judges artifacts and returns `pass`/`fail`/`uncertain` plus a **diagnosis** and a recommended action. | `src/evaluation.ts` |
| `StageManager` / `Performance` | Runs the cast, records everything, and drives the reperform/recast/redesign loop. | `src/stage.ts` |
| `Persona` / `Audition` | A recognisable performer that declares nothing about its fit, and the casting call that binds it to a role. | `src/persona.ts` |
| `serializePerformance` | Versioned JSON round-trip; re-attaches executors by actor name for replay. | `src/serialize.ts` |
| `Artifact` | Structured, named output exchanged between actors (`ResearchReport`, `Critique`, `RootCause`, …). | `src/types.ts` |

### Project layout

```text
src/
  types.ts       shared primitives (Status, Artifact, Diagnosis, ids)
  scene.ts       Scene, SceneCard, SceneDesigner, conflict detection
  actor.ts       Actor, executors, tools, LLM adapter
  cast.ts        Cast, Protocol, CastingDirector, minimality, planWaves, card normalisers
  evaluation.ts  Evaluation, Evaluator, diagnosis → action
  persona.ts     Persona, Audition, Auditioner, AuditionStore, dressCast
  opencode.ts    agent markdown → Persona adapter
  stage.ts       StageManager, Performance, waves, gates, recast/redesign loop
  serialize.ts   Performance JSON round-trip and replay
  trace.ts       formatPerformance, performanceTimeline
  index.ts       public surface
.opencode/       skills, project tool, audition libraries
examples/        incident-rca · audition · llm · anthropic · providers
test/            behavioural tests and formalized requirements
docs/            architecture · actors · engines · graph-engineering · prior-art · requirements · ROADMAP
```

### Testing

Tests assert behaviour, not class existence, in two layers:

- `test/*.test.ts` — behavioural tests for scene design, casting, evaluation, orchestration and
  the end-to-end example.
- `test/requirements/*.test.ts` — every test is a **formalized requirement** (`R-<area>-<n>`) with
  an abstract statement and a concrete example. The full matrix — and the bugs the requirements
  surfaced — is in [`docs/requirements.md`](docs/requirements.md).

That second layer is not ceremony. Writing it found a live-array aliasing bug in `ActorContext`,
duplicate actor names on slug collisions, a null-element hole reachable from `run`, a stale persona
binding on recast, an executor registry that walked the prototype chain, a serialized payload that
accepted broken shapes, and a fake edge in the flagship example.

### Design principles

1. Scene before cast.
2. Cast before execution.
3. Roles before prompts.
4. Local objectives are explicit.
5. Actors may disagree — and the disagreement is designed.
6. Disagreement can be productive.
7. Actors need not be LLMs.
8. Artifacts are preferable to opaque conversations.
9. Evaluation is part of the performance.
10. Failure may require recasting rather than retrying.
11. The cast is minimal.
12. Orchestration stays observable.
13. A persona is not a capability.
14. **Do not add an actor unless its presence changes the solution space.**
15. No fake edges: express a dependency as `consumes`, never as a step order.

### Further reading

- [`docs/architecture.md`](docs/architecture.md) — module map, dependency direction, data flow.
- [`docs/actors.md`](docs/actors.md) — roles vs personas, the casting call, the refusal cache.
- [`docs/graph-engineering.md`](docs/graph-engineering.md) — how drama maps to the task-graph discipline.
- [`docs/engines.md`](docs/engines.md) — using LangGraph, the OpenAI Agents SDK, Google ADK, CrewAI or Mastra as an actor.
- [`docs/prior-art.md`](docs/prior-art.md) — the five most-used frameworks, compared, and why there are no native adapters.
- [`docs/requirements.md`](docs/requirements.md) — the requirement matrix and its findings log.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what is done, and what is deliberately out of scope.

### Status

A small foundational primitive, deliberately not a framework. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) for the explicit non-goals.

### License

MIT
