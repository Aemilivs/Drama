/**
 * Casting-call prompt rendering and answer parsing for the host.
 *
 * A project tool cannot spawn a subagent, so the audition itself is performed by
 * the orchestrating agent: it renders a casting call (this module), spawns the
 * persona's subagent, and parses the reply (this module) back into `Audition`s
 * that feed `dressCast` / `StageManager`.
 *
 * Both functions are pure and total: malformed model output becomes a decline,
 * never a throw and never an invented acceptance.
 */

import type { Audition, Persona, RoleRef } from "../../src/index.ts";

/** Render the one prompt a persona is asked, covering every open role at once. */
export function renderCastingCall(
  roles: RoleRef[],
  persona: Persona,
  sceneObjective: string,
): string {
  const roleBlocks = roles
    .map((role) => {
      const lines = [
        `- name: ${role.name}`,
        `  role: ${role.role}`,
        `  capabilities: ${role.capabilities.join(", ") || "(none)"}`,
        `  objective: ${role.objective}`,
        `  expected artifact: ${role.expectedOutput.join(", ") || "(unspecified)"}`,
      ];
      if (role.constraints.length) lines.push(`  constraints: ${role.constraints.join("; ")}`);
      if (role.interactionPermissions.length) {
        lines.push(`  permissions: ${role.interactionPermissions.join("; ")}`);
      }
      return lines.join("\n");
    })
    .join("\n");

  const roleNames = roles.map((role) => role.name);

  return [
    `You are being audited for a role in a Scene-Casting performance.`,
    `This is NOT a request to do the work — only to say whether you can play the role.`,
    ``,
    `Scene: ${sceneObjective}`,
    `Playing as: ${persona.name}${persona.archetype ? ` (${persona.archetype})` : ""}`,
    persona.description ? `Character: ${persona.description}` : undefined,
    ``,
    `Open roles:`,
    roleBlocks,
    ``,
    `Reply with ONLY one JSON object, no markdown fence, no prose before or after:`,
    `{"auditions":[{"role":"<role name>","accepted":true,"reason":"...","approach":"..."}]}`,
    ``,
    `- Include one entry per open role: ${roleNames.join(", ")}.`,
    `- accepted: true only if you are willing and able to play that role.`,
    `- reason: if you decline, why, in one sentence.`,
    `- approach: if you accept, how you would play it, in one sentence specific to this role.`,
    `Do not perform the role. Do not edit files. Do not ask questions.`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/**
 * Parse a persona's reply into one `Audition` per requested role. Anything the
 * reply does not answer — or that cannot be parsed at all — becomes a decline.
 */
export function parseAuditionAnswer(
  text: string,
  personaId: string,
  roles: string[],
): Audition[] {
  const parsed = asRecord(extractJson(text));
  const raw = parsed && Array.isArray(parsed.auditions) ? parsed.auditions : [];

  return roles.map((role) => {
    const entry = raw.map(asRecord).find((candidate) => candidate?.role === role);
    if (!entry || typeof entry.accepted !== "boolean") {
      return { role, persona: personaId, accepted: false, reason: "no parseable answer" };
    }
    return {
      role,
      persona: personaId,
      accepted: entry.accepted === true,
      reason: typeof entry.reason === "string" ? entry.reason : undefined,
      approach: typeof entry.approach === "string" ? entry.approach : undefined,
    };
  });
}
