/**
 * Export a performance as OpenTelemetry-shaped spans.
 *
 * An adapter, not a core change: `ActorTurn` already carries the timings, status,
 * actor and usage a span needs, and `performanceTimeline` is already a span list
 * in disguise. drama emits the OTLP/JSON shape and the host ships it wherever its
 * collector lives — no SDK, no dependency, and no network call from the library.
 *
 * The mapping is a pure function of the performance: the same performance always
 * produces the same document, because every id and timestamp is derived from the
 * performance's own recorded values. Exporting a stored trace later gives the
 * same spans.
 */

import type { ActorTurn } from "./actor";
import type { Performance, PerformanceResult } from "./stage";

/** One attribute, in the shape OTLP/JSON expects. */
export interface SpanAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}

export interface SpanStatus {
  code: "STATUS_CODE_OK" | "STATUS_CODE_ERROR" | "STATUS_CODE_UNSET";
  message?: string;
}

/** A span in the shape OTLP/JSON expects. */
export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "SPAN_KIND_INTERNAL";
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: SpanAttribute[];
  status: SpanStatus;
}

export interface OtlpDocument {
  resourceSpans: {
    resource: { attributes: SpanAttribute[] };
    scopeSpans: {
      scope: { name: string; version?: string };
      spans: Span[];
    }[];
  }[];
}

export interface OtlpOptions {
  /** `service.name` on the resource. Defaults to `"drama"`. */
  serviceName?: string;
  /** Instrumentation scope name. Defaults to `"drama"`. */
  scopeName?: string;
}

/**
 * A deterministic 32-hex-char digest. FNV-1a run with four seeds, so the result is
 * long enough for a trace id and stable across processes — no dependency, and no
 * random ids that would make two exports of one performance differ.
 */
function digest(text: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let value = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    out += value.toString(16).padStart(8, "0");
  }
  return out;
}

function spanId(performanceId: string, key: string): string {
  return digest(`${performanceId}/${key}`).slice(0, 16);
}

function string(key: string, value: string): SpanAttribute {
  return { key, value: { stringValue: value } };
}

function integer(key: string, value: number): SpanAttribute {
  return { key, value: { intValue: String(Math.round(value)) } };
}

function real(key: string, value: number): SpanAttribute {
  return { key, value: { doubleValue: value } };
}

/** Milliseconds since the epoch, as OTLP counts them: nanoseconds in a string. */
function toUnixNano(milliseconds: number): string {
  return String(Math.round(milliseconds * 1_000_000));
}

function statusOf(result: PerformanceResult): SpanStatus {
  if (result.status === "done") return { code: "STATUS_CODE_OK" };
  if (result.status === "failed") return { code: "STATUS_CODE_ERROR", message: result.reason };
  // `aborted` and `paused` are outcomes, not errors, and neither is a success.
  return { code: "STATUS_CODE_UNSET", message: result.reason };
}

function turnStatus(turn: ActorTurn): SpanStatus {
  if (turn.output.status === "failed") {
    return { code: "STATUS_CODE_ERROR", message: turn.output.error ?? "actor failed" };
  }
  return { code: "STATUS_CODE_OK" };
}

function turnAttributes(turn: ActorTurn, iteration: number): SpanAttribute[] {
  const attributes = [
    string("drama.turn.id", turn.id),
    integer("drama.iteration", iteration),
    string("drama.step", turn.step),
    string("drama.actor", turn.actor),
    integer("drama.artifact.count", turn.output.artifacts.length),
    real("drama.duration_ms", turn.durationMs),
  ];
  const kinds = turn.output.artifacts.map((artifact) => artifact.kind);
  if (kinds.length) attributes.push(string("drama.artifact.kinds", kinds.join(", ")));
  const usage = turn.usage ?? turn.output.usage;
  if (usage?.inputTokens !== undefined) {
    attributes.push(integer("drama.usage.input_tokens", usage.inputTokens));
  }
  if (usage?.outputTokens !== undefined) {
    attributes.push(integer("drama.usage.output_tokens", usage.outputTokens));
  }
  if (usage?.costUsd !== undefined) {
    attributes.push(real("drama.usage.cost_usd", usage.costUsd));
  }
  return attributes;
}

/** The performance's own time window, taken from the turns it recorded. */
function windowOf(performance: Performance): { start: number; end: number } {
  if (performance.turns.length === 0) {
    // A performance that paused before its first turn recorded no time. Zero is
    // honest here: inventing a timestamp would make two exports differ.
    return { start: 0, end: 0 };
  }
  const start = Math.min(...performance.turns.map((turn) => turn.startedAt));
  const end = Math.max(...performance.turns.map((turn) => turn.endedAt));
  return { start, end };
}

/**
 * Map a performance to OTel-shaped spans: one root, one per iteration, one per
 * actor turn. Spans come back oldest-first and carry their parent, so they can be
 * sent as a flat batch.
 */
export function performanceToSpans(performance: Performance): Span[] {
  const traceId = digest(`trace:${performance.id}`);
  const rootId = spanId(performance.id, "performance");
  const { start, end } = windowOf(performance);

  const root: Span = {
    traceId,
    spanId: rootId,
    name: `performance ${performance.id}`,
    kind: "SPAN_KIND_INTERNAL",
    startTimeUnixNano: toUnixNano(start),
    endTimeUnixNano: toUnixNano(end),
    attributes: [
      string("drama.performance.id", performance.id),
      string("drama.scene.id", performance.scene.id),
      string("drama.scene.objective", performance.scene.objective),
      string("drama.cast.id", performance.cast.id),
      string("drama.cast.actors", performance.cast.actors.map((actor) => actor.name).join(", ")),
      integer("drama.turns.count", performance.turns.length),
      integer("drama.artifacts.count", performance.artifacts.length),
      string("drama.result.status", performance.finalResult.status),
      string("drama.result.reason", performance.finalResult.reason),
    ],
    status: statusOf(performance.finalResult),
  };
  if (performance.finalResult.gate) {
    root.attributes.push(
      string(
        "drama.gate.step",
        `${performance.finalResult.gate.step} (iteration ${performance.finalResult.gate.iteration})`,
      ),
    );
  }

  const spans: Span[] = [root];
  for (const iteration of performance.iterations) {
    const iterationId = spanId(performance.id, `iteration:${iteration.index}`);
    const turns = iteration.turns;
    const iterationStart = turns.length
      ? Math.min(...turns.map((turn) => turn.startedAt))
      : start;
    const iterationEnd = turns.length ? Math.max(...turns.map((turn) => turn.endedAt)) : end;

    const attributes = [
      integer("drama.iteration", iteration.index),
      integer("drama.iteration.turns", turns.length),
    ];
    const evaluation = iteration.evaluation;
    if (evaluation) {
      attributes.push(
        string("drama.evaluation.status", evaluation.status),
        string("drama.evaluation.action", evaluation.recommendedAction),
        string("drama.evaluation.diagnosis", evaluation.diagnosis),
        integer("drama.evaluation.issues", evaluation.issues.length),
      );
    }
    spans.push({
      traceId,
      spanId: iterationId,
      parentSpanId: rootId,
      name: `iteration ${iteration.index}`,
      kind: "SPAN_KIND_INTERNAL",
      startTimeUnixNano: toUnixNano(iterationStart),
      endTimeUnixNano: toUnixNano(iterationEnd),
      attributes,
      status: evaluation
        ? evaluation.status === "pass"
          ? { code: "STATUS_CODE_OK" }
          : evaluation.status === "fail"
            ? { code: "STATUS_CODE_ERROR", message: "criteria not met" }
            : { code: "STATUS_CODE_UNSET", message: "criteria not evaluated" }
        : { code: "STATUS_CODE_UNSET", message: "not evaluated" },
    });

    for (const turn of turns) {
      spans.push({
        traceId,
        spanId: spanId(performance.id, `turn:${turn.id}`),
        parentSpanId: iterationId,
        name: `${turn.actor} (${turn.step})`,
        kind: "SPAN_KIND_INTERNAL",
        startTimeUnixNano: toUnixNano(turn.startedAt),
        endTimeUnixNano: toUnixNano(turn.endedAt),
        attributes: turnAttributes(turn, iteration.index),
        status: turnStatus(turn),
      });
    }
  }
  return spans;
}

/**
 * The whole OTLP/JSON document, ready for a host to POST to a collector. drama
 * never sends it: exporting is the host's job.
 */
export function performanceToOtlp(
  performance: Performance,
  options: OtlpOptions = {},
): OtlpDocument {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [string("service.name", options.serviceName ?? "drama")],
        },
        scopeSpans: [
          {
            scope: { name: options.scopeName ?? "drama" },
            spans: performanceToSpans(performance),
          },
        ],
      },
    ],
  };
}
