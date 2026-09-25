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
 * ## Credentials are reused, not demanded
 *
 * `x-api-key` remains a documented fallback for the Authorization header; this
 * adapter sends the documented primary form. It resolves a credential in order:
 *
 *   1. `ANTHROPIC_API_KEY`, then `ANTHROPIC_AUTH_TOKEN`
 *   2. **the host's own store** — `opencode auth login` writes
 *      `$XDG_DATA_HOME/opencode/auth.json` (`~/.local/share/opencode/auth.json`
 *      by default), and its `anthropic` entry is reused as-is
 *
 * So once Anthropic is connected to the host, nothing extra is needed here. The
 * store is read read-only and best-effort: a missing or malformed file is simply
 * "no credential", never an error. No credential value is ever logged, copied or
 * written anywhere.
 *
 * ## What this adapter deliberately does NOT read
 *
 * **Claude Code's own credential is not read**, even though Anthropic documents
 * where it lives (macOS Keychain, falling back to `~/.claude/.credentials.json`;
 * that file under Linux and Windows; `CLAUDE_CONFIG_DIR` honoured). The reason is
 * the policy, not the undocumented file format:
 *
 *   "Anthropic does not permit third-party developers to offer Claude.ai login
 *    into their own applications, or to route requests through Free, Pro, or Max
 *    plan credentials on behalf of their users. Moreover, developers may not
 *    collect, store, or intermediate Claude.ai credentials or session tokens."
 *   — code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use
 *
 * The documented path for your *own* headless runs is `claude setup-token`, which
 * yields a one-year token you export as `CLAUDE_CODE_OAUTH_TOKEN`; that is
 * supported here as the last resort. Everything else should be a Console API key
 * or a supported cloud-provider credential.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatFn, ChatMessage } from "../../src/index.ts";

export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** `max_tokens` is required by the API and is deliberately conservative here. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
/** Override the host store path (used by tests). */
export const OPENCODE_AUTH_PATH_ENV = "OPENCODE_AUTH_PATH";

export interface AnthropicConfig {
  /** An API key. Either this or `authToken` is required. */
  apiKey?: string;
  /** A pre-issued token, e.g. an OAuth access token. Wins over `apiKey`. */
  authToken?: string;
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

/** Where a credential came from — never the credential itself. */
export type AnthropicAuthSource = "env" | "opencode-auth" | "claude-code-token" | "none";

export interface AnthropicAuth {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  maxTokens?: number;
  source: AnthropicAuthSource;
}

type Env = Record<string, string | undefined>;

/** The host's credential store. Honours `XDG_DATA_HOME`, like the host does. */
export function opencodeAuthPath(env: Env = process.env as Env): string {
  if (env[OPENCODE_AUTH_PATH_ENV]) return env[OPENCODE_AUTH_PATH_ENV]!;
  const dataHome = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

/**
 * Read one provider's credential from the host store.
 *
 * Best effort by design: the file may be absent, unreadable, or of a shape we do
 * not recognise — all of which mean "no credential" rather than a failure. Only
 * `key` (the shape the host writes for API-key providers) and, for oauth-shaped
 * entries, an `access` token are understood.
 */
export function opencodeCredential(
  providerId = "anthropic",
  options: { authPath?: string; env?: Env } = {},
): { apiKey?: string; authToken?: string } | undefined {
  const path = options.authPath ?? opencodeAuthPath(options.env);
  try {
    const store = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const entry = store?.[providerId];
    if (!entry || typeof entry !== "object") return undefined;

    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" && record.key ? record.key : undefined;
    const access =
      typeof record.access === "string" && record.access
        ? record.access
        : typeof record.access_token === "string" && record.access_token
          ? record.access_token
          : undefined;

    if (record.type === "oauth") return access ? { authToken: access } : undefined;
    if (key) return { apiKey: key };
    return access ? { authToken: access } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a credential: explicit environment first, then the host's store.
 * Returns `source: "none"` rather than throwing when there is nothing to use.
 */
export function resolveAnthropicAuth(
  env: Env = process.env as Env,
  options: { authPath?: string } = {},
): AnthropicAuth {
  const baseUrl = env.ANTHROPIC_BASE_URL || undefined;
  const parsed = Number.parseInt(env.ANTHROPIC_MAX_TOKENS ?? "", 10);
  const maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  const common = { baseUrl, maxTokens };

  // Precedence mirrors the host CLI's own, so a machine configured for either
  // behaves the same here: bearer token, then API key, then stored credentials.
  if (env.ANTHROPIC_AUTH_TOKEN) {
    return { ...common, authToken: env.ANTHROPIC_AUTH_TOKEN, source: "env" };
  }
  if (env.ANTHROPIC_API_KEY) return { ...common, apiKey: env.ANTHROPIC_API_KEY, source: "env" };

  const host = opencodeCredential("anthropic", { authPath: options.authPath, env });
  if (host) return { ...common, ...host, source: "opencode-auth" };

  // `claude setup-token` output: documented for your own scripts, so it comes last —
  // anything designed for programmatic use wins over a subscription token.
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { ...common, authToken: env.CLAUDE_CODE_OAUTH_TOKEN, source: "claude-code-token" };
  }

  return { ...common, source: "none" };
}

/** Wrap the Messages API as a prompt function that `createLlmExecutor` accepts. */
export function createAnthropicChat(
  config: AnthropicConfig,
): (messages: ChatMessage[]) => Promise<string> {
  const credential = config.authToken ?? config.apiKey;
  if (!credential) throw new Error("anthropic adapter needs an apiKey or an authToken");

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
        authorization: `Bearer ${credential}`,
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
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_MAX_TOKENS?: string;
  ANTHROPIC_BASE_URL?: string;
  /** From `claude setup-token`; documented for your own headless runs. */
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  [OPENCODE_AUTH_PATH_ENV]?: string;
  [key: string]: string | undefined;
}

/**
 * Build an Anthropic prompt function from the environment and the host's stored
 * credential, or `undefined` when neither has one.
 */
export function anthropicFromEnv(
  env: AnthropicEnv = process.env as AnthropicEnv,
  options: { authPath?: string } = {},
): ChatFn | undefined {
  const model = env.ANTHROPIC_MODEL;
  if (!model) return undefined;

  const auth = resolveAnthropicAuth(env, options);
  if (!auth.apiKey && !auth.authToken) return undefined;

  return createAnthropicChat({
    apiKey: auth.apiKey,
    authToken: auth.authToken,
    model,
    maxTokens: auth.maxTokens,
    baseUrl: auth.baseUrl,
  });
}
