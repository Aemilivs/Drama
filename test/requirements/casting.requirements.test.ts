import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  actorFromCard,
  castFromCard,
  createActor,
  createCast,
  createProtocol,
  deriveMinimalCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { Scene } from "../../src/index.ts";

function sceneWith(capabilities: string[]): Scene {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: capabilities,
  });
}

describe("Casting requirements", () => {
  test("R-CAST-1 the cast is derived from the scene, not from a canonical template", () => {
    const one = deriveMinimalCast(sceneWith(["research"]));
    const two = deriveMinimalCast(sceneWith(["research", "design"]));
    expect(one.actors.map((a) => a.name)).toEqual(["research"]);
    expect(two.actors.map((a) => a.name)).toEqual(["research", "design", "synthesizer"]);
  });

  test("R-CAST-5 an actor whose output is consumed is necessary even if its capability is not required", () => {
    const scene = sceneWith(["review"]);
    const producer = createActor({
      name: "producer",
      role: "producer",
      objective: "produce",
      capabilities: ["drafting"],
      expectedOutput: ["Draft"],
    });
    const reviewer = createActor({
      name: "reviewer",
      role: "reviewer",
      objective: "review",
      capabilities: ["review"],
      expectedOutput: ["Review"],
    });
    const cast = createCast(
      [producer, reviewer],
      createProtocol([
        { actor: "producer", instruction: "produce", produces: ["Draft"] },
        { actor: "reviewer", instruction: "review", consumes: ["Draft"], produces: ["Review"] },
      ]),
    );
    const removable = new CastingDirector()
      .minimality(scene, cast)
      .removable.map((f) => f.actor);
    expect(removable).not.toContain("producer");
  });

  test("R-CAST-6 validate reports unknown actors, empty objectives and duplicate names", () => {
    const scene = sceneWith([]);
    const director = new CastingDirector();

    const unknown = createCast(
      [createActor({ name: "real", role: "real", objective: "o", capabilities: ["x"] })],
      createProtocol([{ actor: "ghost", instruction: "boo" }]),
    );
    expect(director.validate(scene, unknown).some((i) => i.code === "unknown_actor")).toBe(true);

    const emptyObjective = createCast(
      [createActor({ name: "blank", role: "blank", objective: "" })],
      createProtocol([{ actor: "blank", instruction: "go" }]),
    );
    expect(director.validate(scene, emptyObjective).some((i) => i.code === "empty_objective")).toBe(
      true,
    );

    const duplicate = createCast(
      [
        createActor({ name: "dup", role: "r1", objective: "o", capabilities: ["x"] }),
        createActor({ name: "dup", role: "r2", objective: "o", capabilities: ["y"] }),
      ],
      createProtocol([{ actor: "dup", instruction: "go" }]),
    );
    expect(director.validate(scene, duplicate).some((i) => i.code === "duplicate_actor")).toBe(
      true,
    );
  });

  test("R-CAST-7 consuming an artifact produced by a later step is an error", () => {
    const scene = sceneWith([]);
    const a = createActor({
      name: "a",
      role: "a",
      objective: "o",
      capabilities: ["x"],
      expectedOutput: ["AReport"],
    });
    const b = createActor({
      name: "b",
      role: "b",
      objective: "o",
      capabilities: ["y"],
      expectedOutput: ["BReport"],
    });
    const cast = createCast(
      [a, b],
      createProtocol([
        { actor: "a", instruction: "first", consumes: ["BReport"] },
        { actor: "b", instruction: "second", produces: ["BReport"] },
      ]),
    );
    expect(new CastingDirector().validate(scene, cast).some((i) => i.code === "unproduced_input")).toBe(
      true,
    );
  });

  test("R-CAST-8 cast cards accept aliases and both protocol shapes", () => {
    const asArray = castFromCard({
      actors: [{ name: "a", role: "a", objective: "o", capabilities: ["x"], produces: "AReport" }],
      protocol: [{ actor: "a", instruction: "go", produces: ["AReport"] }],
    });
    const asObject = castFromCard({
      cast: [{ name: "a", role: "a", objective: "o", capabilities: ["x"], produces: "AReport" }],
      protocol: { notes: "n", steps: [{ actor: "a", instruction: "go", produces: ["AReport"] }] },
    });
    expect(asArray.actors[0]!.expectedOutput).toEqual(["AReport"]);
    expect(asArray.protocol.steps).toHaveLength(1);
    expect(asObject.actors[0]!.name).toBe("a");
    expect(asObject.protocol.notes).toBe("n");
    expect(actorFromCard({ name: "z", capabilities: ["q"], produces: ["ZReport"] }).expectedOutput).toEqual([
      "ZReport",
    ]);
  });

  test("R-CAST-9 a derived cast is always internally valid", () => {
    const director = new CastingDirector();
    for (const capabilities of [
      ["a"],
      ["a", "b"],
      ["a", "b", "c"],
      ["security review", "cost analysis"],
    ]) {
      const scene = sceneWith(capabilities);
      const cast = deriveMinimalCast(scene);
      expect(director.validate(scene, cast).filter((i) => i.severity === "error")).toHaveLength(0);
      expect(director.minimality(scene, cast).removable).toHaveLength(0);
    }
  });
});
