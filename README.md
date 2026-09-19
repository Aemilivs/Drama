# drama

**Scene-Casting for LLM workflows.** Don't ask one actor to be the whole theatre. Design the scene, cast the actors, let them pursue local objectives, and make the result emerge from their interaction.

```text
Traditional:

    Task ──▶ Agent ──▶ Answer


Scene-Casting:

    Task
     │
     ▼
    Scene          model the problem as an environment
     │
     ▼
    Cast           choose the smallest set of actors + a protocol
     │
     ▼
    Performance    actors pursue local goals and exchange artifacts
     │
     ▼
    Evaluation     compare artifacts against the scene's criteria
     │
     ▼
    Result         finish · reperform · recast · redesign the scene
```

A single prompt forces one model to be planner, researcher, critic and author at once. That hides the parts you most need to inspect and change. `drama` makes those parts explicit primitives: a **Scene** (the problem), a **Cast** (who acts), a **Protocol** (how they interact), a **Performance** (what happened), and an **Evaluation** (whether it worked). Orchestration is explicit and inspectable — never buried in one giant prompt.

## The one rule

> The goal is not "more agents". The goal is **the smallest cast capable of producing the desired outcome.**

`drama` will happily run a one-actor cast when that is what the scene needs. An actor is a *participant with a responsibility and an interface* — not a model. It may be an LLM, a deterministic function, a test suite, a compiler, a search, or a database query.

## Core abstractions

| Concept | What it is | Where |
| --- | --- | --- |
| `Scene` | The problem as an environment: objective, known/unknown/assumed, constraints, success criteria, required capabilities, failure modes. May be incomplete by design. | `src/scene.ts` |
| `SceneDesigner` | Turns a request into a `Scene`, and reports what is still missing. Asks questions only when the gap changes the architecture. | `src/scene.ts` |
| `Actor` | Role + local objective + capabilities + tools + constraints + permissions + expected artifact + exit condition. | `src/actor.ts` |
| `Cast` / `Protocol` | The chosen actors and the explicit, ordered interaction between them. | `src/cast.ts` |
| `CastingDirector` | Derives the cast and protocol from a scene; validates coverage, roles and minimality; handles recasts. | `src/cast.ts` |
| `Evaluator` / `Evaluation` | Judges artifacts against the scene's criteria and returns `pass`/`fail`/`uncertain` plus a **diagnosis** and a recommended action. | `src/evaluation.ts` |
| `StageManager` / `Performance` | Runs the cast, records every activation, input, output, evaluation and decision, and drives the reperform/recast/redesign loop. | `src/stage.ts` |
| `Persona` / `Audition` | A recognizable performer that declares nothing about its fit, and the casting call that binds it to a role. | `src/persona.ts` |
| `Artifact` | Structured, named output exchanged between actors (`ResearchReport`, `Critique`, `RootCause`, ...). | `src/types.ts` |

## Recasting: failure is a diagnosis, not a retry

```text
Performance ──▶ Evaluation ──▶ failure ──▶ diagnosis
                                             ├── bad_execution      → reperform
                                             ├── missing_capability → recast
                                             ├── missing_information→ recast (add a research actor)
                                             └── malformed_problem  → redesign the scene
```

A failed attempt does not automatically mean "try again". If the cast lacked a capability, retrying is wasted; the system recasts. If the *question* was wrong, it returns to scene design. The diagnosis selects the action, and the whole loop is bounded by explicit budgets.

## Quickstart

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

const stage = new StageManager({
  evaluator,
  castingDirector: new CastingDirector(),
  sceneDesigner: new SceneDesigner(),
});

const performance = await stage.perform(scene, cast);
console.log(performance.finalResult.status);   // "done" | "failed"
console.log(formatPerformance(performance));    // full, ordered trace
```

To run the **whole lifecycle** — design, cast, perform, evaluate, recast — use `stage.run(request)`. It returns `{ kind: "needs_input", questions }` when a blocking unknown must be resolved first, otherwise `{ kind: "performance", performance }`.

### Using real models

`drama` has **zero runtime dependencies**. Wire any model in through one function:

```ts
import { createLlmExecutor, functionActor } from "drama";

const researcher = functionActor({
  name: "researcher", role: "researcher", objective: "Find prior art",
  capabilities: ["research"], produces: "ResearchReport",
  run: createLlmExecutor(async (messages) => myModel(messages)),
});
```

`renderActorPrompt` builds the prompt from the actor card plus its input artifacts, so the orchestration stays visible. Non-LLM actors need no adapter at all.

A complete, runnable version — an OpenAI-compatible adapter over `fetch`, configured by `DRAMA_LLM_BASE_URL` / `DRAMA_LLM_API_KEY` / `DRAMA_LLM_MODEL`, and offline-safe with no config — lives in [`examples/llm/run.ts`](examples/llm/run.ts).

## OpenCode integration

The two design steps are exposed as native OpenCode skills, discovered project-locally:

- [`.opencode/skills/scene-designer/SKILL.md`](.opencode/skills/scene-designer/SKILL.md) — request → Scene Card (YAML).
- [`.opencode/skills/casting-director/SKILL.md`](.opencode/skills/casting-director/SKILL.md) — Scene Card → cast + protocol (YAML).

Their YAML output maps directly onto the code via `sceneFromCard` and `castFromCard`, so the same loop can be driven by an agent or embedded in a program.

A project-local tool closes the loop: [`.opencode/tools/drama.ts`](.opencode/tools/drama.ts) validates cards before anything runs — `analyze_scene` reports missing fields, blocking unknowns and conflicting constraints; `validate_cast` reports capability gaps, protocol wiring errors and removable actors. It needs no model, so an agent can check the skills' output as a design-time gate.

## Example

[`examples/incident-rca/run.ts`](examples/incident-rca/run.ts) is a complete, deterministic end-to-end performance. A checkout service starts returning 500s after a deploy.

- A **single generic answer** blames the loudest symptom: *"The database is overloaded; scale up the database."* — 0/4 criteria.
- The **cast** — metrics analyst, change researcher, skeptic, synthesizer — rules out the symptom and converges on the actual cause: a bcrypt cost increase made login slower, exhausting the connection pool. — 4/4 criteria.

The difference comes from one actor whose local objective is to *falsify* the others. Run it offline:

```bash
bun run example
```

## Design principles

1. Scene before cast.
2. Cast before execution.
3. Roles before prompts.
4. Local objectives are explicit.
5. Actors may disagree.
6. Disagreement can be productive.
7. Actors need not be LLMs.
8. Artifacts are preferable to opaque conversations.
9. Evaluation is part of the performance.
10. Failure may require recasting rather than retrying.
11. The cast is minimal.
12. Orchestration stays observable.
13. A persona is not a capability.
14. **Do not add an actor unless its presence changes the solution space.**

## Testing

```bash
bun test          # 168 tests: behavioural suite + formalized requirements
bun run typecheck # optional; requires `bun install` for dev types
```

Tests assert behaviour, not class existence. The suite has two layers:

- `test/*.test.ts` — behavioural tests for scene design, casting, evaluation, orchestration and the end-to-end example.
- `test/requirements/*.test.ts` — each test is a **formalized requirement** (`R-<area>-<n>`) with an abstract statement and a concrete example. The full matrix, plus the bugs requirements have surfaced, is in [`docs/requirements.md`](docs/requirements.md).

## Project layout

```text
src/
  types.ts       shared primitives (Status, Artifact, Diagnosis, ids)
  scene.ts       Scene, SceneCard, SceneDesigner, conflict detection
  actor.ts       Actor, executors, tools, LLM adapter
  cast.ts        Cast, Protocol, CastingDirector, minimality, castFromCard
  evaluation.ts  Evaluation, Evaluator, diagnosis → action
  persona.ts     Persona, Audition, Auditioner, AuditionStore, dressCast
  opencode.ts    agent markdown → Persona adapter
  stage.ts       StageManager, Performance, recast/redesign loop, events (incl. auditions)
  serialize.ts   Performance JSON round-trip and replay
  trace.ts       formatPerformance, performanceTimeline
  index.ts       public surface
.opencode/skills/{scene-designer,casting-director}/SKILL.md
examples/incident-rca/run.ts
examples/llm/run.ts
examples/audition/run.ts
test/*.test.ts
docs/architecture.md
docs/actors.md
docs/requirements.md
```

See [`docs/architecture.md`](docs/architecture.md) for the module map and data flow, [`docs/actors.md`](docs/actors.md) for the role/persona model, and [`docs/requirements.md`](docs/requirements.md) for the requirement matrix.

## Status

A small foundational primitive, deliberately not a framework. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is intentionally out of scope.

## License

MIT
