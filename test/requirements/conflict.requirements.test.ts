import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  castFromCard,
  createActor,
  createCast,
  createProtocol,
  createToolRegistry,
  renderActorPrompt,
  sceneFromCard,
} from "../../src/index.ts";
import type { Actor, ActorContext, ActorStance, Cast } from "../../src/index.ts";

function scene() {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: ["analysis", "adversarial_review"],
  });
}

function analyst(): Actor {
  return createActor({
    name: "analyst",
    role: "analyst",
    objective: "analyse",
    capabilities: ["analysis"],
    expectedOutput: ["Draft"],
  });
}

function skeptic(stance: ActorStance): Actor {
  return createActor({
    name: "skeptic",
    role: "skeptic",
    objective: "challenge the analysis",
    capabilities: ["adversarial_review"],
    expectedOutput: ["Critique"],
    interactionPermissions: ["challenge:analyst"],
    stance,
  });
}

function synthesizer(): Actor {
  return createActor({
    name: "synthesizer",
    role: "synthesizer",
    objective: "merge",
    capabilities: ["synthesis"],
    expectedOutput: ["FinalAnswer"],
    interactionPermissions: ["synthesize"],
  });
}

const good = (stance: ActorStance): Cast =>
  createCast(
    [analyst(), skeptic(stance), synthesizer()],
    createProtocol([
      { actor: "analyst", instruction: "draft", produces: ["Draft"] },
      { actor: "skeptic", instruction: "challenge", consumes: ["Draft"], produces: ["Critique"] },
      {
        actor: "synthesizer",
        instruction: "merge",
        consumes: ["Draft", "Critique"],
        produces: ["FinalAnswer"],
      },
    ]),
  );

describe("Designed conflict requirements", () => {
  test("R-CONFLICT-1 a stance that targets nobody is an error", () => {
    const cast = good({ opposes: "ghost_capability", toYield: "Critique" });
    const dangling = new CastingDirector()
      .validate(scene(), cast)
      .find((issue) => issue.code === "dangling_stance");
    expect(dangling?.severity).toBe("error");
    expect(dangling?.message).toContain("ghost_capability");
  });

  test("R-CONFLICT-2 a conflict that yields nothing anyone uses is a warning", () => {
    const cast = good({ opposes: "analysis", toYield: "UnusedKind" });
    const unused = new CastingDirector()
      .validate(scene(), cast)
      .find((issue) => issue.code === "unused_conflict_yield");
    expect(unused?.severity).toBe("warning");
    expect(unused?.message).toContain("UnusedKind");
  });

  test("R-CONFLICT-3 challenging before the target has produced is a warning", () => {
    const cast = createCast(
      [analyst(), skeptic({ opposes: "analysis", toYield: "Critique" }), synthesizer()],
      createProtocol([
        { actor: "skeptic", instruction: "challenge", consumes: [], produces: ["Critique"] },
        { actor: "analyst", instruction: "draft", produces: ["Draft"] },
        {
          actor: "synthesizer",
          instruction: "merge",
          consumes: ["Draft", "Critique"],
          produces: ["FinalAnswer"],
        },
      ]),
    );
    expect(
      new CastingDirector()
        .validate(scene(), cast)
        .some((issue) => issue.code === "stance_before_target"),
    ).toBe(true);
  });

  test("R-CONFLICT-4 a well-formed designed conflict is clean and reaches the prompt", () => {
    const cast = good({ opposes: "analysis", toYield: "Critique" });
    expect(new CastingDirector().validate(scene(), cast)).toHaveLength(0);

    const context: ActorContext = {
      scene: scene(),
      actor: cast.actors.find((actor) => actor.name === "skeptic")!,
      instruction: "challenge",
      inputs: [],
      history: [],
      tools: createToolRegistry(),
      iteration: 1,
    };
    const system = renderActorPrompt(context).find((message) => message.role === "system")!.content;
    expect(system).toContain("Designed opposition");
    expect(system).toContain("analysis");
    expect(system).toContain("Critique");
  });

  test("R-CONFLICT-5 a stance survives the cast card wire format", () => {
    const parsed = castFromCard({
      cast: [
        {
          name: "skeptic",
          role: "skeptic",
          objective: "challenge",
          capabilities: ["adversarial_review"],
          expectedOutput: ["Critique"],
          stance: { opposes: "analysis", toYield: "Critique" },
        },
      ],
      protocol: { steps: [{ actor: "skeptic", instruction: "challenge", produces: ["Critique"] }] },
    } as never);
    expect(parsed.actors[0]!.stance).toEqual({ opposes: "analysis", toYield: "Critique" });
  });
});
