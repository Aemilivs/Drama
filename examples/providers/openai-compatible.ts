/**
 * An OpenAI-compatible `/chat/completions` adapter over `fetch`.
 *
 * No provider SDK, no dependency: the whole adapter is one function, which is
 * what "bring your own client" means in practice. What it returns is a plain
 * prompt function that `createLlmExecutor` accepts.
 */

import type { ChatFn, ChatMessage } from "../../src/index.ts";

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

/** Wrap an OpenAI-compatible `/chat/completions` endpoint as a prompt function. */
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

/** Build a prompt function from the environment, or `undefined` when it is incomplete. */
export function chatFromEnv(env: LlmEnv = process.env as LlmEnv): ChatFn | undefined {
  const { DRAMA_LLM_BASE_URL: baseUrl, DRAMA_LLM_API_KEY: apiKey, DRAMA_LLM_MODEL: model } = env;
  if (!baseUrl || !apiKey || !model) return undefined;
  return createOpenAiCompatibleChat({ baseUrl, apiKey, model });
}
