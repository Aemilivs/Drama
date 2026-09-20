# Working principles for this repository

Derived while building `drama`. Keep this file current as new principles are found.

## Architecture

- **Data first, behaviour second.** Scene, Actor, Cast, Protocol, Evaluation and Performance are plain serialisable objects; the only behaviour lives in small classes (`SceneDesigner`, `CastingDirector`, `Evaluator`, `StageManager`). The scene, cast, artifacts, evaluation and trace can be dumped to JSON; `Actor.executor` is a function, so replaying a stored performance requires re-attaching executors.
- **Zero runtime dependencies.** The library runs on Bun/TypeScript alone. Models are wired in through one injected `ChatFn`; nothing in `src/` imports a provider SDK.
- **One-way dependencies.** `types → scene → actor → cast → evaluation → stage → trace`. The `cast ↔ evaluation` edge is type-only and must stay that way; do not introduce a runtime import between them.
- **Prompts and code meet only at the wire format.** Skills emit YAML; `sceneFromCard` / `castFromCard` normalise it. Do not couple prompts to internal classes.
- **Never crystallise a role.** Roles are derived per scene. To shape behaviour, add an *example* to the casting prompt — not a fixed role or a dedicated agent. Personas are the crystallisable layer, and even they must audition.
- **No fake edges.** Express a dependency as `consumes`, never as a step order. `independent_steps` reports serialized steps that never read each other; `no_merge_owner` reports terminal artifacts with several owners. The task-graph discipline and its mapping live in `docs/graph-engineering.md`.
- **The boundary is total.** `sceneFromCard`, `castFromCard`, `actorFromCard` and `createProtocol` must never throw on malformed input — coerce or ignore wrong-typed fields, because the input comes from a model. Enforced by R-PROP-3.
- **Keep the primitive small.** Resist adding infrastructure (persistence, retries at the HTTP layer, schedulers, registries) until a concrete scene demands it.
- **Artifact inputs are explicit.** A protocol step's `consumes` lists the kinds it receives; an empty list means no inputs. Do not reintroduce an implicit "all artifacts" default — it makes minimality and recast wiring ambiguous.

## Behavioural invariants (do not regress)

- An unevaluated success criterion is `uncertain`, never `pass`.
- An evaluator crash is `uncertain` with a visible issue, never a silent pass.
- Actors receive a **snapshot** of the turn history, never the live array — a retained `ActorContext` must not grow after the fact.
- A failed attempt is diagnosed; the diagnosis chooses `reperform | recast | redesign_scene`. Never hard-code "retry".
- Recasting must preserve a correct attempt counter: the initial cast is attempt 1, so the first recast is attempt 2.
- Minimality is enforced: an actor that is never activated, or whose capabilities are already covered and whose output is never consumed, is flagged.
- All loops are bounded by explicit budgets.

## Testing

- `bun test` is the gate. Tests assert behaviour (capability gaps, redundant actors, role conflicts, actor/evaluator failure, retry, recast, redesign, every status), not class existence.
- When adding an abstraction, add a test that fails if its *behaviour* is removed, not just if the symbol disappears.
- Keep the end-to-end example deterministic so it runs offline and in CI.

## Conventions

- Files: one concept per module, named after the concept (`scene.ts`, `cast.ts`).
- Public surface is `src/index.ts` only; everything else is internal.
- Type names: `Scene`, `Actor`, `Cast`, `Evaluation`, `Performance`. Card/wire types end in `Card`.
- Ids come from `nextId(prefix)`; tests may call `resetIds()`.

## OpenCode integration

- Reusable prompts live as project skills at `.opencode/skills/<name>/SKILL.md` with `name` + `description` frontmatter.
- Project tools live at `.opencode/tools/<name>.ts` and export `tool({ description, args, execute })` from `@opencode-ai/plugin` (`tool.schema` is zod). `@opencode-ai/plugin` is a devDependency only; opencode provides it at runtime.
- Prefer a native mechanism (skill, tool) over a parallel one.
