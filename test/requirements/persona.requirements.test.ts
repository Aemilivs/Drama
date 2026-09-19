import { describe, expect, test } from "bun:test";
import {
  CastingDirector,
  Evaluator,
  StageManager,
  acceptAllAuditioner,
  artifact,
  createActor,
  createCast,
  createMemoryAuditionStore,
  createPersona,
  createProtocol,
  createToolRegistry,
  criterionEvaluator,
  dressCast,
  functionActor,
  ok,
  renderActorPrompt,
  roleFingerprint,
  roleRefOf,
  sceneFromCard,
} from "../../src/index.ts";
import type {
  ActorContext,
  Audition,
  Auditioner,
  Cast,
  Evaluation,
  Persona,
  RoleRef,
  Scene,
} from "../../src/index.ts";

function scene(): Scene {
  return sceneFromCard({
    objective: "o",
    success_criteria: ["c"],
    required_capabilities: ["research", "review"],
  });
}

function roles(): Cast {
  const researcher = functionActor({
    name: "researcher",
    role: "researcher",
    objective: "find facts",
    capabilities: ["research"],
    produces: "ResearchReport",
    run: () => ok([artifact("researcher", "ResearchReport", "r")]),
  });
  const reviewer = functionActor({
    name: "reviewer",
    role: "reviewer",
    objective: "review the findings",
    capabilities: ["review"],
    produces: "Review",
    run: () => ok([artifact("reviewer", "Review", "v")]),
  });
  return createCast(
    [researcher, reviewer],
    createProtocol([
      { actor: "researcher", instruction: "find", produces: ["ResearchReport"] },
      {
        actor: "reviewer",
        instruction: "review",
        consumes: ["ResearchReport"],
        produces: ["Review"],
      },
    ]),
  );
}

const ada = createPersona({ id: "ada", name: "Ada" });
const bob = createPersona({ id: "bob", name: "Bob" });

function recorder(answers: (persona: Persona, roles: RoleRef[]) => Audition[]) {
  const calls: { persona: string; roles: string[] }[] = [];
  const auditioner: Auditioner = ({ roles: openRoles, persona }) => {
    calls.push({ persona: persona.id, roles: openRoles.map((role) => role.name) });
    return answers(persona, openRoles);
  };
  return { auditioner, calls };
}

function actorContext(actor: Cast["actors"][number]): ActorContext {
  return {
    scene: scene(),
    actor,
    instruction: "go",
    inputs: [],
    history: [],
    tools: createToolRegistry(),
    iteration: 1,
  };
}

function passEvaluator(target: Scene): Evaluator {
  return new Evaluator(
    criterionEvaluator(
      target.successCriteria.map((criterion) => ({
        criterion,
        check: () => ({ status: "pass" as const, evidence: "ok" }),
      })),
    ),
  );
}

describe("Persona and audition requirements", () => {
  test("R-PERSONA-1 a persona declares no fit; only its answer decides", async () => {
    const { auditioner } = recorder(() => [
      { role: "researcher", persona: "p", accepted: true },
    ]);
    const misleading = createPersona({
      id: "p",
      name: "P",
      archetype: "Auditor",
      description: "only audits ledgers",
    });
    const other = createPersona({
      id: "p",
      name: "P",
      archetype: "Poet",
      description: "only writes verse",
    });

    const first = await dressCast(roles(), scene(), { personas: [misleading], auditioner });
    const second = await dressCast(roles(), scene(), { personas: [other], auditioner });
    const bound = (cast: Cast) =>
      cast.actors.find((actor) => actor.name === "researcher")!.binding?.persona.id;

    // Metadata is never read: the same answers bind identically regardless of it.
    expect(bound(first.cast)).toBe("p");
    expect(bound(second.cast)).toBe("p");
  });

  test("R-PERSONA-2 a declining persona is not bound; an accepting one is", async () => {
    const { auditioner } = recorder((persona) =>
      persona.id === "ada"
        ? [{ role: "researcher", persona: "ada", accepted: false, reason: "no tools" }]
        : [{ role: "researcher", persona: "bob", accepted: true, approach: "follow the money" }],
    );
    const { cast } = await dressCast(roles(), scene(), { personas: [ada, bob], auditioner });
    const researcher = cast.actors.find((actor) => actor.name === "researcher")!;
    expect(researcher.binding?.persona.id).toBe("bob");
    expect(researcher.binding?.approach).toBe("follow the money");
  });

  test("R-PERSONA-3 nobody accepting leaves the role persona-less and unchanged", async () => {
    const { auditioner } = recorder(() => []);
    const original = roles();
    const { cast, uncast } = await dressCast(original, scene(), {
      personas: [ada],
      auditioner,
    });
    expect(cast.actors.every((actor) => !actor.binding)).toBe(true);
    expect(uncast).toEqual(["researcher", "reviewer"]);
    expect(cast.actors.map((actor) => actor.expectedOutput)).toEqual(
      original.actors.map((actor) => actor.expectedOutput),
    );
  });

  test("R-PERSONA-4 auditions are a casting call: one per persona, roles batched", async () => {
    const { auditioner, calls } = recorder(() => []);
    await dressCast(roles(), scene(), { personas: [ada, bob], auditioner, maxAuditions: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.roles).toEqual(["researcher", "reviewer"]);

    // With everyone accepting, the second persona is never asked.
    const accepting = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "x", accepted: true })),
    );
    await dressCast(roles(), scene(), {
      personas: [ada, bob],
      auditioner: accepting.auditioner,
    });
    expect(accepting.calls).toHaveLength(1);
  });

  test("R-PERSONA-5 identical audition answers yield an identical cast", async () => {
    const run = async () => {
      const { auditioner } = recorder(() => [
        { role: "researcher", persona: "ada", accepted: true, approach: "dig" },
      ]);
      const { cast } = await dressCast(roles(), scene(), { personas: [ada], auditioner });
      return cast.actors.map((actor) => `${actor.name}:${actor.binding?.persona.id ?? "-"}`);
    };
    expect(await run()).toEqual(await run());
  });

  test("R-PERSONA-6 the approach reaches the prompt and never changes the artifact kinds", async () => {
    const { auditioner } = recorder(() => [
      { role: "researcher", persona: "ada", accepted: true, approach: "follow the money" },
    ]);
    const withPrompt = createPersona({
      id: "ada",
      name: "Ada",
      personaPrompt: "speak plainly",
    });
    const { cast } = await dressCast(roles(), scene(), {
      personas: [withPrompt],
      auditioner,
    });
    const actor = cast.actors.find((candidate) => candidate.name === "researcher")!;

    expect(actor.expectedOutput).toEqual(
      roles().actors.find((candidate) => candidate.name === "researcher")!.expectedOutput,
    );

    const messages = renderActorPrompt(actorContext(actor));
    const system = messages.find((message) => message.role === "system")!.content;
    expect(system).toContain("Ada");
    expect(system).toContain("speak plainly");
    expect(system).toContain("follow the money");
  });

  test("R-PERSONA-7 a cache hit does not call the auditioner again", async () => {
    const store = createMemoryAuditionStore();
    const { auditioner, calls } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "ada", accepted: true })),
    );
    await dressCast(roles(), scene(), { personas: [ada], auditioner, store });
    expect(calls).toHaveLength(1);

    const second = await dressCast(roles(), scene(), { personas: [ada], auditioner, store });
    expect(calls).toHaveLength(1); // unchanged: everything was cached
    expect(second.cast.actors.every((actor) => actor.binding?.persona.id === "ada")).toBe(true);
    expect(second.auditions.every((audition) => audition.cached)).toBe(true);
  });

  test("R-PERSONA-8 a refusal is scoped to the role, not the capability", async () => {
    const store = createMemoryAuditionStore();
    const { auditioner } = recorder(() => [
      { role: "researcher", persona: "ada", accepted: false, reason: "no metrics tool" },
    ]);
    await dressCast(roles(), scene(), { personas: [ada], auditioner, store });

    // Same capability, different formulation: a different question, asked again.
    const researcherB = functionActor({
      name: "researcher",
      role: "researcher",
      objective: "synthesise the literature",
      capabilities: ["research"],
      produces: "ResearchReport",
      run: () => ok([]),
    });
    const castB = createCast(
      [researcherB],
      createProtocol([{ actor: "researcher", instruction: "go", produces: ["ResearchReport"] }]),
    );
    let askedAgain = false;
    const auditionerB: Auditioner = () => {
      askedAgain = true;
      return [{ role: "researcher", persona: "ada", accepted: true }];
    };
    const out = await dressCast(castB, scene(), { personas: [ada], auditioner: auditionerB, store });
    expect(askedAgain).toBe(true);
    expect(out.cast.actors[0]!.binding?.persona.id).toBe("ada");
  });

  test("R-PERSONA-9 changing the role spec invalidates the cache", async () => {
    const store = createMemoryAuditionStore();
    const { auditioner, calls } = recorder(() => [
      { role: "researcher", persona: "ada", accepted: false },
    ]);
    await dressCast(roles(), scene(), { personas: [ada], auditioner, store });
    expect(calls).toHaveLength(1);

    const changed = roles();
    changed.actors[0] = { ...changed.actors[0]!, objective: "a changed objective" };
    const { auditioner: auditioner2, calls: calls2 } = recorder(() => [
      { role: "researcher", persona: "ada", accepted: true },
    ]);
    const out = await dressCast(changed, scene(), { personas: [ada], auditioner: auditioner2, store });

    expect(calls2.length).toBeGreaterThanOrEqual(1);
    expect(out.cast.actors.find((actor) => actor.name === "researcher")!.binding?.persona.id).toBe(
      "ada",
    );
  });

  test("R-PERSONA-10 the refusal reason is kept and never becomes a capability ban", async () => {
    const store = createMemoryAuditionStore();
    const { auditioner } = recorder((_persona, openRoles) => [
      { role: "researcher", persona: "ada", accepted: false, reason: "lacks the metrics tool" },
    ]);
    await dressCast(roles(), scene(), { personas: [ada], auditioner, store });

    const stored = store.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.accepted).toBe(false);
    expect(stored[0]!.reason).toBe("lacks the metrics tool");
    // The record is keyed by role content only — there is no capability field to ban.
    expect(stored[0]!.fingerprint).toBe(roleFingerprint(roleRefOf(roles().actors[0]!)));
    expect(stored[0]).not.toHaveProperty("capability");
  });

  test("R-PERSONA-11 an all-declined cast is still valid and reported as uncast", async () => {
    const { auditioner } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({
        role: role.name,
        persona: "ada",
        accepted: false,
        reason: "not for me",
      })),
    );
    const out = await dressCast(roles(), scene(), { personas: [ada], auditioner });
    expect(out.uncast).toEqual(["researcher", "reviewer"]);
    expect(out.cast.actors.every((actor) => !actor.binding)).toBe(true);

    const issues = new CastingDirector().validate(scene(), out.cast);
    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  test("R-PERSONA-12 a cache hit is recorded in the trace", async () => {
    const store = createMemoryAuditionStore();
    const { auditioner } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "ada", accepted: true })),
    );
    await dressCast(roles(), scene(), { personas: [ada], auditioner, store });
    const second = await dressCast(roles(), scene(), { personas: [ada], auditioner, store });

    expect(second.auditions.length).toBeGreaterThan(0);
    expect(second.auditions.every((audition) => audition.cached)).toBe(true);
    expect(second.events.filter((event) => event.type === "audition_cached")).toHaveLength(2);
  });

  test("R-PERSONA-13 a performance dresses its cast and traces the binding", async () => {
    const s = scene();
    const { auditioner } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({
        role: role.name,
        persona: "ada",
        accepted: true,
        approach: "be terse",
      })),
    );
    const performance = await new StageManager({
      evaluator: passEvaluator(s),
      personas: [ada],
      auditioner,
    }).perform(s, roles());

    expect(performance.cast.actors.every((actor) => actor.binding?.persona.id === "ada")).toBe(true);
    const types = performance.events.map((event) => event.type);
    expect(types[0]).toBe("cast_selected");
    expect(types).toContain("persona_bound");
    expect(types.at(-1)).toBe("finished");
  });

  test("R-PERSONA-14 without a roster the performance is unchanged", async () => {
    const s = scene();
    const performance = await new StageManager({ evaluator: passEvaluator(s) }).perform(s, roles());
    expect(performance.cast.actors.every((actor) => !actor.binding)).toBe(true);
    expect(
      performance.events.some(
        (event) => event.type === "persona_bound" || event.type === "audition_cached",
      ),
    ).toBe(false);
  });

  test("R-PERSONA-15 a recast dresses the newly added roles", async () => {
    const s = sceneFromCard({
      objective: "assess",
      success_criteria: ["compliance is covered"],
      required_capabilities: ["analysis"],
    });
    const analyst = functionActor({
      name: "analysis",
      role: "analysis",
      objective: "analyse",
      capabilities: ["analysis"],
      produces: "AnalysisReport",
      run: () => ok([artifact("analysis", "AnalysisReport", "a")]),
    });
    const castA = createCast(
      [analyst],
      createProtocol([{ actor: "analysis", instruction: "analyse", produces: ["AnalysisReport"] }]),
    );
    const evaluator = new Evaluator((ctx): Evaluation => {
      const covered = ctx.artifacts.some((a) => a.kind === "ComplianceReport");
      return {
        id: "e",
        status: covered ? "pass" : "fail",
        criteria: [
          {
            criterion: "criterion-1",
            status: covered ? "pass" : "fail",
            evidence: covered ? "ok" : "need compliance",
          },
        ],
        issues: [],
        recommendedAction: covered ? "finish" : "recast",
        diagnosis: covered ? "unspecified" : "missing_capability",
        missingCapabilities: covered ? [] : ["compliance"],
        createdAt: 0,
        meta: {},
      };
    });
    const { auditioner, calls } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "ada", accepted: true })),
    );
    const performance = await new StageManager({
      evaluator,
      personas: [ada],
      auditioner,
      auditionStore: createMemoryAuditionStore(),
      executors: {
        compliance: () => ok([artifact("compliance", "ComplianceReport", "c")]),
        synthesizer: () => ok([artifact("synthesizer", "FinalAnswer", "m")]),
      },
      maxRecasts: 2,
    }).perform(s, castA);

    expect(performance.finalResult.status).toBe("done");
    expect(performance.cast.actors.find((actor) => actor.name === "compliance")?.binding?.persona.id).toBe(
      "ada",
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  test("R-PERSONA-16 re-dressing clears a stale binding when nothing accepts", async () => {
    const store = createMemoryAuditionStore();
    const accepting = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "ada", accepted: true })),
    );
    const first = await dressCast(roles(), scene(), {
      personas: [ada],
      auditioner: accepting.auditioner,
      store,
    });
    expect(first.cast.actors.find((actor) => actor.name === "researcher")!.binding?.persona.id).toBe(
      "ada",
    );

    // A fresh store forces a live decline, so the old binding must not survive.
    const declining = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({
        role: role.name,
        persona: "ada",
        accepted: false,
        reason: "changed my mind",
      })),
    );
    const second = await dressCast(first.cast, scene(), {
      personas: [ada],
      auditioner: declining.auditioner,
      store: createMemoryAuditionStore(),
    });
    expect(second.cast.actors.find((actor) => actor.name === "researcher")!.binding).toBeUndefined();
    expect(second.uncast).toContain("researcher");
  });

  test("R-PERSONA-17 the fingerprint includes the slot name, and cache hits keep the right label", async () => {
    const base = createActor({
      name: "researcher",
      role: "researcher",
      objective: "find facts",
      capabilities: ["research"],
      expectedOutput: ["ResearchReport"],
    });
    const renamed = { ...base, name: "lead" };
    const castA = createCast(
      [base],
      createProtocol([{ actor: "researcher", instruction: "go", produces: ["ResearchReport"] }]),
    );
    const castB = createCast(
      [renamed],
      createProtocol([{ actor: "lead", instruction: "go", produces: ["ResearchReport"] }]),
    );

    const store = createMemoryAuditionStore();
    const { auditioner, calls } = recorder((_persona, openRoles) =>
      openRoles.map((role) => ({ role: role.name, persona: "ada", accepted: true })),
    );
    await dressCast(castA, scene(), { personas: [ada], auditioner, store });
    expect(calls).toHaveLength(1);

    const second = await dressCast(castB, scene(), { personas: [ada], auditioner, store });
    expect(calls).toHaveLength(2); // a different slot name is a different question
    expect(second.cast.actors[0]!.binding?.persona.id).toBe("ada");

    const third = await dressCast(castB, scene(), { personas: [ada], auditioner, store });
    expect(third.auditions[0]!.cached).toBe(true);
    expect(third.auditions[0]!.role).toBe("lead");
  });

  test("a default auditioner makes dressing possible without a model", async () => {
    const out = await dressCast(roles(), scene(), {
      personas: [ada],
      auditioner: acceptAllAuditioner(),
    });
    expect(out.cast.actors.every((actor) => actor.binding?.persona.id === "ada")).toBe(true);
    expect(out.uncast).toEqual([]);
  });
});
