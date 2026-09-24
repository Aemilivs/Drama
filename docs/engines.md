# Using an agent engine as an actor

drama depends on no agent framework. An actor needs exactly one thing — an `executor` — so
**every engine is already supported**: you pass a function that calls it. This page is the whole
integration surface, and it is deliberately small.

The generic adapter is `createEngineExecutor` (`src/engines.ts`):

```ts
import { createActor, createEngineExecutor } from "drama";

const actor = createActor({
  name: "analyst", role: "migration analyst", objective: "Assess the migration",
  capabilities: ["migration_review"], expectedOutput: ["RiskReport"],
  executor: createEngineExecutor({
    producer: "langgraph",                                   // who the artifacts say produced them
    invoke: async ({ prompt, inputs, iteration }) => {
      // ... call your engine here ...
      return { artifacts: [{ kind: "RiskReport", content: result }] };
    },
  }),
});
```

The engine receives **exactly what a model would receive** — `renderActorPrompt(ctx)`, plus the raw
`inputs`, `scene`, `actor`, `instruction` and `iteration` — so the orchestration stays inspectable
and the engine stays swappable. A throw, a missing result or a result with no usable artifact kinds
becomes a `failed` output, never an exception escaping into the stage.

Because the wrapper is identical everywhere, each recipe below shows **only the engine call**.

## The contract

| Direction | Shape |
| --- | --- |
| Into the engine | `{ messages, prompt, actor, instruction, inputs, scene, iteration }` |
| Out of the engine | `{ artifacts: [{ kind, content?, meta? }] }` — drama assigns ids and timestamps |

**Structured output is the better fit.** Every engine here can return a typed object rather than
prose; when it does, pass that object as `content` and the artifact is validated data instead of
text the next actor has to parse.

## 1. LangGraph — `@langchain/langgraph` 1.4.17 (TS)

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatAnthropic } from "@langchain/anthropic";

const graph = createReactAgent({ llm: new ChatAnthropic({ model: "claude-sonnet-4-6" }), tools: [] });

// inside invoke:
const result = await graph.invoke({ messages: [{ role: "user", content: prompt }] });
return { artifacts: [{ kind: "RiskReport", content: result.messages.at(-1)?.text }] };
```

Docs: <https://docs.langchain.com/oss/javascript/langgraph/quickstart>. Needs Node 18+, a provider
key, and the provider package (`@langchain/anthropic`) installed separately from the graph package.

## 2. OpenAI Agents SDK — `@openai/agents` 0.18.0 (TS)

```ts
import { Agent, run } from "@openai/agents";

const agent = new Agent({ name: "Analyst", instructions: "Assess migrations." });

// inside invoke:
const result = await run(agent, prompt);
return { artifacts: [{ kind: "RiskReport", content: result.finalOutput }] };
```

Docs: <https://openai.github.io/openai-agents-js/guides/quickstart>. Node 22+, ESM, `OPENAI_API_KEY`
read at run time, `zod ^4` as a peer dependency.

## 3. Google ADK — `@google/adk` 2.1.0 (TS)

ADK needs a runner and a user id even for one prompt; `runEphemeral` hides the session pre-creation.

```ts
import { LlmAgent, InMemoryRunner, isFinalResponse } from "@google/adk";
import { createUserContent } from "@google/genai";

const agent = new LlmAgent({
  name: "analyst", model: "gemini-2.5-flash", instruction: "Assess migrations.",
});
const runner = new InMemoryRunner({ appName: "drama", agent });

// inside invoke:
let text = "";
for await (const event of runner.runEphemeral({ userId: "actor", newMessage: createUserContent(prompt) })) {
  if (isFinalResponse(event)) {
    text += event.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }
}
return { artifacts: [{ kind: "RiskReport", content: text }] };
```

Docs: <https://adk.dev/get-started/typescript/>. Node **24.13+**, `GEMINI_API_KEY` in `.env`, ESM,
and the heaviest dependency tree of the five (OpenTelemetry, optional express/dockerode).

## 4. CrewAI — `crewai` 1.15.22 (Python only)

There is **no JS/TS binding**, and the OSS package documents no self-hosted HTTP service — so from
Bun you spawn the Python entrypoint. The paid AMP platform exposes `POST /kickoff` if you prefer HTTP.

```python
# crew_runner.py — one prompt on stdin, one JSON line on stdout
import sys, json
from crewai import Agent

agent = Agent(role="Analyst", goal="Assess migrations", backstory="You are a migration analyst.")
print(json.dumps({"text": agent.kickoff(sys.stdin.read()).raw}))
```

```ts
// inside invoke — Bun's shell escapes interpolated values:
const raw = await Bun.$`echo ${prompt} | python3 crew_runner.py`.text();
return { artifacts: [{ kind: "RiskReport", content: JSON.parse(raw).text }] };
```

Docs: <https://docs.crewai.com/en/concepts/agents>. Python `>=3.10,<3.14`; `OPENAI_API_KEY` by default.

## 5. Mastra — `@mastra/core` 1.69.0 (TS)

```ts
import { Agent } from "@mastra/core/agent";
import { z } from "zod";

const agent = new Agent({
  id: "analyst", name: "Analyst", instructions: "Assess migrations.",
  model: "openai/gpt-5-mini",              // provider/model string; key from env
});

// inside invoke — text:
const res = await agent.generate(prompt);
return { artifacts: [{ kind: "RiskReport", content: res.text }] };

// or validated data, which drama prefers:
const typed = await agent.generate(prompt, {
  structuredOutput: { schema: z.object({ risks: z.array(z.string()) }) },
});
return { artifacts: [{ kind: "RiskReport", content: typed.object }] };
```

Docs: <https://mastra.ai/docs/agents/overview>. Node 22.13+, ESM-only, no server needed for a direct
`generate()`.

## What this deliberately does not do

Wrapping an engine gives you **one actor**. It does not import that engine's durability, streaming,
memory or retries into drama, and drama will not pretend the semantics compose:

- **Durability** — LangGraph checkpoints per super-step, CrewAI forks task outputs, Mastra snapshots
  workflows. drama's `gate` / `maxTurns` / `enqueue` semantics are its own; a wrapped engine's
  checkpoints do not resume a drama performance.
- **Streaming** — executors return a complete output. An engine that streams internally may still be
  wrapped; drama just sees the final result.
- **Memory** — the engine's own memory persists nothing for drama. Everything an actor knows arrives
  as artifacts and a history snapshot.

If you need those, they belong to the host or the engine, not to this seam. See
[`docs/prior-art.md`](prior-art.md) for the full comparison and why five native adapters were
deliberately not written.
