import { describe, expect, test } from "bun:test";
import {
  chatFromEnv,
  createOpenAiCompatibleChat,
  runLlmExample,
} from "../../examples/llm/run.ts";

function fakeFetch(content = "hi") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("LLM adapter requirements", () => {
  test("R-LLM-1 the adapter posts an OpenAI-compatible request and returns the content", async () => {
    const { fetchImpl, calls } = fakeFetch("the answer");
    const chat = createOpenAiCompatibleChat({
      baseUrl: "https://api.example.com/v1/",
      apiKey: "secret",
      model: "some-model",
      fetch: fetchImpl,
    });

    const content = await chat([
      { role: "system", content: "you answer" },
      { role: "user", content: "why?" },
    ]);

    expect(content).toBe("the answer");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0]!.init!.method).toBe("POST");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    const body = JSON.parse(String(calls[0]!.init!.body)) as {
      model: string;
      messages: unknown[];
    };
    expect(body.model).toBe("some-model");
    expect(body.messages).toHaveLength(2);
  });

  test("R-LLM-2 configuration comes from the environment and is optional", () => {
    expect(chatFromEnv({})).toBeUndefined();
    expect(chatFromEnv({ DRAMA_LLM_BASE_URL: "https://x/v1", DRAMA_LLM_MODEL: "m" })).toBeUndefined();
    expect(
      chatFromEnv({
        DRAMA_LLM_BASE_URL: "https://x/v1",
        DRAMA_LLM_API_KEY: "k",
        DRAMA_LLM_MODEL: "m",
      }),
    ).toBeFunction();
  });

  test("R-LLM-3 a model-backed performance runs end to end", async () => {
    const { fetchImpl } = fakeFetch("forty-two");
    const chat = createOpenAiCompatibleChat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      model: "m",
      fetch: fetchImpl,
    });
    const performance = await runLlmExample(chat);
    expect(performance.finalResult.status).toBe("done");
    expect(performance.finalResult.artifacts[0]!.kind).toBe("Answer");
    expect(performance.finalResult.artifacts[0]!.content).toBe("forty-two");
  });

  test("R-LLM-4 a failing endpoint surfaces as an error, not a silent answer", async () => {
    const failing = (async () =>
      new Response("nope", { status: 500, statusText: "Server Error" })) as unknown as typeof fetch;
    const chat = createOpenAiCompatibleChat({
      baseUrl: "https://api.example.com/v1",
      apiKey: "k",
      model: "m",
      fetch: failing,
    });
    await expect(chat([{ role: "user", content: "x" }])).rejects.toThrow("chat request failed: 500");
  });
});
