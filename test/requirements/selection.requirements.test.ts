import { describe, expect, test } from "bun:test";
import {
  createActor,
  createCast,
  createPersona,
  createProtocol,
  dressCast,
  sceneFromCard,
} from "../../src/index.ts";
import type { Audition, Auditioner, Cast, Persona, RoleRef } from "../../src/index.ts";

const ada = createPersona({ id: "ada", name: "Ada" });
const bob = createPersona({ id: "bob", name: "Bob" });
const carol = createPersona({ id: "carol", name: "Carol" });

function scene() {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: ["code_review"],
  });
}

function cast(): Cast {
  const reviewer = createActor({
    name: "reviewer",
    role: "reviewer",
    objective: "review",
    capabilities: ["code_review"],
    expectedOutput: ["Review"],
  });
  return createCast(
    [reviewer],
    createProtocol([{ actor: "reviewer", instruction: "review", produces: ["Review"] }]),
  );
}

function recorder(answers: (persona: Persona, roles: RoleRef[]) => Audition[]) {
  const calls: { persona: string; roles: string[] }[] = [];
  const auditioner: Auditioner = ({ roles, persona }) => {
    calls.push({ persona: persona.id, roles: roles.map((role) => role.name) });
    return answers(persona, roles);
  };
  return { auditioner, calls };
}

const acceptAll = () =>
  recorder((persona, roles) =>
    roles.map((role) => ({
      role: role.name,
      persona: persona.id,
      accepted: true,
      approach: `${persona.id} would play ${role.name}`,
    })),
  );

describe("Selection among acceptors", () => {
  test("R-SELECT-1 askAll gathers every acceptor and the selector chooses", async () => {
    const { auditioner, calls } = acceptAll();
    const { cast: dressed, auditions } = await dressCast(cast(), scene(), {
      personas: [ada, bob, carol],
      auditioner,
      askAll: true,
      select: (candidates) => candidates.at(-1)!.persona,
    });

    expect(calls).toHaveLength(3); // everyone was asked
    expect(auditions).toHaveLength(3); // every approach recorded
    expect(dressed.actors[0]!.binding?.persona.id).toBe("carol");
    expect(dressed.actors[0]!.binding?.approach).toBe("carol would play reviewer");
  });

  test("R-SELECT-2 the default choice is roster order and the alternatives are traced", async () => {
    const { auditioner } = acceptAll();
    const { cast: dressed, events } = await dressCast(cast(), scene(), {
      personas: [ada, bob, carol],
      auditioner,
      askAll: true,
    });

    expect(dressed.actors[0]!.binding?.persona.id).toBe("ada");
    const selected = events.find((event) => event.type === "persona_selected");
    expect(selected).toEqual({
      type: "persona_selected",
      role: "reviewer",
      persona: "ada",
      candidates: ["ada", "bob", "carol"],
    });
  });

  test("R-SELECT-3 a selector may leave the role uncast", async () => {
    const { auditioner } = acceptAll();
    const out = await dressCast(cast(), scene(), {
      personas: [ada],
      auditioner,
      select: () => undefined,
    });
    expect(out.cast.actors[0]!.binding).toBeUndefined();
    expect(out.uncast).toEqual(["reviewer"]);
    expect(out.events.some((event) => event.type === "persona_selected")).toBe(false);
  });

  test("R-SELECT-4 without askAll, auditioning stops once the role is filled", async () => {
    const { auditioner, calls } = acceptAll();
    await dressCast(cast(), scene(), { personas: [ada, bob, carol], auditioner });
    expect(calls).toHaveLength(1); // bob and carol are never asked
  });

  test("R-SELECT-5 a persona may accept more than one role", async () => {
    const twoRoles = createCast(
      [
        createActor({
          name: "reviewer",
          role: "reviewer",
          objective: "review",
          capabilities: ["code_review"],
          expectedOutput: ["Review"],
        }),
        createActor({
          name: "analyst",
          role: "analyst",
          objective: "analyse",
          capabilities: ["analysis"],
          expectedOutput: ["Analysis"],
        }),
      ],
      createProtocol([
        { actor: "reviewer", instruction: "review", produces: ["Review"] },
        { actor: "analyst", instruction: "analyse", produces: ["Analysis"] },
      ]),
    );
    const { auditioner } = acceptAll();
    const { cast: dressed } = await dressCast(twoRoles, scene(), {
      personas: [ada],
      auditioner,
      askAll: true,
    });
    expect(dressed.actors.map((actor) => actor.binding?.persona.id)).toEqual(["ada", "ada"]);
  });
});
