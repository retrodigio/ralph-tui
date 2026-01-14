/**
 * ABOUTME: WorkerPool orchestrator for managing parallel worker lifecycle.
 * Coordinates worker spawning, task dispatch, rate limit handling, and
 * merge queue processing through a central dispatch loop.
 */

import { EventEmitter } from 'events';
import { Worker } from './worker.js';
import { Scheduler, type TaskAssignment } from './scheduler.js';
import { RateLimitCoordinator } from './rate-limit-coordinator.js';
import { WorktreeManager } from '../worktree/index.js';
import { NamePool } from '../worktree/names.js';
import type { TrackerPlugin, TrackerTask } from '../plugins/trackers/types.js';
import type { AgentPlugin } from '../plugins/agents/types.js';
import type { WorkerEvent } from './types.js';

/**
 * Configuration for the WorkerPool
 */
export interface PoolConfig {
  /** Maximum number of concurrent workers ('unlimited' for no limit) */
  maxWorkers: number | 'unlimited';
  /** Base directory for worktrees (relative to repo root) */
  worktreeBaseDir: string;
  /** Ordered list of fallback agents */
  fallbackAgents: string[];
  /** If true, only dispatch tasks with all dependencies merged */
  strictDependencies: boolean;
  /** Dispatch loop interval in milliseconds */
  loopIntervalMs?: number;
  /** Model to use for agent execution */
  model?: string;
}

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_CONFIG: PoolConfig = {
  maxWorkers: 3,
  worktreeBaseDir: '.ralph-workers',
  fallbackAgents: ['claude'],
  strictDependencies: true,
  loopIntervalMs: 1000,
};

/**
 * Status of the WorkerPool
 */
export type PoolStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'all-limited';

/**
 * State of the WorkerPool
 */
export interface PoolState {
  /** Current pool status */
  status: PoolStatus;
  /** Active workers by name */
  workers: Map<string, Worker>;
  /** Number of workers waiting to be merged */
  pendingMerges: number;
  /** Total tasks completed since start */
  tasksCompleted: number;
  /** Tasks remaining in the queue */
  tasksRemaining: number;
}

/**
 * Events emitted by WorkerPool
 */
export interface WorkerPoolEvents {
  /** Worker was spawned */
  'worker:spawned': (worker: Worker) => void;
  /** Worker completed its task */
  'worker:completed': (worker: Worker, task: TrackerTask) => void;
  /** Worker hit rate limit */
  'worker:rate-limited': (worker: Worker, agent: string) => void;
  /** Worker encountered an error */
  'worker:error': (worker: Worker, error: string) => void;
  /** Task was queued for merge */
  'merge:queued': (worker: Worker) => void;
  /** Task was merged successfully */
  'merge:completed': (taskId: string) => void;
  /** All agents are rate-limited */
  'pool:all-limited': () => void;
  /** Pool recovered from all-limited state */
  'pool:recovered': () => void;
  /** Pool started */
  'pool:started': () => void;
  /** Pool stopped */
  'pool:stopped': () => void;
}

/**
 * Typed EventEmitter for WorkerPool
 */
interface TypedPoolEmitter {
  on<K extends keyof WorkerPoolEvents>(
    event: K,
    listener: WorkerPoolEvents[K]
  ): this;
  off<K extends keyof WorkerPoolEvents>(
    event: K,
    listener: WorkerPoolEvents[K]
  ): this;
  emit<K extends keyof WorkerPoolEvents>(
    event: K,
    ...args: Parameters<WorkerPoolEvents[K]>
  ): boolean;
  removeAllListeners(event?: keyof WorkerPoolEvents): this;
}

/**
 * Factory function for creating agent plugins
 */
export type AgentFactory = (agentId: string) => AgentPlugin | null;

/**
 * WorkerPool orchestrates parallel worker lifecycle:
 * - Spawns workers for ready tasks (respecting maxWorkers limit)
 * - Manages worktree creation and cleanup
 * - Coordinates rate limit fallback across all workers
 * - Queues completed tasks for merging (Refinery integration point)
 */
export class WorkerPool extends EventEmitter implements TypedPoolEmitter {
  /** Pool configuration */
  private config: PoolConfig;

  /** Active workers by name */
  private workers: Map<string, Worker> = new Map();

  /** Task scheduler */
  private scheduler: Scheduler;

  /** Rate limit coordinator */
  private rateLimits: RateLimitCoordinator;

  /** Worktree manager */
  private worktrees: WorktreeManager;

  /** Name pool for worker names */
  private namePool: NamePool;

  /** Tracker plugin */
  private tracker: TrackerPlugin;

  /** Agent factory */
  private agentFactory: AgentFactory;

  /** Current pool status */
  private _status: PoolStatus = 'idle';

  /** Running flag for dispatch loop */
  private running = false;

  /** Dispatch loop promise */
  private loopPromise: Promise<void> | null = null;

  /** Workers pending merge */
  private pendingMergeWorkers: Set<string> = new Set();

  /** Completed task count */
  private _tasksCompleted = 0;

  /** Worker event unsubscribe functions */
  private workerUnsubscribes: Map<string, () => void> = new Map();

  constructor(
    tracker: TrackerPlugin,
    agentFactory: AgentFactory,
    worktrees: WorktreeManager,
    config?: Partial<PoolConfig>
  ) {
    super();
    this.tracker = tracker;
    this.agentFactory = agentFactory;
    this.worktrees = worktrees;
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };

    // Initialize components
    this.scheduler = new Scheduler(tracker, {
      maxWorkers: this.config.maxWorkers,
      strictDependencies: this.config.strictDependencies,
    });

    this.rateLimits = new RateLimitCoordinator(this.config.fallbackAgents);
    this.namePool = new NamePool();

    // Wire up rate limit coordinator events
    this.rateLimits.on('all:limited', () => {
      this._status = 'all-limited';
      this.emit('pool:all-limited');
    });

    this.rateLimits.on('all:recovered', () => {
      if (this._status === 'all-limited') {
        this._status = 'running';
        this.emit('pool:recovered');
      }
    });
  }

  /**
   * Get the current pool state
   */
  get state(): PoolState {
    return {
      status: this._status,
      workers: new Map(this.workers),
      pendingMerges: this.pendingMergeWorkers.size,
      tasksCompleted: this._tasksCompleted,
      tasksRemaining: this.scheduler.getAssignedCount(),
    };
  }

  /**
   * Get the current pool status
   */
  get status(): PoolStatus {
    return this._status;
  }

  /**
   * Initialize the pool and start the dispatch loop.
   *
   * @param workingDir - Working directory for bv commands
   */
  async start(workingDir?: string): Promise<void> {
    if (this.running) {
      return;
    }

    // Initialize scheduler
    await this.scheduler.initialize(workingDir);

    // Reconcile existing worktrees
    const existingWorktrees = await this.worktrees.list();
    const existingNames = existingWorktrees.map((wt) => wt.name);
    this.namePool.reconcile(existingNames);

    // Start rate limit recovery probe
    this.rateLimits.startRecoveryProbe(30000);

    // Start dispatch loop
    this.running = true;
    this._status = 'running';
    this.loopPromise = this.dispatchLoop();

    this.emit('pool:started');
  }

  /**
   * Stop all workers and the dispatch loop gracefully.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this._status = 'stopping';
    this.running = false;

    // Stop all workers
    for (const worker of this.workers.values()) {
      worker.stop();
    }

    // Wait for dispatch loop to finish
    if (this.loopPromise) {
      await this.loopPromise;
      this.loopPromise = null;
    }

    // Stop rate limit probe
    this.rateLimits.stopRecoveryProbe();

    // Cleanup all worktrees
    for (const worker of this.workers.values()) {
      await this.cleanupWorker(worker);
    }

    this.workers.clear();
    this._status = 'idle';

    this.emit('pool:stopped');
  }

  /**
   * Pause all workers (they will complete current iteration but not start new ones).
   */
  pause(): void {
    if (this._status !== 'running') {
      return;
    }

    this._status = 'paused';
    for (const worker of this.workers.values()) {
      worker.pause();
    }
  }

  /**
   * Resume all paused workers.
   */
  resume(): void {
    if (this._status !== 'paused') {
      return;
    }

    this._status = 'running';
    for (const worker of this.workers.values()) {
      worker.resume();
    }
  }

  /**
   * Get the scheduler instance (for external coordination).
   */
  getScheduler(): Scheduler {
    return this.scheduler;
  }

  /**
   * Get the rate limit coordinator (for external monitoring).
   */
  getRateLimitCoordinator(): RateLimitCoordinator {
    return this.rateLimits;
  }

  /**
   * Get a worker by name.
   */
  getWorker(name: string): Worker | undefined {
    return this.workers.get(name);
  }

  /**
   * Get all active workers.
   */
  getAllWorkers(): Worker[] {
    return Array.from(this.workers.values());
  }

  /**
   * Main dispatch loop - runs every ~1s while pool is running.
   * Coordinates task assignment, worker lifecycle, and merge queue.
   */
  private async dispatchLoop(): Promise<void> {
    while (this.running) {
      try {
        // Skip iteration if all agents are rate-limited
        if (this._status === 'all-limited') {
          await this.sleep(this.config.loopIntervalMs ?? 1000);
          continue;
        }

        // Skip iteration if paused
        if (this._status === 'paused') {
          await this.sleep(this.config.loopIntervalMs ?? 1000);
          continue;
        }

        // 1. Get ready tasks from scheduler
        const readyTasks = await this.scheduler.getReadyTasks();

        // 2. Spawn workers for ready tasks (if under limit)
        for (const assignment of readyTasks) {
          if (!this.canSpawnWorker()) {
            break;
          }
          await this.spawnWorker(assignment);
        }

        // 3. Check for completed workers, queue for merge
        for (const worker of this.workers.values()) {
          if (worker.state.status === 'done') {
            await this.queueForMerge(worker);
          }
        }

        // 4. Process merge queue (placeholder - Refinery integration)
        await this.processMergeQueue();

        // 5. Cleanup merged worktrees
        await this.cleanupMergedWorkers();
      } catch (error) {
        // Log error but continue loop
        console.error('WorkerPool dispatch loop error:', error);
      }

      // 6. Sleep before next iteration
      await this.sleep(this.config.loopIntervalMs ?? 1000);
    }
  }

  /**
   * Check if we can spawn another worker.
   */
  private canSpawnWorker(): boolean {
    if (this.config.maxWorkers === 'unlimited') {
      return true;
    }
    return this.workers.size < this.config.maxWorkers;
  }

  /**
   * Spawn a new worker for a task assignment.
   */
  private async spawnWorker(assignment: TaskAssignment): Promise<Worker | null> {
    const { task } = assignment;

    // Get first available agent
    const agentId = this.rateLimits.getFirstAvailable();
    if (!agentId) {
      return null;
    }

    // Create agent instance
    const agent = this.agentFactory(agentId);
    if (!agent) {
      console.error(`Failed to create agent: ${agentId}`);
      return null;
    }

    // Acquire worker name
    const name = this.namePool.acquire();

    // Create worktree
    const worktree = await this.worktrees.create({
      name,
      taskId: task.id,
      startPoint: 'HEAD',
    });

    // Create worker
    const worker = new Worker({
      name,
      worktree,
      agent,
      tracker: this.tracker,
      model: this.config.model,
    });

    // Subscribe to worker events
    const unsubscribe = worker.on((event) => this.handleWorkerEvent(worker, event));
    this.workerUnsubscribes.set(name, unsubscribe);

    // Register worker
    this.workers.set(name, worker);

    // Mark task as assigned in scheduler
    this.scheduler.assignTask(task.id, name);

    // Assign and start task
    await worker.assignTask(task);

    this.emit('worker:spawned', worker);

    // Start worker execution in background
    this.runWorkerLoop(worker);

    return worker;
  }

  /**
   * Run the worker execution loop in the background.
   */
  private async runWorkerLoop(worker: Worker): Promise<void> {
    while (
      this.running &&
      worker.state.status === 'working' &&
      worker.state.task !== null
    ) {
      const result = await worker.executeIteration();

      // Handle rate limit
      if (result.status === 'rate_limited') {
        await this.handleWorkerRateLimited(worker);
      }

      // Handle task completion
      if (result.taskCompleted) {
        break;
      }

      // Handle failure
      if (result.status === 'failed' || result.status === 'interrupted') {
        break;
      }
    }
  }

  /**
   * Handle worker rate limit - try fallback or wait.
   */
  private async handleWorkerRateLimited(worker: Worker): Promise<void> {
    const currentAgent = worker.state.agent;

    // Mark agent as limited
    this.rateLimits.markLimited(currentAgent);

    this.emit('worker:rate-limited', worker, currentAgent);

    // Try to get a fallback agent
    const fallbackId = this.rateLimits.getAvailableFallback(currentAgent);
    if (fallbackId) {
      const fallbackAgent = this.agentFactory(fallbackId);
      if (fallbackAgent) {
        await worker.switchAgent(fallbackAgent);
        return;
      }
    }

    // No fallback available - worker stays rate-limited
  }

  /**
   * Handle worker events for coordination.
   */
  private handleWorkerEvent(worker: Worker, event: WorkerEvent): void {
    switch (event.type) {
      case 'task:completed':
        if ('task' in event) {
          this.emit('worker:completed', worker, event.task);
        }
        break;
      case 'error':
        if ('error' in event) {
          this.emit('worker:error', worker, event.error);
        }
        break;
      case 'rate-limited':
        // Handled by runWorkerLoop
        break;
    }
  }

  /**
   * Queue a completed worker for merging.
   */
  private async queueForMerge(worker: Worker): Promise<void> {
    if (this.pendingMergeWorkers.has(worker.name)) {
      return;
    }

    this.pendingMergeWorkers.add(worker.name);
    this.emit('merge:queued', worker);
  }

  /**
   * Process the merge queue.
   * Placeholder for Refinery integration - for now, just marks as merged.
   */
  private async processMergeQueue(): Promise<void> {
    for (const workerName of this.pendingMergeWorkers) {
      const worker = this.workers.get(workerName);
      if (!worker) {
        this.pendingMergeWorkers.delete(workerName);
        continue;
      }

      // Get the task ID from the worktree
      const taskId = worker.worktree.taskId;
      if (!taskId) {
        this.pendingMergeWorkers.delete(workerName);
        continue;
      }

      // Mark as merged in scheduler (unblocks dependents)
      this.scheduler.markMerged(taskId);

      this._tasksCompleted++;
      this.emit('merge:completed', taskId);
    }
  }

  /**
   * Cleanup workers that have been merged.
   */
  private async cleanupMergedWorkers(): Promise<void> {
    const toCleanup: string[] = [];

    for (const workerName of this.pendingMergeWorkers) {
      const worker = this.workers.get(workerName);
      if (!worker) {
        this.pendingMergeWorkers.delete(workerName);
        continue;
      }

      const taskId = worker.worktree.taskId;
      if (taskId && this.scheduler.isMerged(taskId)) {
        toCleanup.push(workerName);
      }
    }

    for (const workerName of toCleanup) {
      const worker = this.workers.get(workerName);
      if (worker) {
        await this.cleanupWorker(worker);
      }
      this.pendingMergeWorkers.delete(workerName);
    }
  }

  /**
   * Cleanup a single worker (remove worktree, release name).
   */
  private async cleanupWorker(worker: Worker): Promise<void> {
    // Unsubscribe from events
    const unsub = this.workerUnsubscribes.get(worker.name);
    if (unsub) {
      unsub();
      this.workerUnsubscribes.delete(worker.name);
    }

    // Remove from workers map
    this.workers.delete(worker.name);

    // Remove worktree
    try {
      await this.worktrees.remove(worker.name);
    } catch {
      // Ignore removal errors
    }

    // Release name back to pool
    this.namePool.release(worker.name);
  }

  /**
   * Sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.running = false;
    this.rateLimits.dispose();
    this.removeAllListeners();
  }

  /**
   * Get pool state for debugging.
   */
  getDebugState(): {
    status: PoolStatus;
    workerCount: number;
    workers: Array<{
      name: string;
      status: string;
      taskId: string | null;
    }>;
    pendingMerges: number;
    tasksCompleted: number;
    schedulerState: ReturnType<Scheduler['getState']>;
    rateLimitState: Map<string, unknown>;
  } {
    return {
      status: this._status,
      workerCount: this.workers.size,
      workers: Array.from(this.workers.values()).map((w) => ({
        name: w.name,
        status: w.state.status,
        taskId: w.worktree.taskId,
      })),
      pendingMerges: this.pendingMergeWorkers.size,
      tasksCompleted: this._tasksCompleted,
      schedulerState: this.scheduler.getState(),
      rateLimitState: this.rateLimits.getAllAgentStates(),
    };
  }
}
