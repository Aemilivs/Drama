/**
 * Observability: render a performance as a readable, ordered trace.
 */

import type { Performance } from "./stage";
import type { Actor } from "./actor";

/** Show the persona a role is dressed in, when it has one. */
function labelActor(actor: Actor): string {
  return actor.binding ? `${actor.name} as ${actor.binding.persona.name}` : actor.name;
}

export function formatPerformance(performance: Performance): string {
  const lines: string[] = [];
  lines.push(`Performance ${performance.id}`);
  lines.push(`Scene ${performance.scene.id}: ${performance.scene.objective}`);
  lines.push(
    `Cast ${performance.cast.id}: [${performance.cast.actors
      .map(labelActor)
      .join(", ")}]`,
  );
  if (performance.cast.rationale) lines.push(`  rationale: ${performance.cast.rationale}`);

  for (const iteration of performance.iterations) {
    lines.push("");
    lines.push(`Iteration ${iteration.index}`);
    for (const turn of iteration.turns) {
      const produced = turn.output.artifacts.map((artifact) => artifact.kind);
      const parts = [
        `  ${turn.step} ${turn.actor}`,
        turn.output.status === "failed" ? "FAILED" : "ok",
      ];
      if (produced.length) parts.push(`-> ${produced.join(", ")}`);
      if (turn.output.status === "failed" && turn.output.error) {
        parts.push(`(${turn.output.error})`);
      }
      lines.push(parts.join(" "));
    }
    const evaluation = iteration.evaluation;
    if (evaluation) {
      lines.push(
        `  Evaluation: ${evaluation.status} | action=${evaluation.recommendedAction} | diagnosis=${evaluation.diagnosis}`,
      );
      for (const criterion of evaluation.criteria) {
        lines.push(
          `    - ${criterion.criterion}: ${criterion.status} — ${criterion.evidence}`,
        );
      }
      for (const issue of evaluation.issues) lines.push(`    ! ${issue}`);
    }
  }

  lines.push("");
  lines.push(`Result: ${performance.finalResult.status} — ${performance.finalResult.reason}`);
  for (const artifact of performance.finalResult.artifacts) {
    lines.push(`  artifact ${artifact.id} [${artifact.kind}] by ${artifact.producedBy}`);
  }
  return lines.join("\n");
}

/** The exact ordered chain of stage events, for machine inspection. */
export function performanceTimeline(performance: Performance): string[] {
  return performance.events.map((event) => JSON.stringify(event));
}
