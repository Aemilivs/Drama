/**
 * End-to-end example: incident root-cause analysis.
 *
 * A checkout service starts returning 500s two minutes after a deploy. A single
 * generic answer blames the loudest symptom ("the database is overloaded").
 * Here a small cast — metrics analyst, change researcher, skeptic, synthesizer —
 * rules out the symptom and converges on the actual cause, because one actor's
 * local objective is to falsify the others.
 *
 * Everything is deterministic, so the example runs offline and the comparison is
 * reproducible. Swap any `functionActor` for `createLlmExecutor(chat)` to run the
 * same production with real models.
 */

import {
  CastingDirector,
  Evaluator,
  SceneDesigner,
  StageManager,
  artifact,
  createCast,
  createProtocol,
  criterionEvaluator,
  formatPerformance,
  functionActor,
  ok,
  sceneFromCard,
} from "../../src/index.ts";
import type {
  ActorContext,
  Cast,
  CriterionCheck,
  EvaluationContext,
  Performance,
  Scene,
} from "../../src/index.ts";

// --- The world state the actors reason over -------------------------------

export const incident = {
  service: "checkout",
  deployAt: "14:00",
  alertAt: "14:02",
  symptoms: [
    "HTTP 500 rate 0.2% -> 6.1%",
    "login p99 latency 180ms -> 2.4s",
    "db connection pool utilization 100%",
    "db query latency p99 12ms (unchanged)",
    "cpu utilization 41% (unchanged)",
    "memory utilization 63% (unchanged)",
  ],
  changes: [
    "auth-service: bcrypt cost factor 10 -> 12",
    "checkout: cart page copy tweak",
  ],
  logs: [
    "login: pool timeout acquiring connection",
    "login: request exceeded 2000ms",
    "cart: ok",
  ],
};

// --- Artifact shapes -------------------------------------------------------

interface MetricReport {
  poolUtilizationPct: number;
  dbLatency: string;
  cpu: string;
  slowPath: string;
  onset: string;
}

interface ChangeReport {
  riskyChange: string;
  touchedPath: string;
  unrelated: string[];
}

interface Critique {
  ruledOut: string[];
  survivingMechanism: string;
}

export interface RootCause {
  cause: string;
  mechanism: string;
  evidence: string[];
  ruledOut: string[];
  fix: string;
}

// --- The naive baseline ----------------------------------------------------

export function singleShotAnswer(): string {
  return "The database is overloaded. Scale up the database and add a read replica.";
}

export interface AnswerScore {
  namesSpecificCause: boolean;
  evidenceBacked: boolean;
  alternativesRuledOut: boolean;
  actionableFix: boolean;
  passed: number;
}

/** Score a free-text answer against the same criteria the cast is judged on. */
export function scoreAnswer(answer: string): AnswerScore {
  const score: AnswerScore = {
    namesSpecificCause: /bcrypt/i.test(answer),
    evidenceBacked: /\bpool\b/i.test(answer) && /(100%|saturat)/i.test(answer),
    alternativesRuledOut:
      /(ruled out|rule out|not the database|database[^.]*unchanged)/i.test(answer),
    actionableFix: /(revert|lower)[^.]*bcrypt|raise[^.]*pool|resize[^.]*pool/i.test(answer),
    passed: 0,
  };
  score.passed = [
    score.namesSpecificCause,
    score.evidenceBacked,
    score.alternativesRuledOut,
    score.actionableFix,
  ].filter(Boolean).length;
  return score;
}

// --- Actors (deterministic; swap for LLM executors to go live) -------------

function metricsAnalyst() {
  return functionActor({
    name: "metrics-analyst",
    role: "metrics analyst",
    archetype: "Detective",
    objective: "Describe what the metrics actually show, without explaining it yet.",
    capabilities: ["metrics_analysis"],
    knowledge: ["The full metrics snapshot for the incident window"],
    constraints: ["Report only what the data supports"],
    produces: "MetricReport",
    run: (): ReturnType<typeof ok> =>
      ok([
        artifact("metrics-analyst", "MetricReport", {
          poolUtilizationPct: 100,
          dbLatency: "p99 12ms (unchanged)",
          cpu: "41% (unchanged)",
          slowPath: "login",
          onset: `first spike at ${incident.alertAt}, two minutes after the ${incident.deployAt} deploy`,
        } satisfies MetricReport),
      ]),
  });
}

function changeResearcher() {
  return functionActor({
    name: "change-researcher",
    role: "change researcher",
    objective: "Report what changed near the onset and which request paths they touch.",
    capabilities: ["change_analysis"],
    knowledge: ["Deploy log for the incident window"],
    produces: "ChangeReport",
    run: (): ReturnType<typeof ok> => {
      const risky = incident.changes.find((change) => /bcrypt/.test(change))!;
      return ok([
        artifact("change-researcher", "ChangeReport", {
          riskyChange: risky,
          touchedPath: "login",
          unrelated: incident.changes.filter((change) => change !== risky),
        } satisfies ChangeReport),
      ]);
    },
  });
}

function skeptic() {
  return functionActor({
    name: "skeptic",
    role: "skeptic",
    archetype: "Adversary",
    objective: "Try to falsify the obvious explanation using the metrics and changes.",
    capabilities: ["adversarial_review"],
    knowledge: ["How connection pools and bcrypt cost interact"],
    interactionPermissions: ["challenge:metrics-analyst", "challenge:change-researcher"],
    produces: "Critique",
    run: (ctx: ActorContext): ReturnType<typeof ok> => {
      const metrics = findInput<MetricReport>(ctx, "MetricReport")!;
      const changes = findInput<ChangeReport>(ctx, "ChangeReport")!;
      const ruledOut = [
        `database overload: db latency is ${metrics.dbLatency} while the pool is pinned at ${metrics.poolUtilizationPct}%`,
        `cpu exhaustion: cpu is ${metrics.cpu}`,
        "generic 'the deploy broke it': only the bcrypt change (on login) is relevant",
      ];
      return ok([
        artifact("skeptic", "Critique", {
          ruledOut,
          survivingMechanism: `the ${changes.touchedPath} path holds a db connection longer, saturating the fixed pool`,
        } satisfies Critique),
      ]);
    },
  });
}

function synthesizer() {
  return functionActor({
    name: "synthesizer",
    role: "root-cause synthesizer",
    objective: "Combine the reports into one falsifiable root cause with a fix.",
    capabilities: ["synthesis"],
    interactionPermissions: ["synthesize"],
    produces: "RootCause",
    run: (ctx: ActorContext): ReturnType<typeof ok> => {
      const metrics = findInput<MetricReport>(ctx, "MetricReport")!;
      const changes = findInput<ChangeReport>(ctx, "ChangeReport")!;
      const critique = findInput<Critique>(ctx, "Critique")!;
      return ok([
        artifact("synthesizer", "RootCause", {
          cause: `The bcrypt cost factor increase (10 -> 12) made login roughly 4x slower, so each request held a database connection longer and exhausted the fixed ${metrics.poolUtilizationPct}% pool.`,
          mechanism: critique.survivingMechanism,
          evidence: [
            `connection pool utilization ${metrics.poolUtilizationPct}%`,
            "login p99 latency 180ms -> 2.4s",
            `db query latency ${metrics.dbLatency}`,
            `bcrypt cost changed at deploy (${incident.deployAt}), alert at ${incident.alertAt}`,
          ],
          ruledOut: critique.ruledOut,
          fix: "Revert the bcrypt cost to 10, then move password hashing off the request path or size the pool for the slowest login.",
        } satisfies RootCause),
      ]);
    },
  });
}

function findInput<T>(ctx: ActorContext, kind: string): T | undefined {
  return ctx.inputs.find((item) => item.kind === kind)?.content as T | undefined;
}

// --- Scene, cast and evaluation -------------------------------------------

export function buildScene(): Scene {
  return sceneFromCard({
    objective:
      "Explain why checkout started returning 500s after the 14:00 deploy, and propose a fix.",
    desiredOutcome: "A falsifiable root cause with supporting evidence and a fix.",
    known: incident.symptoms,
    unknown: ["Whether load changed at the same time"],
    constraints: ["Do not restart or scale anything without a cause"],
    availableTools: ["metrics", "deploy-log"],
    success_criteria: [
      "Names the specific change that caused the incident",
      "Supports the cause with pool and latency evidence",
      "Rules out at least one plausible alternative",
      "Proposes an actionable fix at the cause",
    ],
    failure_modes: [
      "Blaming the loudest symptom (the pool) instead of its cause",
      "Proposing a fix that does not address the cause",
    ],
    required_capabilities: [
      "metrics_analysis",
      "change_analysis",
      "adversarial_review",
      "synthesis",
    ],
    interaction_requirements: [
      "The skeptic must challenge the obvious explanation before synthesis",
    ],
  });
}

export function buildCast(): Cast {
  const actors = [metricsAnalyst(), changeResearcher(), skeptic(), synthesizer()];
  return createCast(
    actors,
    createProtocol(
      [
        {
          actor: "metrics-analyst",
          instruction: "Summarise the metrics relevant to the incident.",
          produces: ["MetricReport"],
        },
        {
          actor: "change-researcher",
          instruction: "Summarise the changes near the onset and the paths they touch.",
          produces: ["ChangeReport"],
        },
        {
          actor: "skeptic",
          instruction: "Falsify the obvious explanation using the metrics and changes.",
          consumes: ["MetricReport", "ChangeReport"],
          produces: ["Critique"],
        },
        {
          actor: "synthesizer",
          instruction: "State the root cause, its evidence, and a fix.",
          consumes: ["MetricReport", "ChangeReport", "Critique"],
          produces: ["RootCause"],
        },
      ],
      "Capability separation: observe, then challenge, then synthesise — never all at once.",
    ),
    "One analyst per information source, an adversarial reviewer, and a synthesizer. Minimal for the criteria.",
  );
}

function rootCauseCheckers(scene: Scene): CriterionCheck[] {
  const rootCause = (ctx: EvaluationContext): RootCause | undefined =>
    [...ctx.artifacts].reverse().find((item) => item.kind === "RootCause")?.content as
      | RootCause
      | undefined;

  return [
    {
      criterion: scene.successCriteria[0]!,
      check: (ctx) => {
        const rc = rootCause(ctx);
        return rc && /bcrypt/i.test(rc.cause)
          ? { status: "pass", evidence: "cause names the bcrypt cost change" }
          : { status: "fail", evidence: "cause does not name a specific change" };
      },
    },
    {
      criterion: scene.successCriteria[1]!,
      check: (ctx) => {
        const rc = rootCause(ctx);
        const backed =
          !!rc &&
          rc.evidence.length >= 3 &&
          rc.evidence.some((line) => /pool/i.test(line)) &&
          rc.evidence.some((line) => /latency/i.test(line));
        return backed
          ? { status: "pass", evidence: `${rc!.evidence.length} evidence lines incl. pool + latency` }
          : { status: "fail", evidence: "evidence is missing or thin" };
      },
    },
    {
      criterion: scene.successCriteria[2]!,
      check: (ctx) => {
        const rc = rootCause(ctx);
        return rc && rc.ruledOut.some((line) => /database/i.test(line))
          ? { status: "pass", evidence: "rules out database overload explicitly" }
          : { status: "fail", evidence: "no alternative explanation was ruled out" };
      },
    },
    {
      criterion: scene.successCriteria[3]!,
      check: (ctx) => {
        const rc = rootCause(ctx);
        return rc && rc.fix.length > 0
          ? { status: "pass", evidence: rc.fix }
          : { status: "fail", evidence: "no fix proposed" };
      },
    },
  ];
}

export function buildStage(scene: Scene): StageManager {
  return new StageManager({
    evaluator: new Evaluator(criterionEvaluator(rootCauseCheckers(scene))),
    castingDirector: new CastingDirector(),
    sceneDesigner: new SceneDesigner(),
  });
}

export interface IncidentExampleResult {
  scene: Scene;
  cast: Cast;
  performance: Performance;
  rootCause?: RootCause;
  baseline: string;
  baselineScore: AnswerScore;
  castScore: AnswerScore;
  report: string;
}

export async function runIncidentExample(): Promise<IncidentExampleResult> {
  const scene = buildScene();
  const cast = buildCast();
  const stage = buildStage(scene);
  const performance = await stage.perform(scene, cast);

  const rootCause = performance.finalResult.artifacts.find(
    (item) => item.kind === "RootCause",
  )?.content as RootCause | undefined;

  const baseline = singleShotAnswer();
  const baselineScore = scoreAnswer(baseline);
  const castScore = scoreAnswer(
    rootCause ? `${rootCause.cause} ${rootCause.evidence.join(" ")} ${rootCause.ruledOut.join(" ")} ${rootCause.fix}` : "",
  );

  return {
    scene,
    cast,
    performance,
    rootCause,
    baseline,
    baselineScore,
    castScore,
    report: formatPerformance(performance),
  };
}

if ((import.meta as { main?: boolean }).main) {
  const result = await runIncidentExample();
  console.log("=== Single-shot answer (one generic request) ===");
  console.log(result.baseline);
  console.log(`score: ${result.baselineScore.passed}/4 criteria\n`);
  console.log("=== Scene-Casting performance ===");
  console.log(result.report);
  console.log(`\ncast answer score: ${result.castScore.passed}/4 criteria`);
  console.log("\nroot cause:", result.rootCause?.cause);
}
