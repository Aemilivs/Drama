import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  Evaluator,
  StageManager,
  calibratedEvaluator,
  createActor,
  createCast,
  createLlmExecutor,
  createProtocol,
  criterionEvaluator,
  deriveMinimalCast,
  sceneFromCard,
} from "../../src/index.ts";
import {
  KEV_DEFAULT_BASE_URL,
  createKevDecision,
  decisionFromEnv,
  readKevConfig,
} from "../../examples/providers/kev.ts";
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

  test("R-ANTHROPIC-10 the Claude Code token is the last resort, never the first", () => {
    const store = writeAuth({ anthropic: { type: "api", key: "host-key" } });
    const model = { ANTHROPIC_MODEL: "m" };

    // `claude setup-token` output is accepted, and reported as its own source.
    const token = resolveAnthropicAuth(
      { ...model, CLAUDE_CODE_OAUTH_TOKEN: "oauth-1y" },
      { authPath: NO_STORE },
    );
    expect(token.source).toBe("claude-code-token");
    expect(token.authToken).toBe("oauth-1y");
    expect(
      anthropicFromEnv({ ...model, CLAUDE_CODE_OAUTH_TOKEN: "oauth-1y" }, { authPath: NO_STORE }),
    ).toBeFunction();

    // A bearer token beats an API key, matching the host CLI's own precedence.
    const both = resolveAnthropicAuth(
      { ...model, ANTHROPIC_AUTH_TOKEN: "bearer", ANTHROPIC_API_KEY: "key" },
      { authPath: NO_STORE },
    );
    expect(both.authToken).toBe("bearer");
    expect(both.apiKey).toBeUndefined();

    // Anything designed for programmatic use wins over a subscription token.
    const overKey = resolveAnthropicAuth(
      { ...model, CLAUDE_CODE_OAUTH_TOKEN: "oauth-1y", ANTHROPIC_API_KEY: "key" },
      { authPath: NO_STORE },
    );
    expect(overKey.source).toBe("env");
    expect(overKey.apiKey).toBe("key");

    const overStore = resolveAnthropicAuth(
      { ...model, CLAUDE_CODE_OAUTH_TOKEN: "oauth-1y" },
      { authPath: store },
    );
    expect(overStore.source).toBe("opencode-auth");
    expect(overStore.apiKey).toBe("host-key");
  });
});


interface FakeKevOptions {
  status?: number;
  body?: unknown;
}

function fakeKev(options: FakeKevOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (options.status && options.status >= 400) {
      return new Response(JSON.stringify(options.body ?? { detail: "bad request" }), {
        status: options.status,
        headers: { "content-type": "application/json" },
      });
    }
    // A real server answers whatever question ids the request carries.
    const request = JSON.parse(String(init?.body ?? "{}")) as {
      questions?: Record<string, { type?: string }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [id, question] of Object.entries(request.questions ?? {})) {
      if (question.type === "noul") {
        answers[id] = { type: "noul", noul: 0.93 };
      } else if (question.type === "score") {
        answers[id] = {
          type: "score",
          score: 1.44,
          confidence: 0.34,
          probabilities: { "0": 0, "1": 0.56, "2": 0.44 },
        };
      } else {
        answers[id] = {
          type: "choice",
          choice: "pass",
          confidence: 0.2,
          probabilities: { pass: 0.9, fail: 0.1 },
        };
      }
    }
    return new Response(
      JSON.stringify({
        model: "kev-latest",
        answers,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A path that never exists, so a test cannot read a real Kev config. */
const NO_KEV_CONFIG = join(tmpdir(), "drama-no-such-kev-config.json");

describe("Kev adapter requirements", () => {
  test("R-KEV-1 the request is a System One call, and a choice answer normalises", async () => {
    const { fetchImpl, calls } = fakeKev();
    const decision = createKevDecision({
      baseUrl: "http://127.0.0.1:8009/",
      model: "kev-latest",
      fetch: fetchImpl,
    });

    const answers = await decision({
      state: "the proposal",
      questions: { q: { type: "choice", instructions: "?", criteria: { pass: "ok", fail: "no" } } },
    });

    expect(calls[0]!.url).toBe(`${KEV_DEFAULT_BASE_URL}/v1/systemone`);
    expect(calls[0]!.init!.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init!.body)) as Record<string, unknown>;
    expect(body.state).toBe("the proposal");
    expect(body.model).toBe("kev-latest");
    expect(answers.q).toEqual({
      type: "choice",
      probabilities: { pass: 0.9, fail: 0.1 },
      confidence: 0.2,
      top: "pass",
    });
  });

  test("R-KEV-2 noul and score answers normalise, and a non-2xx throws", async () => {
    const { fetchImpl } = fakeKev();
    const answers = await createKevDecision({
      baseUrl: KEV_DEFAULT_BASE_URL,
      fetch: fetchImpl,
    })({
      state: "s",
      questions: { escalate: { type: "noul" }, quality: { type: "score", criteria: ["a", "b", "c"] } },
    });
    expect(answers.escalate!.probabilities.yes).toBe(0.93);
    expect(answers.escalate!.top).toBe("yes");
    expect(answers.quality!.top).toBe("1.44");

    const failing = fakeKev({ status: 422, body: { detail: "bad question" } });
    await expect(
      createKevDecision({ baseUrl: KEV_DEFAULT_BASE_URL, fetch: failing.fetchImpl })({
        state: "s",
        questions: {},
      }),
    ).rejects.toThrow("Kev 422");
  });

  test("R-KEV-3 decisionFromEnv needs a base URL, and a Kev answer becomes a drama Status", async () => {
    expect(decisionFromEnv({}, { configPath: NO_KEV_CONFIG })).toBeUndefined();
    expect(decisionFromEnv({ KEV_BASE_URL: "http://127.0.0.1:8009" }, { configPath: NO_KEV_CONFIG }))
      .toBeFunction();

    // The setup command's config is read, and junk is simply "not configured".
    const dir = mkdtempSync(join(tmpdir(), "drama-kev-"));
    const configPath = join(dir, "kev.json");
    writeFileSync(configPath, JSON.stringify({ baseUrl: KEV_DEFAULT_BASE_URL, model: "kev-latest" }));
    expect(readKevConfig(configPath)?.baseUrl).toBe(KEV_DEFAULT_BASE_URL);
    expect(decisionFromEnv({}, { configPath })).toBeFunction();
    writeFileSync(configPath, "not json");
    expect(readKevConfig(configPath)).toBeUndefined();

    // The point of the adapter: a Kev probability drives the library's Status.
    const { fetchImpl } = fakeKev();
    const decision = createKevDecision({ baseUrl: KEV_DEFAULT_BASE_URL, fetch: fetchImpl });
    const scene = sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["a"],
    });
    const criterion = scene.successCriteria[0]!;
    const evaluator = new Evaluator(
      calibratedEvaluator([
        {
          criterion,
          check: async () => {
            const answers = await decision({
              state: "the artifact",
              questions: {
                [criterion.id]: {
                  type: "choice",
                  instructions: "?",
                  criteria: { pass: "ok", fail: "no" },
                },
              },
            });
            const answer = answers[criterion.id]!;
            return { probability: answer.probabilities.pass ?? 0, evidence: `kev ${answer.top}` };
          },
        },
      ]),
    );
    const evaluation = await evaluator.evaluate({
      scene,
      cast: deriveMinimalCast(scene),
      artifacts: [],
      failures: [],
      iteration: 1,
    });
    expect(evaluation.status).toBe("pass");
  });
});
