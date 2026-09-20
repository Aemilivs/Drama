import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  aggregate,
  castFromCard,
  createActor,
  createCast,
  createProtocol,
  deriveMinimalCast,
  functionActor,
  ok,
  artifact,
  sceneFromCard,
} from "../src/index.ts";
import type { Scene } from "../src/index.ts";

function sceneWithCapabilities(capabilities: string[]): Scene {
  return sceneFromCard({
    objective: "produce something",
    success_criteria: ["something exists"],
    required_capabilities: capabilities,
  });
}

describe("casting", () => {
  test("a minimal derived cast covers every capability and has no removable actor", () => {
    const scene = sceneWithCapabilities(["analysis", "design"]);
    const cast = deriveMinimalCast(scene);
    const director = new CastingDirector();

    expect(director.validate(scene, cast).filter((i) => i.severity === "error")).toHaveLength(0);
    expect(director.minimality(scene, cast).removable).toHaveLength(0);
    expect(cast.actors.map((a) => a.name)).toEqual(["analysis", "design", "synthesizer"]);
  });

  test("a missing capability is an error", () => {
    const scene = sceneWithCapabilities(["analysis", "design"]);
    const partial = createActor({
      name: "analysis",
      role: "analysis",
      objective: "analyse",
      capabilities: ["analysis"],
      expectedOutput: ["AnalysisReport"],
    });
    const cast = createCast(
      [partial],
      createProtocol([{ actor: "analysis", instruction: "analyse", produces: ["AnalysisReport"] }]),
    );
    const issues = new CastingDirector().validate(scene, cast);
    const missing = issues.find((i) => i.code === "missing_capability");
    expect(missing).toBeDefined();
    expect(missing!.message).toContain("design");
  });

  test("an unnecessary actor is flagged", () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const analyst = createActor({
      name: "analyst",
      role: "analyst",
      objective: "analyse",
      capabilities: ["analysis"],
      expectedOutput: ["AnalysisReport"],
    });
    const spare = createActor({
      name: "spare",
      role: "spare",
      objective: "loiter",
      capabilities: ["vibes"],
      expectedOutput: ["VibesReport"],
    });
    const cast = createCast(
      [analyst, spare],
      createProtocol([{ actor: "analyst", instruction: "analyse", produces: ["AnalysisReport"] }]),
    );
    const director = new CastingDirector();
    expect(director.minimality(scene, cast).removable.map((f) => f.actor)).toEqual(["spare"]);
    const warning = director.validate(scene, cast).find((i) => i.code === "unnecessary_actor");
    expect(warning?.severity).toBe("warning");
  });

  test("two actors claiming the same role conflict", () => {
    const scene = sceneWithCapabilities([]);
    const a = createActor({ name: "a", role: "analyst", objective: "one", capabilities: ["x"] });
    const b = createActor({ name: "b", role: "analyst", objective: "two", capabilities: ["y"] });
    const cast = createCast([a, b], createProtocol([{ actor: "a", instruction: "go" }]));
    const issues = new CastingDirector().validate(scene, cast);
    expect(issues.some((i) => i.code === "role_conflict")).toBe(true);
  });

  test("a protocol that consumes an unproduced artifact is an error", () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const analyst = createActor({ name: "analyst", role: "analyst", objective: "analyse", capabilities: ["analysis"] });
    const cast = createCast(
      [analyst],
      createProtocol([{ actor: "analyst", instruction: "analyse", consumes: ["GhostReport"] }]),
    );
    const issues = new CastingDirector().validate(scene, cast);
    expect(issues.some((i) => i.code === "unproduced_input")).toBe(true);
  });

  test("a deterministic non-LLM actor is a first-class cast member", () => {
    const scene = sceneWithCapabilities(["verification"]);
    const verifier = functionActor({
      name: "test-runner",
      role: "verifier",
      objective: "run the test suite",
      capabilities: ["verification"],
      produces: "TestReport",
      run: () => ok([artifact("test-runner", "TestReport", { passed: 12 })]),
    });
    expect(verifier.kind).toBe("deterministic");
    expect(verifier.executor).toBeDefined();

    const cast = createCast(
      [verifier],
      createProtocol([{ actor: "test-runner", instruction: "verify", produces: ["TestReport"] }]),
    );
    const director = new CastingDirector();
    expect(director.validate(scene, cast).filter((i) => i.severity === "error")).toHaveLength(0);
    expect(director.minimality(scene, cast).removable).toHaveLength(0);
  });

  test("the casting director passes the diagnosis to a recast call", async () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const seen: string[] = [];
    const director = new CastingDirector({
      cast: (_scene, ctx) => {
        seen.push(`${ctx.attempt}:${ctx.diagnosis ?? "none"}`);
        return deriveMinimalCast(_scene);
      },
    });
    await director.cast(scene, { attempt: 1 });
    await director.cast(scene, { attempt: 2, diagnosis: "missing_capability" });
    expect(seen).toEqual(["1:none", "2:missing_capability"]);
  });

  test("a one-actor cast for a capability-less scene is not flagged", () => {
    const scene = sceneFromCard({ objective: "just answer", success_criteria: ["answered"] });
    const cast = deriveMinimalCast(scene);
    expect(cast.actors.map((a) => a.name)).toEqual(["reasoning"]);
    expect(new CastingDirector().minimality(scene, cast).removable).toHaveLength(0);
  });

  test("mutually redundant actors flag only one of themselves", () => {
    const scene = sceneWithCapabilities(["x"]);
    const a = createActor({ name: "a", role: "a", objective: "do", capabilities: ["x"], expectedOutput: ["A"] });
    const b = createActor({ name: "b", role: "b", objective: "do", capabilities: ["x"], expectedOutput: ["B"] });
    const cast = createCast(
      [a, b],
      createProtocol([
        { actor: "a", instruction: "do", produces: ["A"] },
        { actor: "b", instruction: "do", produces: ["B"] },
      ]),
    );
    const removable = new CastingDirector().minimality(scene, cast).removable;
    expect(removable).toHaveLength(1);
  });

  test("a referenced actor that provides nothing and feeds no one is removable", () => {
    const scene = sceneWithCapabilities(["x"]);
    const real = createActor({ name: "real", role: "real", objective: "do", capabilities: ["x"], expectedOutput: ["R"] });
    const idle = createActor({ name: "idle", role: "idle", objective: "observe", capabilities: [], expectedOutput: ["Notes"] });
    const cast = createCast(
      [real, idle],
      createProtocol([
        { actor: "real", instruction: "do", produces: ["R"] },
        { actor: "idle", instruction: "observe", produces: ["Notes"] },
      ]),
    );
    expect(
      new CastingDirector().minimality(scene, cast).removable.map((f) => f.actor),
    ).toContain("idle");
  });
  test("the default director fills a diagnosed capability gap", async () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const director = new CastingDirector();
    const first = await director.cast(scene, { attempt: 1 });
    const evaluation = aggregate(scene, [], {
      diagnosis: "missing_capability",
      missingCapabilities: ["compliance"],
    });
    const recast = await director.cast(scene, {
      attempt: 2,
      previous: first,
      evaluation,
      diagnosis: "missing_capability",
    });

    // actors that worked are kept, the gap is filled, the cast stays valid
    expect(recast.actors.map((a) => a.name)).toContain("analysis");
    expect(recast.actors.map((a) => a.name)).toContain("compliance");
    expect(director.validate(scene, recast).filter((i) => i.severity === "error")).toHaveLength(0);
    expect(director.minimality(scene, recast).removable).toHaveLength(0);
  });

  test("the default director adds a researcher for missing information", async () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const director = new CastingDirector();
    const first = await director.cast(scene, { attempt: 1 });
    const evaluation = aggregate(scene, [], {
      diagnosis: "missing_information",
      missingInformation: ["current traffic volume"],
    });
    const recast = await director.cast(scene, {
      attempt: 2,
      previous: first,
      evaluation,
      diagnosis: "missing_information",
    });

    const researcher = recast.actors.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher!.expectedOutput).toEqual(["ResearchReport"]);
    expect(director.validate(scene, recast).filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("a recast with a pre-existing synthesizer wires the new actor correctly", async () => {
    const scene = sceneWithCapabilities(["analysis", "design"]);
    const director = new CastingDirector();
    const first = deriveMinimalCast(scene); // has a synthesizer
    const evaluation = aggregate(scene, [], {
      diagnosis: "missing_capability",
      missingCapabilities: ["compliance"],
    });
    const recast = await director.cast(scene, {
      attempt: 2,
      previous: first,
      evaluation,
      diagnosis: "missing_capability",
    });

    const steps = recast.protocol.steps;
    const names = steps.map((step) => step.actor);
    const synthIndex = names.indexOf("synthesizer");
    const complianceIndex = names.findIndex((name) => name.startsWith("compliance"));
    expect(complianceIndex).toBeGreaterThanOrEqual(0);
    expect(complianceIndex).toBeLessThan(synthIndex);
    expect(steps[synthIndex]!.consumes).toContain("ComplianceReport");
    expect(director.validate(scene, recast).filter((i) => i.severity === "error")).toHaveLength(0);
    expect(director.minimality(scene, recast).removable).toHaveLength(0);
  });

  test("a recast never introduces a role conflict", async () => {
    const scene = sceneWithCapabilities([]);
    const alpha = createActor({
      name: "alpha",
      role: "compliance",
      objective: "do",
      capabilities: ["x"],
      expectedOutput: ["XReport"],
    });
    const base = createCast(
      [alpha],
      createProtocol([{ actor: "alpha", instruction: "do", produces: ["XReport"] }]),
    );
    const evaluation = aggregate(scene, [], {
      diagnosis: "missing_capability",
      missingCapabilities: ["compliance"],
    });
    const recast = await new CastingDirector().cast(scene, {
      attempt: 2,
      previous: base,
      evaluation,
      diagnosis: "missing_capability",
    });
    expect(
      new CastingDirector().validate(scene, recast).filter((i) => i.code === "role_conflict"),
    ).toHaveLength(0);
  });

  test("a bad execution keeps the cast unchanged", async () => {
    const scene = sceneWithCapabilities(["analysis"]);
    const director = new CastingDirector();
    const first = await director.cast(scene, { attempt: 1 });
    const recast = await director.cast(scene, {
      attempt: 2,
      previous: first,
      diagnosis: "bad_execution",
    });
    expect(recast.actors.map((a) => a.name)).toEqual(first.actors.map((a) => a.name));
  });
});

describe("cast cards", () => {
  test("a cast card emitted by a skill normalises into a Cast", () => {
    const cast = castFromCard({
      rationale: "one observer, one adversary",
      cast: [
        {
          name: "observer",
          role: "observer",
          objective: "observe",
          capabilities: ["observation"],
          produces: "Observation",
        },
        {
          name: "adversary",
          role: "adversary",
          objective: "challenge the observation",
          capabilities: ["challenge"],
          expectedOutput: ["Critique"],
          interactionPermissions: ["challenge:observer"],
        },
      ],
      protocol: {
        notes: "observe, then challenge",
        steps: [
          { actor: "observer", instruction: "observe", produces: ["Observation"] },
          {
            actor: "adversary",
            instruction: "challenge",
            consumes: ["Observation"],
            produces: ["Critique"],
          },
        ],
      },
    });

    expect(cast.actors.map((a) => a.name)).toEqual(["observer", "adversary"]);
    expect(cast.actors[1]!.expectedOutput).toEqual(["Critique"]);
    expect(cast.protocol.steps[1]!.consumes).toEqual(["Observation"]);
    expect(cast.rationale).toContain("adversary");

    const issues = new CastingDirector().validate(
      sceneWithCapabilities(["observation", "challenge"]),
      cast,
    );
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("an empty cast card is still a valid Cast object", () => {
    const cast = castFromCard({});
    expect(cast.actors).toEqual([]);
    expect(cast.protocol.steps).toEqual([]);
    expect(typeof cast.id).toBe("string");
  });
});
