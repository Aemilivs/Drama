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
import type { ActorContext, Scene } from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "ship the change",
    success_criteria: ["one verdict"],
    required_capabilities: ["verify"],
  });
}

function verifier(name: string, question?: string) {
  return createActor({
    name,
    role: name,
    objective: "verify the change",
    capabilities: ["verify"],
    expectedOutput: ["Verdict"],
    question,
  });
}

function castOf(actors: ReturnType<typeof verifier>[]) {
  return createCast(
    actors,
    createProtocol(
      actors.map((actor) => ({
        actor: actor.name,
        instruction: "verify",
        produces: ["Verdict"],
      })),
    ),
  );
}

describe("Judge-panel requirements", () => {
  test("R-PANEL-1 two actors asking the same question are reported as copies", () => {
    const cast = castOf([
      verifier("correctness", "Is the change correct?"),
      verifier("safety", "is the change   correct!"),
    ]);
    const found = new CastingDirector()
      .validate(scene(), cast)
      .find((issue) => issue.code === "duplicate_question");

    expect(found?.severity).toBe("warning");
    expect(found?.actors.sort()).toEqual(["correctness", "safety"]);
    expect(found?.message).toContain("copies");
  });

  test("R-PANEL-2 distinct questions, a lone verifier, and undeclared questions are silent", () => {
    const director = new CastingDirector();

    const complements = castOf([
      verifier("correctness", "Is the change correct?"),
      verifier("currency", "Is the cited evidence still current?"),
      verifier("provenance", "Is the source real?"),
    ]);
    expect(director.validate(scene(), complements).some((i) => i.code === "duplicate_question")).toBe(
      false,
    );

    expect(
      director.validate(scene(), castOf([verifier("only", "Is it correct?")])).some(
        (i) => i.code === "duplicate_question",
      ),
    ).toBe(false);

    // Actors that declare no question are not a panel and cannot be compared.
    expect(
      director
        .validate(scene(), castOf([verifier("a"), verifier("b")]))
        .some((i) => i.code === "duplicate_question"),
    ).toBe(false);
  });

  test("R-PANEL-3 the declared question reaches the actor prompt", () => {
    const actor = verifier("correctness", "Is the change correct?");
    const ctx: ActorContext = {
      scene: scene(),
      actor,
      instruction: "verify",
      inputs: [],
      history: [],
      tools: createToolRegistry(),
      iteration: 1,
    };
    const text = (messages: { content: string }[]) =>
      messages.map((message) => message.content).join("\n");
    expect(text(renderActorPrompt(ctx))).toContain(
      "Question to answer: Is the change correct?",
    );

    const silent = verifier("quiet");
    expect(text(renderActorPrompt({ ...ctx, actor: silent }))).not.toContain("Question to answer:");
  });

  test("R-PANEL-4 the question survives the cast card", () => {
    const cast = castFromCard({
      cast: [
        {
          name: "correctness",
          role: "correctness",
          objective: "verify",
          capabilities: ["verify"],
          expectedOutput: ["Verdict"],
          question: "Is the change correct?",
        },
      ],
      protocol: [{ actor: "correctness", instruction: "verify", produces: ["Verdict"] }],
    });
    expect(cast.actors[0]!.question).toBe("Is the change correct?");
  });
});
