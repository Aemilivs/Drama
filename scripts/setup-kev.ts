#!/usr/bin/env bun
/**
 * Set up a local Kev server that drama can use as a decision model.
 *
 * Kev (https://github.com/jaredpalmer/kev) is the open-source System One model
 * that speaks the same `POST /v1/systemone` contract as Jev. This command leaves
 * it *drama-compatible*: it installs Kev if it is missing, starts it, verifies a
 * real System One call through drama's own adapter
 * (`examples/providers/kev.ts`), and writes the config that
 * `decisionFromEnv()` reads — so the example then runs with no environment
 * variable set.
 *
 *   bun run setup:kev                 install if missing, start, verify, write config
 *   bun run setup:kev --check         report whether Kev is present/running; change nothing
 *   bun run setup:kev --smoke         verify a running server and rewrite the config
 *   bun run setup:kev --no-serve      install only; print how to start it
 *   bun run setup:kev --foreground    install and serve in this terminal
 *
 * Options:
 *   --dir <path>         checkout directory (default ~/.cache/drama/kev)
 *   --port <n>           server port (default 8009)
 *   --checkpoint <repo>  model to serve (default jaredpalmer/kev-0.8b)
 *   --model <name>       the model name drama sends (default kev-latest)
 *   --base-url <url>     probe an already-running server here
 *   --wait <seconds>     how long to wait for the server to answer (default 90)
 *   -h, --help           this text
 *
 * Needs `git` and `uv` (https://docs.astral.sh/uv/) for the install step; the
 * first start downloads the base model, so a laptop-scale checkpoint is the
 * default. Nothing here touches drama's `src/`.
 */

import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  KEV_DEFAULT_MODEL,
  createKevDecision,
  kevConfigPath,
} from "../examples/providers/kev.ts";

const KEV_REPO = "https://github.com/jaredpalmer/kev.git";
const DEFAULT_CHECKPOINT = "jaredpalmer/kev-0.8b";
const DEFAULT_PORT = 8009;

interface Options {
  check: boolean;
  smoke: boolean;
  serve: boolean;
  foreground: boolean;
  dir: string;
  port: number;
  checkpoint: string;
  model: string;
  baseUrl?: string;
  waitMs: number;
}

const USAGE = `Set up a local Kev server that drama can use as a decision model.

  bun run setup:kev                 install if missing, start, verify, write config
  bun run setup:kev --check         report whether Kev is present/running; change nothing
  bun run setup:kev --smoke         verify a running server and rewrite the config
  bun run setup:kev --no-serve      install only; print how to start it
  bun run setup:kev --foreground    install and serve in this terminal

Options:
  --dir <path>         checkout directory (default ~/.cache/drama/kev)
  --port <n>           server port (default ${DEFAULT_PORT})
  --checkpoint <repo>  model to serve (default ${DEFAULT_CHECKPOINT})
  --model <name>       the model name drama sends (default ${KEV_DEFAULT_MODEL})
  --base-url <url>     probe an already-running server here
  --wait <seconds>     how long to wait for the server to answer (default 90)
  -h, --help           this text`;

function parseArgs(argv: string[]): Options {
  const options: Options = {
    check: false,
    smoke: false,
    serve: true,
    foreground: false,
    dir: process.env.KEV_DIR ?? join(homedir(), ".cache", "drama", "kev"),
    port: Number(process.env.KEV_PORT ?? DEFAULT_PORT),
    checkpoint: process.env.KEV_CHECKPOINT ?? DEFAULT_CHECKPOINT,
    model: process.env.KEV_MODEL ?? KEV_DEFAULT_MODEL,
    baseUrl: process.env.KEV_BASE_URL,
    waitMs: 90_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--smoke") options.smoke = true;
    else if (arg === "--no-serve") options.serve = false;
    else if (arg === "--foreground") options.foreground = true;
    else if (arg === "--dir") options.dir = argv[++index] ?? options.dir;
    else if (arg === "--port") options.port = Number(argv[++index] ?? options.port);
    else if (arg === "--checkpoint") options.checkpoint = argv[++index] ?? options.checkpoint;
    else if (arg === "--model") options.model = argv[++index] ?? options.model;
    else if (arg === "--base-url") options.baseUrl = argv[++index];
    else if (arg === "--wait") options.waitMs = Number(argv[++index] ?? 90) * 1000;
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      console.error(`unknown option: ${arg}\n\n${USAGE}`);
      process.exit(2);
    }
  }
  return options;
}

function serverUrl(options: Options): string {
  return (options.baseUrl ?? `http://127.0.0.1:${options.port}`).replace(/\/+$/, "");
}

function hasCheckout(dir: string): boolean {
  return existsSync(join(dir, "pyproject.toml")) || existsSync(join(dir, ".git"));
}

async function probe(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitFor(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(baseUrl)) return true;
    await Bun.sleep(2000);
  }
  return false;
}

function requireTool(tool: string, hint: string): void {
  if (!Bun.which(tool)) {
    console.error(`${tool} is required but was not found on PATH. ${hint}`);
    process.exit(1);
  }
}

function runSync(cmd: string[], cwd?: string): void {
  const result = Bun.spawnSync({
    cmd,
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (!result.success) {
    console.error(`command failed (${result.exitCode}): ${cmd.join(" ")}`);
    process.exit(result.exitCode ?? 1);
  }
}

function startServer(options: Options, logPath: string): void {
  const fd = openSync(logPath, "a");
  const proc = Bun.spawn(
    [
      "uv",
      "run",
      "--extra",
      "serve",
      "python",
      "-m",
      "kev.serve",
      "--run",
      options.checkpoint,
      "--port",
      String(options.port),
    ],
    { cwd: options.dir, stdin: "ignore", stdout: fd, stderr: fd },
  );
  proc.unref();
}

function writeConfig(options: Options): string {
  const path = kevConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ baseUrl: serverUrl(options), model: options.model }, null, 2)}\n`,
  );
  return path;
}

/** A real System One call, using the exact question shapes drama sends. */
async function smoke(baseUrl: string, model: string): Promise<boolean> {
  const decision = createKevDecision({ baseUrl, model });
  try {
    const answers = await decision({
      state: "The proposal cites a primary source for every factual claim.",
      questions: {
        pass: {
          type: "choice",
          instructions: "Does the artifact meet this criterion?",
          criteria: { pass: "it meets the criterion", fail: "it does not" },
        },
        escalate: { type: "noul", instructions: "Does this need a human?" },
        quality: {
          type: "score",
          instructions: "How good is it?",
          criteria: ["poor", "ok", "good"],
        },
      },
    });
    const choice = answers.pass;
    const ok = choice?.type === "choice" && typeof choice.probabilities.pass === "number";
    console.log(`  choice -> ${choice?.top ?? "?"} (p(pass)=${choice?.probabilities.pass?.toFixed(3) ?? "?"})`);
    console.log(
      `  noul   -> ${answers.escalate?.top ?? "?"} (p(yes)=${answers.escalate?.probabilities.yes?.toFixed(3) ?? "?"})`,
    );
    console.log(`  score  -> ${answers.quality?.top ?? "?"}`);
    return ok;
  } catch (error) {
    console.error(`  smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function verifyAndConfigure(options: Options): Promise<void> {
  const baseUrl = serverUrl(options);
  console.log("Verifying compatibility with drama (System One via examples/providers/kev.ts) …");
  if (!(await smoke(baseUrl, options.model))) {
    console.error(
      "Kev answered but the response did not match the contract drama expects; config not written.",
    );
    process.exit(1);
  }
  const path = writeConfig(options);
  console.log(`\nKev is running and drama-compatible at ${baseUrl}.`);
  console.log(`  config written: ${path}`);
  console.log("  try it:         bun run examples/decision-models/run.ts");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = serverUrl(options);
  const running = await probe(baseUrl);

  if (running) {
    console.log(`Kev is already answering at ${baseUrl}.`);
    if (options.check) return;
    await verifyAndConfigure(options);
    return;
  }

  if (options.check || options.smoke) {
    console.log(`Kev is not answering at ${baseUrl}.`);
    console.log(
      hasCheckout(options.dir)
        ? `A checkout exists at ${options.dir}. Start it with:  bun run setup:kev`
        : `No checkout at ${options.dir}. Install with:  bun run setup:kev`,
    );
    if (options.smoke) process.exit(1);
    return;
  }

  if (!hasCheckout(options.dir)) {
    requireTool("git", `Clone Kev yourself: git clone ${KEV_REPO} ${options.dir}`);
    console.log(`Cloning Kev into ${options.dir} …`);
    runSync(["git", "clone", "--depth", "1", KEV_REPO, options.dir]);
  } else {
    console.log(`Using the existing Kev checkout at ${options.dir}.`);
  }

  requireTool("uv", "Install uv from https://docs.astral.sh/uv/ and re-run.");
  console.log("Syncing Kev's Python environment (uv sync --extra serve) …");
  runSync(["uv", "sync", "--extra", "serve"], options.dir);

  if (!options.serve) {
    console.log(
      `\nInstalled. Start it with:\n  cd ${options.dir} && uv run --extra serve python -m kev.serve --run ${options.checkpoint} --port ${options.port}`,
    );
    return;
  }

  if (options.foreground) {
    console.log(`Serving Kev (${options.checkpoint}) on ${baseUrl} — press Ctrl-C to stop.`);
    runSync(
      [
        "uv",
        "run",
        "--extra",
        "serve",
        "python",
        "-m",
        "kev.serve",
        "--run",
        options.checkpoint,
        "--port",
        String(options.port),
      ],
      options.dir,
    );
    return;
  }

  const logPath = join(options.dir, "serve.log");
  console.log(`Starting Kev in the background (log: ${logPath}) …`);
  startServer(options, logPath);

  if (!(await waitFor(baseUrl, options.waitMs))) {
    console.log(
      `\nKev has not answered yet — the first start downloads the model. Watch ${logPath},`,
    );
    console.log("then re-check with:  bun run setup:kev --smoke");
    return;
  }

  await verifyAndConfigure(options);
}

await main();
