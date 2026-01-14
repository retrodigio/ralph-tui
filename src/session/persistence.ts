/**
 * ABOUTME: Session persistence for Ralph TUI.
 * Handles saving and loading full session state including task statuses,
 * iteration history, and tracker state to .ralph-tui/session.json.
 * Supports both single-worker (v1) and parallel-worker (v2) session formats.
 */

import { join, dirname } from 'node:path';
import {
  readFile,
  writeFile,
  unlink,
  access,
  constants,
  mkdir,
} from 'node:fs/promises';
import type { TrackerTask, TrackerTaskStatus } from '../plugins/trackers/types.js';
import type { IterationResult } from '../engine/types.js';
import type { SessionStatus } from './types.js';
import type { MergeRequestStatus } from '../refinery/types.js';
import type { WorkerStatus } from '../pool/types.js';

/**
 * Session file path relative to cwd (inside .ralph-tui directory)
 */
const SESSION_FILE = '.ralph-tui/session.json';

/**
 * Task status snapshot for persistence
 */
export interface TaskStatusSnapshot {
  /** Task ID */
  id: string;
  /** Task title for display */
  title: string;
  /** Current status */
  status: TrackerTaskStatus;
  /** Whether task was completed in this session */
  completedInSession: boolean;
}

/**
 * Tracker state for persistence
 */
export interface TrackerStateSnapshot {
  /** Tracker plugin name */
  plugin: string;
  /** Epic ID if using beads */
  epicId?: string;
  /** PRD path if using json tracker */
  prdPath?: string;
  /** Total tasks at session start */
  totalTasks: number;
  /** Task statuses snapshot */
  tasks: TaskStatusSnapshot[];
}

/**
 * Persisted session state
 * Saved to .ralph-tui/session.json
 */
export interface PersistedSessionState {
  /** Schema version for forward compatibility */
  version: 1;

  /** Unique session identifier */
  sessionId: string;

  /** Current session status */
  status: SessionStatus;

  /** When the session was started (ISO 8601) */
  startedAt: string;

  /** When the session was last updated (ISO 8601) */
  updatedAt: string;

  /** When the session was paused (if paused) */
  pausedAt?: string;

  /** Current iteration number (0-based internally, 1-based for display) */
  currentIteration: number;

  /** Maximum iterations configured (0 = unlimited) */
  maxIterations: number;

  /** Tasks completed in this session */
  tasksCompleted: number;

  /** Whether the session is paused */
  isPaused: boolean;

  /** Agent plugin being used */
  agentPlugin: string;

  /** Model being used (if specified) */
  model?: string;

  /** Tracker state snapshot */
  trackerState: TrackerStateSnapshot;

  /** Completed iteration results */
  iterations: PersistedIterationResult[];

  /** Skipped task IDs (for retry/skip error handling) */
  skippedTaskIds: string[];

  /** Working directory */
  cwd: string;

  /**
   * Task IDs that this session set to in_progress and haven't completed.
   * Used for crash recovery: on graceful shutdown, reset these back to open.
   * On startup, detect stale in_progress tasks from crashed sessions.
   */
  activeTaskIds: string[];

  /**
   * Whether the subagent tree panel is visible.
   * Persisted to remember user preference across pauses/resumes.
   */
  subagentPanelVisible?: boolean;
}

/**
 * Persisted iteration result (subset of IterationResult for storage)
 */
export interface PersistedIterationResult {
  /** Iteration number (1-based) */
  iteration: number;

  /** Status of the iteration */
  status: IterationResult['status'];

  /** Task ID that was worked on */
  taskId: string;

  /** Task title for display */
  taskTitle: string;

  /** Whether the task was completed */
  taskCompleted: boolean;

  /** Duration in milliseconds */
  durationMs: number;

  /** Error message if failed */
  error?: string;

  /** When iteration started */
  startedAt: string;

  /** When iteration ended */
  endedAt: string;
}

// =============================================================================
// Version 2: Parallel Mode Session Types
// =============================================================================

/**
 * Session mode indicator
 */
export type SessionMode = 'single' | 'parallel';

/**
 * Persisted state of a worker in parallel mode
 */
export interface PersistedWorkerState {
  /** Task ID currently assigned (null if idle) */
  taskId: string | null;
  /** Task title for display */
  taskTitle?: string;
  /** Current iteration number for this task */
  iteration: number;
  /** Worker status */
  status: WorkerStatus;
  /** Agent being used by this worker */
  agent: string;
  /** Worktree path for this worker */
  worktreePath: string;
  /** Branch name for this worker */
  branch: string;
  /** When work started on current task (ISO 8601) */
  startedAt?: string;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Persisted merge request in the queue
 */
export interface PersistedMergeRequest {
  /** Unique identifier */
  id: string;
  /** Branch to merge */
  branch: string;
  /** Worker name that completed the task */
  workerName: string;
  /** Task ID associated with this merge */
  taskId: string;
  /** Priority level (P0-P4) */
  priority: number;
  /** Number of tasks this unblocks */
  unblockCount: number;
  /** When request was created (ISO 8601) */
  createdAt: string;
  /** Current status */
  status: MergeRequestStatus;
  /** Retry count */
  retryCount: number;
  /** Error message if failed/conflict */
  error?: string;
}

/**
 * Rate limit state for an agent
 */
export interface PersistedRateLimitState {
  /** Whether agent is available or limited */
  status: 'available' | 'limited';
  /** When the agent was limited (ISO 8601) */
  limitedAt?: string;
  /** When to retry (ISO 8601) */
  retryAfter?: string;
  /** Consecutive limit count */
  consecutiveLimits: number;
}

/**
 * Pool state for parallel mode sessions (version 2)
 */
export interface PersistedPoolState {
  /** Per-worker state, keyed by worker name */
  workers: Record<string, PersistedWorkerState>;
  /** Merge queue state */
  mergeQueue: PersistedMergeRequest[];
  /** Task IDs that have been completed */
  completedTasks: string[];
  /** Task IDs that have conflicts awaiting resolution */
  conflictTasks: string[];
  /** Rate limit state per agent */
  rateLimitState: Record<string, PersistedRateLimitState>;
  /** Maximum parallel workers configured */
  maxWorkers: number;
  /** Fallback agent chain */
  fallbackChain: string[];
}

/**
 * Version 2 session state (parallel mode).
 * Backward compatible with version 1.
 */
export interface PersistedSessionStateV2 extends Omit<PersistedSessionState, 'version'> {
  /** Schema version for forward compatibility */
  version: 2;

  /** Session mode: 'single' or 'parallel' */
  mode: SessionMode;

  /** Pool state (only present in parallel mode) */
  pool?: PersistedPoolState;

  /** Global iteration counter (sum across all workers in parallel mode) */
  globalIteration?: number;
}

/**
 * Union type for all session versions.
 * Use isParallelSession() to check mode.
 */
export type AnyPersistedSessionState = PersistedSessionState | PersistedSessionStateV2;

/**
 * Type guard to check if session is parallel mode (v2)
 */
export function isParallelSession(
  state: AnyPersistedSessionState
): state is PersistedSessionStateV2 {
  return state.version === 2 && (state as PersistedSessionStateV2).mode === 'parallel';
}

/**
 * Type guard to check if session is single mode (v1 or v2 single)
 */
export function isSingleSession(state: AnyPersistedSessionState): boolean {
  return state.version === 1 || (state as PersistedSessionStateV2).mode === 'single';
}

/**
 * Get the session file path
 */
function getSessionFilePath(cwd: string): string {
  return join(cwd, SESSION_FILE);
}

/**
 * Check if a session file exists
 */
export async function hasPersistedSession(cwd: string): Promise<boolean> {
  const filePath = getSessionFilePath(cwd);
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a loaded session has required fields.
 * Returns null if valid, or an error message if invalid.
 */
function validateLoadedSession(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return 'Session file is not a valid object';
  }

  const session = parsed as Record<string, unknown>;

  // Required top-level fields
  if (typeof session.sessionId !== 'string') {
    return 'Missing or invalid sessionId';
  }
  if (typeof session.status !== 'string') {
    return 'Missing or invalid status';
  }

  // trackerState is required and must have required sub-fields
  if (!session.trackerState || typeof session.trackerState !== 'object') {
    return 'Missing or invalid trackerState (session may be from an older version)';
  }

  const trackerState = session.trackerState as Record<string, unknown>;
  if (typeof trackerState.plugin !== 'string') {
    return 'Missing trackerState.plugin';
  }
  if (typeof trackerState.totalTasks !== 'number') {
    return 'Missing trackerState.totalTasks';
  }
  if (!Array.isArray(trackerState.tasks)) {
    return 'Missing trackerState.tasks array';
  }

  return null;
}

/**
 * Load persisted session state (v1 format only).
 * For loading any version, use loadAnyPersistedSession().
 */
export async function loadPersistedSession(
  cwd: string
): Promise<PersistedSessionState | null> {
  const session = await loadAnyPersistedSession(cwd);
  if (!session) {
    return null;
  }

  // For backward compatibility, only return v1 sessions
  if (session.version === 2) {
    // Convert v2 single-mode session to v1 format for compatibility
    if ((session as PersistedSessionStateV2).mode === 'single') {
      // Create a clean v1 session without v2-specific fields
      const v2Session = session as PersistedSessionStateV2;
      const v1Session: PersistedSessionState = {
        version: 1,
        sessionId: v2Session.sessionId,
        status: v2Session.status,
        startedAt: v2Session.startedAt,
        updatedAt: v2Session.updatedAt,
        pausedAt: v2Session.pausedAt,
        currentIteration: v2Session.currentIteration,
        maxIterations: v2Session.maxIterations,
        tasksCompleted: v2Session.tasksCompleted,
        isPaused: v2Session.isPaused,
        agentPlugin: v2Session.agentPlugin,
        model: v2Session.model,
        trackerState: v2Session.trackerState,
        iterations: v2Session.iterations,
        skippedTaskIds: v2Session.skippedTaskIds,
        cwd: v2Session.cwd,
        activeTaskIds: v2Session.activeTaskIds,
        subagentPanelVisible: v2Session.subagentPanelVisible,
      };
      return v1Session;
    }
    // Parallel mode sessions cannot be returned as v1
    console.warn(
      'Session is in parallel mode (v2) but caller requested v1. ' +
        'Use loadAnyPersistedSession() for parallel sessions.'
    );
    return null;
  }

  return session as PersistedSessionState;
}

/**
 * Load persisted session state (any version).
 * Handles both v1 (single worker) and v2 (parallel mode) sessions.
 */
export async function loadAnyPersistedSession(
  cwd: string
): Promise<AnyPersistedSessionState | null> {
  const filePath = getSessionFilePath(cwd);

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Validate required fields exist
    const validationError = validateLoadedSession(parsed);
    if (validationError) {
      console.warn(
        `Invalid session file: ${validationError}. ` +
          'Delete .ralph-tui/session.json to start fresh.'
      );
      return null;
    }

    // Detect version
    const version = (parsed as Record<string, unknown>).version ?? 1;

    if (version === 1) {
      const session = parsed as PersistedSessionState;
      // Ensure version field is set for future saves
      session.version = 1;
      return session;
    } else if (version === 2) {
      const session = parsed as PersistedSessionStateV2;
      // Validate v2-specific fields
      const v2Error = validateV2Session(session);
      if (v2Error) {
        console.warn(
          `Invalid v2 session file: ${v2Error}. ` +
            'Delete .ralph-tui/session.json to start fresh.'
        );
        return null;
      }
      return session;
    } else {
      console.warn(
        `Unknown session file version: ${version}. ` +
          'Session may not load correctly.'
      );
      // Try loading as v1 for forward compatibility
      const session = parsed as PersistedSessionState;
      session.version = 1;
      return session;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Validate v2-specific session fields.
 * Returns null if valid, or an error message if invalid.
 */
function validateV2Session(session: PersistedSessionStateV2): string | null {
  if (session.mode !== 'single' && session.mode !== 'parallel') {
    return 'Invalid or missing mode field';
  }

  if (session.mode === 'parallel') {
    if (!session.pool) {
      return 'Parallel mode session missing pool state';
    }
    if (typeof session.pool.workers !== 'object') {
      return 'Invalid pool.workers';
    }
    if (!Array.isArray(session.pool.mergeQueue)) {
      return 'Invalid pool.mergeQueue';
    }
  }

  return null;
}

/**
 * Save persisted session state (v1 format).
 * For v2 sessions, use saveAnyPersistedSession().
 */
export async function savePersistedSession(
  state: PersistedSessionState
): Promise<void> {
  await saveAnyPersistedSession(state);
}

/**
 * Save persisted session state (any version).
 * Handles both v1 and v2 session formats.
 */
export async function saveAnyPersistedSession(
  state: AnyPersistedSessionState
): Promise<void> {
  const filePath = getSessionFilePath(state.cwd);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Update timestamp
  const updatedState: AnyPersistedSessionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(filePath, JSON.stringify(updatedState, null, 2));
}

/**
 * Delete the persisted session file
 */
export async function deletePersistedSession(cwd: string): Promise<boolean> {
  const filePath = getSessionFilePath(cwd);

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false; // File didn't exist
    }
    throw error;
  }
}

/**
 * Create a new persisted session state
 */
export function createPersistedSession(options: {
  sessionId: string;
  agentPlugin: string;
  model?: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
  maxIterations: number;
  tasks: TrackerTask[];
  cwd: string;
}): PersistedSessionState {
  const now = new Date().toISOString();

  return {
    version: 1,
    sessionId: options.sessionId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    currentIteration: 0,
    maxIterations: options.maxIterations,
    tasksCompleted: 0,
    isPaused: false,
    agentPlugin: options.agentPlugin,
    model: options.model,
    trackerState: {
      plugin: options.trackerPlugin,
      epicId: options.epicId,
      prdPath: options.prdPath,
      totalTasks: options.tasks.length,
      tasks: options.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        completedInSession: false,
      })),
    },
    iterations: [],
    skippedTaskIds: [],
    cwd: options.cwd,
    activeTaskIds: [],
    subagentPanelVisible: false,
  };
}

/**
 * Update session state after an iteration completes
 */
export function updateSessionAfterIteration(
  state: PersistedSessionState,
  result: IterationResult
): PersistedSessionState {
  const iterationRecord: PersistedIterationResult = {
    iteration: result.iteration,
    status: result.status,
    taskId: result.task.id,
    taskTitle: result.task.title,
    taskCompleted: result.taskCompleted,
    durationMs: result.durationMs,
    error: result.error,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
  };

  // Update task status in snapshot if completed
  const updatedTasks = state.trackerState.tasks.map((task) => {
    if (task.id === result.task.id && result.taskCompleted) {
      return {
        ...task,
        status: 'completed' as TrackerTaskStatus,
        completedInSession: true,
      };
    }
    return task;
  });

  return {
    ...state,
    currentIteration: result.iteration,
    tasksCompleted: result.taskCompleted
      ? state.tasksCompleted + 1
      : state.tasksCompleted,
    trackerState: {
      ...state.trackerState,
      tasks: updatedTasks,
    },
    iterations: [...state.iterations, iterationRecord],
  };
}

/**
 * Mark session as paused
 */
export function pauseSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'paused',
    isPaused: true,
    pausedAt: new Date().toISOString(),
  };
}

/**
 * Mark session as resumed
 */
export function resumePersistedSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'running',
    isPaused: false,
    pausedAt: undefined,
  };
}

/**
 * Mark session as completed
 */
export function completeSession(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    status: 'completed',
    isPaused: false,
  };
}

/**
 * Mark session as failed
 */
export function failSession(
  state: PersistedSessionState,
  _error?: string
): PersistedSessionState {
  return {
    ...state,
    status: 'failed',
    isPaused: false,
  };
}

/**
 * Add a skipped task ID
 */
export function addSkippedTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  if (state.skippedTaskIds.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    skippedTaskIds: [...state.skippedTaskIds, taskId],
  };
}

/**
 * Add a task to the active task list (when starting work on it).
 * These are tasks this session set to in_progress that haven't completed.
 */
export function addActiveTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  // Handle legacy sessions that don't have activeTaskIds
  const currentActive = state.activeTaskIds ?? [];

  if (currentActive.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    activeTaskIds: [...currentActive, taskId],
  };
}

/**
 * Remove a task from the active task list (when task is completed).
 */
export function removeActiveTask(
  state: PersistedSessionState,
  taskId: string
): PersistedSessionState {
  // Handle legacy sessions that don't have activeTaskIds
  const currentActive = state.activeTaskIds ?? [];

  return {
    ...state,
    activeTaskIds: currentActive.filter((id) => id !== taskId),
  };
}

/**
 * Clear all active tasks (used during graceful shutdown).
 */
export function clearActiveTasks(
  state: PersistedSessionState
): PersistedSessionState {
  return {
    ...state,
    activeTaskIds: [],
  };
}

/**
 * Get the list of active task IDs for this session.
 * Returns empty array for legacy sessions without this field.
 */
export function getActiveTasks(state: PersistedSessionState): string[] {
  return state.activeTaskIds ?? [];
}

/**
 * Update subagent panel visibility in session state.
 */
export function setSubagentPanelVisible(
  state: PersistedSessionState,
  visible: boolean
): PersistedSessionState {
  return {
    ...state,
    subagentPanelVisible: visible,
  };
}

/**
 * Check if a session is resumable
 */
export function isSessionResumable(state: PersistedSessionState): boolean {
  // Can resume if paused, running (crashed), or interrupted
  return (
    state.status === 'paused' ||
    state.status === 'running' ||
    state.status === 'interrupted'
  );
}

/**
 * Result of stale session detection and recovery
 */
export interface StaleSessionRecoveryResult {
  /** Whether a stale session was detected */
  wasStale: boolean;
  /** Number of active task IDs that were cleared */
  clearedTaskCount: number;
  /** Previous status before recovery */
  previousStatus?: SessionStatus;
}

/**
 * Detect and recover from a stale session.
 *
 * A session is considered stale if:
 * 1. It has status 'running' (indicating it was active)
 * 2. But the lock file is stale (process no longer running) or missing
 *
 * Recovery actions:
 * 1. Clear activeTaskIds (tasks that were being worked on)
 * 2. Set status to 'interrupted' (so it can be resumed)
 * 3. Save the recovered session
 *
 * This should be called early in both run and resume commands,
 * BEFORE any prompts or session decisions are made.
 *
 * @param cwd Working directory
 * @param checkLock Function to check lock status (passed in to avoid circular deps)
 * @returns Recovery result
 */
export async function detectAndRecoverStaleSession(
  cwd: string,
  checkLock: (cwd: string) => Promise<{ isLocked: boolean; isStale: boolean }>
): Promise<StaleSessionRecoveryResult> {
  const result: StaleSessionRecoveryResult = {
    wasStale: false,
    clearedTaskCount: 0,
  };

  // Check if session file exists
  const hasSession = await hasPersistedSession(cwd);
  if (!hasSession) {
    return result;
  }

  // Load session
  const session = await loadPersistedSession(cwd);
  if (!session) {
    return result;
  }

  // Only recover if status is 'running' - this indicates an ungraceful exit
  if (session.status !== 'running') {
    return result;
  }

  // Check if lock is stale (process no longer running)
  const lockStatus = await checkLock(cwd);

  // If lock is valid (held by running process), don't recover
  if (lockStatus.isLocked && !lockStatus.isStale) {
    return result;
  }

  // Session is stale - recover it
  result.wasStale = true;
  result.previousStatus = session.status;
  result.clearedTaskCount = session.activeTaskIds?.length ?? 0;

  // Clear active tasks and set status to interrupted
  const recoveredSession: PersistedSessionState = {
    ...session,
    status: 'interrupted',
    activeTaskIds: [],
    updatedAt: new Date().toISOString(),
  };

  // Save recovered session
  await savePersistedSession(recoveredSession);

  return result;
}

/**
 * Get session summary for display
 */
export function getSessionSummary(state: PersistedSessionState): {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  currentIteration: number;
  maxIterations: number;
  tasksCompleted: number;
  totalTasks: number;
  isPaused: boolean;
  isResumable: boolean;
  agentPlugin: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
} {
  // Defensive: handle missing trackerState (corrupted/old session files)
  const trackerState = state.trackerState ?? {
    plugin: 'unknown',
    totalTasks: 0,
    tasks: [],
  };

  return {
    sessionId: state.sessionId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    currentIteration: state.currentIteration,
    maxIterations: state.maxIterations,
    tasksCompleted: state.tasksCompleted,
    totalTasks: trackerState.totalTasks ?? 0,
    isPaused: state.isPaused,
    isResumable: isSessionResumable(state),
    agentPlugin: state.agentPlugin,
    trackerPlugin: trackerState.plugin ?? 'unknown',
    epicId: trackerState.epicId,
    prdPath: trackerState.prdPath,
  };
}

// =============================================================================
// Version 2: Parallel Mode Session Functions
// =============================================================================

/**
 * Options for creating a parallel mode session
 */
export interface CreateParallelSessionOptions {
  sessionId: string;
  agentPlugin: string;
  model?: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
  maxIterations: number;
  tasks: TrackerTask[];
  cwd: string;
  maxWorkers: number;
  fallbackChain: string[];
}

/**
 * Create a new parallel mode session (v2).
 */
export function createParallelSession(
  options: CreateParallelSessionOptions
): PersistedSessionStateV2 {
  const now = new Date().toISOString();

  // Initialize rate limit state for all agents in fallback chain
  const rateLimitState: Record<string, PersistedRateLimitState> = {};
  for (const agent of options.fallbackChain) {
    rateLimitState[agent] = {
      status: 'available',
      consecutiveLimits: 0,
    };
  }

  return {
    version: 2,
    mode: 'parallel',
    sessionId: options.sessionId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    currentIteration: 0,
    globalIteration: 0,
    maxIterations: options.maxIterations,
    tasksCompleted: 0,
    isPaused: false,
    agentPlugin: options.agentPlugin,
    model: options.model,
    trackerState: {
      plugin: options.trackerPlugin,
      epicId: options.epicId,
      prdPath: options.prdPath,
      totalTasks: options.tasks.length,
      tasks: options.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        completedInSession: false,
      })),
    },
    iterations: [],
    skippedTaskIds: [],
    cwd: options.cwd,
    activeTaskIds: [],
    subagentPanelVisible: false,
    pool: {
      workers: {},
      mergeQueue: [],
      completedTasks: [],
      conflictTasks: [],
      rateLimitState,
      maxWorkers: options.maxWorkers,
      fallbackChain: options.fallbackChain,
    },
  };
}

/**
 * Update worker state in a parallel session.
 */
export function updateWorkerState(
  state: PersistedSessionStateV2,
  workerName: string,
  workerState: PersistedWorkerState
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot update worker state on non-parallel session');
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      workers: {
        ...state.pool.workers,
        [workerName]: workerState,
      },
    },
  };
}

/**
 * Remove a worker from a parallel session.
 */
export function removeWorker(
  state: PersistedSessionStateV2,
  workerName: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot remove worker from non-parallel session');
  }

  const { [workerName]: _, ...remainingWorkers } = state.pool.workers;

  return {
    ...state,
    pool: {
      ...state.pool,
      workers: remainingWorkers,
    },
  };
}

/**
 * Add a merge request to the queue.
 */
export function addMergeRequest(
  state: PersistedSessionStateV2,
  request: PersistedMergeRequest
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot add merge request to non-parallel session');
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      mergeQueue: [...state.pool.mergeQueue, request],
    },
  };
}

/**
 * Update a merge request's status in the queue.
 */
export function updateMergeRequestStatus(
  state: PersistedSessionStateV2,
  requestId: string,
  status: MergeRequestStatus,
  error?: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot update merge request in non-parallel session');
  }

  const updatedQueue = state.pool.mergeQueue.map((req) => {
    if (req.id === requestId) {
      return {
        ...req,
        status,
        error,
        retryCount: status === 'conflict' || status === 'failed'
          ? req.retryCount + 1
          : req.retryCount,
      };
    }
    return req;
  });

  return {
    ...state,
    pool: {
      ...state.pool,
      mergeQueue: updatedQueue,
    },
  };
}

/**
 * Remove a merge request from the queue.
 */
export function removeMergeRequest(
  state: PersistedSessionStateV2,
  requestId: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot remove merge request from non-parallel session');
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      mergeQueue: state.pool.mergeQueue.filter((req) => req.id !== requestId),
    },
  };
}

/**
 * Mark a task as completed in the pool.
 */
export function markTaskCompleted(
  state: PersistedSessionStateV2,
  taskId: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot mark task completed in non-parallel session');
  }

  if (state.pool.completedTasks.includes(taskId)) {
    return state;
  }

  // Update tracker state task status
  const updatedTasks = state.trackerState.tasks.map((task) => {
    if (task.id === taskId) {
      return {
        ...task,
        status: 'completed' as TrackerTaskStatus,
        completedInSession: true,
      };
    }
    return task;
  });

  return {
    ...state,
    tasksCompleted: state.tasksCompleted + 1,
    trackerState: {
      ...state.trackerState,
      tasks: updatedTasks,
    },
    pool: {
      ...state.pool,
      completedTasks: [...state.pool.completedTasks, taskId],
    },
  };
}

/**
 * Mark a task as having a conflict.
 */
export function markTaskConflict(
  state: PersistedSessionStateV2,
  taskId: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot mark task conflict in non-parallel session');
  }

  if (state.pool.conflictTasks.includes(taskId)) {
    return state;
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      conflictTasks: [...state.pool.conflictTasks, taskId],
    },
  };
}

/**
 * Clear a task's conflict status.
 */
export function clearTaskConflict(
  state: PersistedSessionStateV2,
  taskId: string
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot clear task conflict in non-parallel session');
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      conflictTasks: state.pool.conflictTasks.filter((id) => id !== taskId),
    },
  };
}

/**
 * Update rate limit state for an agent.
 */
export function updateRateLimitState(
  state: PersistedSessionStateV2,
  agent: string,
  rateLimitState: PersistedRateLimitState
): PersistedSessionStateV2 {
  if (!state.pool) {
    throw new Error('Cannot update rate limit state in non-parallel session');
  }

  return {
    ...state,
    pool: {
      ...state.pool,
      rateLimitState: {
        ...state.pool.rateLimitState,
        [agent]: rateLimitState,
      },
    },
  };
}

/**
 * Increment the global iteration counter.
 */
export function incrementGlobalIteration(
  state: PersistedSessionStateV2
): PersistedSessionStateV2 {
  return {
    ...state,
    globalIteration: (state.globalIteration ?? 0) + 1,
  };
}

/**
 * Check if a parallel session is resumable.
 */
export function isParallelSessionResumable(
  state: PersistedSessionStateV2
): boolean {
  return isSessionResumable(state as unknown as PersistedSessionState);
}

/**
 * Get parallel session summary for display.
 */
export interface ParallelSessionSummary {
  sessionId: string;
  status: SessionStatus;
  mode: SessionMode;
  startedAt: string;
  updatedAt: string;
  globalIteration: number;
  maxIterations: number;
  tasksCompleted: number;
  totalTasks: number;
  activeWorkers: number;
  maxWorkers: number;
  pendingMerges: number;
  conflictTasks: number;
  isPaused: boolean;
  isResumable: boolean;
  agentPlugin: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
}

/**
 * Get summary of a parallel session for display.
 */
export function getParallelSessionSummary(
  state: PersistedSessionStateV2
): ParallelSessionSummary {
  const trackerState = state.trackerState ?? {
    plugin: 'unknown',
    totalTasks: 0,
    tasks: [],
  };

  const pool = state.pool ?? {
    workers: {},
    mergeQueue: [],
    completedTasks: [],
    conflictTasks: [],
    rateLimitState: {},
    maxWorkers: 1,
    fallbackChain: [],
  };

  // Count active workers (not idle, not done, not error)
  const activeWorkers = Object.values(pool.workers).filter(
    (w) => w.status === 'working' || w.status === 'rate-limited'
  ).length;

  // Count pending merges (queued or merging)
  const pendingMerges = pool.mergeQueue.filter(
    (m) => m.status === 'queued' || m.status === 'merging'
  ).length;

  return {
    sessionId: state.sessionId,
    status: state.status,
    mode: state.mode,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    globalIteration: state.globalIteration ?? 0,
    maxIterations: state.maxIterations,
    tasksCompleted: state.tasksCompleted,
    totalTasks: trackerState.totalTasks ?? 0,
    activeWorkers,
    maxWorkers: pool.maxWorkers,
    pendingMerges,
    conflictTasks: pool.conflictTasks.length,
    isPaused: state.isPaused,
    isResumable: isParallelSessionResumable(state),
    agentPlugin: state.agentPlugin,
    trackerPlugin: trackerState.plugin ?? 'unknown',
    epicId: trackerState.epicId,
    prdPath: trackerState.prdPath,
  };
}

// =============================================================================
// Crash Recovery for Parallel Sessions
// =============================================================================

/**
 * Result of parallel session crash recovery
 */
export interface ParallelSessionRecoveryResult {
  /** Whether recovery was performed */
  wasRecovered: boolean;
  /** Previous session status */
  previousStatus?: SessionStatus;
  /** Workers that were active and cleared */
  recoveredWorkers: string[];
  /** Merge requests that were in progress and reset */
  resetMerges: string[];
  /** Active task IDs that were cleared */
  clearedActiveTasks: string[];
}

/**
 * Recover a crashed parallel session.
 *
 * Actions:
 * 1. Clear all active workers (they'll need to be recreated with fresh worktrees)
 * 2. Reset any 'merging' merge requests back to 'queued'
 * 3. Clear active task IDs
 * 4. Set status to 'interrupted'
 *
 * @param state The session state to recover
 * @returns Recovered session state and recovery info
 */
export function recoverParallelSession(
  state: PersistedSessionStateV2
): { state: PersistedSessionStateV2; result: ParallelSessionRecoveryResult } {
  const result: ParallelSessionRecoveryResult = {
    wasRecovered: false,
    recoveredWorkers: [],
    resetMerges: [],
    clearedActiveTasks: [],
  };

  if (state.status !== 'running') {
    return { state, result };
  }

  if (!state.pool) {
    return { state, result };
  }

  result.wasRecovered = true;
  result.previousStatus = state.status;
  result.recoveredWorkers = Object.keys(state.pool.workers);
  result.clearedActiveTasks = [...(state.activeTaskIds ?? [])];

  // Reset any 'merging' merge requests back to 'queued'
  const updatedMergeQueue = state.pool.mergeQueue.map((req) => {
    if (req.status === 'merging') {
      result.resetMerges.push(req.id);
      return { ...req, status: 'queued' as MergeRequestStatus };
    }
    return req;
  });

  const recoveredState: PersistedSessionStateV2 = {
    ...state,
    status: 'interrupted',
    activeTaskIds: [],
    updatedAt: new Date().toISOString(),
    pool: {
      ...state.pool,
      // Clear all workers - they'll be recreated on resume
      workers: {},
      mergeQueue: updatedMergeQueue,
    },
  };

  return { state: recoveredState, result };
}

/**
 * Detect and recover from a stale parallel session.
 *
 * @param cwd Working directory
 * @param checkLock Function to check lock status
 * @returns Recovery result
 */
export async function detectAndRecoverStaleParallelSession(
  cwd: string,
  checkLock: (cwd: string) => Promise<{ isLocked: boolean; isStale: boolean }>
): Promise<ParallelSessionRecoveryResult> {
  const result: ParallelSessionRecoveryResult = {
    wasRecovered: false,
    recoveredWorkers: [],
    resetMerges: [],
    clearedActiveTasks: [],
  };

  // Check if session file exists
  const hasSession = await hasPersistedSession(cwd);
  if (!hasSession) {
    return result;
  }

  // Load session as any version
  const session = await loadAnyPersistedSession(cwd);
  if (!session) {
    return result;
  }

  // Only recover parallel sessions with this function
  if (!isParallelSession(session)) {
    return result;
  }

  // Only recover if status is 'running' (indicates crash)
  if (session.status !== 'running') {
    return result;
  }

  // Check if lock is stale
  const lockStatus = await checkLock(cwd);

  // If lock is valid, don't recover
  if (lockStatus.isLocked && !lockStatus.isStale) {
    return result;
  }

  // Session is stale - recover it
  const { state: recoveredState, result: recoveryResult } =
    recoverParallelSession(session);

  // Save recovered session
  await saveAnyPersistedSession(recoveredState);

  return recoveryResult;
}
