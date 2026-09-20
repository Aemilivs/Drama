import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  aggregate,
  artifact,
  createCast,
  createProtocol,
  deriveMinimalCast,
  functionActor,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type { Evaluation, Scene } from "../../src/index.ts";

describe("Cross-cutting requirements", () => {
  test("R-X-1 a recast does not mutate the previous cast", async () => {
    const scene = sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["a"],
    });
    const director = new CastingDirector();
    const first = deriveMinimalCast(scene);
    const snapshot = JSON.stringify(first);
    const evaluation = aggregate(scene, [], {
      diagnosis: "missing_capability",
      missingCapabilities: ["b"],
    });
    await director.cast(scene, {
      attempt: 2,
      previous: first,
      evaluation,
      diagnosis: "missing_capability",
    });
    expect(JSON.stringify(first)).toBe(snapshot);
  });

  test("R-X-2 a redesign does not mutate the original scene", async () => {
    const original: Scene = sceneFromCard({
      objective: "original",
      success_criteria: ["a fix exists"],
      required_capabilities: ["fix"],
    });
    const snapshot = JSON.stringify(original);

    const wrongActor = functionActor({
      name: "wrong", role: "wrong", objective: "solve", capabilities: ["fix"], produces: "Draft",
      run: () => ok([artifact("wrong", "Draft", "irrelevant")]),
    });
    const castA = createCast(
      [wrongActor],
      createProtocol([{ actor: "wrong", instruction: "solve", produces: ["Draft"] }]),
    );
    const rightActor = functionActor({
      name: "right", role: "right", objective: "solve", capabilities: ["fix"], produces: "Fix",
      run: () => ok([artifact("right", "Fix", "real")]),
    });
    const castB = createCast(
      [rightActor],
      createProtocol([{ actor: "right", instruction: "solve", produces: ["Fix"] }]),
    );
    const sceneDesigner = new SceneDesigner({
      design: () => ({
        objective: "REDESIGNED",
        success_criteria: ["a fix exists"],
        required_capabilities: ["fix"],
      }),
    });
    const castingDirector = new CastingDirector({
      cast: (s) => (s.objective.startsWith("REDESIGNED") ? castB : castA),
    });
    const evaluator = new Evaluator((ctx): Evaluation => {
      const fixed = ctx.artifacts.some((a) => a.kind === "Fix");
      return {
        id: "e",
        status: fixed ? "pass" : "fail",
        criteria: [
          {
            criterion: ctx.scene.successCriteria[0]!.id,
            status: fixed ? "pass" : "fail",
            evidence: fixed ? "fix present" : "no fix",
          },
        ],
        issues: [],
        recommendedAction: fixed ? "finish" : "redesign_scene",
        diagnosis: fixed ? "unspecified" : "malformed_problem",
        createdAt: 0,
        meta: {},
      };
    });

    const performance = await new StageManager({
      evaluator,
      castingDirector,
      sceneDesigner,
    }).perform(original, castA);

    expect(performance.finalResult.status).toBe("done");
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(performance.scenes[0]!.objective).toBe("original");
  });
});
