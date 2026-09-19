/**
 * Core primitives shared by every drama abstraction.
 *
 * These types are deliberately small and serialisable: a whole performance can
 * be written to JSON and inspected later. Nothing here talks to a model.
 */

/** Outcome of a single criterion or of a whole evaluation. */
export type Status = "pass" | "fail" | "uncertain";

/** What the system should do next after an evaluation. */
export type RecommendedAction = "finish" | "reperform" | "recast" | "redesign_scene";

/**
 * Why a performance fell short. The diagnosis — not the raw failure — decides
 * whether to retry, recast, or redesign the scene.
 */
export type Diagnosis =
  | "bad_execution"
  | "missing_capability"
  | "missing_information"
  | "malformed_problem"
  | "unspecified";

/** One success criterion taken from the scene. */
export interface Criterion {
  id: string;
  description: string;
}

/** Structured output exchanged between actors. Prefer this over free-form chat. */
export interface Artifact<T = unknown> {
  id: string;
  kind: string;
  producedBy: string;
  content: T;
  createdAt: number;
  meta?: Record<string, unknown>;
}

/**
 * An item of scene information. A bare string is "soft" information; the object
 * form can mark a gap as blocking, i.e. one that must be resolved before a cast
 * can be chosen.
 */
export type InfoItem = string | { text: string; blocking?: boolean };

export function infoText(item: InfoItem): string {
  if (typeof item === "string") return item;
  if (
    item !== null &&
    typeof item === "object" &&
    typeof (item as { text?: unknown }).text === "string"
  ) {
    return (item as { text: string }).text;
  }
  return String(item ?? "");
}

export function isBlocking(item: InfoItem): boolean {
  return (
    item !== null &&
    typeof item === "object" &&
    (item as { blocking?: unknown }).blocking === true
  );
}

/**
 * Normalise an information list from the wire. Malformed entries (nulls, bare
 * objects without text) are dropped rather than propagated: the list comes from
 * a model, and downstream analysis must never throw on it.
 */
export function toInfoItems(items: unknown): InfoItem[] {
  if (!Array.isArray(items)) return [];
  const out: InfoItem[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      out.push({
        text: (item as { text: string }).text,
        blocking: (item as { blocking?: unknown }).blocking === true,
      });
    }
  }
  return out;
}

let idCounter = 0;

/** Process-local monotonic ids. Injection-friendly enough for tests and traces. */
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Reset the id counter. Used by tests that assert on stable traces. */
export function resetIds(): void {
  idCounter = 0;
}
