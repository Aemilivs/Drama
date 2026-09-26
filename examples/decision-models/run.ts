/**
 * A drama that researches Jev and its open-source alternatives and decides how a
 * "decision model" should integrate into drama.
 *
 * The scene and cast below are the design. The live performance — run with real
 * actors and recorded in docs/decision-models.md — followed it:
 *
 *   wave 1  researcher   (Librarian)      -> ResearchBrief
 *           mapper       (Rincewind)      -> SeamMap
 *   wave 2  synthesizer  (orchestrator)   -> IntegrationProposal
 *   wave 3  verifier     (Vimes)          -> Verification
 *   wave 4  synthesizer  (orchestrator)   -> FinalProposal
 *
 * This file is the reproducible half: it re-derives the cast decision from the
 * scene, **performs** the protocol through `StageManager` with the actors'
 * recorded outputs, and evaluates it with the very integration under discussion
 * — a decision model whose calibrated probabilities become drama's Status. No
 * model and no network are needed, so the whole thing runs offline.
 */

import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  artifact,
  calibratedEvaluator,
  castFromCard,
  formatPerformance,
  ok,
  planWaves,
  sceneFromCard,
} from "../../src/index.ts";
import type {
  ActorExecutor,
  CalibratedCheck,
  Cast,
  CastCard,
  Criterion,
  EvaluationContext,
  EvaluatorFn,
  Performance,
  Scene,
  SceneCard,
} from "../../src/index.ts";
import { decisionFromEnv } from "../providers/kev.ts";
import type { DecisionAnswer, DecisionFn } from "../providers/kev.ts";

// --- The scene: the research problem --------------------------------------

export const sceneCard: SceneCard = {
  objective:
    "Decide how a System One decision model (Jev and its open-source alternatives) should be integrated into drama.",
  desiredOutcome:
    "A source-cited research brief plus an integration proposal naming the seam, the minimal change and the explicit non-goals.",
  known: [
    "Jev is TypeSafe AI's hosted System One model: it answers typed questions over a supplied state with calibrated probabilities and generates no text.",
    "Open-source alternatives (Kev, Laya, Jevlike) exist and speak the same /v1/systemone request shape.",
    "drama models three actor kinds today: llm, deterministic and tool.",
    "drama has no calibrated channel: Status is three-valued and ActorOutput carries no score.",
  ],
  unknown: [
    "Which contract details are vendor-confirmed versus inferred (Jev's architecture is undisclosed).",
    "Which open-source alternative is the most faithful and practical to drive from a host-supplied client.",
    "How reliable the published cross-model benchmarks are.",
  ],
  assumed: [
    "A decision model is a new actor kind, not a replacement for an LLM actor, because it cannot generate text.",
    "drama keeps zero runtime dependencies, so any decision function is host-supplied, like ChatFn.",
  ],
  required: [
    "The reference model's input and output contract from primary docs.",
    "At least two open-source alternatives with license and architecture.",
    "The exact drama seams (file and symbol) a decision actor would touch.",
    "An independent check that every claim is sourced and the proposal respects the zero-dependency rule.",
  ],
  stakeholders: ["the drama maintainer", "a host integrating a decision model"],
  constraints: [
    "zero runtime dependencies; no provider SDK inside src/",
    "prefer serialisable structured artifacts over free-form text",
    "no fixed canonical cast",
  ],
  availableTools: ["web research", "GitHub", "repository mapping", "bun test", "tsc"],
  successCriteria: [
    "Names the reference model's contract (typed questions to calibrated distribution, no generated text) with a source.",
    "Distinguishes the closed reference from at least two open-source alternatives, each with its license.",
    "Separates vendor-confirmed facts from inferred or unverified ones and cites sources.",
    "Names at least one concrete drama seam with file and symbol references.",
    "States a minimal integration and at least one explicit non-goal.",
  ],
  failureModes: [
    "A hype summary with no primary sources.",
    "Recommending a provider adapter or a /v1/systemone client inside src/.",
    "Presenting an inferred architecture as confirmed.",
    "Treating a decision model as a drop-in replacement for an LLM actor.",
  ],
  requiredCapabilities: [
    "external_primary_source_research",
    "local_seam_mapping",
    "integration_synthesis",
    "independent_verification",
  ],
  interactionRequirements: [
    "assumptions must be challenged before synthesis",
    "verification must run in a separate context from synthesis",
    "the open-source landscape must not be reduced to a single project",
  ],
  unresolvedQuestions: [
    "Whether a typed Distribution artifact earns a core type or an Artifact kind suffices.",
    "Whether the Evaluator or the audition path is the better first adopter.",
  ],
};

// --- The cast: derived from required_capabilities --------------------------

export const castCard: CastCard = {
  cast: [
    {
      name: "researcher",
      role: "external primary-source research",
      objective:
        "Establish from primary sources what Jev is and what its open-source alternatives are.",
      kind: "llm",
      capabilities: ["external_primary_source_research"],
      tools: ["web research", "GitHub"],
      constraints: ["cite a URL per factual claim", "label inference as inference"],
      expectedOutput: ["ResearchBrief"],
    },
    {
      name: "mapper",
      role: "local seam mapping",
      objective: "Report the exact drama seams a decision-model actor would touch.",
      kind: "llm",
      capabilities: ["local_seam_mapping"],
      tools: ["repository mapping"],
      constraints: ["read-only", "give file and symbol references, not summaries"],
      expectedOutput: ["SeamMap"],
    },
    {
      name: "synthesizer",
      role: "integration synthesis",
      objective: "Turn the brief and the seam map into one source-cited integration proposal.",
      kind: "llm",
      capabilities: ["integration_synthesis"],
      interactionPermissions: ["synthesize"],
      constraints: ["no claim without a source", "state a minimal change and a non-goal"],
      expectedOutput: ["IntegrationProposal", "FinalProposal"],
    },
    {
      name: "verifier",
      role: "independent verification",
      objective:
        "Falsify the proposal: unsourced claims, inferred-as-confirmed, dependency-rule breaches.",
      kind: "llm",
      capabilities: ["independent_verification"],
      interactionPermissions: ["challenge:synthesizer"],
      question:
        "Is every factual claim primary-sourced, and does the proposal respect drama's zero-dependency rule?",
      constraints: ["separate context from the synthesizer", "read-only"],
      expectedOutput: ["Verification"],
    },
  ],
  protocol: {
    notes:
      "The brief and the seam map read nothing from each other, so they are one wave. Synthesis needs both. Verification runs after synthesis, and its finding is consumed by the revision that ends the performance.",
    steps: [
      {
        actor: "researcher",
        instruction:
          "Research Jev and its open-source alternatives from primary sources and produce a sourced brief.",
        consumes: [],
        produces: ["ResearchBrief"],
      },
      {
        actor: "mapper",
        instruction: "Map the exact drama seams a decision-model actor would touch.",
        consumes: [],
        produces: ["SeamMap"],
      },
      {
        actor: "synthesizer",
        instruction: "Write the integration proposal from the brief and the seam map.",
        consumes: ["ResearchBrief", "SeamMap"],
        produces: ["IntegrationProposal"],
        owns: ["docs/decision-models.md"],
      },
      {
        actor: "verifier",
        instruction:
          "Challenge the proposal: unsourced claims, inferred-as-confirmed, dependency-rule breaches.",
        consumes: ["IntegrationProposal"],
        produces: ["Verification"],
      },
      {
        actor: "synthesizer",
        instruction: "Revise the proposal in light of the verification and emit the final artifact.",
        consumes: ["IntegrationProposal", "Verification"],
        produces: ["FinalProposal"],
        owns: ["docs/decision-models.md"],
      },
    ],
  },
  rationale:
    "Two independent producers (external research, local mapping) and one synthesis that needs both; one independent verifier because the proposal changes architecture. Nothing else changes the solution space.",
};

export function designCast(): { scene: Scene; cast: Cast } {
  return { scene: sceneFromCard(sceneCard), cast: castFromCard(castCard) };
}

// --- The seam: a decision model (the System One contract) ------------------

/**
 * The host supplies a `DecisionFn` — the System One contract from
 * `examples/providers/kev.ts`. Kev is the open-source implementation; `bun run
 * setup:kev` installs it and writes the config `decisionFromEnv` reads. This file
 * keeps a stub, so it runs offline.
 */

/**
 * Recorded answers standing in for a real decision model. The keys are the
 * scene's criterion ids.
 */
export const recordedDecisions: Record<string, DecisionAnswer> = {
  "criterion-1": { type: "choice", probabilities: { pass: 0.95, fail: 0.05 }, confidence: 0.81, top: "pass" },
  "criterion-2": { type: "choice", probabilities: { pass: 0.93, fail: 0.07 }, confidence: 0.78, top: "pass" },
  "criterion-3": { type: "choice", probabilities: { pass: 0.87, fail: 0.13 }, confidence: 0.65, top: "pass" },
  "criterion-4": { type: "choice", probabilities: { pass: 0.91, fail: 0.09 }, confidence: 0.74, top: "pass" },
  "criterion-5": { type: "choice", probabilities: { pass: 0.89, fail: 0.11 }, confidence: 0.68, top: "pass" },
  c_minimal_integration: { type: "choice", probabilities: { pass: 0.89, fail: 0.11 }, confidence: 0.68, top: "pass" },
  c_source_discipline: { type: "choice", probabilities: { pass: 0.55, fail: 0.45 }, confidence: 0.12, top: "pass" },
};

export const stubDecision: DecisionFn = async ({ questions }) => {
  const answers: Record<string, DecisionAnswer> = {};
  for (const id of Object.keys(questions)) {
    const answer = recordedDecisions[id];
    if (answer) answers[id] = answer;
  }
  return answers;
};

/** The decision model the example runs against: a real Kev if configured, else the stub. */
export function activeDecision(): DecisionFn {
  return decisionFromEnv() ?? stubDecision;
}

/** A criterion the decision model is asked about, as a calibrated check. */
export function decisionCheck(
  decision: DecisionFn,
  criterion: Criterion,
  state: string,
): CalibratedCheck {
  return {
    criterion,
    check: async () => {
      const answers = await decision({
        state,
        questions: {
          [criterion.id]: {
            type: "choice",
            instructions: `Does the artifact meet this criterion? ${criterion.description}`,
            criteria: { pass: "it meets the criterion", fail: "it does not" },
          },
        },
      });
      const answer = answers[criterion.id];
      if (!answer) {
        // No answer settles nothing; the library keeps the criterion `uncertain`.
        return { probability: Number.NaN, evidence: "decision model returned no answer" };
      }
      return {
        probability: answer.probabilities.pass ?? 0,
        evidence: `calibrated ${answer.top ?? "?"} (confidence ${answer.confidence})`,
      };
    },
  };
}

/**
 * The Evaluator integration, now built into the library: the host supplies the
 * decision function, and `calibratedEvaluator` owns the probability -> Status
 * policy — 0.8 / 0.2 by default, a wide distribution stays `uncertain`.
 */
export function decisionEvaluator(
  decision: DecisionFn,
  scene: Scene,
  state: string,
): EvaluatorFn {
  return calibratedEvaluator(
    scene.successCriteria.map((criterion) => decisionCheck(decision, criterion, state)),
  );
}

// --- The recorded performance (live actors, replayed offline) --------------

/** What each actor returned in the live run; the full write-up is the doc. */
export const recordedOutputs: Record<string, unknown> = {
  ResearchBrief: {
    class:
      "System One / decision models: a state plus typed questions yields calibrated probabilities, no generated text",
    reference:
      "Jev (TypeSafe AI, hosted 2026-09-15; noul | choice | score; POST https://api.typesafe.ai/v1/systemone)",
    alternatives: [
      "Kev (Apache-2.0; Qwen base + rank-16 LoRA + pointer head)",
      "Laya (Apache-2.0; ModernBERT option-attention)",
      "Jevlike (MIT; byte-embedding option-attention)",
    ],
    unverified: [
      "Jev's parameter count and architecture — Archer Hume's reconstruction is inference",
      "cross-model benchmark comparisons are author-reported and uncontrolled",
    ],
    sources: [
      "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
      "https://docs.typesafe.ai/api",
      "https://github.com/jaredpalmer/kev",
      "https://github.com/NandhaKishorM/laya",
      "https://github.com/vinnylarouge/jevlike",
    ],
  },
  SeamMap: {
    actorKind: "src/actor.ts:14 — llm | deterministic | tool",
    cardWhitelist:
      "src/cast.ts:345-348 — a new kind must be listed here or a card's kind degrades to llm",
    executor:
      "src/actor.ts:154 + src/stage.ts:760-767 — kind-agnostic; any supplied executor runs, and the chat fallback is gated on kind === 'llm'",
    evaluator: "src/evaluation.ts:51-59,143-156 — CriterionCheck + criterionEvaluator; a plain function",
    audition: ".opencode/lib/audition-prompt.ts:116-137 — accepted:boolean; unparseable counts as refusal",
    serialization: "src/serialize.ts:48-53,128-141 — functions dropped, re-attached by actor name",
    gap: "no calibrated channel anywhere: Status is three-valued and ActorOutput has no score",
  },
  IntegrationProposal: {
    strongestFit:
      "the Evaluator: a calibrated probability maps to pass/fail/uncertain by threshold, and a choice maps to RecommendedAction",
    also: [
      "auditions — a noul acceptance, and a choice over N personas",
      "routing and gates — bounded decisions, not generations",
      "the structured-output contract (drama-gas.4)",
    ],
    minimalChange: [
      "add 'decision' to ActorKind (src/actor.ts:14)",
      "accept it in actorFromCard's whitelist (src/cast.ts:345-348)",
      "optionally export DecisionFn next to ChatFn (src/index.ts:36-54)",
    ],
    nonGoals: [
      "no /v1/systemone client or provider SDK in src/",
      "no supported-models list",
      "no new ActorOutput return shape",
    ],
  },
  Verification: {
    verdict: "fail, then fixed",
    findings: [
      "CastCard has no recastsWhen/reperformsWhen fields — bun run typecheck failed; removed",
      "Kev-ANE is Apache-2.0, not unlicensed; corrected",
      "CUA-S1's 99.7/83.6 numbers are not in the cited source; removed",
      "pricing and context cited to /api, but live on /models; re-sourced",
      "'no weights' was an inference presented as a vendor fact; reframed",
    ],
    confirmed: "all six src/ line references and the zero-dependency claim verified",
  },
  FinalProposal: {
    revisedAfter: "Verification",
    seam: "a host-supplied DecisionFn, surfaced through the Evaluator (and optionally an audition)",
    minimalChange: [
      "add 'decision' to ActorKind",
      "accept it in the cast-card whitelist",
      "optionally export DecisionFn",
    ],
    nonGoals: [
      "no provider client in src/",
      "no supported-models list",
      "no new ActorOutput shape",
    ],
    note: "the full text is docs/decision-models.md",
  },
};

/** The four executors, carrying what the live actors produced. */
export function dramaExecutors(): Record<string, ActorExecutor> {
  return {
    researcher: () => ok([artifact("researcher", "ResearchBrief", recordedOutputs.ResearchBrief)]),
    mapper: () => ok([artifact("mapper", "SeamMap", recordedOutputs.SeamMap)]),
    synthesizer: (ctx) => {
      const revised = ctx.inputs.some((item) => item.kind === "Verification");
      const kind = revised ? "FinalProposal" : "IntegrationProposal";
      return ok([artifact("synthesizer", kind, recordedOutputs[kind])]);
    },
    verifier: () => ok([artifact("verifier", "Verification", recordedOutputs.Verification)]),
  };
}

/**
 * Perform the drama through the real stage, evaluated by the integration under
 * discussion. This is the point of the example: the same `StageManager` that
 * runs any performance runs this one, and the decision model changes nothing in
 * `src/`.
 */
export async function performDrama(): Promise<{ performance: Performance; report: string }> {
  const { scene, cast } = designCast();
  const stage = new StageManager({
    evaluator: new Evaluator(decisionEvaluator(activeDecision(), scene, "docs/decision-models.md")),
    castingDirector: new CastingDirector(),
    sceneDesigner: new SceneDesigner(),
  });
  const performance = await stage.perform(scene, cast, {
    executors: dramaExecutors(),
    parallel: true,
  });
  return { performance, report: formatPerformance(performance) };
}

// --- A `decision` actor, end to end ---------------------------------------

/**
 * The second half of the integration: a `decision` actor whose executor answers
 * a typed question with a calibrated distribution instead of text. Its artifact
 * is then what a calibrated evaluator reads back to set the criterion.
 */
export function decisionActorScene(): { scene: Scene; cast: Cast } {
  const scene = sceneFromCard({
    objective: "Route one support ticket.",
    desiredOutcome: "A routing decision with a calibrated confidence.",
    known: ["the ticket text"],
    successCriteria: ["A routing decision is produced with a confidence."],
    requiredCapabilities: ["ticket_routing"],
    constraints: ["no text generation"],
  });
  const cast = castFromCard({
    cast: [
      {
        name: "router",
        role: "ticket routing",
        objective: "Decide whether the ticket escalates.",
        kind: "decision",
        capabilities: ["ticket_routing"],
        expectedOutput: ["Decision"],
        question: "Does this ticket escalate?",
      },
    ],
    protocol: {
      notes: "One decision actor, one typed question.",
      steps: [
        {
          actor: "router",
          instruction: "Answer the routing question with a calibrated distribution.",
          consumes: [],
          produces: ["Decision"],
        },
      ],
    },
    rationale: "A single decision is a single-capability scene.",
  });
  return { scene, cast };
}

export async function runDecisionActor(): Promise<Performance> {
  const { scene, cast } = decisionActorScene();
  const criterion = scene.successCriteria[0]!;
  const evaluator = new Evaluator(
    calibratedEvaluator([
      {
        criterion,
        check: (ctx) => {
          const decision = ctx.artifacts.find((item) => item.kind === "Decision");
          const probability =
            (decision?.content as { escalate?: number } | undefined)?.escalate ?? Number.NaN;
          return { probability, evidence: `router reported escalate=${probability}` };
        },
      },
    ]),
  );
  const stage = new StageManager({ evaluator });
  return stage.perform(scene, cast, {
    executors: {
      router: () =>
        ok([
          artifact("router", "Decision", {
            question: "Does this ticket escalate?",
            escalate: 0.87,
            confidence: 0.64,
          }),
        ]),
    },
  });
}

// --- The threshold probe: why the mapping needs three states --------------

export interface DecisionModelsExampleResult {
  scene: Scene;
  cast: Cast;
  waves: string[][];
  validationErrors: number;
  evaluation: Awaited<ReturnType<Evaluator["evaluate"]>>;
}

export async function runDecisionModelsExample(): Promise<DecisionModelsExampleResult> {
  const { scene, cast } = designCast();
  const director = new CastingDirector();
  const issues = director.validate(scene, cast);
  const waves = planWaves(cast.protocol.steps).map((wave) =>
    wave.map((step) => `${step.actor} -> ${step.produces.join("+") || "(none)"}`),
  );

  const criteria: Criterion[] = [
    {
      id: "c_minimal_integration",
      description: "States a minimal integration and at least one explicit non-goal.",
    },
    {
      id: "c_source_discipline",
      description: "Separates vendor-confirmed facts from inferred or unverified ones.",
    },
  ];
  const evaluator = new Evaluator(
    calibratedEvaluator(
      criteria.map((criterion) => decisionCheck(activeDecision(), criterion, "docs/decision-models.md")),
    ),
  );
  const context: EvaluationContext = {
    scene,
    cast,
    artifacts: [],
    failures: [],
    iteration: 1,
  };
  const evaluation = await evaluator.evaluate(context);

  return {
    scene,
    cast,
    waves,
    validationErrors: issues.filter((issue) => issue.severity === "error").length,
    evaluation,
  };
}

if ((import.meta as { main?: boolean }).main) {
  const { scene, cast } = designCast();
  const analysis = new SceneDesigner().analyze(scene);
  const issues = new CastingDirector().validate(scene, cast);

  console.log(`Scene: ${scene.objective}`);
  console.log(`complete: ${analysis.complete}; blocking unknowns: ${analysis.blockingUnknowns.length}`);
  console.log(`Cast: [${cast.actors.map((actor) => actor.name).join(", ")}]`);
  console.log(
    `validation errors: ${issues.filter((issue) => issue.severity === "error").length}, warnings: ${issues.filter((issue) => issue.severity === "warning").length}`,
  );
  console.log("waves:");
  for (const [index, wave] of planWaves(cast.protocol.steps).entries()) {
    console.log(`  ${index + 1}. ${wave.map((step) => `${step.actor} -> ${step.produces.join("+")}`).join("  |  ")}`);
  }

  console.log("\n=== Performance (live actors, replayed offline) ===");
  const { performance, report } = await performDrama();
  console.log(report);
  const evaluation = performance.finalResult.evaluation;
  console.log(`\nperformance status: ${performance.finalResult.status}`);
  console.log(`evaluation: ${evaluation?.status ?? "none"} -> ${evaluation?.recommendedAction ?? "none"}`);
  console.log(
    `artifacts: ${performance.finalResult.artifacts.map((item) => item.kind).join(", ")}`,
  );

  console.log("\n=== A `decision` actor (kind added to ActorKind) ===");
  const routed = await runDecisionActor();
  console.log(
    `  router(decision) -> ${routed.finalResult.status}; evaluation ${routed.finalResult.evaluation?.status ?? "none"} -> ${routed.finalResult.evaluation?.recommendedAction ?? "none"}`,
  );
  console.log("  its artifact is a distribution; the calibrated evaluator reads it back into a Status");

  console.log("\n=== The calibration seam: a decision model as the Evaluator ===");
  const probe = await runDecisionModelsExample();
  const wired = new Set(["c_minimal_integration", "c_source_discipline"]);
  for (const criterion of probe.evaluation.criteria) {
    if (!wired.has(criterion.criterion)) continue;
    console.log(`  ${criterion.criterion}: ${criterion.status} — ${criterion.evidence}`);
  }
  console.log(
    "  calibrated 0.89 -> pass, but 0.55 -> uncertain: a probability that settles nothing is not rounded up.",
  );
}
