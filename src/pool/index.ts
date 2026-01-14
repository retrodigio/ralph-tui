/**
 * ABOUTME: Worker pool module for parallel task execution.
 * Exports Worker class and related types for isolated task processing.
 */

export { Worker } from './worker.js';
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
