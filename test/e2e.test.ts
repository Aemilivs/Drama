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

  test("the example's designed conflict validates cleanly", () => {
    const issues = new CastingDirector().validate(buildScene(), buildCast());
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(issues.filter((issue) => issue.severity === "warning")).toHaveLength(0);
    expect(buildCast().actors.find((actor) => actor.name === "skeptic")?.stance).toEqual({
      opposes: "metrics_analysis",
      toYield: "Critique",
    });
  });
});
