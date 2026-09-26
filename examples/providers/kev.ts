/**
 * Kev adapter: a `DecisionFn` over the System One API (`POST /v1/systemone`).
 *
 * Kev is the open-source System One decision model the docs point at
 * (https://github.com/jaredpalmer/kev). It answers typed questions with
 * calibrated probabilities and no generated text, so a criterion check reads
 * `probabilities.pass` and `calibratedEvaluator` thresholds it.
 *
 * Zero dependencies, like the other adapters here: plain `fetch`, and the
 * contract below is the wire format Kev and Jev share.
 *
 * Offline-safe: `decisionFromEnv()` returns `undefined` when Kev is not
 * configured, so a caller keeps its own stub. One command wires it up:
 *
 *   bun run setup:kev
 *   bun run examples/decision-models/run.ts
 *
 * `setup:kev` installs and starts Kev, smoke-tests it through this adapter, and
 * writes the config below — so no environment variable is needed afterwards.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The System One question contract, shared by Kev and Jev. */
export type DecisionQuestion =
  | { type: "noul"; instructions?: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions?: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions?: string; criteria: string[] };

/** A normalised answer: a calibrated distribution, whatever the question type. */
export interface DecisionAnswer {
  type: "noul" | "choice" | "score";
  /** Probability per option (`choice`), yes/no (`noul`), or level (`score`). */
  probabilities: Record<string, number>;
  confidence: number;
  /** The winning option, `"yes"`, or the mean level as a string. */
  top?: string;
}

export type DecisionFn = (input: {
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, DecisionQuestion>;
}) => Promise<Record<string, DecisionAnswer>>;

export const KEV_DEFAULT_BASE_URL = "http://127.0.0.1:8009";
export const KEV_DEFAULT_MODEL = "kev-latest";

export interface KevDecisionOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

interface SystemOneWireAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

function winner(probabilities: Record<string, number>): string | undefined {
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Collapse the per-type wire answer into one distribution shape. */
function normalize(answer: SystemOneWireAnswer): DecisionAnswer | undefined {
  if (!answer || typeof answer !== "object") return undefined;
  const probabilities = answer.probabilities ?? {};
  if (answer.type === "noul") {
    const yes = typeof answer.noul === "number" ? answer.noul : 0;
    return {
      type: "noul",
      probabilities: { yes, no: 1 - yes },
      confidence: Math.max(yes, 1 - yes),
      top: yes >= 0.5 ? "yes" : "no",
    };
  }
  if (answer.type === "choice") {
    return {
      type: "choice",
      probabilities,
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      top: answer.choice ?? winner(probabilities),
    };
  }
  if (answer.type === "score") {
    return {
      type: "score",
      probabilities,
      confidence: typeof answer.confidence === "number" ? answer.confidence : 0,
      top: typeof answer.score === "number" ? String(answer.score) : undefined,
    };
  }
  return undefined;
}

export function createKevDecision(options: KevDecisionOptions = {}): DecisionFn {
  const baseUrl = (options.baseUrl ?? KEV_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = options.model ?? KEV_DEFAULT_MODEL;
  const doFetch = options.fetch ?? fetch;
  return async ({ state, questions }) => {
    const response = await doFetch(`${baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({ state, model, questions }),
    });
    if (!response.ok) {
      throw new Error(`Kev ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as { answers?: Record<string, SystemOneWireAnswer> };
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, raw] of Object.entries(body.answers ?? {})) {
      const answer = normalize(raw);
      if (answer) answers[id] = answer;
    }
    return answers;
  };
}

/**
 * The config `bun run setup:kev` writes (default `~/.cache/drama/kev.json`), so
 * a running Kev is picked up with no environment variable.
 */
export const KEV_CONFIG_PATH_ENV = "KEV_CONFIG_PATH";

export function kevConfigPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env[KEV_CONFIG_PATH_ENV];
  if (explicit) return explicit;
  const cache = env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(cache, "drama", "kev.json");
}

export interface KevConfig {
  baseUrl?: string;
  model?: string;
}

/** Best-effort read; a missing or malformed config is simply "not configured". */
export function readKevConfig(path: string = kevConfigPath()): KevConfig | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = parsed as Record<string, unknown>;
      return {
        baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : undefined,
        model: typeof value.model === "string" ? value.model : undefined,
      };
    }
  } catch {
    // no config
  }
  return undefined;
}

/**
 * The Kev adapter when `KEV_BASE_URL` is set, then the setup config, else
 * `undefined` — so drama stays offline-safe and silent until Kev is installed.
 */
export function decisionFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: { configPath?: string } = {},
): DecisionFn | undefined {
  const config = readKevConfig(options.configPath ?? kevConfigPath(env));
  const baseUrl = env.KEV_BASE_URL ?? config?.baseUrl;
  if (!baseUrl) return undefined;
  return createKevDecision({
    baseUrl,
    model: env.KEV_MODEL ?? config?.model ?? KEV_DEFAULT_MODEL,
    apiKey: env.KEV_API_KEY,
  });
}
