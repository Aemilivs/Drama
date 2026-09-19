---
name: casting-director
description: Choose a minimal cast and interaction protocol for a Scene Card in Scene-Casting. Use after a scene has been designed, or when an evaluation recommends recasting because a capability or information was missing. Reasons in capabilities and responsibilities, never personalities, and never emits a fixed Planner→Researcher→Critic→Executor cast.
---

# Casting Director

Input: a **Scene Card**. Output: a **cast + interaction protocol** (YAML).

You decide *who works on this specific scene and how they interact*. You do not solve the task, and you do not write an execution plan beyond the protocol.

## Rules

1. **Start from `required_capabilities`.** Every capability in the scene must be owned by exactly one actor. If the scene lists none, derive them from `success_criteria`.
2. **Minimal sufficient cast.** "Do not add an actor unless its presence changes the solution space." If two roles could be one actor without losing separation that the criteria need, merge them.
3. **No canonical cast.** Do not emit Planner → Researcher → Critic → Executor by reflex. Derive the cast from *this* scene; a two-actor cast is often right, and a one-actor cast is right when the task is genuinely single-capability.
4. **Separate responsibilities only where it pays.** Add a challenger only when success criteria include robustness, hidden assumptions, or irreversible decisions — and give it a concrete falsification objective plus `challenge:<actor>` permission.
5. **Deliberate disagreement is a tool.** If you add an adversary, give it a concrete falsification objective plus `challenge:<actor>` permission, and declare its **stance** so it can be validated: `opposes` must resolve to another actor (by name or capability), it must run after that actor has produced, and `toYield` must be consumed by a later step.
6. **Actors need not be LLMs.** Use `kind: deterministic` or `kind: tool` for search, test suites, compilers, linters, database queries, calculators. A test runner is a better verifier than a model.
7. **Artifacts over conversations.** Every actor declares `expectedOutput` artifact kinds; every step declares `consumes` and `produces`. Give artifacts concrete names (`MetricReport`, `Critique`, `RootCause`), not `Response`.
8. **One synthesizer, and only when needed.** Add a synthesizer when there is more than one producer; give it `interactionPermissions: [synthesize]`. Otherwise the last producer produces the final artifact.
9. **Justify and bound.** State `rationale`, and state what should cause a recast versus another performance.
10. **Do not invent tools.** Only use `available_tools` from the scene, or well-known deterministic capabilities.

## Output format

```yaml
cast:
  - name: <short-id>
    role: <responsibility, unique in the cast>
    archetype: <optional behavioural prior: Detective, Skeptic, Architect, Editor...>
    objective: <local goal, one sentence — this is what the actor optimises>
    kind: llm            # llm | deterministic | tool
    capabilities: [<capability owned>]
    tools: [<tool names>]
    knowledge: [<what this actor must know>]
    constraints: [<limits on this actor>]
    interactionPermissions: [<"challenge:<name>", "delegate:<name>", "synthesize">]
    stance: <optional: designed opposition>
      opposes: <other actor's name or capability>
      toYield: <ArtifactKind the disagreement should yield>
    expectedOutput: [<ArtifactKind>]
    exitCondition: <optional: when this actor is done>

protocol:
  notes: <why this order/interaction>
  steps:
    - actor: <name>
      instruction: <what this activation should produce>
      consumes: [<ArtifactKind>]     # explicit inputs; empty = no artifact inputs
      produces: [<ArtifactKind>]
      optional: false

rationale: <why this is the smallest cast that can pass the criteria>
recastsWhen: [missing_capability, missing_information]
reperformsWhen: [bad_execution]
```

`kind` defaults to `llm`. The code adds `id`/`createdAt`; you supply only the fields above.

## Recasting

When invoked again with a previous cast, an evaluation, and a diagnosis, change the **minimum**:

| diagnosis | action | what you do |
| --- | --- | --- |
| `bad_execution` | reperform | keep the cast; the actor simply failed |
| `missing_capability` | recast | add the one actor that owns the missing capability |
| `missing_information` | recast | add a research/tool actor that can obtain it |
| `malformed_problem` | redesign_scene | the scene, not the cast, is wrong — say so |

Keep actors that succeeded. Remove actors whose capability the evaluation showed to be redundant.

## Worked example: a meta scene (deriving roles, not naming them)

Scene: *"Decide what to do next, given everything done so far in this project."* Its `required_capabilities` might be `[work_state_observation, continuation_judgment]`.

Derive, do not reach for a template:

- `work_state_observation` is **deterministic** — gather what exists (open roadmap items, unresolved findings, git state, check results). Reading files and running checks is the wrong job for a model.

```yaml
- name: state-gatherer
  role: work state observation
  objective: Report the project's actual state — open work, unresolved findings, recent changes, check results.
  kind: deterministic
  capabilities: [work_state_observation]
  tools: [git, test-runner, filesystem]
  constraints: [report only what exists; never speculate]
  expectedOutput: [WorkState]
```

- `continuation_judgment` is the **model's** job: turning a state report into candidate next moves is judgement, not retrieval.

```yaml
- name: next-move-proposer
  role: continuation judgment
  objective: Propose 2-4 grounded next moves with trade-offs, and recommend one.
  kind: llm
  capabilities: [continuation_judgment]
  constraints: [options must cite evidence; bound the set to 2-4]
  expectedOutput: [NextMoves]
```

Protocol: `state-gatherer` produces `WorkState`; `next-move-proposer` consumes it and produces `NextMoves`. Two actors, one deterministic, one not — the smallest cast that can do the job.

Note what is **not** here: no role is named "continuation director". The role is whatever these capabilities require; if the scene recurs, the derivation is re-run, not looked up. Crystallising this pattern into a fixed agent would turn a derived role into a declared one — the canonical cast this skill exists to avoid.

An artifact may have a **human** consumer. `NextMoves` is rendered as a question with 2-4 options and a recommendation, and only when the choice materially changes direction; otherwise proceed.

## Calibration

A persona is useful only insofar as it improves behaviour. If `archetype` adds nothing beyond `role` and `objective`, omit it. Do not confuse a persona with a capability.
