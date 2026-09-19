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

  test("R-CONFLICT-6 a yield consumed only by the stancer itself is not counted", () => {
    const writer = createActor({
      name: "writer", role: "writer", objective: "write",
      capabilities: ["analysis"], expectedOutput: ["Critique"],
    });
    const challenger = createActor({
      name: "challenger", role: "challenger", objective: "challenge",
      capabilities: ["adversarial_review"], expectedOutput: ["Verdict"],
      stance: { opposes: "analysis", toYield: "Critique" },
    });
    const cast = createCast([writer, challenger], createProtocol([
      { actor: "writer", instruction: "write", produces: ["Critique"] },
      { actor: "challenger", instruction: "challenge", consumes: ["Critique"], produces: ["Verdict"] },
    ]));
    expect(
      new CastingDirector().validate(scene(), cast).some((i) => i.code === "unused_conflict_yield"),
    ).toBe(true);
  });

  test("R-CONFLICT-7 a stance must run after every target", () => {
    const a1 = createActor({ name: "a1", role: "a1", objective: "x", capabilities: ["analysis"], expectedOutput: ["A"] });
    const a2 = createActor({ name: "a2", role: "a2", objective: "y", capabilities: ["analysis"], expectedOutput: ["B"] });
    const challenger = createActor({
      name: "challenger", role: "challenger", objective: "challenge",
      capabilities: ["adversarial_review"], expectedOutput: ["Critique"],
      stance: { opposes: "analysis", toYield: "Critique" },
    });
    const cast = createCast([a1, a2, challenger], createProtocol([
      { actor: "a1", instruction: "x", produces: ["A"] },
      { actor: "challenger", instruction: "challenge", consumes: ["A"], produces: ["Critique"] },
      { actor: "a2", instruction: "y", produces: ["B"] },
    ]));
    expect(
      new CastingDirector().validate(scene(), cast).some((i) => i.code === "stance_before_target"),
    ).toBe(true);
  });

  test("R-CONFLICT-8 a stance whose target never runs is flagged", () => {
    const challenger = createActor({
      name: "challenger", role: "challenger", objective: "challenge",
      capabilities: ["adversarial_review"], expectedOutput: ["Critique"],
      stance: { opposes: "analysis", toYield: "Critique" },
    });
    const ghost = createActor({ name: "ghost", role: "ghost", objective: "x", capabilities: ["analysis"], expectedOutput: ["A"] });
    const cast = createCast([challenger, ghost], createProtocol([
      { actor: "challenger", instruction: "challenge", produces: ["Critique"] },
    ]));
    expect(
      new CastingDirector().validate(scene(), cast).some((i) => i.code === "stance_target_inactive"),
    ).toBe(true);
  });

  test("R-CONFLICT-9 a later step by the stancer does not count as a consumer", () => {
    const writer = createActor({
      name: "writer", role: "writer", objective: "w",
      capabilities: ["analysis"], expectedOutput: ["Draft"],
    });
    const challenger = createActor({
      name: "challenger", role: "challenger", objective: "c",
      capabilities: ["adversarial_review"], expectedOutput: ["Verdict"],
      stance: { opposes: "analysis", toYield: "Critique" },
    });
    const cast = createCast([writer, challenger], createProtocol([
      { actor: "writer", instruction: "w", produces: ["Draft"] },
      { actor: "challenger", instruction: "c", consumes: ["Draft"], produces: ["Critique"] },
      { actor: "challenger", instruction: "c2", consumes: ["Critique"], produces: ["Verdict"] },
    ]));
    expect(
      new CastingDirector().validate(scene(), cast).some((i) => i.code === "unused_conflict_yield"),
    ).toBe(true);
  });
});
