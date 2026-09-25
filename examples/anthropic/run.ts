/**
 * The same production as `examples/llm/run.ts`, with Claude as the model.
 *
 * Credentials are **reused, not demanded**: the adapter takes `ANTHROPIC_API_KEY`
 * or `ANTHROPIC_AUTH_TOKEN` if you set one, and otherwise reads the host's own
 * store — the credential `opencode auth login` writes for the `anthropic`
 * provider. Connecting Anthropic to the host once is enough.
 *
 *   ANTHROPIC_MODEL=claude-opus-5-5 bun run examples/anthropic/run.ts
 *
 * Optional: `ANTHROPIC_MAX_TOKENS`, `ANTHROPIC_BASE_URL`.
 * Offline-safe: with no credential it says where to look and exits.
 */

import { formatPerformance } from "../../src/index.ts";
import { runLlmExample } from "../llm/run.ts";
import { anthropicFromEnv, resolveAnthropicAuth } from "../providers/anthropic.ts";

if ((import.meta as { main?: boolean }).main) {
  const auth = resolveAnthropicAuth();
  const chat = anthropicFromEnv();

  if (auth.source === "none") {
    console.log("No Anthropic credential found.");
    console.log("Either set ANTHROPIC_API_KEY, or connect the host once:");
    console.log("  opencode auth login    # choose Anthropic — drama reuses that credential");
  } else if (!chat) {
    console.log(`Anthropic credential found (${auth.source}), but ANTHROPIC_MODEL is not set.`);
  } else {
    console.log(`credential: ${auth.source} · model: ${process.env.ANTHROPIC_MODEL}`);
    const performance = await runLlmExample(chat);
    console.log(formatPerformance(performance));
    console.log("\nanswer:", performance.finalResult.artifacts[0]?.content);
  }
}
