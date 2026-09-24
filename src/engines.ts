/**
 * Engine adapters.
 *
 * drama depends on no agent framework: an actor needs exactly one thing, an
 * `executor`. This module is the whole integration surface — one generic shape
 * that LangGraph, the OpenAI Agents SDK, Google ADK, CrewAI, Mastra, a shell
 * command or an HTTP service can fill, without drama importing any of them.
 */

import { artifact, failed, ok, renderActorPrompt } from "./actor";
import type { Actor, ActorContext, ActorExecutor, ChatMessage } from "./actor";
import type { Scene } from "./scene";
import type { Artifact } from "./types";
import { messageOf } from "./types";

/** What the host's engine receives. */
export interface EngineRequest {
  /** Exactly the chat messages a model executor would receive. */
  messages: ChatMessage[];
  /** The same prompt flattened, for engines that take a single string. */
  prompt: string;
  actor: Actor;
  instruction: string;
  inputs: Artifact[];
  scene: Scene;
  iteration: number;
}

/** An artifact as an engine declares it — drama assigns the id and timestamp. */
export interface DeclaredArtifact {
  kind: string;
  content?: unknown;
  meta?: Record<string, unknown>;
}

/** What an engine must return. */
export interface EngineResult {
  artifacts: DeclaredArtifact[];
}

export interface EngineExecutorOptions {
  /** Call the engine. Any framework can satisfy this shape. */
  invoke: (request: EngineRequest) => EngineResult | Promise<EngineResult>;
  /** Who produced the artifacts; defaults to the actor's name. */
  producer?: string;
}

function isDeclaredArtifact(value: unknown): value is DeclaredArtifact {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" && kind.length > 0;
}

/**
 * Wrap any agent engine as an actor executor.
 *
 * The engine gets the *same* prompt a model would get (`renderActorPrompt`), so
 * the orchestration stays inspectable and the engine stays swappable. A throw, a
 * missing result or a malformed one becomes a failed output, never an exception
 * escaping into the stage.
 */
export function createEngineExecutor(options: EngineExecutorOptions): ActorExecutor {
  return async (ctx: ActorContext) => {
    try {
      const messages = renderActorPrompt(ctx);
      const result = await options.invoke({
        messages,
        prompt: messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
        actor: ctx.actor,
        instruction: ctx.instruction,
        inputs: ctx.inputs,
        scene: ctx.scene,
        iteration: ctx.iteration,
      });

      const declared = Array.isArray(result?.artifacts) ? result.artifacts : [];
      const artifacts = declared
        .filter(isDeclaredArtifact)
        .map((item) => artifact(options.producer ?? ctx.actor.name, item.kind, item.content, item.meta));

      if (artifacts.length === 0) return failed("engine returned no usable artifacts");
      return ok(artifacts);
    } catch (error) {
      return failed(messageOf(error));
    }
  };
}
