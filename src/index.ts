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
  ActorBinding,
  ActorStance,
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
  StepRetry,
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
  globPrefix,
  globsOverlap,
  planWaves,
} from "./cast";

export { createEngineExecutor } from "./engines";
export type {
  EngineRequest,
  EngineResult,
  EngineExecutorOptions,
  DeclaredArtifact,
} from "./engines";

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
  GateRequest,
  Approver,
  PerformanceStatus,
} from "./stage";
export { StageManager } from "./stage";

export { formatPerformance, performanceTimeline } from "./trace";

export type {
  Persona,
  PersonaSource,
  RoleRef,
  Audition,
  AuditionRecord,
  Auditioner,
  StoredAudition,
  AuditionStore,
  AuditionEvent,
  AuditionCandidate,
  Selector,
  DressOptions,
  DressedCast,
} from "./persona";
export {
  createPersona,
  roleRefOf,
  roleFingerprint,
  acceptAllAuditioner,
  createMemoryAuditionStore,
  dressCast,
} from "./persona";

export type { OpencodeAgentCard, PersonaFromAgentOptions, PersonaRosterOptions } from "./opencode";
export {
  parseOpencodeAgent,
  personaFromOpencodeAgent,
  personasFromOpencodeAgents,
} from "./opencode";

export type { PerformanceDocument, DeserializeOptions } from "./serialize";
export {
  PERFORMANCE_FORMAT,
  PERFORMANCE_FORMAT_VERSION,
  serializePerformance,
  deserializePerformance,
  performanceFromDocument,
} from "./serialize";
