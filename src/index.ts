/**
 * drama — Scene-Casting for LLM workflows.
 *
 * Don't ask one actor to be the whole theatre. Design the scene, cast the
 * actors, let them pursue local objectives, and make the result emerge.
 */

export type {
  Status,
  RecommendedAction,
  Diagnosis,
  Criterion,
  Artifact,
  InfoItem,
} from "./types";
export { infoText, isBlocking, toInfoItems, nextId, resetIds } from "./types";

export type {
  Scene,
  SceneCard,
  SceneDesignInput,
  SceneAnalysis,
  SceneDesignFn,
  SceneDesignerOptions,
  ConstraintItem,
} from "./scene";
export {
  SceneDesigner,
  sceneFromCard,
  isScene,
  detectConstraintConflicts,
  constraintText,
  constraintConflictsWith,
} from "./scene";

export type {
  Actor,
  ActorKind,
  ActorContext,
  ActorExecutor,
  ActorOutput,
  ActorTurn,
  ToolCall,
  ToolContext,
  ToolHandler,
  ToolRegistry,
  FunctionActorOptions,
  ChatMessage,
  ChatFn,
  LlmExecutorOptions,
} from "./actor";
export {
  createActor,
  functionActor,
  artifact,
  ok,
  failed,
  createToolRegistry,
  renderActorPrompt,
  createLlmExecutor,
} from "./actor";

export type {
  Protocol,
  ProtocolStep,
  ProtocolStepInput,
  Cast,
  CastIssue,
  CastIssueCode,
  MinimalityFinding,
  MinimalityReport,
  RecastContext,
  CastFn,
  ActorCard,
  ProtocolCard,
  CastCard,
} from "./cast";
export {
  CastingDirector,
  createCast,
  createProtocol,
  deriveMinimalCast,
  actorFromCard,
  castFromCard,
} from "./cast";

export type {
  Evaluation,
  EvaluationContext,
  CriterionResult,
  CriterionCheck,
  CriterionCheckResult,
  EvaluatorFn,
  ActorFailure,
} from "./evaluation";
export {
  Evaluator,
  aggregate,
  criterionEvaluator,
  normalizeEvaluation,
  actionForDiagnosis,
} from "./evaluation";

export type {
  StageEvent,
  IterationRecord,
  PerformanceResult,
  Performance,
  RunOutcome,
  StageOptions,
  StageManagerOptions,
} from "./stage";
export { StageManager } from "./stage";

export { formatPerformance, performanceTimeline } from "./trace";
