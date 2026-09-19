/**
 * Store and reload a `Performance` as JSON.
 *
 * A performance is pure data — scenes, casts, artifacts, evaluations, events —
 * so it round-trips exactly, with one deliberate exception: `Actor.executor` is
 * a function and cannot be serialised. Re-attach executors on load by passing a
 * registry keyed by actor name.
 *
 * The machinery that produced the trace is not part of a `Performance` either:
 * the evaluator, the casting director and the auditioner all live on the
 * `StageManager`. Reloading a trace is therefore always paired with re-supplying
 * that machinery — which is what makes a replay honest rather than magical.
 */

import type { ActorExecutor } from "./actor";
import type { Cast } from "./cast";
import type { Performance } from "./stage";

export const PERFORMANCE_FORMAT = "drama.performance";
export const PERFORMANCE_FORMAT_VERSION = 1;

export interface PerformanceDocument {
  format: typeof PERFORMANCE_FORMAT;
  formatVersion: number;
  performance: Performance;
}

export interface DeserializeOptions {
  /** Executors to re-attach, keyed by actor name. */
  executors?: Record<string, ActorExecutor>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Serialise a performance to a versioned JSON document. */
export function serializePerformance(
  performance: Performance,
  options: { pretty?: boolean } = {},
): string {
  const document: PerformanceDocument = {
    format: PERFORMANCE_FORMAT,
    formatVersion: PERFORMANCE_FORMAT_VERSION,
    performance,
  };
  // JSON.stringify already drops functions; the replacer makes that explicit.
  return JSON.stringify(
    document,
    (_key, value) => (typeof value === "function" ? undefined : value),
    options.pretty ? 2 : undefined,
  );
}

/** Reload a performance from already-parsed JSON. Throws on a foreign document. */
export function performanceFromDocument(
  value: unknown,
  options: DeserializeOptions = {},
): Performance {
  if (!isRecord(value) || value.format !== PERFORMANCE_FORMAT) {
    throw new Error(`not a ${PERFORMANCE_FORMAT} document`);
  }
  if (typeof value.formatVersion !== "number") {
    throw new Error("performance document has no formatVersion");
  }
  if (!isRecord(value.performance)) {
    throw new Error("performance document has no performance payload");
  }
  return reattachExecutors(
    value.performance as unknown as Performance,
    options.executors ?? {},
  );
}

/** Reload a performance from its JSON text. Throws on invalid JSON. */
export function deserializePerformance(
  text: string,
  options: DeserializeOptions = {},
): Performance {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid performance JSON: ${detail}`);
  }
  return performanceFromDocument(parsed, options);
}

function reattachExecutors(
  performance: Performance,
  executors: Record<string, ActorExecutor>,
): Performance {
  const restore = (cast: Cast): Cast => ({
    ...cast,
    actors: cast.actors.map((actor) => {
      const executor = executors[actor.name];
      return executor ? { ...actor, executor } : { ...actor };
    }),
  });
  return {
    ...performance,
    cast: restore(performance.cast),
    casts: Array.isArray(performance.casts) ? performance.casts.map(restore) : [],
  };
}
