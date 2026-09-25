/**
 * Actor: a participant with a responsibility and an interface.
 *
 * Actor is not synonymous with model. An actor may be an LLM, a deterministic
 * program, a tool call, a test runner — anything that maps a context to output.
 * What matters is the role, the local objective, and the artifacts it produces.
 */

import type { Artifact } from "./types";
import { nextId } from "./types";
import type { Scene } from "./scene";
import type { Persona } from "./persona";

export type ActorKind = "llm" | "deterministic" | "tool";

export interface ToolCall {
  tool: string;
  input: unknown;
  result?: unknown;
  error?: string;
}

export interface ActorOutput {
  artifacts: Artifact[];
  message?: string;
  toolCalls?: ToolCall[];
  status: "ok" | "failed";
  error?: string;
}

/**
 * A role's designed opposition: what it challenges, and what the disagreement
 * should yield. Declared on the role so the casting director can validate that
 * disagreement is intentional rather than incidental.
 */
export interface ActorStance {
  /** The other actor's name, or a capability, that this actor challenges. */
  opposes: string;
  /** The artifact kind the disagreement should yield (e.g. "Critique"). */
  toYield?: string;
}

export interface Actor {
  name: string;
  role: string;
  objective: string;
  kind: ActorKind;
  /** Optional behavioural prior (Detective, Skeptic, Architect...). */
  archetype?: string;
  capabilities: string[];
  tools: string[];
  knowledge: string[];
  constraints: string[];
  /** e.g. "challenge:architect", "delegate:researcher", "synthesize". */
  interactionPermissions: string[];
  /** Artifact kinds this actor is expected to produce. */
  expectedOutput: string[];
  exitCondition?: string;
  /**
   * The question this actor answers. A verifier must declare it, so that two
   * verifiers asking the same thing are visible as copies.
   */
  question?: string;
  /** Designed disagreement: who this role challenges and what it should yield. */
  stance?: ActorStance;
  /** The persona playing this role, once an audition has bound one. */
  binding?: ActorBinding;
  /** How the actor runs. Deterministic/tool actors must supply one. */
  executor?: ActorExecutor;
}

/** Role dressed in a persona: the result of a successful audition. */
export interface ActorBinding {
  persona: Persona;
  /** The approach the persona proposed for this role, if any. */
  approach?: string;
  /** Whether the binding came from a live audition or a cached answer. */
  from: "audition" | "cache";
}

export interface ActorTurn {
  id: string;
  iteration: number;
  step: string;
  actor: string;
  instruction: string;
  inputIds: string[];
  output: ActorOutput;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ToolContext {
  actor: Actor;
  scene: Scene;
  tools: ToolRegistry;
}

export type ToolHandler = (input: unknown, ctx: ToolContext) => unknown | Promise<unknown>;

export interface ToolRegistry {
  names(): string[];
  has(name: string): boolean;
  call(name: string, input: unknown, ctx: ToolContext): Promise<unknown>;
}

export function createToolRegistry(
  handlers: Record<string, ToolHandler> = {},
): ToolRegistry {
  return {
    names: () => Object.keys(handlers),
    has: (name) => Object.prototype.hasOwnProperty.call(handlers, name),
    call: async (name, input, ctx) => {
      const handler = handlers[name];
      if (!handler) throw new Error(`unknown tool "${name}"`);
      return handler(input, ctx);
    },
  };
}

export interface ActorContext {
  scene: Scene;
  actor: Actor;
  /** What this actor should do in this activation, from the protocol. */
  instruction: string;
  inputs: Artifact[];
  history: ActorTurn[];
  tools: ToolRegistry;
  /**
   * The performance's cancellation signal, when the caller supplied one. An
   * executor should pass it to its own transport so an in-flight call stops
   * instead of being merely abandoned.
   */
  signal?: AbortSignal;
  iteration: number;
}

export type ActorExecutor = (ctx: ActorContext) => ActorOutput | Promise<ActorOutput>;

export function createActor(
  partial: Partial<Actor> & Pick<Actor, "name" | "role" | "objective">,
): Actor {
  return {
    name: partial.name,
    role: partial.role,
    objective: partial.objective,
    kind: partial.kind ?? "llm",
    archetype: partial.archetype,
    capabilities: partial.capabilities?.slice() ?? [],
    tools: partial.tools?.slice() ?? [],
    knowledge: partial.knowledge?.slice() ?? [],
    constraints: partial.constraints?.slice() ?? [],
    interactionPermissions: partial.interactionPermissions?.slice() ?? [],
    expectedOutput: partial.expectedOutput?.slice() ?? [],
    exitCondition: partial.exitCondition,
    question: partial.question,
    stance: partial.stance,
    binding: partial.binding,
    executor: partial.executor,
  };
}

export function artifact(
  producedBy: string,
  kind: string,
  content: unknown,
  meta?: Record<string, unknown>,
): Artifact {
  return { id: nextId("artifact"), kind, producedBy, content, createdAt: Date.now(), meta };
}

export function ok(artifacts: Artifact[], message?: string): ActorOutput {
  return { artifacts, message, status: "ok" };
}

export function failed(error: string, artifacts: Artifact[] = []): ActorOutput {
  return { artifacts, status: "failed", error };
}

export interface FunctionActorOptions
  extends Pick<Actor, "name" | "role" | "objective"> {
  archetype?: string;
  capabilities?: string[];
  tools?: string[];
  knowledge?: string[];
  constraints?: string[];
  interactionPermissions?: string[];
  stance?: ActorStance;
  produces?: string | string[];
  run: ActorExecutor;
}

/** Wrap a deterministic function as an actor (no model required). */
export function functionActor(options: FunctionActorOptions): Actor {
  return createActor({
    name: options.name,
    role: options.role,
    objective: options.objective,
    kind: "deterministic",
    archetype: options.archetype,
    capabilities: options.capabilities,
    tools: options.tools,
    knowledge: options.knowledge,
    constraints: options.constraints,
    interactionPermissions: options.interactionPermissions,
    stance: options.stance,
    expectedOutput: options.produces
      ? Array.isArray(options.produces)
        ? options.produces
        : [options.produces]
      : [],
    executor: options.run,
  });
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFn = (messages: ChatMessage[], ctx: ActorContext) => Promise<string>;

/**
 * Render the actor card plus its inputs into a chat prompt. Kept explicit so the
 * orchestration is inspectable rather than hidden inside one giant prompt.
 */
export function renderActorPrompt(ctx: ActorContext): ChatMessage[] {
  const { actor } = ctx;
  const system: string[] = [
    `Role: ${actor.role}`,
    `Objective: ${actor.objective}`,
  ];
  if (actor.archetype) system.push(`Archetype (behavioural prior): ${actor.archetype}`);
  if (actor.binding) {
    const { persona, approach } = actor.binding;
    system.push(
      `Playing as: ${persona.name}${persona.archetype ? ` (${persona.archetype})` : ""}`,
    );
    if (persona.description) system.push(`Character: ${persona.description}`);
    if (persona.personaPrompt) system.push(`Persona guidance: ${persona.personaPrompt}`);
    if (approach) system.push(`Your approach to this role: ${approach}`);
  }
  if (actor.knowledge.length) system.push(`Knowledge: ${actor.knowledge.join("; ")}`);
  if (actor.constraints.length) system.push(`Constraints: ${actor.constraints.join("; ")}`);
  if (actor.interactionPermissions.length) {
    system.push(`Permissions: ${actor.interactionPermissions.join("; ")}`);
  }
  if (actor.question) {
    system.push(`Question to answer: ${actor.question}`);
  }

  if (actor.stance) {
    const { opposes, toYield } = actor.stance;
    system.push(
      `Designed opposition: challenge "${opposes}"${
        toYield ? `, and the disagreement should yield ${toYield}` : ""
      }`,
    );
  }
  if (actor.expectedOutput.length) {
    system.push(`Produce artifact kind(s): ${actor.expectedOutput.join(", ")}`);
  }
  if (actor.exitCondition) system.push(`Exit condition: ${actor.exitCondition}`);

  const inputs = ctx.inputs.length
    ? ctx.inputs
        .map(
          (a) =>
            `--- ${a.kind} (by ${a.producedBy}) ---\n${
              typeof a.content === "string" ? a.content : JSON.stringify(a.content)
            }`,
        )
        .join("\n")
    : "(no input artifacts)";

  return [
    { role: "system", content: system.join("\n") },
    { role: "user", content: `Task: ${ctx.instruction}\n\nInput artifacts:\n${inputs}` },
  ];
}

export interface LlmExecutorOptions {
  /** Turn the model's text into artifacts. Defaults to one artifact of the first expected kind. */
  parse?: (text: string, ctx: ActorContext) => ActorOutput;
}

/** Adapt any chat function (any provider) into an actor executor. */
export function createLlmExecutor(
  chat: ChatFn,
  options: LlmExecutorOptions = {},
): ActorExecutor {
  return async (ctx) => {
    const text = await chat(renderActorPrompt(ctx), ctx);
    if (options.parse) return options.parse(text, ctx);
    const kind = ctx.actor.expectedOutput[0] ?? "Answer";
    return ok([artifact(ctx.actor.name, kind, text)]);
  };
}
