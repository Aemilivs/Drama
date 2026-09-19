import { describe, expect, test } from "bun:test";
import {
  parseAuditionAnswer,
  renderCastingCall,
} from "../../.opencode/lib/audition-prompt.ts";
import { runAuditionExample } from "../../examples/audition/run.ts";
import {
  createActor,
  createCast,
  createProtocol,
  dressCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { Cast, Persona, RoleRef } from "../../src/index.ts";

const roleRef: RoleRef = {
  name: "reviewer",
  role: "reviewer",
  objective: "Review the change and give a verdict",
  capabilities: ["code_review"],
  expectedOutput: ["Review"],
  constraints: ["read-only"],
  interactionPermissions: ["challenge:author"],
};

const ada: Persona = { id: "ada", name: "Ada", archetype: "Auditor", source: { kind: "builtin" } };

describe("Casting call requirements", () => {
  test("R-AUDITION-1 the casting call describes every role and demands JSON only", () => {
    const prompt = renderCastingCall([roleRef], ada, "Decide whether to merge");
    expect(prompt).toContain("Decide whether to merge");
    expect(prompt).toContain("Ada");
    expect(prompt).toContain("reviewer");
    expect(prompt).toContain("code_review");
    expect(prompt).toContain("Review the change and give a verdict");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("NOT a request to do the work");
    expect(prompt).toContain('"auditions"');
  });

  test("R-AUDITION-2 an answer wrapped in prose or a fence is still parsed", () => {
    const text =
      'Sure, here you go:\n```json\n{"auditions":[{"role":"reviewer","accepted":true,"approach":"Read the diff first"}]}\n```\n';
    const auditions = parseAuditionAnswer(text, "ada", ["reviewer"]);
    expect(auditions).toHaveLength(1);
    expect(auditions[0]!.accepted).toBe(true);
    expect(auditions[0]!.approach).toBe("Read the diff first");
  });

  test("R-AUDITION-3 unparseable output is a decline, never an invented acceptance", () => {
    for (const text of ["I would rather not.", "", "{ broken json", "[1,2,3]"]) {
      const auditions = parseAuditionAnswer(text, "ada", ["reviewer"]);
      expect(auditions).toHaveLength(1);
      expect(auditions[0]!.accepted).toBe(false);
      expect(auditions[0]!.reason).toBe("no parseable answer");
    }
  });

  test("R-AUDITION-4 a partial answer declines the roles it omits", () => {
    const text = '{"auditions":[{"role":"reviewer","accepted":true}]}';
    const auditions = parseAuditionAnswer(text, "ada", ["reviewer", "analyst"]);
    expect(auditions.find((a) => a.role === "reviewer")!.accepted).toBe(true);
    const analyst = auditions.find((a) => a.role === "analyst")!;
    expect(analyst.accepted).toBe(false);
    expect(analyst.reason).toBe("no parseable answer");
  });

  test("R-AUDITION-5 parsed answers drive dressing", async () => {
    const scene = sceneFromCard({
      objective: "review",
      success_criteria: ["c"],
      required_capabilities: ["code_review", "analysis"],
    });
    const reviewer = createActor({
      name: "reviewer",
      role: "reviewer",
      objective: "review",
      capabilities: ["code_review"],
      expectedOutput: ["Review"],
    });
    const analyst = createActor({
      name: "analyst",
      role: "analyst",
      objective: "analyse",
      capabilities: ["analysis"],
      expectedOutput: ["Analysis"],
    });
    const cast: Cast = createCast(
      [reviewer, analyst],
      createProtocol([
        { actor: "reviewer", instruction: "review", produces: ["Review"] },
        { actor: "analyst", instruction: "analyse", produces: ["Analysis"] },
      ]),
    );

    // A persona that accepts review and declines analysis, as a real agent might.
    const reply = '{"auditions":[{"role":"reviewer","accepted":true,"approach":"strict"}]}';
    const answers = parseAuditionAnswer(reply, "ada", ["reviewer", "analyst"]);
    const auditioner = () => answers;

    const { cast: dressed, uncast } = await dressCast(cast, scene, {
      personas: [ada],
      auditioner,
    });
    expect(dressed.actors.find((a) => a.name === "reviewer")!.binding?.persona.id).toBe("ada");
    expect(dressed.actors.find((a) => a.name === "analyst")!.binding).toBeUndefined();
    expect(uncast).toEqual(["analyst"]);
  });

  test("R-AUDITION-6 a recorded casting call binds deterministically from a warm store", async () => {
    const { gathered, dressed, binding, candidates } = await runAuditionExample();
    expect(gathered).toHaveLength(3);
    expect(gathered.every((audition) => audition.accepted)).toBe(true);
    expect(gathered.every((audition) => (audition.approach ?? "").length > 0)).toBe(true);
    expect(binding).toBe("Vimes");
    expect(candidates).toEqual(["Vimes", "Feegle", "Librarian"]);
    expect(dressed.uncast).toEqual([]);
    expect(dressed.auditions).toHaveLength(3);
    expect(dressed.auditions.every((audition) => audition.cached)).toBe(true);
  });
});
