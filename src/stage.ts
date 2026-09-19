/**
 * Stage Manager: runs a cast according to its protocol, evaluates the result,
 * and drives the reperform / recast / redesign loop.
 *
 * Every activation, input, output, evaluation and decision is recorded in an
 * inspectable trace.
 */

import type { Artifact, Diagnosis, RecommendedAction, Status } from "./types";
import { nextId } from "./types";
import type { Scene, SceneAnalysis, SceneDesignInput } from "./scene";
import { SceneDesigner } from "./scene";
import type {
  Actor,
  ActorExecutor,
  ActorOutput,
  ActorTurn,
  ChatFn,
  ToolRegistry,
} from "./actor";
import { createLlmExecutor, createToolRegistry, failed } from "./actor";
import type { Cast } from "./cast";
import { CastingDirector } from "./cast";
import type { ActorFailure, Evaluation } from "./evaluation";
import { Evaluator } from "./evaluation";
import type { AuditionEvent, Auditioner, AuditionStore, Persona, Selector } from "./persona";
import { dressCast } from "./persona";

export type StageEvent =
  | { type: "scene_designed"; sceneId: string; complete: boolean; questions: string[] }
  | { type: "cast_selected"; castId: string; actors: string[]; rationale: string }
  | { type: "actor_activated"; iteration: number; step: string; actor: string; inputIds: string[] }
  | { type: "actor_output"; iteration: number; step: string; actor: string; artifactIds: string[] }
  | { type: "actor_failed"; iteration: number; step: string; actor: string; error: string }
  | { type: "evaluated"; iteration: number; status: Status; recommendedAction: RecommendedAction; diagnosis: Diagnosis }
  | { type: "decision"; iteration: number; action: RecommendedAction; diagnosis: Diagnosis }
  | { type: "recast"; attempt: number; diagnosis: Diagnosis; actors: string[] }
  | { type: "redesign"; attempt: number; diagnosis: Diagnosis; sceneId: string }
  | { type: "finished"; status: "done" | "failed"; reason: string }
  | AuditionEvent;

export interface IterationRecord {
  index: number;
  turns: ActorTurn[];
  failures: ActorFailure[];
  evaluation: Evaluation | null;
  decision: RecommendedAction | null;
}

export interface PerformanceResult {
  status: "done" | "failed";
  reason: string;
  artifacts: Artifact[];
  evaluation: Evaluation | null;
}

export interface Performance {
  id: string;
  scene: Scene;
  cast: Cast;
  /** Every cast used, including recasts. */
  casts: Cast[];
  /** Every scene used, including redesigns. */
  scenes: Scene[];
  iterations: IterationRecord[];
  turns: ActorTurn[];
  artifacts: Artifact[];
  events: StageEvent[];
  finalResult: PerformanceResult;
}

export type RunOutcome =
  | {
      kind: "needs_input";
      scene: Scene;
      analysis: SceneAnalysis;
      questions: string[];
    }
  | { kind: "performance"; performance: Performance };

export interface StageOptions {
  /** Per-actor executor overrides, keyed by actor name. Highest priority. */
  executors?: Record<string, ActorExecutor>;
  tools?: ToolRegistry;
  /** Enables actors of kind "llm" that have no executor of their own. */
  chat?: ChatFn;
  /** Roster of personas. With an `auditioner`, each cast is dressed. */
  personas?: Persona[];
  auditioner?: Auditioner;
  auditionStore?: AuditionStore;
  /** Cap on how many personas are asked per dressing. */
  maxAuditions?: number;
  /** Ask every persona instead of stopping once every role has an acceptor. */
  askAll?: boolean;
  /** Choose among the personas that accepted. Defaults to roster order. */
  select?: Selector;
  onEvent?: (event: StageEvent) => void;
}

export interface StageManagerOptions extends StageOptions {
  evaluator: Evaluator;
  castingDirector?: CastingDirector;
  sceneDesigner?: SceneDesigner;
  /** Total performances (including reperformances) before giving up. */
  maxPerformances?: number;
  maxRecasts?: number;
  maxRedesigns?: number;
  clock?: () => number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Artifact inputs are explicit: an empty `consumes` means no inputs. */
function selectInputs(artifacts: Artifact[], consumes: string[]): Artifact[] {
  if (consumes.length === 0) return [];
  return artifacts.filter((item) => consumes.includes(item.kind));
}

export class StageManager {
  private readonly defaults: Required<Pick<StageOptions, "executors" | "tools">> & StageOptions;
  private readonly evaluator: Evaluator;
  private readonly castingDirector: CastingDirector;
  private readonly sceneDesigner: SceneDesigner;
  private readonly maxPerformances: number;
  private readonly maxRecasts: number;
  private readonly maxRedesigns: number;
  private readonly clock: () => number;

  constructor(options: StageManagerOptions) {
    this.evaluator = options.evaluator;
    this.castingDirector = options.castingDirector ?? new CastingDirector();
    this.sceneDesigner = options.sceneDesigner ?? new SceneDesigner();
    this.maxPerformances = options.maxPerformances ?? 4;
    this.maxRecasts = options.maxRecasts ?? 2;
    this.maxRedesigns = options.maxRedesigns ?? 1;
    this.clock = options.clock ?? Date.now;
    this.defaults = {
      executors: options.executors ?? {},
      tools: options.tools ?? createToolRegistry(),
      chat: options.chat,
      personas: options.personas,
      auditioner: options.auditioner,
      auditionStore: options.auditionStore,
      maxAuditions: options.maxAuditions,
      askAll: options.askAll,
      select: options.select,
      onEvent: options.onEvent,
    };
  }

  /** Full lifecycle: design the scene, cast, then perform. */
  async run(
    request: string | SceneDesignInput,
    options: StageOptions = {},
  ): Promise<RunOutcome> {
    const opts = { ...this.defaults, ...options };
    const scene = await this.sceneDesigner.design(request);
    const analysis = this.sceneDesigner.analyze(scene);
    opts.onEvent?.({
      type: "scene_designed",
      sceneId: scene.id,
      complete: analysis.complete,
      questions: analysis.questions,
    });
    if (this.sceneDesigner.shouldAskQuestions(analysis)) {
      return { kind: "needs_input", scene, analysis, questions: analysis.questions };
    }
    const cast = await this.castingDirector.cast(scene, { attempt: 1 });
    const performance = await this.perform(scene, cast, options);
    return { kind: "performance", performance };
  }

  /** Skip design: perform an explicitly given scene and cast. */
  async perform(
    sceneInput: Scene,
    castInput: Cast,
    options: StageOptions = {},
  ): Promise<Performance> {
    const opts = { ...this.defaults, ...options };
    const performanceId = nextId("performance");

    let scene = sceneInput;
    let cast = castInput;

    const casts: Cast[] = [];
    const scenes: Scene[] = [scene];
    const iterations: IterationRecord[] = [];
    const turns: ActorTurn[] = [];
    const artifacts: Artifact[] = [];
    const events: StageEvent[] = [];

    const emit = (event: StageEvent) => {
      events.push(event);
      opts.onEvent?.(event);
    };

    /**
     * Bind personas to a cast's roles when a roster and an auditioner are
     * supplied. Roles are never added or removed — only dressed.
     */
    const dress = async (input: Cast): Promise<Cast> => {
      if (!opts.personas?.length || !opts.auditioner) return input;
      const dressed = await dressCast(input, scene, {
        personas: opts.personas,
        auditioner: opts.auditioner,
        auditionStore: opts.auditionStore,
        maxAuditions: opts.maxAuditions,
        askAll: opts.askAll,
        select: opts.select,
        onEvent: emit,
      });
      return dressed.cast;
    };

    let result: PerformanceResult = {
      status: "failed",
      reason: "no iterations executed",
      artifacts: [],
      evaluation: null,
    };
    let performances = 0;
    let recasts = 0;
    let redesigns = 0;
    // The initial cast is attempt 1; the first recast is attempt 2.
    let castAttempt = 1;

    emit({
      type: "cast_selected",
      castId: cast.id,
      actors: cast.actors.map((actor) => actor.name),
      rationale: cast.rationale,
    });
    cast = await dress(cast);
    casts.push(cast);

    while (performances < this.maxPerformances) {
      performances += 1;
      const iterationIndex = performances;
      const record: IterationRecord = {
        index: iterationIndex,
        turns: [],
        failures: [],
        evaluation: null,
        decision: null,
      };

      for (const step of cast.protocol.steps) {
        const actor = cast.actors.find((candidate) => candidate.name === step.actor);
        if (!actor) {
          const error = `step "${step.id}" references unknown actor "${step.actor}"`;
          record.failures.push({ actor: step.actor, step: step.id, error });
          emit({
            type: "actor_failed",
            iteration: iterationIndex,
            step: step.id,
            actor: step.actor,
            error,
          });
          if (!step.optional) break;
          continue;
        }

        const inputs = selectInputs(artifacts, step.consumes);
        emit({
          type: "actor_activated",
          iteration: iterationIndex,
          step: step.id,
          actor: actor.name,
          inputIds: inputs.map((item) => item.id),
        });

        const startedAt = this.clock();
        let output: ActorOutput;
        try {
          const executor = this.resolveExecutor(actor, opts);
          output = await executor({
            scene,
            actor,
            instruction: step.instruction,
            inputs,
            history: turns.slice(),
            tools: opts.tools ?? createToolRegistry(),
            iteration: iterationIndex,
          });
          if (!output || typeof output !== "object") {
            output = failed("executor returned no output");
          }
        } catch (error) {
          output = failed(messageOf(error));
        }
        const endedAt = this.clock();

        const turn: ActorTurn = {
          id: nextId("turn"),
          iteration: iterationIndex,
          step: step.id,
          actor: actor.name,
          instruction: step.instruction,
          inputIds: inputs.map((item) => item.id),
          output,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
        };
        record.turns.push(turn);
        turns.push(turn);

        if (output.status === "failed") {
          const error = output.error ?? "actor failed";
          record.failures.push({ actor: actor.name, step: step.id, error });
          emit({
            type: "actor_failed",
            iteration: iterationIndex,
            step: step.id,
            actor: actor.name,
            error,
          });
          if (!step.optional) break;
        } else {
          artifacts.push(...output.artifacts);
          emit({
            type: "actor_output",
            iteration: iterationIndex,
            step: step.id,
            actor: actor.name,
            artifactIds: output.artifacts.map((item) => item.id),
          });
        }
      }

      const evaluation = await this.evaluator.evaluate({
        scene,
        cast,
        artifacts,
        failures: record.failures,
        iteration: iterationIndex,
      });
      record.evaluation = evaluation;
      record.decision = evaluation.recommendedAction;
      iterations.push(record);

      emit({
        type: "evaluated",
        iteration: iterationIndex,
        status: evaluation.status,
        recommendedAction: evaluation.recommendedAction,
        diagnosis: evaluation.diagnosis,
      });
      emit({
        type: "decision",
        iteration: iterationIndex,
        action: evaluation.recommendedAction,
        diagnosis: evaluation.diagnosis,
      });

      const stop = (reason: string, status: "done" | "failed") => {
        result = {
          status,
          reason,
          artifacts: artifacts.slice(),
          evaluation,
        };
        emit({ type: "finished", status, reason });
      };

      if (evaluation.recommendedAction === "finish") {
        stop("evaluation passed", "done");
        break;
      }

      if (evaluation.recommendedAction === "reperform") {
        continue;
      }

      if (evaluation.recommendedAction === "recast") {
        if (recasts >= this.maxRecasts) {
          stop("max recasts reached", "failed");
          break;
        }
        castAttempt += 1;
        const recastCast = await this.castingDirector.cast(scene, {
          attempt: castAttempt,
          previous: cast,
          evaluation,
          diagnosis: evaluation.diagnosis,
        });
        recasts += 1;
        emit({
          type: "recast",
          attempt: castAttempt,
          diagnosis: evaluation.diagnosis,
          actors: recastCast.actors.map((actor) => actor.name),
        });
        cast = await dress(recastCast);
        casts.push(cast);
        continue;
      }

      // redesign_scene
      if (redesigns >= this.maxRedesigns) {
        stop("max redesigns reached", "failed");
        break;
      }
      scene = await this.sceneDesigner.design(
        { request: scene.objective },
        { previous: scene, diagnosis: evaluation.diagnosis },
      );
      scenes.push(scene);
      redesigns += 1;
      artifacts.length = 0;
      // A redesigned scene restarts casting from attempt 1.
      castAttempt = 1;
      const redesignedCast = await this.castingDirector.cast(scene, {
        attempt: castAttempt,
        previous: cast,
        evaluation,
        diagnosis: evaluation.diagnosis,
      });
      emit({
        type: "redesign",
        attempt: redesigns,
        diagnosis: evaluation.diagnosis,
        sceneId: scene.id,
      });
      cast = await dress(redesignedCast);
      casts.push(cast);
    }

    if (result.status === "failed" && result.reason === "no iterations executed") {
      result = {
        status: "failed",
        reason: performances >= this.maxPerformances
          ? "max performances reached"
          : "performance did not finish",
        artifacts: artifacts.slice(),
        evaluation: iterations.at(-1)?.evaluation ?? null,
      };
    }

    return {
      id: performanceId,
      scene,
      cast,
      casts,
      scenes,
      iterations,
      turns,
      artifacts,
      events,
      finalResult: result,
    };
  }

  private resolveExecutor(actor: Actor, opts: StageOptions): ActorExecutor {
    const override = opts.executors?.[actor.name];
    if (override) return override;
    if (actor.executor) return actor.executor;
    // Only LLM actors may fall back to the shared chat function.
    if (opts.chat && actor.kind === "llm") return createLlmExecutor(opts.chat);
    throw new Error(`no executor available for actor "${actor.name}"`);
  }
}
