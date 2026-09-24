/**
 * A runnable LLM-backed example.
 *
 * Proves the whole chain with a real model: `createLlmExecutor` + `StageManager`
 * are the production path. The adapter itself is an OpenAI-compatible chat call
 * over `fetch` — no provider SDK, no dependency — and lives in
 * `examples/providers/openai-compatible.ts`, next to the Anthropic one.
 *
 * Offline-safe by design: with no configuration the example prints how to set it
 * up and exits; the test suite injects a fake `fetch` and never touches a network.
 *
 *   DRAMA_LLM_BASE_URL=https://api.example.com/v1 \
 *   DRAMA_LLM_API_KEY=... \
 *   DRAMA_LLM_MODEL=some-model \
 *   bun run examples/llm/run.ts
 *
 * For Claude, use `examples/providers/anthropic.ts`:
 *
 *   ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-opus-5-5 \
 *   bun run examples/anthropic/run.ts
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
import type { ChatFn, Performance } from "../../src/index.ts";
import { chatFromEnv } from "../providers/openai-compatible.ts";

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
