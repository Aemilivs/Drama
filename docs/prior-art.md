# Prior art: how drama relates to the agent frameworks

Written after comparing drama against the five most-used code-first agent orchestration
frameworks. Read it before adding an integration, an adapter, or a feature "because LangGraph has
it".

**Data snapshot:** GitHub stars/pushes and package downloads pulled **2026-09-24 UTC**; versions as
of that pull. Treat this as perishable — the *reasoning* is the part meant to last.

## Method, and its caveats

"Agent orchestration framework" here means a **code-first library/runtime for composing agent
control flow and multi-agent coordination** — which excludes end-user coding harnesses and
low-code platforms (see the last section).

Ranking is a **composite**: monthly package downloads primary (closest available proxy for runtime
use), GitHub stars secondary, release liveness tertiary. The caveats are real and worth keeping:

- Download counts include CI, mirrors and containers; they inflate every package roughly equally,
  so read them as relative, not absolute.
- **Stars and downloads disagree sharply.** `microsoft/autogen` holds 61k stars while being frozen;
  CrewAI has the most stars of any dedicated framework (59k) but only ~2.4M monthly downloads.
  Slots 3–6 are genuinely weighting-sensitive.
- **AutoGen and Semantic Kernel no longer qualify.** `microsoft/autogen` last pushed 2026-04-15 with
  zero releases in 90 days; Semantic Kernel is superseded. Their successor is **Microsoft Agent
  Framework**, which is why it appears in the table below as a special case.

## The five, and what they are

| # | Framework | Language | Orchestration model | Stars | Downloads / month |
| --- | --- | --- | --- | ---: | ---: |
| 1 | **LangGraph** | Python + TS | explicit state graph, Pregel-style super-steps | 42.2k | 43.5M PyPI + 12.1M npm |
| 2 | **OpenAI Agents SDK** | Python + TS | handoffs / agents-as-tools + code-driven chaining | 29.7k | 12.8M + 6.2M |
| 3 | **Google ADK** | Python, Java, Go, TS | workflow agents (seq/parallel/loop) + graph workflows | 21.6k | 9.9M + 0.69M |
| 4 | **CrewAI** | Python | role-based crews (sequential or hierarchical) + event Flows | 59.0k | 2.4M |
| 5 | **Mastra** | TypeScript | `.then()/.parallel()/.branch()` workflow graph + Agents | 28.3k | 5.5M (npm) |
| — | *Microsoft Agent Framework* | Python, .NET, Go | workflows + handoff / group chat / magentic | 13.8k | — |

## Table stakes — what every one of the five ships

These are the baseline a framework is judged on today:

1. **Schema-typed tool calling**, and **MCP as a client** (Mastra, OpenAI and Microsoft also expose an MCP *server*).
2. **Multi-agent primitives** — supervisor, handoff, group chat, or role assignment.
3. **Streaming**, at token and step/event granularity.
4. **Span-level tracing** — first-party, or via a companion product, with OpenTelemetry export in most.
5. **Conversation memory plus long-term / compaction.**
6. **Provider flexibility with a bring-your-own client.**
7. **A deployment path** — server, hosted platform, or documented cloud target.
8. **Suspend/resume for human approval, and guardrails on actions.**
9. **Retries, timeouts and error handling as configurable primitives.**

**The one notable exception:** *built-in evaluation, including LLM-as-judge, is not universal.* Only
**Google ADK** and **Mastra** ship it as core; LangGraph (LangSmith), CrewAI (third-party) and
Microsoft (Foundry) treat it as a separate product, and OpenAI's Evals/Agent Builder surface is being
withdrawn from 2026-11-30.

## Where drama stands

| Table stake | drama | Note |
| --- | --- | --- |
| Tool calling + MCP | ⚠️ a name→function registry; **no MCP** | the host supplies real tools |
| Multi-agent primitives | ✅ core, of a different kind | artifact dependencies, not supervisor/handoff/chat |
| Streaming | ❌ | executors return a complete output |
| Span-level tracing | ✅/⚠️ `ActorTurn` timings, events, `performanceTimeline`, `serializePerformance` | **no OTel export** |
| Memory + compaction | ❌ by design | artifacts over conversations |
| BYO client | ✅ maximal | **zero runtime dependencies**; the host must supply the client |
| Deployment path | ❌ | it is a library |
| HITL + guardrails | ✅ and stricter than most | `gate` fails closed; `owns`, `maxConcurrency`, `maxTurns`, `planWaves`, `independent_steps`, `no_merge_owner`, `duplicate_question` |
| Retries / timeouts / fallbacks | ⚠️ bounded loops only | `maxPerformances` / `maxRecasts` / `maxRedesigns`; no per-step retry |
| **Built-in evaluation** | ✅ **core, and deeper** | `Evaluation` chooses an *action* (reperform / recast / redesign), not just a score |

### What drama has that none of the five do

- **Roles derived per scene.** CrewAI's crews are role-based, but the roles are *declared by the user*.
  drama derives them from the scene's capabilities and validates minimality; a canonical cast is
  rejected, and a fixed Planner→Researcher→Critic→Executor is called out as an anti-pattern.
- **Personas and auditions.** Binding is *discovered by asking the performer*, cached against a
  content-derived fingerprint of the role, with refusals as first-class answers. No framework has this.
- **Designed conflict.** A role declares what it exists to challenge, and the design is validated —
  the target must exist, the challenger must run after it produced, and the disagreement must yield
  something a later step consumes.
- **Diagnosis-driven recast.** Failure routes by *cause*: bad execution → reperform, missing
  capability → recast, missing information → recast with a research actor, malformed problem →
  redesign. The others have retries and fallbacks; none changes *who is on stage*.
- **Discipline as validation** — fake edges (`independent_steps`), one owner of the merge
  (`no_merge_owner`), copies in a verifier panel (`duplicate_question`), one writer per file
  (`owns_conflict`).
- **Replay.** `serializePerformance` plus an R-SERIAL test that re-runs a stored trace to the same
  structural fingerprint. ADK's conformance replay is the analogue; this is the same idea, smaller.

### What drama lacks — and who closes it

| Gap | Closed by |
| --- | --- |
| MCP, real tools, permissions, subagents, skills | **the host** (OpenCode) |
| Streaming, OpenTelemetry export, deployment, UI | nothing today |
| Memory, RAG, compaction | nothing today, and it is out of scope |
| Durable execution with mid-run resume | nothing: LangGraph checkpoints every super-step and CrewAI can fork task outputs; this is their genuine advantage |

## Verdict: control plane, not platform

The five are **platforms** — they own models, memory, tracing backends and deployment. drama is a
**control plane for one performance**: no runtime, no providers, no storage. It is not a competitor;
it is a layer above, and the two directions of integration already work by construction:

- **Any engine can be an actor** — the executor seam. See [`engines.md`](engines.md).
- **drama can be called from inside any engine** — it is an ordinary library; Microsoft names the
  pattern `workflow-as-agent`.

**So no native adapters were written.** Wrapping an engine takes about five lines of host code
(`createEngineExecutor`); making it "native" would replace *your* five lines with *the library's*
five lines while adding nothing drama can express — and would add five version-churn surfaces to a
library whose value is having no runtime dependencies. Those five ship 34 to 190 releases per 90
days. Where a deeper integration is genuinely wanted — an engine's durable checkpoints *under* a
performance — that is a specific project with a concrete requirement, not five "supported engines".

**Provider adapters follow the same rule.** `examples/providers/` carries a plain-`fetch`
OpenAI-compatible adapter and an Anthropic Messages adapter — both tested, and both deliberately
outside `src/`. The library ships no provider code, so the BYO-client row above stays true.

## Coding harnesses and low-code platforms are a different category

By raw stars the biggest names are applications, not orchestration libraries: `sst/opencode`
(209.8k), `n8n` (205.8k), `Dify` (157.0k), `claude-code` (147.9k), `codex` (126.3k).

For drama this matters in one specific way: **drama is OpenCode-native**, and OpenCode supplies
several of the gaps above (MCP, tools, permissions, subagents, skills). The honest framing is that
drama delegates the platform layer to its host — which is exactly why the missing pieces above are
tolerable rather than fatal.
