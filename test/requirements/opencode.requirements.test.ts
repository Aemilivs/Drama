import { describe, expect, test } from "bun:test";
import {
  createActor,
  createCast,
  createProtocol,
  dressCast,
  parseOpencodeAgent,
  personaFromOpencodeAgent,
  personasFromOpencodeAgents,
  sceneFromCard,
} from "../../src/index.ts";
import type { Auditioner } from "../../src/index.ts";

const VIMES = `---
description: >-
  Use this agent when a major project step has been completed and needs to be reviewed against the original plan and
  coding standards.

  Examples:
  <example>
  Context: The user has finished a feature.
  user: "I've finished the auth system"
  assistant: "I'll have the reviewer examine it."
  </example>
  <example>
  Context: A numbered step from the plan is done.
  user: "Step 2 is complete"
  assistant: "Reviewing it now."
  </example>
mode: all
model: deepseek/deepseek-flash
color: primary
permission:
  edit: deny
  task: allow
  batch: allow
---

You are a meticulous reviewer. Judge the work against the plan and identify issues.
`;

describe("OpenCode agent adapter requirements", () => {
  test("R-OCAGENT-1 a folded description and the body are parsed, model and mode kept", () => {
    const card = parseOpencodeAgent(VIMES, { id: "Vimes" });
    expect(card.description).toContain("reviewed against the original plan and coding standards");
    expect(card.description).not.toContain("Context:");
    expect(card.prompt).toContain("You are a meticulous reviewer");
    expect(card.model).toBe("deepseek/deepseek-flash");
    expect(card.mode).toBe("all");
  });

  test("R-OCAGENT-2 the id comes from the caller and the name is title-cased", () => {
    const persona = personaFromOpencodeAgent(VIMES, { id: "leonard-of-quirm" });
    expect(persona.id).toBe("leonard-of-quirm");
    expect(persona.name).toBe("Leonard Of Quirm");
  });

  test("R-OCAGENT-3 example blocks never leak into the persona description", () => {
    const persona = personaFromOpencodeAgent(VIMES, { id: "Vimes" });
    expect(persona.description).not.toContain("<example>");
    expect(persona.description).not.toContain("I've finished the auth system");
  });

  test("R-OCAGENT-4 parsing is total: malformed or absent frontmatter never throws", () => {
    const noFrontmatter = personaFromOpencodeAgent("just a prompt", { id: "plain" });
    expect(noFrontmatter.personaPrompt).toBe("just a prompt");
    expect(noFrontmatter.description).toBe("");

    const unclosed = personaFromOpencodeAgent("---\ndescription: broken", { id: "broken" });
    expect(typeof unclosed.name).toBe("string");

    const empty = parseOpencodeAgent("", { id: "empty" });
    expect(empty.prompt).toBe("");
    expect(empty.fields).toEqual({});
  });

  test("R-OCAGENT-5 an agent persona declares no capabilities and is bound only by an audition", async () => {
    const persona = personaFromOpencodeAgent(VIMES, { id: "Vimes" });
    expect(persona.source).toEqual({ kind: "opencode-agent", ref: "Vimes" });
    expect(persona).not.toHaveProperty("capabilities");
    expect(persona).not.toHaveProperty("tags");

    const scene = sceneFromCard({
      objective: "o",
      success_criteria: ["c"],
      required_capabilities: ["review"],
    });
    const reviewer = createActor({
      name: "reviewer",
      role: "reviewer",
      objective: "review",
      capabilities: ["review"],
      expectedOutput: ["Review"],
    });
    const cast = createCast(
      [reviewer],
      createProtocol([{ actor: "reviewer", instruction: "review", produces: ["Review"] }]),
    );
    const auditioner: Auditioner = () => [
      { role: "reviewer", persona: "Vimes", accepted: true, approach: "assume nothing" },
    ];

    const { cast: dressed } = await dressCast(cast, scene, { personas: [persona], auditioner });
    expect(dressed.actors[0]!.binding?.persona.id).toBe("Vimes");
    expect(dressed.actors[0]!.binding?.approach).toBe("assume nothing");
  });

  test("R-OCAGENT-7 quotes are only stripped when they wrap the whole value", () => {
    const card = parseOpencodeAgent(
      "---\ndescription: Respect the users' constraints\nmodel: \"quoted model\"\n---\n\nbody",
      { id: "x" },
    );
    expect(card.description).toBe("Respect the users' constraints");
    expect(card.model).toBe("quoted model");
  });

  test("R-OCAGENT-8 leading blank lines and key case do not defeat the parser", () => {
    const card = parseOpencodeAgent(
      "\n  \n---\nDescription: Looks things up.\nMode: all\n---\n\nbody",
      { id: "x" },
    );
    expect(card.description).toBe("Looks things up.");
    expect(card.mode).toBe("all");
    expect(card.prompt).toBe("body");
  });

  test("R-OCAGENT-6 a whole agents directory becomes a roster", () => {
    const roster = personasFromOpencodeAgents([
      { id: "Vimes", markdown: VIMES },
      { id: "librarian", markdown: "---\ndescription: Looks things up.\n---\n\nFind sources." },
    ]);
    expect(roster.map((persona) => persona.id)).toEqual(["Vimes", "librarian"]);
    expect(roster[1]!.name).toBe("Librarian");
    expect(roster[1]!.source).toEqual({ kind: "opencode-agent", ref: "librarian" });
  });

  test("R-OCAGENT-9 a disabled agent is never a performer", () => {
    const disabled = "---\ndescription: Turned off.\ndisable: true\n---\n\nbody";
    const roster = personasFromOpencodeAgents([
      { id: "Vimes", markdown: VIMES },
      { id: "build", markdown: disabled },
    ]);
    expect(roster.map((persona) => persona.id)).toEqual(["Vimes"]);

    const kept = personasFromOpencodeAgents([{ id: "build", markdown: disabled }], {
      excludeDisabled: false,
    });
    expect(kept.map((persona) => persona.id)).toEqual(["build"]);
  });

  test("R-OCAGENT-10 primary agents are kept unless the caller excludes them", () => {
    const primary = "---\ndescription: Entry point.\nmode: primary\n---\n\nbody";
    const agents = [
      { id: "Vimes", markdown: VIMES },
      { id: "Vetinari", markdown: primary },
    ];
    expect(personasFromOpencodeAgents(agents).map((persona) => persona.id)).toEqual([
      "Vimes",
      "Vetinari",
    ]);
    expect(
      personasFromOpencodeAgents(agents, { excludePrimary: true }).map((persona) => persona.id),
    ).toEqual(["Vimes"]);
  });

  test("R-OCAGENT-11 the orchestrator can be excluded by id", () => {
    const primary = "---\ndescription: Entry point.\nmode: primary\n---\n\nbody";
    const roster = personasFromOpencodeAgents(
      [
        { id: "Vimes", markdown: VIMES },
        { id: "Vetinari", markdown: primary },
      ],
      { exclude: ["Vetinari"], excludePrimary: true },
    );
    expect(roster.map((persona) => persona.id)).toEqual(["Vimes"]);
  });
});
