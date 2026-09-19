/**
 * Adapt OpenCode agent definitions (`agents/<name>.md`) into Personas.
 *
 * An agent is a *performer*, not a role: its description is a delegation
 * trigger and its body is a system prompt. It declares no capabilities, so it
 * maps naturally onto `Persona` and is bound to a role by an audition.
 *
 * This module is pure: it takes markdown text and returns data. Reading the
 * agents directory belongs to the host (a tool or plugin), not to the core.
 */

import { type Persona, createPersona } from "./persona";

export interface OpencodeAgentCard {
  id: string;
  /** The agent's description, with `<example>…</example>` blocks removed. */
  description: string;
  /** The agent body — its system prompt. */
  prompt: string;
  model?: string;
  mode?: string;
  /** Every simple scalar found in the frontmatter. */
  fields: Record<string, string>;
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const text = typeof markdown === "string" ? markdown.replace(/^\uFEFF/, "") : "";
  const source = text.trimStart();
  if (!source.startsWith("---")) return { frontmatter: "", body: text.trim() };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: "", body: text.trim() };
  const frontmatter = source.slice(3, end).replace(/^\r?\n/, "");
  const body = source.slice(end + 4).replace(/^\r?\n/, "");
  return { frontmatter, body: body.trim() };
}

/**
 * A deliberately small frontmatter reader: top-level `key: value` scalars and
 * folded/literal block scalars (`>-`, `>`, `|`). Nested maps are ignored. It is
 * not a YAML parser and does not pretend to be one.
 */
function parseFrontmatter(frontmatter: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!match) {
      index += 1;
      continue;
    }
    const key = match[1]!.toLowerCase();
    let value = match[2]!.trim();

    if (/^[>|][+-]?$/.test(value)) {
      const folded = value.startsWith(">");
      const block: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        (lines[index]!.startsWith("  ") || lines[index]!.startsWith("\t") || lines[index]!.trim() === "")
      ) {
        block.push(lines[index]!.replace(/^[ \t]{2}/, "").trimEnd());
        index += 1;
      }
      fields[key] = folded
        ? block.join(" ").replace(/\s+/g, " ").trim()
        : block.join("\n").trim();
      continue;
    }

    if (value === "") {
      index += 1;
      continue;
    }
    // Only strip quotes when both ends are the same quote character, so an
    // unquoted scalar ending in an apostrophe or quote is left intact.
    fields[key] = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
    index += 1;
  }
  return fields;
}

function stripExamples(text: string): string {
  return text
    .replace(/<example>[\s\S]*?<\/example>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** Parse one agent definition. Never throws. */
export function parseOpencodeAgent(
  markdown: string,
  options: { id: string },
): OpencodeAgentCard {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const fields = parseFrontmatter(frontmatter);
  return {
    id: options.id,
    description: stripExamples(fields.description ?? ""),
    prompt: body,
    model: fields.model,
    mode: fields.mode,
    fields,
  };
}

export interface PersonaFromAgentOptions {
  id: string;
  name?: string;
  archetype?: string;
}

/** Turn one agent definition into a persona. Never throws. */
export function personaFromOpencodeAgent(
  markdown: string,
  options: PersonaFromAgentOptions,
): Persona {
  const card = parseOpencodeAgent(markdown, { id: options.id });
  return createPersona({
    id: card.id,
    name: options.name ?? titleFromId(card.id),
    archetype: options.archetype,
    description: card.description,
    personaPrompt: card.prompt || undefined,
    source: { kind: "opencode-agent", ref: card.id },
  });
}

/** Turn a set of agent definitions into a roster. */
export function personasFromOpencodeAgents(
  agents: { id: string; markdown: string; name?: string; archetype?: string }[],
): Persona[] {
  return agents.map((agent) =>
    personaFromOpencodeAgent(agent.markdown, {
      id: agent.id,
      name: agent.name,
      archetype: agent.archetype,
    }),
  );
}
