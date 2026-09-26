# Decision models: Jev, the open-source alternatives, and how they fit drama

Written after researching the "System One" / decision-model class. This is the
`FinalProposal` artifact of the drama defined in
[`examples/decision-models/run.ts`](../examples/decision-models/run.ts): a
two-producer cast (external research, local seam mapping), one synthesis, and one
independent verifier.

**Data snapshot:** primary docs and GitHub READMEs pulled **2026-09-26 UTC**;
versions and prices as of that pull. Treat the numbers as perishable — the
reasoning is the part meant to last.

Read this before adding a "decision model support" feature to `src/`, the same
way [`prior-art.md`](prior-art.md) is read before adding an engine adapter.

## What the class is

A **decision model** takes a document (the `state`) plus a set of **typed
questions** and returns, for each question, a **calibrated probability
distribution over options** — in a single forward pass, generating no text at
all. TypeSafe AI names the class *System One Models* after Kahneman's fast,
intuitive system and positions it as a bounded probabilistic decision layer
inside software rather than a generative System 2 assistant — "smart
if-statements".

Three answer schemas, defined **per request**:

| type | answer | returns |
| --- | --- | --- |
| `noul` | yes/no | `P(yes)` |
| `choice` | one of up to 255 supplied options | top option, full probability map, confidence |
| `score` | ordered levels (2–10 on Jev; 1–255 on Kev) | probability-weighted score |

Because the options are request inputs, the same checkpoint answers a 2-option
and a 200-option question without retraining — the property that separates this
from an ordinary classifier with a baked-in label space.

Source: <https://typesafe.ai/blog/introducing-system-one-models-and-jev>,
<https://docs.typesafe.ai/api>; the Kev bounds on `choice`/`score` are from
<https://github.com/jaredpalmer/kev>.

## Jev — the closed reference

TypeSafe AI (founder Diogo Almeida), announced **2026-09-15** as a hosted,
early-access product; no public weights and no parameter count have appeared, and
the architecture is undisclosed. `POST https://api.typesafe.ai/v1/systemone`;
request `{ state, model, questions: { <id>: { type, instructions, criteria } } }`;
models `jev-1.13.0` / `jev-latest`. Source: <https://docs.typesafe.ai/api>.
Pricing is $0.042 per M input tokens with output free, on a 64k-token context
(32k state + longest question). Source: <https://docs.typesafe.ai/models>.

Vendor-stated properties:

- no string generation — TypeSafe's phrasing is that it "outputs all
  probabilities in parallel instead of autoregressively generating by token";
- **not fine-tuned or LoRA-adapted on customer data** — adaptation is via
  `state` / `instructions` / `criteria`, not weights;
- `confidence` is derived from the probability distribution, not a learned
  accuracy estimate.

**Vendor-documented jaggedness** (this matters for integration): literal
reading; unreliable counting, date arithmetic and numeric comparison; it
degrades on long irrelevant state ("context rot"); adversarial content can move
answers; structural invariants are not guaranteed (a `noul` and the equivalent
yes/no `choice` can disagree); it cannot generate.
Source: <https://docs.typesafe.ai/model-jaggedness/jev-1.13>.

**Benchmarks.** TypeSafe's own workflow evals report 67.8% mean accuracy at 0.4 s
and $0.0004/case, against opus 5 at 73.1%, 37.8 s and $0.176 — on reference
labels built by averaging GPT-6 Astra and Claude Fable 5.1 at high thinking,
which TypeSafe itself flags as biased toward OpenAI/Anthropic. The homepage
headline (193.6× faster, 444.6× cheaper) is a separate aggregate, not that row.
Source: <https://evals.typesafe.ai/>.

**The architecture is not confirmed.** Archer Hume's *Jev's Architecture
Unmasked* reconstructs it as an **inference** from black-box API probing — the
author's headline count is ~10,000 calls, while the methods section itemises
about 1,000 probes — and labels the result speculation. It proposes a causal
transformer with a shared-state prefix, isolated question branches, listwise
option processing, direct numerical readouts, and post-training with TypeSafe's
stated RLCD. Treat it as a hypothesis, not a spec.
Source: <https://archerhume.com/posts/jevs-architecture-unmasked/>.

## The open-source alternatives

| Project | License | Base / architecture | Sizes | Notes |
| --- | --- | --- | --- | --- |
| **Kev** (jaredpalmer) | Apache-2.0 | Qwen3.5 / Qwen3.8 base + rank-16 LoRA + small **pointer head** scoring each option's `</opt>` state against the question's `<decide>` state; softmax over options; one pass | 0.8B / 4B / 9B / 27B (older 0.5–8B line) | implements TypeSafe's public `/v1/systemone`; the TypeSafe Python SDK drives a Kev server unchanged |
| **Laya** (NandhaKishorM) | Apache-2.0 | ModernBERT-large 421M (English) + mmBERT-base 322M (multilingual) with a router; option-attention | 421M / 322M | same wire protocol; ~33 ms/question on a T4; options share a fixed head budget, so >~20 described options degrade |
| **Jevlike** (vinnylarouge) | MIT | byte-embedding **option-attention**: each option is a query that reads the context, softmax across options | research starter | deliberately not a Jev copy |
| **Kev-ANE** (MidasMulli) | Apache-2.0 | Kev-0.6B compiled for the Apple Neural Engine | 0.6B | 7.16 ms p50 at T=64; 155/155 argmax agreement with Kev's reference on real records |
| **CUA-S1** (trycua) | MIT | a 706k-parameter specialist checkpoint (`cua-s1-forms`) for computer-use form decisions | 706k | domain-specific, not a general Jev alternative; no like-for-like benchmark confirmed here |

Sources: <https://github.com/jaredpalmer/kev>,
<https://github.com/NandhaKishorM/laya>, <https://github.com/vinnylarouge/jevlike>,
<https://github.com/MidasMulli/kev-ane>, <https://github.com/trycua/cua>.

Caveats that must travel with the table:

- **Every cross-model comparison is author-reported and uncontrolled.** Nobody
  knows Jev's training data, so "Kev-27B ≈ Jev" on one suite is not equivalence;
  Kev's own README says as much.
- The three architectures genuinely differ (pointer head vs option-attention vs
  byte embeddings): "Jev-like" is a **contract**, not one implementation.
- Jev's parameter count, training corpus and internals are **unverified**.

## Where this fits drama

drama's actor kinds today are `llm`, `deterministic` and `tool`
(`src/actor.ts:14`). A decision model is none of them: it is not generative, but
it is not deterministic either — it makes a *judgement*, with a calibrated
confidence drama has no channel for. The code confirms the gap: `Status` is
three-valued, `ActorOutput` carries artifacts and usage but no score, and
`Selector` returns one persona, not a distribution.

Four places it fits, in descending strength:

1. **The Evaluator (strongest).** `CriterionCheck` / `criterionEvaluator`
   (`src/evaluation.ts:51-59,143-156`) is already exactly a typed question → structured
   answer. A decision model gives per-criterion **calibrated** answers, and a
   threshold maps cleanly onto `Status`: high `P(pass)` → `pass`, low → `fail`, a
   wide distribution → `uncertain` — drama's existing "never guess" status. A
   `choice` over `finish | reperform | recast | redesign_scene` maps directly
   onto `RecommendedAction`.
2. **Auditions and casting calls.** "Does this persona accept this role?" is a
   `noul`; `askAll` over N personas is a `choice` with N options — precisely the
   "arbitrary option sets without retraining" property. Today
   `parseAuditionAnswer` (`.opencode/lib/audition-prompt.ts:116-137`, host layer)
   yields a boolean and an unparseable answer counts as a refusal; a decision
   model would yield a calibrated acceptance instead.
3. **Routing and gates.** Any binary or small-choice routing decision inside a
   performance (`gate`, step selection) is a bounded decision, not a generation.
4. **The structured-output contract** (beads `drama-gas.4`). A decision model is
   the anti-autoregressive-JSON primitive: the output shape *is* the request.

And what it is **not**: with no text generation it cannot replace an LLM actor or
produce artifact *content*. It also inherits Jev's jaggedness (counting, dates,
long context), so it must not displace a deterministic check where one exists —
the same rule drama already applies to verifiers.

## Executing it changed the answer

The drama above was performed for real through `StageManager.perform`: the
actors' recorded outputs, a decision-backed `Evaluator`, `parallel: true` for the
first wave. It needed **no change to `src/`**.

- `StageOptions.executors` (keyed by actor name) runs any supplied executor, and
  `resolveExecutor` (`src/stage.ts:760-767`) gates the shared `chat` on `kind ===
  "llm"` — so a decision actor runs today.
- `criterionEvaluator` (`src/evaluation.ts:143-156`) already composes checks, so a
  decision model slots in as the check function.
- The performance produced all five artifacts and evaluated `pass -> finish`.

[`examples/decision-models/run.ts`](../examples/decision-models/run.ts) reproduces
this offline: a calibrated 0.89 becomes `pass`, and a 0.55 stays `uncertain`.

## What was built

Executing it first showed the seams already worked; the two changes worth keeping
are now in the library.

1. **The calibration policy at the Evaluator.** `calibrate(probability, policy)`
   and `calibratedEvaluator(checks, policy)` sit beside `criterionEvaluator`
   (`src/evaluation.ts`): a check returns a probability, drama thresholds it at
   0.8 / 0.2 by default, and a wide distribution stays `uncertain`. Pinned by
   `R-CALIB-1..6` and demonstrated in the example.
2. **A `"decision"` `ActorKind`.** Added to the union (`src/actor.ts:14`) and to
   the cast-card whitelist (`src/cast.ts:345-348`), so a card can declare a
   decision actor honestly. It stays expressive-only — nothing branches on the
   kind yet — which is why it is two lines and not a subsystem.

**Deliberately not built**, by the same argument `prior-art.md` used for engines
and providers:

- **No `/v1/systemone` client or provider SDK in `src/`.** The adapter lives in
  [`examples/providers/kev.ts`](../examples/providers/kev.ts) beside the
  OpenAI-compatible and Anthropic adapters, so `src/` keeps shipping no provider
  code.
- **No `Distribution` type.** No consumer needs a typed shape; an `Artifact` kind
  carries the probabilities, matching the "data first" bias in
  [`AGENTS.md`](AGENTS.md).
- **No "supported decision models" list.** The contract is the wire format; Kev,
  Laya and Jev are interchangeable behind a host-supplied function, and their
  release cadence is not drama's to track.

## Running it against a real Kev

```bash
bun run setup:kev
```

That command is a no-op when Kev already answers. Otherwise it clones
`jaredpalmer/kev`, runs `uv sync --extra serve`, starts `kev.serve`, smoke-tests a
real System One request **through the drama adapter**, and writes
`~/.cache/drama/kev.json`. `decisionFromEnv()` reads that config, so the example
then talks to Kev with no environment variable set — and still falls back to its
stub when Kev is absent, so it stays offline-safe. The wire handling is pinned by
`R-KEV-1..3`, including the compatibility claim: a Kev `choice` probability of
0.9 drives `calibratedEvaluator` to `pass`.

## Verdict

A decision model is drama's first case of an actor that is neither generative nor
deterministic — a **calibrated judgement layer**. It needed no adapter framework
and no dependency: the executor seam already ran it, and the one genuine gap was
the probability-to-`Status` policy, which is now `calibratedEvaluator`. Everything
provider-shaped stays a host-supplied function, which keeps the BYO-client row in
[`prior-art.md`](prior-art.md) true.
