/**
 * ABOUTME: Worker pool module for parallel task execution.
 * Exports Worker class and related types for isolated task processing.
 */

export { Worker } from './worker.js';
export {
  RateLimitCoordinator,
  type AgentRateLimitState,
  type RateLimitCoordinatorEvents,
} from './rate-limit-coordinator.js';
export {
  Scheduler,
  type SchedulerConfig,
  type TaskAssignment,
} from './scheduler.js';
export type {
  WorkerConfig,
  WorkerStatus,
  WorkerState,
  WorkerEvent,
  WorkerEventType,
  WorkerEventListener,
  WorkerTaskStartedEvent,
  WorkerTaskCompletedEvent,
  WorkerIterationStartedEvent,
  WorkerIterationCompletedEvent,
  WorkerRateLimitedEvent,
  WorkerErrorEvent,
  WorkerOutputEvent,
  WorkerPausedEvent,
  WorkerResumedEvent,
  IterationResult,
  IterationResultStatus,
  SubagentTraceState,
} from './types.js';
