/**
 * A recorded casting call — the host-level audition, end to end.
 *
 * The prompts below were rendered by `renderCastingCall` and sent to three real
 * OpenCode agents (Vimes, Feegle, Librarian) via subagent spawn. Their replies
 * are recorded verbatim, so replaying this example is fully offline.
 *
 * It shows how the two layers compose:
 *
 *   1. the host performs the casting call — render, spawn, parse — and gathers
 *      every persona's answer (which is where a persona's *approach* comes from);
 *   2. `dressCast` binds deterministically from an `AuditionStore` seeded with
 *      those answers, so it never re-asks.
 *
 * A project tool cannot spawn a subagent, which is exactly why step 1 lives in
 * the orchestrator and only the pure parts live in the repo.
 */

import {
  createActor,
  createCast,
  createMemoryAuditionStore,
  createPersona,
  createProtocol,
  dressCast,
  roleFingerprint,
  roleRefOf,
  sceneFromCard,
} from "../../src/index.ts";
import type { Audition, DressedCast, Persona, RoleRef } from "../../src/index.ts";
import { parseAuditionAnswer, renderCastingCall } from "../../.opencode/lib/audition-prompt.ts";

export const sceneObjective = "Decide whether drama's persona/audition layer is safe to merge.";

/** The role the scene needs: functional, capability-keyed, read-only. */
export const role: RoleRef = {
  name: "reviewer",
  role: "code reviewer",
  objective: "Review drama's persona/audition layer and give a merge verdict",
  capabilities: ["code_review"],
  expectedOutput: ["Review"],
  constraints: ["read-only; do not modify files"],
  interactionPermissions: ["challenge:author"],
};

/**
 * The roster. Note that no persona declares anything about its fit — not even
 * which roles it could play.
 */
export const personas: Persona[] = [
  createPersona({
    id: "Vimes",
    name: "Vimes",
    archetype: "hard-boiled investigator",
    description: "Reviews work against the plan and finds issues.",
    source: { kind: "opencode-agent", ref: "Vimes" },
  }),
  createPersona({
    id: "Feegle",
    name: "Feegle",
    description: "Tightly scoped implementation and tests.",
    source: { kind: "opencode-agent", ref: "Feegle" },
  }),
  createPersona({
    id: "Librarian",
    name: "Librarian",
    description: "External research and documentation.",
    source: { kind: "opencode-agent", ref: "Librarian" },
  }),
];

/** The prompt each persona was asked. Rendered here; recorded for the example. */
export function castingCallPrompt(persona: Persona): string {
  return renderCastingCall([role], persona, sceneObjective);
}

/**
 * Recorded replies from real subagent auditions. All three accepted — and each
 * approach reflects the persona, not the role: same function, different playing.
 */
export const recordedReplies: { persona: string; reply: string }[] = [
  {
    persona: "Vimes",
    reply:
      '{"auditions":[{"role":"reviewer","accepted":true,"reason":"","approach":"Read drama\'s persona/audition layer against its OpenSpec plan and specs, check git state for uncommitted or conflicted work, then verify behavior with the narrowest runnable test and evidence-cited findings categorized Critical/Important/Suggestion before issuing a merge verdict."}]}',
  },
  {
    persona: "Feegle",
    reply:
      '{"auditions":[{"role":"reviewer","accepted":true,"reason":"The review is bounded to drama\'s persona/audition layer and read-only, fitting a tightly scoped lane with a concrete verdict artifact.","approach":"Inspect the persona/audition layer files and tests with read-only tools, verify behavior against existing patterns and constraints, then report a concise merge verdict with evidence and any blocking issues."}]}',
  },
  {
    persona: "Librarian",
    reply:
      '{"auditions":[{"role":"reviewer","accepted":true,"reason":"The read-only reviewer role fits the Librarian lane when the merge verdict is grounded in authoritative external documentation and ecosystem evidence rather than edits.","approach":"I would cross-check drama\'s persona/audition layer against authoritative agent-configuration docs and real-world GitHub patterns, separate documented from inferred behavior, flag any version-dependent or spec mismatches, and return a merge verdict with precise cited evidence."}]}',
  },
];

export interface AuditionExampleResult {
  /** Every persona's answer, as gathered by the host casting call. */
  gathered: Audition[];
  /** The deterministically bound cast. */
  dressed: DressedCast;
  binding: string;
}

export async function runAuditionExample(): Promise<AuditionExampleResult> {
  const scene = sceneFromCard({
    objective: sceneObjective,
    success_criteria: ["A review artifact exists"],
    required_capabilities: ["code_review"],
  });
  const reviewer = createActor({
    name: role.name,
    role: role.role,
    objective: role.objective,
    capabilities: role.capabilities,
    constraints: role.constraints,
    expectedOutput: role.expectedOutput,
  });
  const cast = createCast(
    [reviewer],
    createProtocol([{ actor: role.name, instruction: role.objective, produces: role.expectedOutput }]),
  );

  // 1. The host casting call: parse what the spawned personas answered.
  const gathered = recordedReplies.flatMap(({ persona, reply }) =>
    parseAuditionAnswer(reply, persona, [role.name]),
  );

  // 2. Seed the store, so binding never re-asks (in a real run it would persist).
  const store = createMemoryAuditionStore();
  const fingerprint = roleFingerprint(roleRefOf(reviewer));
  for (const audition of gathered) store.put(audition.persona, fingerprint, audition);

  // 3. Bind deterministically; the auditioner must not be called.
  const dressed = await dressCast(cast, scene, {
    personas,
    auditionStore: store,
    auditioner: () => {
      throw new Error("auditioner was called although every answer was cached");
    },
  });

  const binding = dressed.cast.actors[0]!.binding?.persona.name ?? "(none)";
  return { gathered, dressed, binding };
}

if ((import.meta as { main?: boolean }).main) {
  const result = await runAuditionExample();
  console.log(`Scene: ${sceneObjective}`);
  console.log(`Role:  ${role.name} (${role.capabilities.join(", ")})\n`);
  console.log("Casting call — one question, every persona answered:");
  for (const audition of result.gathered) {
    const persona = personas.find((candidate) => candidate.id === audition.persona)!;
    console.log(`  ${persona.name.padEnd(10)} ${audition.accepted ? "accepts" : "declines"}`);
    if (audition.approach) console.log(`             "${audition.approach}"`);
  }
  console.log(`\nBound deterministically to: ${result.binding}`);
  console.log(`Not cast: ${result.dressed.unused.join(", ") || "(none)"}`);
}
