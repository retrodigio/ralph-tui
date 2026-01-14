/**
 * ABOUTME: Worker pool module for parallel task execution.
 * Exports WorkerPool orchestrator, Worker class, and related types for
 * isolated task processing with coordinated worktree management.
 */

export {
  WorkerPool,
  type PoolConfig,
  type PoolState,
  type PoolStatus,
  type WorkerPoolEvents,
  type AgentFactory,
  DEFAULT_POOL_CONFIG,
} from './worker-pool.js';
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
export { PoolRefineryIntegration } from './pool-refinery-integration.js';
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
