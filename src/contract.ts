/**
 * Optional content contracts for artifacts.
 *
 * `expectedOutput` names artifact *kinds*; it says nothing about their content,
 * and drama's normaliser discipline otherwise stops at the card boundary. A
 * contract says what the content must look like, so an executor that validates it
 * turns a malformed answer into a failed turn instead of letting the next actor
 * discover it.
 *
 * Deliberately dependency-free and serialisable: a contract is either a host
 * function or a declarative shape from a small subset — so a casting card can
 * carry one, and a program can supply its own.
 */

import type { Artifact } from "./types";
import { messageOf, ownEntry } from "./types";

/** The types the declarative subset knows. */
export type ShapeType = "object" | "array" | "string" | "number" | "boolean";

const SHAPE_TYPES: string[] = ["object", "array", "string", "number", "boolean"];

/** A minimal, serialisable content shape. */
export interface Shape {
  type?: ShapeType;
  /** `object`: keys that must be present. */
  required?: string[];
  /** `object`: shapes for individual keys. */
  fields?: Record<string, Shape>;
  /** `array`: the shape every item must satisfy. */
  items?: Shape;
}

/**
 * A host-provided check: `true` when the content conforms, otherwise the reason.
 * A throw counts as a refusal and never escapes into the stage.
 */
export type ContentCheck = (content: unknown) => true | string;

export type ContentContract = Shape | ContentCheck;

/** Per-kind contracts, keyed by artifact kind. */
export type ContentContracts = Record<string, ContentContract>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same check without narrowing, for parameters that are already typed. */
function isObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) out.push(item);
  }
  return out;
}

/** The JSON kind of a value, as the contract's vocabulary sees it. */
function kindOf(value: unknown): ShapeType | "null" | "missing" {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean" || type === "object") {
    return type;
  }
  return "missing";
}

/**
 * Check a value against a declarative shape. Returns `true`, or the first reason
 * it failed — a path and what was expected, because that message ends up in the
 * trace.
 */
export function validateShape(
  shape: Shape,
  content: unknown,
  path = "content",
  depth = 0,
): true | string {
  if (!isObject(shape) || depth > 16) return true;
  if (shape.type) {
    const actual = kindOf(content);
    if (actual !== shape.type) return `${path} must be ${shape.type}, got ${actual}`;
  }
  if (shape.required?.length || shape.fields) {
    if (kindOf(content) !== "object") {
      return `${path} must be object, got ${kindOf(content)}`;
    }
    const record = content as Record<string, unknown>;
    for (const key of shape.required ?? []) {
      if (record[key] === undefined) return `${path}.${key} is required`;
    }
    for (const [key, sub] of Object.entries(shape.fields ?? {})) {
      if (record[key] === undefined) continue;
      const outcome = validateShape(sub, record[key], `${path}.${key}`, depth + 1);
      if (outcome !== true) return outcome;
    }
  }
  if (shape.items) {
    if (!Array.isArray(content)) return `${path} must be array, got ${kindOf(content)}`;
    for (let index = 0; index < content.length; index += 1) {
      const outcome = validateShape(shape.items, content[index], `${path}[${index}]`, depth + 1);
      if (outcome !== true) return outcome;
    }
  }
  return true;
}

/** Run one contract. A host check that throws is a refusal with its message. */
export function checkContent(
  contract: ContentContract | undefined,
  content: unknown,
): true | string {
  if (!contract) return true;
  if (typeof contract === "function") {
    try {
      const outcome = contract(content);
      if (outcome === true) return true;
      return typeof outcome === "string" && outcome.length > 0
        ? outcome
        : "contract rejected the content";
    } catch (error) {
      return messageOf(error);
    }
  }
  return validateShape(contract, content);
}

/**
 * Validate a turn's artifacts against per-kind contracts. Returns `undefined`
 * when everything conforms, or the message the failed turn should carry.
 */
export function validateArtifacts(
  contracts: ContentContracts | undefined,
  artifacts: Artifact[],
): string | undefined {
  if (!contracts) return undefined;
  for (const item of artifacts) {
    const contract = ownEntry(contracts, item.kind);
    if (!contract) continue;
    const outcome = checkContent(contract, item.content);
    if (outcome !== true) {
      return `artifact "${item.kind}" does not satisfy its content contract: ${outcome}`;
    }
  }
  return undefined;
}

/** A compact, model-readable description of a shape, for the prompt. */
export function describeShape(shape: Shape, depth = 0): string {
  if (!isObject(shape) || depth > 16) return "any";
  const { type, required, fields, items } = shape;
  if (type === "array") return `array<${items ? describeShape(items, depth + 1) : "any"}>`;
  if (type === "object" || fields) {
    const entries = Object.entries(fields ?? {}).map(
      ([key, sub]) => `${key}: ${describeShape(sub, depth + 1)}`,
    );
    if (required?.length) {
      for (const key of required) {
        if (!entries.some((entry) => entry.startsWith(`${key}:`))) entries.push(`${key}: any`);
      }
    }
    return `object{${entries.join(", ")}}`;
  }
  return type ?? "any";
}

/**
 * Normalise contracts from the wire. Only declarative shapes survive — a card
 * cannot carry a function — and a malformed entry is dropped rather than
 * propagated, like every other card field.
 */
export function normalizeContracts(value: unknown): ContentContracts | undefined {
  if (!isRecord(value)) return undefined;
  const out: ContentContracts = {};
  let found = false;
  for (const [kind, raw] of Object.entries(value)) {
    if (!kind.trim()) continue;
    const shape = toShape(raw);
    if (!shape) continue;
    out[kind] = shape;
    found = true;
  }
  return found ? out : undefined;
}

function toShape(value: unknown, depth = 0): Shape | undefined {
  if (!isRecord(value) || depth > 16) return undefined;
  const shape: Shape = {};
  if (typeof value.type === "string" && SHAPE_TYPES.includes(value.type)) {
    shape.type = value.type as ShapeType;
  }
  const required = readStringArray(value.required);
  if (required.length) shape.required = required;
  const items = toShape(value.items, depth + 1);
  if (items) shape.items = items;
  if (isRecord(value.fields)) {
    const fields: Record<string, Shape> = {};
    for (const [key, sub] of Object.entries(value.fields)) {
      const parsed = toShape(sub, depth + 1);
      if (parsed) fields[key] = parsed;
    }
    if (Object.keys(fields).length) shape.fields = fields;
  }
  return Object.keys(shape).length ? shape : undefined;
}
