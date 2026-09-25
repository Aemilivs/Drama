import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  createActor,
  createCast,
  createLlmExecutor,
  createProtocol,
  criterionEvaluator,
  sceneFromCard,
} from "../../src/index.ts";
import {
  ANTHROPIC_BASE_URL,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_VERSION,
  OPENCODE_AUTH_PATH_ENV,
  anthropicFromEnv,
  createAnthropicChat,
  opencodeAuthPath,
  opencodeCredential,
  resolveAnthropicAuth,
} from "../../examples/providers/anthropic.ts";

interface FakeOptions {
  status?: number;
  body?: unknown;
  content?: unknown[];
}

function fakeAnthropic(options: FakeOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (options.status && options.status >= 400) {
      return new Response(
        JSON.stringify(
          options.body ?? {
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
            request_id: "req_1",
          },
        ),
        { status: options.status, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: options.content ?? [
          { type: "thinking", thinking: "weighing the options" },
          { type: "text", text: "hello" },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function writeRaw(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "drama-auth-"));
  const path = join(dir, "auth.json");
  writeFileSync(path, contents);
  return path;
}

function writeAuth(store: unknown): string {
  return writeRaw(JSON.stringify(store));
}

/** A path that never exists, so a test cannot accidentally read the real store. */
const NO_STORE = join(tmpdir(), "drama-no-such-auth-store.json");

const messages = [
  { role: "system" as const, content: "You are terse." },
  { role: "user" as const, content: "hi" },
];

describe("Anthropic adapter requirements", () => {
  test("R-ANTHROPIC-1 the request is a Messages call, with the system prompt lifted out", async () => {
    const { fetchImpl, calls } = fakeAnthropic();
    const chat = createAnthropicChat({
      apiKey: "test-key",
      model: "claude-opus-5-5",
      fetch: fetchImpl,
    });

    expect(await chat(messages)).toBe("hello");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ANTHROPIC_BASE_URL}/v1/messages`);
    expect(calls[0]!.init!.method).toBe("POST");

    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(headers.authorization).toBe("Bearer test-key");
    expect(headers["content-type"]).toBe("application/json");

    const body = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
    // Claude has no "system" role inside `messages`.
    expect(body.system).toBe("You are terse.");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("R-ANTHROPIC-2 only text blocks become the answer", async () => {
    const { fetchImpl } = fakeAnthropic({
      content: [
        { type: "thinking", thinking: "secret reasoning" },
        { type: "text", text: "part one " },
        { type: "text", text: "part two" },
      ],
    });
    const chat = createAnthropicChat({ apiKey: "k", model: "m", fetch: fetchImpl });
    expect(await chat(messages)).toBe("part one part two");

    const empty = fakeAnthropic({ content: [{ type: "thinking", thinking: "only thinking" }] });
    const chat2 = createAnthropicChat({ apiKey: "k", model: "m", fetch: empty.fetchImpl });
    await expect(chat2(messages)).rejects.toThrow("no text content");
  });

  test("R-ANTHROPIC-3 a non-2xx surfaces the documented error shape", async () => {
    const { fetchImpl } = fakeAnthropic({ status: 401 });
    const chat = createAnthropicChat({ apiKey: "bad", model: "m", fetch: fetchImpl });
    await expect(chat(messages)).rejects.toThrow("authentication_error: invalid x-api-key");
  });

  test("R-ANTHROPIC-4 max_tokens is configurable, and the environment needs a key and a model", async () => {
    expect(anthropicFromEnv({}, { authPath: NO_STORE })).toBeUndefined();
    expect(anthropicFromEnv({ ANTHROPIC_API_KEY: "k" }, { authPath: NO_STORE })).toBeUndefined();
    expect(anthropicFromEnv({ ANTHROPIC_MODEL: "m" }, { authPath: NO_STORE })).toBeUndefined();
    expect(
      typeof anthropicFromEnv(
        { ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" },
        { authPath: NO_STORE },
      ),
    ).toBe("function");

    // The API requires `max_tokens`; the caller can raise the default.
    const { fetchImpl, calls } = fakeAnthropic();
    const chat = createAnthropicChat({ apiKey: "k", model: "m", maxTokens: 123, fetch: fetchImpl });
    await chat(messages);
    const body = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(123);
  });

  test("R-ANTHROPIC-5 a Claude-backed actor drives a real performance", async () => {
    const { fetchImpl } = fakeAnthropic({ content: [{ type: "text", text: "42" }] });
    const chat = createAnthropicChat({ apiKey: "k", model: "claude-opus-5-5", fetch: fetchImpl });

    const scene = sceneFromCard({
      objective: "Answer.",
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
      createProtocol([{ actor: "answerer", instruction: "Answer.", produces: ["Answer"] }]),
    );
    const evaluator = new Evaluator(
      criterionEvaluator([
        {
          criterion: scene.successCriteria[0]!,
          check: (ctx) =>
            ctx.artifacts.some((item) => item.kind === "Answer")
              ? { status: "pass", evidence: "answer present" }
              : { status: "fail", evidence: "no answer" },
        },
      ]),
    );

    const performance = await new StageManager({ evaluator }).perform(scene, cast);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.artifacts[0]!.content).toBe("42");
  });

  test("R-ANTHROPIC-6 the host's stored credential is reused when no key is set", async () => {
    const authPath = writeAuth({ anthropic: { type: "api", key: "host-key" } });
    const env = { ANTHROPIC_MODEL: "claude-opus-5-5" };

    const auth = resolveAnthropicAuth(env, { authPath });
    expect(auth.source).toBe("opencode-auth");
    expect(auth.apiKey).toBe("host-key");
    expect(typeof anthropicFromEnv(env, { authPath })).toBe("function");

    // ...and the resolved credential is what authenticates the request.
    const { fetchImpl, calls } = fakeAnthropic();
    const chat = createAnthropicChat({
      apiKey: auth.apiKey,
      model: "claude-opus-5-5",
      fetch: fetchImpl,
    });
    await chat(messages);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer host-key");
  });

  test("R-ANTHROPIC-7 an explicit environment credential wins over the store", () => {
    const authPath = writeAuth({ anthropic: { type: "api", key: "host-key" } });

    const key = resolveAnthropicAuth(
      { ANTHROPIC_API_KEY: "env-key", ANTHROPIC_MODEL: "m" },
      { authPath },
    );
    expect(key.source).toBe("env");
    expect(key.apiKey).toBe("env-key");

    const token = resolveAnthropicAuth(
      { ANTHROPIC_AUTH_TOKEN: "env-token", ANTHROPIC_MODEL: "m" },
      { authPath },
    );
    expect(token.source).toBe("env");
    expect(token.authToken).toBe("env-token");
  });

  test("R-ANTHROPIC-8 a missing or malformed store means no credential, never an error", () => {
    const env = { ANTHROPIC_MODEL: "m" };

    expect(resolveAnthropicAuth(env, { authPath: NO_STORE }).source).toBe("none");
    expect(anthropicFromEnv(env, { authPath: NO_STORE })).toBeUndefined();

    const broken = writeRaw("this is not json");
    expect(opencodeCredential("anthropic", { authPath: broken })).toBeUndefined();
    expect(resolveAnthropicAuth(env, { authPath: broken }).source).toBe("none");

    expect(resolveAnthropicAuth(env, { authPath: writeAuth({}) }).source).toBe("none");
    expect(
      resolveAnthropicAuth(env, { authPath: writeAuth({ anthropic: "just-a-string" }) }).source,
    ).toBe("none");
  });

  test("R-ANTHROPIC-9 an oauth entry uses its access token, and the store path is overridable", () => {
    const oauth = resolveAnthropicAuth(
      { ANTHROPIC_MODEL: "m" },
      { authPath: writeAuth({ anthropic: { type: "oauth", access: "oauth-token" } }) },
    );
    expect(oauth.source).toBe("opencode-auth");
    expect(oauth.authToken).toBe("oauth-token");
    expect(oauth.apiKey).toBeUndefined();

    // `type: "oauth"` without a token is not a credential.
    const hollow = writeAuth({ anthropic: { type: "oauth" } });
    expect(resolveAnthropicAuth({ ANTHROPIC_MODEL: "m" }, { authPath: hollow }).source).toBe("none");

    // The host's location is XDG-aware and explicitly overridable.
    expect(opencodeAuthPath({ XDG_DATA_HOME: "/tmp/xdg" })).toBe("/tmp/xdg/opencode/auth.json");
    expect(opencodeAuthPath({ [OPENCODE_AUTH_PATH_ENV]: "/tmp/custom.json" })).toBe(
      "/tmp/custom.json",
    );

    // Another provider's credential is not this provider's credential.
    const other = writeAuth({ openai: { type: "api", key: "openai-key" } });
    expect(opencodeCredential("anthropic", { authPath: other })).toBeUndefined();
  });
});
