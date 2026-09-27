/**
 * A drama that evaluated drama's LangGraph integration and planned the accepted
 * work in beads (epic `drama-vfu`).
 *
 * The cast, derived from the scene's capabilities:
 *
 *   wave 1  api_verifier    (Librarian)      -> ApiReport     — the recipe vs the package
 *           surface_auditor (Rincewind)      -> SurfaceAudit  — what the repo already covers
 *   wave 2  planner         (orchestrator)   -> Plan
 *   wave 3  critic          (Vimes)          -> Critique      — scope discipline, own question
 *   wave 4  planner         (orchestrator)   -> FinalPlan
 *
 * The verdict, the drift it found and the three filed issues are recorded in the
 * epic description (`bd show drama-vfu`). This file is the reproducible half: it
 * re-derives the cast, replays the performance offline, and demonstrates the
 * engine seam with the *corrected* LangGraph shape — without a LangGraph
 * dependency, exactly as the verdict requires.
 *
 * `drama-vfu.1` has since corrected the recipe in `docs/engines.md` section 1,
 * so the "pinned to 1.4.17" known below is the state this drama was run against.
 */

import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  artifact,
  castFromCard,
  createActor,
  createCast,
  createEngineExecutor,
  createProtocol,
  criterionEvaluator,
  formatPerformance,
  ok,
  planWaves,
  sceneFromCard,
} from "../../src/index.ts";
import type {
  ActorExecutor,
  Cast,
  CastCard,
  CriterionResult,
  Performance,
  Scene,
  SceneCard,
} from "../../src/index.ts";

// --- The scene and the cast -------------------------------------------------

export const sceneCard: SceneCard = {
  objective:
    "Decide whether drama should deepen its LangGraph integration, and file the resulting plan in beads.",
  desiredOutcome:
    "A source-grounded evaluation of the LangGraph integration and a beads plan (epic + child issues with acceptance criteria) for the work drama accepts.",
  known: [
    "docs/engines.md carries a 7-line LangGraph recipe through createEngineExecutor, pinned to @langchain/langgraph 1.4.17.",
    "src/engines.ts is the whole seam; R-ENGINE-1..5 test it with a fake engine and never the real package.",
    "docs/prior-art.md ranks LangGraph first and says there are deliberately no native adapters.",
    "The drama-gas epic already owns structured output, resumable gated performances and OTel spans.",
  ],
  assumed: [
    "The host, not drama, owns the engine dependency and its credentials.",
    "A recipe that is never executed against the package can drift.",
    "beads is the plan of record for this repository.",
  ],
  unknown: [
    "Whether the current LangGraph JS API still matches the recipe, and whether its messages expose a `text` getter.",
    "Whether a drama performance can be hosted inside LangGraph as a node or tool.",
    "Whether any accepted work is LangGraph-specific or already covered by drama-gas.",
  ],
  successCriteria: [
    "Every recipe claim is checked against the current LangGraph package, and any drift is named.",
    "The evaluation names what drama will NOT build (a native adapter, an engine dependency) and why.",
    "Overlap with the drama-gas children is explicit, so no work is duplicated under a LangGraph label.",
    "The accepted work is filed as bd issues with acceptance criteria and dependencies.",
    "A verifier with a different question confirms the plan does not contradict drama's stated principles.",
  ],
  requiredCapabilities: [
    "langgraph_api_verification",
    "integration_surface_audit",
    "integration_planning",
    "scope_critique",
  ],
  constraints: [
    "zero runtime dependencies - no engine package in src/ or package.json",
    "no native adapter unless a concrete scene cannot be expressed without one",
    "the plan must be filable as bd issues with R-id acceptance criteria",
  ],
};

export const castCard: CastCard = {
  cast: [
    {
      name: "api_verifier",
      role: "LangGraph API verifier",
      objective: "Check every recipe claim against the current LangGraph JS package.",
      kind: "llm",
      capabilities: ["langgraph_api_verification"],
      expectedOutput: ["ApiReport"],
    },
    {
      name: "surface_auditor",
      role: "integration surface auditor",
      objective:
        "Map exactly what drama already covers for engines and what is untested prose.",
      kind: "llm",
      capabilities: ["integration_surface_audit"],
      expectedOutput: ["SurfaceAudit"],
    },
    {
      name: "planner",
      role: "integration planner",
      objective: "Decide what drama should build, defer or refuse, and file it in beads.",
      kind: "llm",
      capabilities: ["integration_planning"],
      expectedOutput: ["Plan", "FinalPlan"],
    },
    {
      name: "critic",
      role: "scope critic",
      objective: "Challenge whether any proposed work is drama's job at all.",
      kind: "llm",
      question: "Does this plan violate the no-native-adapter stance or duplicate drama-gas?",
      capabilities: ["scope_critique"],
      expectedOutput: ["Critique"],
    },
  ],
  protocol: {
    notes:
      "Verification and audit are independent; the critic reads the plan, and the planner revises it once.",
    steps: [
      {
        actor: "api_verifier",
        instruction: "Verify the recipe against the current package and report drift.",
        consumes: [],
        produces: ["ApiReport"],
      },
      {
        actor: "surface_auditor",
        instruction: "Audit the repository's engine surface and name the gaps.",
        consumes: [],
        produces: ["SurfaceAudit"],
      },
      {
        actor: "planner",
        instruction: "Write the evaluation and the beads plan.",
        consumes: ["ApiReport", "SurfaceAudit"],
        produces: ["Plan"],
      },
      {
        actor: "critic",
        instruction: "Attack the plan on scope discipline.",
        consumes: ["Plan"],
        produces: ["Critique"],
      },
      {
        actor: "planner",
        instruction: "Revise the plan against the critique.",
        consumes: ["Plan", "Critique"],
        produces: ["FinalPlan"],
      },
    ],
  },
  rationale:
    "Four actors: two producers with distinct questions, one planner, one independent critic; no actor is removable.",
};

export function designCast(): { scene: Scene; cast: Cast } {
  return { scene: sceneFromCard(sceneCard), cast: castFromCard(castCard) };
}

// --- The recorded performance (live actors, replayed offline) ---------------

/**
 * What each actor returned in the live run, condensed. The full evidence — URLs,
 * file:line references and the drift list — is in the plan and the epic.
 */
export const recordedOutputs: Record<string, unknown> = {
  ApiReport: {
    verdict: "recipe mostly valid, but stale and hiding one silent trap",
    drift: [
      "createReactAgent is deprecated (since at least @langchain/langgraph@1.0.0); the replacement is createAgent from the separate langchain package",
      "pin is one patch stale: 1.4.17 -> 1.4.18",
      "effective Node floor is 20 (from @langchain/core and @langchain/anthropic), not the documented 18",
      "msg.text is a real getter but returns '' for a tool-call or non-text final message and drops non-text blocks",
      "the model string claude-sonnet-4-6 still matches current docs",
    ],
    structuredOutput: "use responseFormat and read result.structuredResponse, not msg.text",
    reverseDirection:
      "an async StateGraph node may host an external async call; a tool is the alternative when the model should decide",
    unverified: [
      "the first @langchain/core version to introduce the text getter",
      "current-version Bun execution (evidence is from the 1.4.12/1.4.13 era)",
    ],
  },
  SurfaceAudit: {
    seam: "createEngineExecutor (src/engines.ts), tested by R-ENGINE-1..5",
    covered: "the seam is proven generic: artifacts, failures, garbage filtering, a real performance",
    notCovered: [
      "no real engine is ever imported - every test injects a fake invoke",
      "no structured-output assertion on the seam (typed content is a recommendation only)",
      "no assertion of serialization, abort or timeout on an engine executor",
    ],
    unexecutedProse: "all five recipes in docs/engines.md carry pinned versions and are never run",
    overlaps: {
      "drama-gas.4": "structured output - the engine recipe must not duplicate it",
      "drama-gas.6": "resumable gated performance - drama's own resume, no engine checkpointer",
    },
  },
  Plan: {
    verdict: "no LangGraph adapter and no dependency; the seam is sufficient",
    items: [
      "correct and date-stamp the LangGraph recipe",
      "make the recipe verifiable with an on-demand check instead of prose",
      "document the reverse direction: a performance inside LangGraph",
    ],
    notFiled: [
      "any adapter or dependency",
      "structured output (already drama-gas.4)",
      "durable resume (already drama-gas.6)",
      "the same treatment for the other four recipes (deferred)",
    ],
  },
  Critique: {
    verdict: "acceptable with changes",
    mustFix: [
      "the recipe check must add no package.json or tsconfig dependency and never statically import an engine package, or tsc --noEmit breaks",
      "'offline-safe' must mean 'never invoked by bun test', not 'works offline'",
      "StageManager.run returns RunOutcome, so the node must handle the union",
      "the checkpointer note is 'serializable by the checkpointer serializer', not strict JSON",
      "deprecation is since at least 1.0.0, and createAgent is a third install",
      "the Node floor must be attributed to core/anthropic",
    ],
  },
  FinalPlan: {
    epic: "drama-vfu",
    issues: [
      { id: "drama-vfu.1", title: "Correct and date-stamp the LangGraph recipe" },
      { id: "drama-vfu.2", title: "Add bun run verify:engines (LangGraph recipe check)" },
      { id: "drama-vfu.3", title: "Document running a drama performance inside LangGraph" },
    ],
    dependsOn: ["drama-vfu.2 depends on drama-vfu.1"],
    revisedAgainst: "Critique",
    willNotBuild: [
      "a LangGraph adapter or dependency",
      "a supported-engines list",
      "structured output or durable resume under a LangGraph label",
    ],
    overlaps: { "drama-gas.4": "structured output", "drama-gas.6": "durable resume" },
  },
};

/** The performance's executors: the live actor outputs, replayed verbatim. */
export function dramaExecutors(): Record<string, ActorExecutor> {
  return {
    api_verifier: () => ok([artifact("api_verifier", "ApiReport", recordedOutputs.ApiReport)]),
    surface_auditor: () =>
      ok([artifact("surface_auditor", "SurfaceAudit", recordedOutputs.SurfaceAudit)]),
    planner: (ctx) => {
      const revised = ctx.inputs.some((item) => item.kind === "Critique");
      const kind = revised ? "FinalPlan" : "Plan";
      return ok([artifact("planner", kind, recordedOutputs[kind])]);
    },
    critic: () => ok([artifact("critic", "Critique", recordedOutputs.Critique)]),
  };
}

function contentOf<Shape>(context: { artifacts: { kind: string; content: unknown }[] }, kind: string) {
  return context.artifacts.find((item) => item.kind === kind)?.content as Shape | undefined;
}

/** One check per success criterion, read from the replayed artifacts. */
export function evaluatorFor(scene: Scene) {
  const [recipe, nonGoals, overlap, filed, verified] = scene.successCriteria;
  const checks = [
    {
      criterion: recipe!,
      check: (ctx: { artifacts: { kind: string; content: unknown }[] }): CriterionResult =>
        contentOf<{ drift: string[] }>(ctx, "ApiReport")?.drift?.length
          ? { criterion: recipe!.id, status: "pass", evidence: "drift named" }
          : { criterion: recipe!.id, status: "fail", evidence: "no drift named" },
    },
    {
      criterion: nonGoals!,
      check: (ctx: { artifacts: { kind: string; content: unknown }[] }): CriterionResult =>
        contentOf<{ willNotBuild: string[] }>(ctx, "FinalPlan")?.willNotBuild?.length
          ? { criterion: nonGoals!.id, status: "pass", evidence: "non-goals stated" }
          : { criterion: nonGoals!.id, status: "fail", evidence: "no non-goals" },
    },
    {
      criterion: overlap!,
      check: (ctx: { artifacts: { kind: string; content: unknown }[] }): CriterionResult =>
        Object.keys(contentOf<{ overlaps: object }>(ctx, "FinalPlan")?.overlaps ?? {}).length
          ? { criterion: overlap!.id, status: "pass", evidence: "drama-gas overlap explicit" }
          : { criterion: overlap!.id, status: "fail", evidence: "overlap unstated" },
    },
    {
      criterion: filed!,
      check: (ctx: { artifacts: { kind: string; content: unknown }[] }): CriterionResult =>
        (contentOf<{ issues: unknown[] }>(ctx, "FinalPlan")?.issues?.length ?? 0) > 0
          ? { criterion: filed!.id, status: "pass", evidence: "issues carry ids" }
          : { criterion: filed!.id, status: "fail", evidence: "no issues" },
    },
    {
      criterion: verified!,
      check: (ctx: { artifacts: { kind: string; content: unknown }[] }): CriterionResult => {
        const plan = contentOf<{ revisedAgainst?: string }>(ctx, "FinalPlan");
        return plan?.revisedAgainst === "Critique"
          ? { criterion: verified!.id, status: "pass", evidence: "revision answers the critic" }
          : { criterion: verified!.id, status: "fail", evidence: "critique unanswered" };
      },
    },
  ];
  return new Evaluator(criterionEvaluator(checks));
}

export async function performDrama(): Promise<{ performance: Performance; report: string }> {
  const { scene, cast } = designCast();
  const stage = new StageManager({
    evaluator: evaluatorFor(scene),
    castingDirector: new CastingDirector(),
    sceneDesigner: new SceneDesigner(),
  });
  const performance = await stage.perform(scene, cast, {
    executors: dramaExecutors(),
    parallel: true,
  });
  return { performance, report: formatPerformance(performance) };
}

// --- The engine seam, with the corrected LangGraph shape --------------------

/** A compiled LangGraph agent, as far as drama ever sees it. */
interface FakeGraph {
  invoke(input: { messages: { role: string; content: string }[] }): Promise<{
    messages: { content: unknown; text: string }[];
    structuredResponse?: { risks: string[]; mitigation: string };
  }>;
}

/**
 * The corrected recipe. `responseFormat` was supplied, so the answer is
 * `structuredResponse`; `msg.text` is only for a plain-text turn. Note the guard:
 * `createEngineExecutor` only validates that `kind` is a non-empty string, so an
 * empty answer has to be refused here, not assumed away.
 */
export function langgraphStyleExecutor(graph: FakeGraph): ActorExecutor {
  return createEngineExecutor({
    producer: "langgraph",
    invoke: async ({ prompt }) => {
      const result = await graph.invoke({ messages: [{ role: "user", content: prompt }] });
      const report = result.structuredResponse;
      if (!report) return { artifacts: [] };
      return { artifacts: [{ kind: "RiskReport", content: report }] };
    },
  });
}

export interface EngineDemo {
  corrected: { status: string; content: unknown };
  trap: { text: string; note: string };
}

/** Shows the corrected extraction and the trap the old recipe would hit. */
export async function runEngineDemo(): Promise<EngineDemo> {
  const good: FakeGraph = {
    invoke: async () => ({
      messages: [{ content: "done", text: "done" }],
      structuredResponse: { risks: ["backfill on a live table"], mitigation: "batch it" },
    }),
  };
  const actor = createActor({
    name: "analyst",
    role: "migration analyst",
    objective: "Assess the migration",
    capabilities: ["migration_review"],
    expectedOutput: ["RiskReport"],
    executor: langgraphStyleExecutor(good),
  });
  const scene = sceneFromCard({
    objective: "review",
    success_criteria: ["a report exists"],
    required_capabilities: ["migration_review"],
  });
  const cast = createCast(
    [actor],
    createProtocol([{ actor: "analyst", instruction: "assess", produces: ["RiskReport"] }]),
  );
  const evaluator = new Evaluator(
    criterionEvaluator([
      {
        criterion: scene.successCriteria[0]!,
        check: (ctx) =>
          ctx.artifacts.some((item) => item.kind === "RiskReport")
            ? { status: "pass", evidence: "typed report" }
            : { status: "fail", evidence: "no report" },
      },
    ]),
  );
  const performance = await new StageManager({ evaluator }).perform(scene, cast);

  // The trap: a final tool-call message has no text blocks, so `.text` is "".
  const toolCallFinal = { content: [{ type: "tool_call", name: "add" }], text: "" };
  return {
    corrected: {
      status: performance.finalResult.status,
      content: performance.artifacts[0]?.content,
    },
    trap: {
      text: toolCallFinal.text,
      note: "msg.text is '' here, so content: msg.text would ship an empty artifact and pass",
    },
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
    console.log(
      `  ${index + 1}. ${wave.map((step) => `${step.actor} -> ${step.produces.join("+")}`).join("  |  ")}`,
    );
  }

  console.log("\n=== Performance (live actors, replayed offline) ===");
  const { performance, report } = await performDrama();
  console.log(report);
  console.log(`\nperformance status: ${performance.finalResult.status}`);
  console.log(
    `evaluation: ${performance.finalResult.evaluation?.status ?? "none"} -> ${performance.finalResult.evaluation?.recommendedAction ?? "none"}`,
  );
  console.log(`artifacts: ${performance.finalResult.artifacts.map((item) => item.kind).join(", ")}`);

  console.log("\n=== The engine seam, with the corrected LangGraph shape ===");
  const demo = await runEngineDemo();
  console.log(`  corrected: structuredResponse -> ${JSON.stringify(demo.corrected.content)}`);
  console.log(`  status: ${demo.corrected.status}`);
  console.log(`  trap: ${demo.trap.note}`);

  console.log("\n=== Filed in beads ===");
  console.log("  drama-vfu     LangGraph integration: verified, not adapted");
  console.log("  drama-vfu.1   Correct and date-stamp the LangGraph recipe");
  console.log("  drama-vfu.2   Add bun run verify:engines (depends on .1)");
  console.log("  drama-vfu.3   Document running a drama performance inside LangGraph");
}
