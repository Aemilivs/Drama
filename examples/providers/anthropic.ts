/**
 * Anthropic Messages API adapter over `fetch`.
 *
 * Claude is *not* OpenAI-compatible: the endpoint, the auth header, the required
 * `max_tokens`, and the placement of the system prompt all differ. The mapping
 * that actually matters is the system prompt — `messages` has no `"system"` role,
 * so system messages are lifted into the top-level `system` parameter.
 *
 * Verified against `platform.claude.com/docs/en/api/messages` and
 * `/docs/en/api/versioning` (2026-09):
 *
 *   POST /v1/messages
 *   headers: content-type, anthropic-version: 2023-06-01, Authorization: Bearer
 *   body:    { model, max_tokens, system?, messages }
 *   reply:   content[] → join the blocks whose `type` is "text"
 *
 * `x-api-key` remains a documented fallback for the Authorization header; this
 * adapter sends the documented primary form.
 */

import type { ChatFn, ChatMessage } from "../../src/index.ts";

export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** `max_tokens` is required by the API and is deliberately conservative here. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  /** Required by the API; defaults to `ANTHROPIC_DEFAULT_MAX_TOKENS`. */
  maxTokens?: number;
  /** Defaults to `ANTHROPIC_BASE_URL`; set it for a proxy or a gateway. */
  baseUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

interface AnthropicBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicBlock[];
}

interface AnthropicErrorBody {
  error?: { type?: unknown; message?: unknown };
}

/** Surface the documented error shape `{ error: { type, message } }` in the thrown error. */
async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as AnthropicErrorBody;
    const type = body?.error?.type;
    const message = body?.error?.message;
    if (typeof type === "string" && typeof message === "string") return `${type}: ${message}`;
    if (typeof message === "string") return message;
  } catch {
    // A non-JSON error body is not worth failing over.
  }
  return response.statusText;
}

/** Wrap the Messages API as a prompt function that `createLlmExecutor` accepts. */
export function createAnthropicChat(
  config: AnthropicConfig,
): (messages: ChatMessage[]) => Promise<string> {
  const doFetch = config.fetch ?? fetch;
  const base = (config.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, "");
  const url = `${base}/v1/messages`;
  const maxTokens = config.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS;

  return async (messages: ChatMessage[]) => {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const turns = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content }));

    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        // The API requires at least one turn; a system-only prompt gets an empty user turn.
        messages: turns.length > 0 ? turns : [{ role: "user", content: "" }],
      }),
    });

    if (!response.ok) {
      const detail = await readError(response);
      throw new Error(
        `anthropic request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
      );
    }

    const data = (await response.json()) as AnthropicResponse;
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");

    if (!text) throw new Error("anthropic response had no text content");
    return text;
  };
}

export interface AnthropicEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_MAX_TOKENS?: string;
  ANTHROPIC_BASE_URL?: string;
}

/** Build an Anthropic prompt function from the environment, or `undefined` when it is incomplete. */
export function anthropicFromEnv(
  env: AnthropicEnv = process.env as AnthropicEnv,
): ChatFn | undefined {
  const { ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model } = env;
  if (!apiKey || !model) return undefined;

  const parsed = Number.parseInt(env.ANTHROPIC_MAX_TOKENS ?? "", 10);
  return createAnthropicChat({
    apiKey,
    model,
    maxTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
    baseUrl: env.ANTHROPIC_BASE_URL || undefined,
  });
}
