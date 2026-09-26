import { describe, expect, test } from "bun:test";
import {
  actorFromCard,
  artifact,
  createActor,
  createLlmExecutor,
  createToolRegistry,
  ok,
  renderActorPrompt,
  sceneFromCard,
} from "../../src/index.ts";
import type { Actor, ActorContext, ActorKind } from "../../src/index.ts";

function ctxFor(actor: Actor, overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    scene: sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["a"],
    }),
    actor,
    instruction: "do the thing",
    inputs: [artifact("upstream", "ResearchReport", "some research")],
    history: [],
    tools: createToolRegistry(),
    iteration: 1,
    ...overrides,
  };
}

describe("Actor requirements", () => {
  test("R-ACTOR-2 the rendered prompt contains the whole actor card", () => {
    const actor = createActor({
      name: "researcher",
      role: "researcher",
      objective: "find facts",
      capabilities: ["research"],
      knowledge: ["domain glossary"],
      constraints: ["cite sources"],
      interactionPermissions: ["challenge:analyst"],
      expectedOutput: ["ResearchReport"],
    });
    const messages = renderActorPrompt(ctxFor(actor));
    const system = messages.find((m) => m.role === "system")!.content;
    const user = messages.find((m) => m.role === "user")!.content;
    expect(system).toContain("researcher");
    expect(system).toContain("find facts");
    expect(system).toContain("cite sources");
    expect(system).toContain("challenge:analyst");
    expect(system).toContain("ResearchReport");
    expect(system).toContain("domain glossary");
    expect(user).toContain("do the thing");
    expect(user).toContain("ResearchReport");
    expect(user).toContain("some research");
  });

  test("R-ACTOR-3 a plain-text model reply still yields a well-formed artifact", async () => {
    const actor = createActor({
      name: "m",
      role: "m",
      objective: "o",
      expectedOutput: ["Answer"],
    });
    const output = await createLlmExecutor(async () => "model says hi")(ctxFor(actor));
    expect(output.status).toBe("ok");
    expect(output.artifacts).toHaveLength(1);
    expect(output.artifacts[0]!.kind).toBe("Answer");
    expect(output.artifacts[0]!.content).toBe("model says hi");
    expect(output.artifacts[0]!.producedBy).toBe("m");
  });

  test("R-ACTOR-4 a custom parser can produce structured artifacts", async () => {
    const actor = createActor({
      name: "m",
      role: "m",
      objective: "o",
      expectedOutput: ["RiskReport"],
    });
    const parse = (text: string, ctx: ActorContext) =>
      ok([artifact(ctx.actor.name, "RiskReport", JSON.parse(text))]);
    const output = await createLlmExecutor(async () => '{"risks":["a"]}', { parse })(
      ctxFor(actor),
    );
    expect(output.artifacts[0]!.content).toEqual({ risks: ["a"] });
  });

  test("R-ACTOR-6 a decision actor kind survives the card boundary", () => {
    expect(actorFromCard({ name: "scorer", role: "proposal scoring", kind: "decision" }).kind).toBe(
      "decision",
    );
    // An unknown kind still degrades to the default rather than trusting the wire.
    expect(actorFromCard({ name: "x", kind: "wizard" as ActorKind }).kind).toBe("llm");
  });
});
