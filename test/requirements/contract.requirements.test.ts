import { describe, expect, test } from "bun:test";
import {
  actorFromCard,
  artifact,
  checkContent,
  createActor,
  createLlmExecutor,
  createToolRegistry,
  failed,
  normalizeContracts,
  ok,
  renderActorPrompt,
  sceneFromCard,
  validateShape,
} from "../../src/index.ts";
import type { Actor, ActorContext, Shape } from "../../src/index.ts";

function context(actor: Actor): ActorContext {
  return {
    scene: sceneFromCard({
      objective: "review the migration",
      success_criteria: ["a report exists"],
      required_capabilities: ["migration_review"],
    }),
    actor,
    instruction: "assess the migration",
    inputs: [],
    history: [],
    tools: createToolRegistry(),
    iteration: 1,
  };
}

const reportShape: Shape = {
  type: "object",
  required: ["risks", "mitigation"],
  fields: {
    risks: { type: "array", items: { type: "string" } },
    mitigation: { type: "string" },
  },
};

const report = { risks: ["backfill on a live table"], mitigation: "batch it" };

describe("Artifact content contract requirements", () => {
  test("R-CONTRACT-1 a declarative shape accepts conforming content and names the first mismatch", () => {
    expect(validateShape(reportShape, report)).toBe(true);
    expect(validateShape(reportShape, { risks: ["a"] })).toBe("content.mitigation is required");
    expect(validateShape(reportShape, { risks: [1], mitigation: "x" })).toBe(
      "content.risks[0] must be string, got number",
    );
    expect(validateShape(reportShape, "prose")).toBe("content must be object, got string");
    expect(validateShape({ type: "array", items: { type: "string" } }, "x")).toBe(
      "content must be array, got string",
    );
    // A shape with no constraints accepts anything — it is opt-in, not a whitelist.
    expect(validateShape({}, report)).toBe(true);
  });

  test("R-CONTRACT-2 a host check may refuse, and a throw is a refusal with its message", () => {
    expect(checkContent(undefined, report)).toBe(true);
    expect(checkContent(() => true, report)).toBe(true);
    expect(checkContent(() => "needs a mitigation", report)).toBe("needs a mitigation");
    expect(
      checkContent(
        () => {
          throw new Error("validator exploded");
        },
        report,
      ),
    ).toBe("validator exploded");
    // A check that returns nothing usable reads as a refusal, never as a pass.
    expect(checkContent((() => undefined) as unknown as () => true | string, report)).toBe(
      "contract rejected the content",
    );
  });

  test("R-CONTRACT-3 a mismatch fails the turn, keeps the artifacts and shows the reason", async () => {
    const actor = createActor({
      name: "analyst",
      role: "analyst",
      objective: "assess the migration",
      expectedOutput: ["RiskReport"],
      contentContract: { RiskReport: { type: "object", required: ["mitigation"] } },
    });

    const conforming = createLlmExecutor(async () => "{}", {
      parse: () => ok([artifact("analyst", "RiskReport", { mitigation: "batch it" })]),
    });
    expect((await conforming(context(actor))).status).toBe("ok");

    const malformed = createLlmExecutor(async () => "{}", {
      parse: () => ok([artifact("analyst", "RiskReport", { risks: [] })]),
    });
    const output = await malformed(context(actor));
    expect(output.status).toBe("failed");
    expect(output.error).toContain('artifact "RiskReport"');
    expect(output.error).toContain("content.mitigation is required");
    // The artifacts are kept: a validation failure is still evidence.
    expect(output.artifacts).toHaveLength(1);
  });

  test("R-CONTRACT-4 a card can carry a contract, and malformed entries are dropped", () => {
    const actor = actorFromCard({
      name: "analyst",
      role: "analyst",
      objective: "assess",
      produces: ["RiskReport"],
      contentContract: {
        RiskReport: { type: "object", required: ["mitigation"], bogus: "ignored" },
        Garbage: 42,
        "": { type: "string" },
      },
    });
    expect(Object.keys(actor.contentContract ?? {})).toEqual(["RiskReport"]);
    expect(actor.contentContract?.RiskReport).toEqual({
      type: "object",
      required: ["mitigation"],
    });

    // The snake_case spelling a skill emits is accepted too.
    const snake = actorFromCard({
      name: "a",
      role: "r",
      objective: "o",
      content_contract: { Score: { type: "number" } },
    });
    expect(snake.contentContract).toEqual({ Score: { type: "number" } });

    expect(normalizeContracts("nonsense")).toBeUndefined();
    expect(normalizeContracts({ Score: {} })).toBeUndefined();
    expect(actorFromCard({ name: "a", role: "r", objective: "o" }).contentContract).toBeUndefined();
  });

  test("R-CONTRACT-5 the prompt asks for the shape, so the model can comply", () => {
    const declared = createActor({
      name: "analyst",
      role: "analyst",
      objective: "assess",
      expectedOutput: ["RiskReport"],
      contentContract: {
        RiskReport: {
          type: "object",
          required: ["mitigation"],
          fields: { mitigation: { type: "string" } },
        },
      },
    });
    const prompt = renderActorPrompt(context(declared))
      .map((message) => message.content)
      .join("\n");
    expect(prompt).toContain("Content contract for RiskReport: object{mitigation: string}");

    const hosted = createActor({
      name: "a",
      role: "r",
      objective: "o",
      expectedOutput: ["Report"],
      contentContract: { Report: () => true },
    });
    expect(
      renderActorPrompt(context(hosted))
        .map((message) => message.content)
        .join("\n"),
    ).toContain("must satisfy the host's validator");
  });

  test("R-CONTRACT-6 without a contract nothing changes, and a failed parse is left alone", async () => {
    const actor = createActor({
      name: "analyst",
      role: "analyst",
      objective: "assess",
      expectedOutput: ["RiskReport"],
    });
    const plain = createLlmExecutor(async () => "the report");
    const output = await plain(context(actor));
    expect(output.status).toBe("ok");
    expect(output.artifacts[0]!.content).toBe("the report");
    expect(
      renderActorPrompt(context(actor))
        .map((message) => message.content)
        .join("\n"),
    ).not.toContain("Content contract");

    // An executor that already failed keeps its own reason.
    const refused = createLlmExecutor(async () => "{}", {
      parse: () => failed("the model refused"),
    });
    const refusedOutput = await refused(context(actor));
    expect(refusedOutput.status).toBe("failed");
    expect(refusedOutput.error).toBe("the model refused");
  });
});
