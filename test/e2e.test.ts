import { describe, expect, test } from "bun:test";
import { CastingDirector } from "../src/index.ts";
import { buildCast, buildScene, runIncidentExample } from "../examples/incident-rca/run.ts";

describe("incident root-cause example", () => {
  test("the cast converges on the evidence-backed cause the single answer misses", async () => {
    const result = await runIncidentExample();

    expect(result.performance.finalResult.status).toBe("done");
    expect(result.rootCause).toBeDefined();
    expect(result.rootCause!.cause).toMatch(/bcrypt/i);
    expect(result.rootCause!.ruledOut.join(" ")).toMatch(/database/i);

    // Every actor was activated exactly once: a minimal cast, not a crowd.
    expect(result.performance.events.filter((e) => e.type === "actor_activated")).toHaveLength(4);
    expect(result.performance.iterations).toHaveLength(1);

    // The multi-role performance beats the single generic answer.
    expect(result.castScore.passed).toBe(4);
    expect(result.baselineScore.passed).toBeLessThan(result.castScore.passed);
    expect(result.baselineScore.namesSpecificCause).toBe(false);
  });

  test("the example validates cleanly, and its fake edge is reported", () => {
    const issues = new CastingDirector().validate(buildScene(), buildCast());
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    // The two analysts never read each other: the protocol serializes them, and
    // the fake-edge check says so instead of hiding it.
    expect(issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code)).toEqual([
      "independent_steps",
    ]);
    expect(buildCast().actors.find((actor) => actor.name === "skeptic")?.stance).toEqual({
      opposes: "metrics_analysis",
      toYield: "Critique",
    });
  });
});
