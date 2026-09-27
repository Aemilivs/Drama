#!/usr/bin/env bun
/**
 * Verify an engine recipe against the real package — on demand, never in CI.
 *
 * `docs/engines.md` documents how to wrap an agent engine as a drama actor, but
 * nothing in `bun test` imports an engine package, so those recipes can rot
 * silently. This script is the check for the LangGraph recipe (section 1):
 *
 *   bun run verify:engines            install if needed, then check
 *   bun run verify:engines --fresh    re-install from scratch
 *   bun run verify:engines --dir      print the cache directory and exit
 *
 * It is a **docs-integrity checker, not a support commitment and not an
 * adapter**. It adds no dependency to `package.json` or `tsconfig.json`, and it
 * imports the engine packages dynamically from an out-of-repo cache dir
 * (`~/.cache/drama/verify-engines`, override with `DRAMA_VERIFY_ENGINES_DIR`),
 * so `tsc --noEmit` stays green and nothing here is reachable from `bun test`.
 * Delete the cache dir whenever it rots.
 *
 * Scope: LangGraph only. The other four recipes in `docs/engines.md` are not
 * checked this way yet.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createActor,
  createEngineExecutor,
  createToolRegistry,
  sceneFromCard,
} from "../src/index.ts";
import type { ActorContext, ActorExecutor } from "../src/index.ts";

/** The versions `docs/engines.md` section 1 is date-stamped against. */
const PINS: Record<string, string> = {
  "@langchain/core": "1.2.13",
  "@langchain/langgraph": "1.4.18",
  langchain: "1.5.14",
  zod: "4.6.5",
};

const CACHE_DIR =
  process.env.DRAMA_VERIFY_ENGINES_DIR ??
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "drama", "verify-engines");

/**
 * A re-export shim written into the cache dir, so a dynamic `import()` resolves
 * the engine packages from *there* — never from this repository.
 */
const SHIM = `export * as langchain from "langchain";
export * as langgraph from "@langchain/langgraph";
export * as testing from "@langchain/core/utils/testing";
export * as zod from "zod";
`;

/**
 * The engine boundary is deliberately untyped: the packages live outside this
 * repository, and requiring types for them is exactly what the check must not do.
 */
type Loose = Record<string, any>;

const problems: string[] = [];

function ok(label: string): void {
  console.log(`  ok    ${label}`);
}

function bad(label: string, detail: string): void {
  problems.push(`${label} — ${detail}`);
  console.log(`  FAIL  ${label} — ${detail}`);
}

function warn(label: string): void {
  console.log(`  warn  ${label}`);
}

function packageJson(): string {
  return `${JSON.stringify(
    { name: "drama-verify-engines", private: true, type: "module", dependencies: PINS },
    null,
    2,
  )}\n`;
}

/** Install the pins, but only when the cache dir is missing or out of date. */
function ensureInstalled(fresh: boolean): boolean {
  const path = join(CACHE_DIR, "package.json");
  const desired = packageJson();
  const installed = existsSync(join(CACHE_DIR, "node_modules"));
  const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (!fresh && installed && current === desired) {
    console.log(`cache: ${CACHE_DIR} (already installed)`);
    return true;
  }

  console.log(`cache: ${CACHE_DIR}`);
  console.log(`installing ${Object.entries(PINS).map(([name, version]) => `${name}@${version}`).join(", ")} …`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(path, desired);
  const result = Bun.spawnSync(["bun", "install"], {
    cwd: CACHE_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (!result.success) {
    console.error(
      `\nFAIL — \`bun install\` exited ${result.exitCode} in ${CACHE_DIR}. ` +
        "Check your network (or run the install by hand), then re-run.",
    );
    return false;
  }
  return true;
}

/** Report when a pin is behind npm `latest`; a warning, never a failure. */
async function reportVersionDrift(): Promise<void> {
  for (const [name, pin] of Object.entries(PINS)) {
    try {
      const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { version?: string };
      if (body.version && body.version !== pin) {
        warn(`${name} ${pin} is behind latest ${body.version} — re-check, then bump the pin`);
      }
    } catch {
      // The registry is unreachable; the drift check is best-effort.
    }
  }
}

/** A minimal context, so the executor is called the way the stage calls it. */
function contextFor(executor: ActorExecutor): ActorContext {
  const scene = sceneFromCard({
    objective: "verify the LangGraph recipe",
    success_criteria: ["a report exists"],
    required_capabilities: ["migration_review"],
  });
  const actor = createActor({
    name: "analyst",
    role: "migration analyst",
    objective: "Assess the migration",
    capabilities: ["migration_review"],
    expectedOutput: ["RiskReport"],
    executor,
  });
  return {
    scene,
    actor,
    instruction: "assess",
    inputs: [],
    history: [],
    tools: createToolRegistry(),
    iteration: 1,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "bun run verify:engines [--fresh] [--dir]\n\n" +
        "  --fresh  re-install the pinned engine packages\n" +
        "  --dir    print the cache directory and exit",
    );
    return;
  }
  if (argv.includes("--dir")) {
    console.log(CACHE_DIR);
    return;
  }

  console.log("verify:engines — LangGraph (docs/engines.md section 1)\n");
  if (!ensureInstalled(argv.includes("--fresh"))) {
    process.exit(1);
  }

  // The shim is rewritten every run so it cannot drift from PINS.
  writeFileSync(join(CACHE_DIR, "probe.mjs"), SHIM);
  const probe = (await import(pathToFileURL(join(CACHE_DIR, "probe.mjs")).href)) as Loose;
  const langchain = (probe.langchain ?? {}) as Loose;
  const langgraph = (probe.langgraph ?? {}) as Loose;
  const testing = (probe.testing ?? {}) as Loose;
  const zod = (probe.zod ?? {}).z as Loose | undefined;

  // 1. The recipe's import claim: createAgent lives in `langchain`, not the graph package.
  if (typeof langchain.createAgent !== "function") {
    bad("langchain exports createAgent", `got ${typeof langchain.createAgent}`);
  } else {
    ok("langchain exports createAgent");
  }

  // 2. The graph exports the recipe builds on.
  const missing = ["StateGraph", "START", "END"].filter((name) => !langgraph[name]);
  if (missing.length > 0) {
    bad("@langchain/langgraph exports StateGraph, START, END", `missing ${missing.join(", ")}`);
  } else {
    ok("@langchain/langgraph exports StateGraph, START, END");
  }

  // 3. `createAgent` is constructible the way the recipe shows it, with a model instance.
  const FakeListChatModel = testing.FakeListChatModel as (new (options: Loose) => Loose) | undefined;
  if (typeof FakeListChatModel !== "function") {
    bad("@langchain/core/utils/testing exports FakeListChatModel", "not a constructor");
  } else if (problems.length === 0) {
    try {
      const model = new FakeListChatModel({ responses: ["not json at all"] });
      const agent = langchain.createAgent({
        model,
        tools: [],
        responseFormat: zod?.object?.({ risks: zod.array(zod.string()) }),
      }) as Loose;
      if (typeof agent?.invoke === "function") {
        ok("createAgent accepts { model, tools, responseFormat } and is invokable");
      } else {
        bad("createAgent is invokable", "invoke is not a function");
      }
    } catch (error) {
      bad("createAgent accepts { model, tools, responseFormat }", String(error));
    }
  }

  if (problems.length > 0) {
    await reportVersionDrift();
    console.error(`\nFAIL — ${problems.length} check(s) failed against the pinned LangGraph versions.`);
    process.exit(1);
  }

  /** A real graph, one node, a fake chat model — no API key, no provider. */
  function graphWith(responses: string[]): Loose {
    const model = new FakeListChatModel!({ responses });
    const state = langgraph.Annotation.Root({
      prompt: langgraph.Annotation(),
      report: langgraph.Annotation(),
    });
    return new langgraph.StateGraph(state)
      .addNode("answer", async (input: Loose) => {
        const message = (await model.invoke(String(input?.prompt ?? ""))) as Loose;
        const text = typeof message?.text === "string" ? message.text : "";
        let report: unknown;
        try {
          report = text ? JSON.parse(text) : undefined;
        } catch {
          report = undefined;
        }
        return { report };
      })
      .addEdge(langgraph.START, "answer")
      .addEdge("answer", langgraph.END)
      .compile();
  }

  // 4. The graph itself executes.
  try {
    const result = (await graphWith([
      '{"risks":["backfill on a live table"],"mitigation":"batch it"}',
    ]).invoke({ prompt: "assess the migration" })) as Loose;
    if (result?.report?.risks?.length) {
      ok("a StateGraph runs under a fake chat model (no API key)");
    } else {
      bad("a StateGraph runs under a fake chat model", `unexpected state ${JSON.stringify(result)}`);
    }
  } catch (error) {
    bad("a StateGraph runs under a fake chat model", String(error));
  }

  /** The documented recipe shape: the graph is called inside `invoke`. */
  function executorFor(responses: string[]): ActorExecutor {
    return createEngineExecutor({
      producer: "langgraph",
      invoke: async ({ prompt }) => {
        const result = (await graphWith(responses).invoke({ prompt })) as Loose;
        const report = result?.report;
        if (!report) return { artifacts: [] };
        return { artifacts: [{ kind: "RiskReport", content: report }] };
      },
    });
  }

  // 5. The extraction, through drama's own seam.
  const executor = executorFor([
    '{"risks":["backfill on a live table"],"mitigation":"batch it"}',
  ]);
  const mapped = await executor(contextFor(executor));
  const artifact = mapped.artifacts[0];
  if (
    mapped.status === "ok" &&
    artifact?.kind === "RiskReport" &&
    artifact?.producedBy === "langgraph" &&
    (artifact?.content as Loose)?.mitigation === "batch it"
  ) {
    ok("createEngineExecutor maps the graph output to a RiskReport artifact");
  } else {
    bad(
      "createEngineExecutor maps the graph output to a RiskReport artifact",
      `status ${mapped.status}, artifacts ${JSON.stringify(mapped.artifacts)}`,
    );
  }

  // 6. The guard the recipe documents: an answer that is not a report must not ship.
  const guardedExecutor = executorFor(["just prose, not a report"]);
  const guarded = await guardedExecutor(contextFor(guardedExecutor));
  if (guarded.status === "failed" && guarded.error?.includes("no usable artifacts")) {
    ok("an engine with no usable answer fails the turn instead of shipping an empty artifact");
  } else {
    bad(
      "an engine with no usable answer fails the turn",
      `status ${guarded.status}, error ${guarded.error ?? "none"}`,
    );
  }

  await reportVersionDrift();

  if (problems.length > 0) {
    console.error(`\nFAIL — ${problems.length} check(s) failed against the pinned LangGraph versions.`);
    process.exit(1);
  }
  console.log(
    `\nPASS — the LangGraph recipe matches ${Object.entries(PINS)
      .map(([name, version]) => `${name}@${version}`)
      .join(", ")}`,
  );
}

await main();
