/**
 * The same production as `examples/llm/run.ts`, with Claude as the model.
 *
 *   ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-opus-5-5 \
 *   bun run examples/anthropic/run.ts
 *
 * Optional: `ANTHROPIC_MAX_TOKENS` (the API requires `max_tokens`; the adapter
 * defaults it) and `ANTHROPIC_BASE_URL` for a proxy or gateway.
 *
 * Offline-safe: with no key it prints how to set it up and exits.
 */

import { formatPerformance } from "../../src/index.ts";
import { runLlmExample } from "../llm/run.ts";
import { anthropicFromEnv } from "../providers/anthropic.ts";

if ((import.meta as { main?: boolean }).main) {
  const chat = anthropicFromEnv();
  if (!chat) {
    console.log("Set ANTHROPIC_API_KEY and ANTHROPIC_MODEL to run this example.");
  } else {
    const performance = await runLlmExample(chat);
    console.log(formatPerformance(performance));
    console.log("\nanswer:", performance.finalResult.artifacts[0]?.content);
  }
}
