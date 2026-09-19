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
  return typeof item === "string" ? item : item.text;
}

export function isBlocking(item: InfoItem): boolean {
  return typeof item !== "string" && item.blocking === true;
}

export function toInfoItems(items: InfoItem[] | undefined): InfoItem[] {
  return (items ?? []).slice();
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
