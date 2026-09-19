/**
 * drama — validate Scene-Casting artifacts before a performance.
 *
 * This is the design-time quality gate: run it after the `scene-designer` skill
 * to check whether a Scene is complete and worth asking about, and after the
 * `casting-director` skill to check capability coverage, protocol wiring and
 * cast minimality. It needs no model.
 *
 * Cards are passed as JSON (the object form of the YAML the skills emit).
 */

import { tool } from "@opencode-ai/plugin";
import {
  CastingDirector,
  SceneDesigner,
  castFromCard,
  sceneFromCard,
} from "../../src/index.ts";
import type { CastCard, SceneCard } from "../../src/index.ts";

function parseCard<T>(label: string, text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} must be a JSON object (the object form of the ${label} card): ${detail}`,
    );
  }
}

export default tool({
  description:
    "Validate Scene-Casting artifacts before running a performance. Use after the scene-designer skill to check scene completeness (missing fields, blocking unknowns, conflicting constraints), and after the casting-director skill to check capability coverage, protocol wiring and cast minimality. Operates on JSON Scene/Cast cards and requires no model.",
  args: {
    operation: tool.schema
      .enum(["analyze_scene", "validate_cast"])
      .describe("analyze_scene checks a Scene Card; validate_cast checks a Cast Card against a Scene Card"),
    scene: tool.schema
      .string()
      .describe("Scene Card as a JSON object string (the object form of the YAML card)"),
    cast: tool.schema
      .string()
      .optional()
      .describe("Cast Card as a JSON object string (required for validate_cast)"),
  },
  async execute(args) {
    const scene = sceneFromCard(parseCard<SceneCard>("scene", args.scene));

    if (args.operation === "analyze_scene") {
      const designer = new SceneDesigner();
      const analysis = designer.analyze(scene);
      return [
        `Scene ${scene.id}: ${scene.objective}`,
        `complete: ${analysis.complete}`,
        `missing: ${analysis.missing.join(", ") || "none"}`,
        `blocking unknowns: ${analysis.blockingUnknowns.join(" | ") || "none"}`,
        `constraint conflicts: ${
          analysis.constraintConflicts.map(([a, b]) => `${a} vs ${b}`).join(" | ") || "none"
        }`,
        `ask the user: ${designer.shouldAskQuestions(analysis)}`,
        analysis.questions.length ? `questions:\n- ${analysis.questions.join("\n- ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (!args.cast) throw new Error("validate_cast requires the `cast` argument");
    const cast = castFromCard(parseCard<CastCard>("cast", args.cast));
    const director = new CastingDirector();
    const issues = director.validate(scene, cast);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    const removable = director.minimality(scene, cast).removable;

    return [
      `Cast ${cast.id}: [${cast.actors.map((actor) => actor.name).join(", ")}]`,
      `errors: ${errors.length}`,
      ...errors.map((i) => `  ERROR [${i.code}] ${i.message}`),
      ...warnings.map((i) => `  WARN [${i.code}] ${i.message}`),
      `removable actors: ${
        removable.map((f) => `${f.actor} (${f.reason})`).join("; ") || "none"
      }`,
      errors.length === 0
        ? "verdict: valid — safe to perform"
        : "verdict: fix the errors before performing",
    ].join("\n");
  },
});
