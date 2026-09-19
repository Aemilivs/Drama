/**
 * A runnable LLM-backed example.
 *
 * Proves the whole chain with a real model: personas are irrelevant here, but
 * `createLlmExecutor` + `StageManager` are the production path. The adapter is a
 * plain OpenAI-compatible chat call over `fetch` — no provider SDK, no
 * dependency — and it is configured entirely from the environment.
 *
 * Offline-safe by design: with no configuration the example prints how to set it
 * up and exits; the test suite injects a fake `fetch` and never touches a network.
 *
 *   DRAMA_LLM_BASE_URL=https://api.example.com/v1 \
 *   DRAMA_LLM_API_KEY=... \
 *   DRAMA_LLM_MODEL=some-model \
 *   bun run examples/llm/run.ts
 */

import {
  Evaluator,
  StageManager,
  createActor,
  createCast,
  createLlmExecutor,
  createProtocol,
  criterionEvaluator,
  formatPerformance,
  sceneFromCard,
} from "../../src/index.ts";
import type { ChatFn, ChatMessage, Performance } from "../../src/index.ts";

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/** Wrap an OpenAI-compatible `/chat/completions` endpoint as a `ChatFn`. */
export function createOpenAiCompatibleChat(
  config: OpenAiCompatibleConfig,
): (messages: ChatMessage[]) => Promise<string> {
  const doFetch = config.fetch ?? fetch;
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages: ChatMessage[]) => {
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages }),
    });
    if (!response.ok) {
      throw new Error(`chat request failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("chat response had no message content");
    return content;
  };
}

export interface LlmEnv {
  DRAMA_LLM_BASE_URL?: string;
  DRAMA_LLM_API_KEY?: string;
  DRAMA_LLM_MODEL?: string;
}

/** Build a `ChatFn` from the environment, or `undefined` when it is incomplete. */
export function chatFromEnv(env: LlmEnv = process.env as LlmEnv): ChatFn | undefined {
  const { DRAMA_LLM_BASE_URL: baseUrl, DRAMA_LLM_API_KEY: apiKey, DRAMA_LLM_MODEL: model } = env;
  if (!baseUrl || !apiKey || !model) return undefined;
  return createOpenAiCompatibleChat({ baseUrl, apiKey, model });
}

/** One actor, one step: the smallest production that exercises the LLM path. */
export async function runLlmExample(chat: ChatFn): Promise<Performance> {
  const scene = sceneFromCard({
    objective: "Answer the question in one sentence.",
    success_criteria: ["An answer artifact exists"],
    required_capabilities: ["answering"],
  });
  const answerer = createActor({
    name: "answerer",
    role: "answerer",
    objective: "Answer the question.",
    capabilities: ["answering"],
    expectedOutput: ["Answer"],
    executor: createLlmExecutor(chat),
  });
  const cast = createCast(
    [answerer],
    createProtocol([{ actor: "answerer", instruction: "Answer the question.", produces: ["Answer"] }]),
  );
  const evaluator = new Evaluator(
    criterionEvaluator([
      {
        criterion: scene.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "Answer")
            ? { status: "pass", evidence: "answer present" }
            : { status: "fail", evidence: "no answer produced" },
      },
    ]),
  );
  return new StageManager({ evaluator }).perform(scene, cast);
}

if ((import.meta as { main?: boolean }).main) {
  const chat = chatFromEnv();
  if (!chat) {
    console.log(
      "Set DRAMA_LLM_BASE_URL, DRAMA_LLM_API_KEY and DRAMA_LLM_MODEL to run this example.",
    );
  } else {
    const performance = await runLlmExample(chat);
    console.log(formatPerformance(performance));
    console.log("\nanswer:", performance.finalResult.artifacts[0]?.content);
  }
}
