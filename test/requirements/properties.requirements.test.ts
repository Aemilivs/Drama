import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  SceneDesigner,
  aggregate,
  castFromCard,
  deriveMinimalCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { Scene } from "../../src/index.ts";
import { CAPABILITY_CORPUS, makeRng, pick, sample } from "./_support.ts";

const CASES = 30;

function sceneWith(capabilities: string[]): Scene {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: capabilities,
  });
}

describe("Property requirements", () => {
  test("R-PROP-1 any derived cast is valid and minimal for arbitrary capability sets", () => {
    const rng = makeRng(20260919);
    const director = new CastingDirector();
    for (let i = 0; i < CASES; i += 1) {
      const capabilities = sample(rng, CAPABILITY_CORPUS, 1, 4);
      const scene = sceneWith(capabilities);
      const cast = deriveMinimalCast(scene);
      const errors = director.validate(scene, cast).filter((x) => x.severity === "error");
      expect({ case: i, capabilities, errors }).toEqual({ case: i, capabilities, errors: [] });
      expect(director.minimality(scene, cast).removable).toHaveLength(0);
    }
  });

  test("R-PROP-2 any recast stays valid, minimal and capability-preserving", async () => {
    const rng = makeRng(424242);
    const director = new CastingDirector();
    for (let i = 0; i < CASES; i += 1) {
      const baseCaps = sample(rng, CAPABILITY_CORPUS, 1, 3);
      const scene = sceneWith(baseCaps);
      const base = deriveMinimalCast(scene);
      const baseCapabilities = new Set(base.actors.flatMap((a) => a.capabilities));
      const namesBefore = base.actors.map((a) => a.name);

      const gaps = sample(
        rng,
        CAPABILITY_CORPUS.filter((capability) => !baseCapabilities.has(capability)),
        0,
        2,
      );
      const diagnosis = gaps.length > 0 ? "missing_capability" : "missing_information";
      const evaluation =
        gaps.length > 0
          ? aggregate(scene, [], { diagnosis, missingCapabilities: gaps })
          : aggregate(scene, [], { diagnosis, missingInformation: ["traffic volume"] });

      const recast = await director.cast(scene, {
        attempt: 2,
        previous: base,
        evaluation,
        diagnosis,
      });
      const issues = director.validate(scene, recast);
      expect({ case: i, baseCaps, gaps, errors: issues.filter((x) => x.severity === "error") }).toEqual(
        { case: i, baseCaps, gaps, errors: [] },
      );
      expect(issues.some((x) => x.code === "unproduced_input")).toBe(false);
      expect(director.minimality(scene, recast).removable).toHaveLength(0);

      const after = new Set(recast.actors.flatMap((a) => a.capabilities));
      for (const capability of baseCapabilities) expect(after.has(capability)).toBe(true);
      for (const name of namesBefore) {
        expect(recast.actors.some((actor) => actor.name === name)).toBe(true);
      }
    }
  });

  test("R-PROP-3 card normalisers are total on arbitrary partial input", () => {
    const rng = makeRng(7);
    const sceneKeys = [
      "objective",
      "desired_outcome",
      "known",
      "unknown",
      "assumed",
      "required",
      "success_criteria",
      "required_capabilities",
      "available_tools",
      "failure_modes",
      "interaction_requirements",
      "unresolved_questions",
      "constraints",
      "meta",
    ];
    const castKeys = ["cast", "actors", "protocol", "rationale"];
    const junk = [
      [],
      ["x"],
      [{ text: "y", blocking: true }],
      [null],
      [undefined],
      [{}],
      [{ text: null }],
      "z",
      5,
      null,
      { steps: [] },
      { notes: "n", steps: [{ actor: "a", instruction: "go" }] },
    ];

    for (let i = 0; i < CASES; i += 1) {
      const sceneCard: Record<string, unknown> = {};
      for (const key of sceneKeys) if (rng() < 0.5) sceneCard[key] = pick(rng, junk);
      const scene = sceneFromCard(sceneCard as never);
      expect(typeof scene.objective).toBe("string");
      expect(Array.isArray(scene.successCriteria)).toBe(true);
      expect(Array.isArray(scene.requiredCapabilities)).toBe(true);
      expect(Array.isArray(scene.constraints)).toBe(true);
      expect(typeof scene.meta).toBe("object");

      const castCard: Record<string, unknown> = {};
      for (const key of castKeys) if (rng() < 0.6) castCard[key] = pick(rng, junk);
      const cast = castFromCard(castCard as never);
      expect(Array.isArray(cast.actors)).toBe(true);
      expect(Array.isArray(cast.protocol.steps)).toBe(true);
    }

    // A well-formed card is preserved, not blanked by the coercion.
    const richScene = sceneFromCard({
      objective: "keep me",
      success_criteria: ["c1"],
      required_capabilities: ["cap one"],
      available_tools: ["t1"],
      known: ["k"],
      unknown: [{ text: "u", blocking: true }],
    });
    expect(richScene.objective).toBe("keep me");
    expect(richScene.successCriteria[0]!.description).toBe("c1");
    expect(richScene.requiredCapabilities).toEqual(["cap one"]);
    expect(richScene.availableTools).toEqual(["t1"]);
    expect(richScene.known).toEqual(["k"]);
    expect(richScene.unknown).toEqual([{ text: "u", blocking: true }]);

    const richCast = castFromCard({
      cast: [{ name: "a", role: "r", objective: "o", capabilities: ["c"], produces: ["P"] }],
      protocol: { notes: "n", steps: [{ actor: "a", instruction: "go", produces: ["P"] }] },
    });
    expect(richCast.actors[0]!.name).toBe("a");
    expect(richCast.actors[0]!.capabilities).toEqual(["c"]);
    expect(richCast.actors[0]!.expectedOutput).toEqual(["P"]);
    expect(richCast.protocol.steps[0]!.produces).toEqual(["P"]);

    // null and undefined never throw either
    expect(Array.isArray(sceneFromCard(null as never).requiredCapabilities)).toBe(true);
    expect(Array.isArray(castFromCard(undefined as never).actors)).toBe(true);
  });

  test("R-PROP-4 scene analysis is total over malformed information items", () => {
    const designer = new SceneDesigner();
    const scene = sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["a"],
      unknown: [null, undefined, {}, { text: null }, { text: "real", blocking: true }],
    } as never);
    expect(() => designer.analyze(scene)).not.toThrow();
    expect(designer.analyze(scene).blockingUnknowns).toEqual(["real"]);
  });
});
