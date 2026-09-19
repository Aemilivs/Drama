/**
 * Support for property and determinism requirements.
 *
 * The PRNG is seeded so a failing property is reproducible: the case index is
 * the only thing you need to re-run a minimal example.
 */

import type { Performance } from "../../src/index.ts";

/** mulberry32 — small, fast, deterministic. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Sample `min..max` distinct items. */
export function sample<T>(
  rng: () => number,
  items: readonly T[],
  min: number,
  max: number,
): T[] {
  const count = min + Math.floor(rng() * (max - min + 1));
  const pool = [...items];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!);
  }
  return out;
}

/**
 * Capabilities chosen to stress normalisation: spaces, punctuation, symbols,
 * and pairs that slug-collapse to the same actor name ("a b" vs "a-b") or to
 * the fallback ("!!!" vs "???").
 */
export const CAPABILITY_CORPUS = [
  "analysis",
  "design",
  "security review",
  "cost analysis",
  "data-science",
  "review",
  "R&D review",
  "a b",
  "a-b",
  "!!!",
  "???",
];

/** A structural fingerprint of a performance: no ids, no timestamps, no durations. */
export interface NormalizedPerformance {
  eventTypes: string[];
  decisions: (string | null)[];
  statuses: (string | undefined)[];
  turns: string[];
  artifacts: string[];
  result: string;
  reason: string;
}

export function normalizePerformance(performance: Performance): NormalizedPerformance {
  return {
    eventTypes: performance.events.map((event) => event.type),
    decisions: performance.iterations.map((iteration) => iteration.decision),
    statuses: performance.iterations.map((iteration) => iteration.evaluation?.status),
    turns: performance.turns.map((turn) =>
      [
        turn.step,
        turn.actor,
        turn.output.status,
        turn.output.artifacts.map((a) => a.kind).join("+"),
      ].join("|"),
    ),
    artifacts: performance.artifacts.map((a) => `${a.producedBy}:${a.kind}`),
    result: performance.finalResult.status,
    reason: performance.finalResult.reason,
  };
}
