/**
 * ABOUTME: Type definitions for the worker pool system.
 * Defines interfaces for Worker configuration, state, events, and iteration results.
 */

import type { Worktree } from '../worktree/types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { AgentPlugin } from '../plugins/agents/types.js';
import type { TrackerPlugin } from '../plugins/trackers/types.js';
import type { SubagentTrace } from '../logs/types.js';

/**
 * Configuration for creating a Worker
 */
export interface WorkerConfig {
  /** Name of this worker (e.g., 'nebula', 'phoenix') */
  name: string;
  /** Worktree assigned to this worker */
  worktree: Worktree;
  /** Agent plugin instance for executing tasks */
  agent: AgentPlugin;
  /** Tracker plugin instance for task management */
  tracker: TrackerPlugin;
  /** Model to use for agent execution (optional) */
  model?: string;
}

/**
 * Status of a Worker
 */
export type WorkerStatus =
  | 'idle'
  | 'working'
  | 'rate-limited'
  | 'done'
  | 'error';

/**
 * State of a subagent during execution
 */
export interface SubagentTraceState {
  /** Unique identifier for the subagent */
  id: string;
  /** Type of agent (e.g., 'Explore', 'Bash') */
  type: string;
  /** Description of what the subagent is doing */
  description: string;
  /** Current status */
  status: 'running' | 'completed' | 'error';
  /** When the subagent started */
  startedAt: string;
  /** When the subagent ended (if completed/error) */
  endedAt?: string;
  /** Duration in milliseconds (if completed) */
  durationMs?: number;
}

/**
 * Current state of a Worker
 */
export interface WorkerState {
  /** Current worker status */
  status: WorkerStatus;
  /** Currently assigned task (null if idle) */
  task: TrackerTask | null;
  /** Current iteration number for this task */
  iteration: number;
  /** When work started on current task */
  startedAt: Date | null;
  /** Current agent name being used */
  agent: string;
  /** Latest output from the agent */
  output: string;
  /** Active subagent traces */
  subagents: SubagentTraceState[];
  /** Error message if status is 'error' */
  error?: string;
  /** Whether the worker is paused */
  paused: boolean;
}

/**
 * Status of a single iteration execution
 */
export type IterationResultStatus =
  | 'completed'
  | 'task_completed'
  | 'failed'
  | 'rate_limited'
  | 'interrupted';

/**
 * Result of executing a single iteration
 */
export interface IterationResult {
  /** Status of the iteration */
  status: IterationResultStatus;
  /** Whether the task was completed */
  taskCompleted: boolean;
  /** Whether <promise>COMPLETE</promise> was detected */
  promiseComplete: boolean;
  /** Duration of the iteration in milliseconds */
  durationMs: number;
  /** Agent output from the iteration */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Rate limit info if rate limited */
  rateLimit?: {
    message: string;
    retryAfter?: number;
  };
  /** Subagent trace if available */
  subagentTrace?: SubagentTrace;
}

/**
 * Base interface for all Worker events
 */
export interface WorkerEventBase {
  /** Event type */
  type: WorkerEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Worker name */
  workerName: string;
}

/**
 * Event types emitted by Worker
 */
export type WorkerEventType =
  | 'task:started'
  | 'task:completed'
  | 'iteration:started'
  | 'iteration:completed'
  | 'rate-limited'
  | 'error'
  | 'output'
  | 'paused'
  | 'resumed';

/**
 * Event emitted when a task is started
 */
export interface WorkerTaskStartedEvent extends WorkerEventBase {
  type: 'task:started';
  task: TrackerTask;
}

/**
 * Event emitted when a task is completed
 */
export interface WorkerTaskCompletedEvent extends WorkerEventBase {
  type: 'task:completed';
  task: TrackerTask;
  totalIterations: number;
}

/**
 * Event emitted when an iteration starts
 */
export interface WorkerIterationStartedEvent extends WorkerEventBase {
  type: 'iteration:started';
  task: TrackerTask;
  iteration: number;
}

/**
 * Event emitted when an iteration completes
 */
export interface WorkerIterationCompletedEvent extends WorkerEventBase {
  type: 'iteration:completed';
  task: TrackerTask;
  iteration: number;
  result: IterationResult;
}

/**
 * Event emitted when rate limited
 */
export interface WorkerRateLimitedEvent extends WorkerEventBase {
  type: 'rate-limited';
  task: TrackerTask;
  message: string;
  retryAfter?: number;
}

/**
 * Event emitted on error
 */
export interface WorkerErrorEvent extends WorkerEventBase {
  type: 'error';
  task: TrackerTask | null;
  error: string;
}

/**
 * Event emitted when agent output is received
 */
export interface WorkerOutputEvent extends WorkerEventBase {
  type: 'output';
  stream: 'stdout' | 'stderr';
  data: string;
}

/**
 * Event emitted when worker is paused
 */
export interface WorkerPausedEvent extends WorkerEventBase {
  type: 'paused';
}

/**
 * Event emitted when worker is resumed
 */
export interface WorkerResumedEvent extends WorkerEventBase {
  type: 'resumed';
}

/**
 * Union of all Worker events
 */
export type WorkerEvent =
  | WorkerTaskStartedEvent
  | WorkerTaskCompletedEvent
  | WorkerIterationStartedEvent
  | WorkerIterationCompletedEvent
  | WorkerRateLimitedEvent
  | WorkerErrorEvent
  | WorkerOutputEvent
  | WorkerPausedEvent
  | WorkerResumedEvent;

/**
 * Listener function for Worker events
 */
export type WorkerEventListener = (event: WorkerEvent) => void;
