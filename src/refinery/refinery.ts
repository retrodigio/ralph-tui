/**
 * ABOUTME: Refinery coordinator for the merge pipeline.
 * Ties together MergeQueue, Merger, and ConflictResolver to process
 * completed worker branches through a serialized merge workflow.
 */

import { EventEmitter } from 'events';
import { MergeQueue } from './queue.js';
import { Merger } from './merger.js';
import { ConflictResolver, type ConflictStrategy } from './conflict.js';
import type {
  MergeConfig,
  MergeRequest,
  MergeRequestInput,
  MergeResult,
} from './types.js';
import type { WorkerPool } from '../pool/worker-pool.js';
import type { Worker } from '../pool/worker.js';

/**
 * Configuration for the Refinery coordinator
 */
export interface RefineryConfig {
  /** Target branch to merge into (e.g., "main") */
  targetBranch: string;
  /** Whether to run tests after merge */
  runTests: boolean;
  /** Command to run for tests */
  testCommand: string;
  /** Strategy for handling conflicts */
  onConflict: ConflictStrategy;
  /** Maximum retry attempts for failed merges */
  maxRetries: number;
  /** Repository path */
  repoPath: string;
  /** Number of times to retry flaky tests */
  retryFlakyTests?: number;
  /** Whether to delete branch after merge */
  deleteAfterMerge?: boolean;
  /** Maximum rebase attempts before escalating (for ConflictResolver) */
  maxRebaseAttempts?: number;
}

/**
 * Default Refinery configuration
 */
export const DEFAULT_REFINERY_CONFIG: RefineryConfig = {
  targetBranch: 'main',
  runTests: true,
  testCommand: 'npm test',
  onConflict: 'rebase',
  maxRetries: 2,
  repoPath: '.',
  retryFlakyTests: 1,
  deleteAfterMerge: true,
  maxRebaseAttempts: 2,
};

/**
 * Events emitted by Refinery
 */
export interface RefineryEvents {
  /** Merge started for a branch */
  'merge:started': (mr: MergeRequest) => void;
  /** Merge completed successfully */
  'merge:completed': (mr: MergeRequest, mergeCommit: string) => void;
  /** Merge encountered a conflict */
  'merge:conflict': (mr: MergeRequest, conflictFiles: string[]) => void;
  /** Merge failed */
  'merge:failed': (mr: MergeRequest, error: string) => void;
  /** Branch queued for merge */
  'branch:queued': (mr: MergeRequest) => void;
  /** Conflict resolution started */
  'conflict:resolving': (mr: MergeRequest, strategy: ConflictStrategy) => void;
  /** Conflict escalated to user */
  'conflict:escalated': (mr: MergeRequest, conflictFiles: string[]) => void;
}

/**
 * Typed EventEmitter for Refinery
 */
interface TypedRefineryEmitter {
  on<K extends keyof RefineryEvents>(
    event: K,
    listener: RefineryEvents[K]
  ): this;
  off<K extends keyof RefineryEvents>(
    event: K,
    listener: RefineryEvents[K]
  ): this;
  emit<K extends keyof RefineryEvents>(
    event: K,
    ...args: Parameters<RefineryEvents[K]>
  ): boolean;
  removeAllListeners(event?: keyof RefineryEvents): this;
}

/**
 * Refinery coordinates the merge pipeline for completed worker branches.
 * Only ONE merge processes at a time to avoid git conflicts.
 *
 * Workflow:
 * 1. Worker completes task -> queueBranch()
 * 2. Refinery dequeues highest priority MR
 * 3. Merger pulls target, merges branch, runs tests, pushes
 * 4. On conflict: ConflictResolver attempts rebase or escalates
 * 5. On failure: retry up to maxRetries, then fail
 */
export class Refinery extends EventEmitter implements TypedRefineryEmitter {
  private queue: MergeQueue;
  private merger: Merger;
  private conflictResolver: ConflictResolver;
  private config: RefineryConfig;

  /** Whether a merge is currently processing */
  private processing = false;

  /** Optional WorkerPool for conflict resolution */
  private pool?: WorkerPool;

  /** Whether the refinery is stopped */
  private stopped = false;

  constructor(config: Partial<RefineryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_REFINERY_CONFIG, ...config };

    // Initialize queue
    this.queue = new MergeQueue();

    // Initialize merger with merge config
    const mergeConfig: MergeConfig = {
      targetBranch: this.config.targetBranch,
      runTests: this.config.runTests,
      testCommand: this.config.testCommand,
      retryFlakyTests: this.config.retryFlakyTests ?? 1,
      deleteAfterMerge: this.config.deleteAfterMerge ?? true,
    };
    this.merger = new Merger(this.config.repoPath, mergeConfig);

    // Initialize conflict resolver
    this.conflictResolver = new ConflictResolver({
      maxRebaseAttempts: this.config.maxRebaseAttempts ?? 2,
      defaultStrategy: this.config.onConflict,
      targetBranch: this.config.targetBranch,
    });

    // Wire up conflict resolver events
    this.setupConflictResolverEvents();
  }

  /**
   * Set the WorkerPool for conflict resolution (required for rebase strategy)
   *
   * @param pool - WorkerPool instance
   */
  setWorkerPool(pool: WorkerPool): void {
    this.pool = pool;
  }

  /**
   * Queue a completed worker's branch for merge.
   *
   * @param worker - Worker that completed a task
   * @returns The created merge request
   * @throws Error if worker has no completed task
   */
  queueBranch(worker: Worker): MergeRequest {
    const state = worker.state;

    // Extract task info - worker may have just completed so task could be null
    // but we need the worktree branch which always exists
    const branch = worker.worktree.branch;
    const taskId = worker.worktree.taskId ?? 'unknown';

    // Get priority and unblock count from task if available, otherwise default
    const priority = state.task?.priority ?? 2;

    // Calculate unblock count (would come from bv in real implementation)
    const unblockCount = 0;

    const input: MergeRequestInput = {
      branch,
      workerName: worker.name,
      taskId,
      priority,
      unblockCount,
      createdAt: new Date(),
    };

    const mr = this.queue.enqueue(input);
    this.emit('branch:queued', mr);

    // Trigger processing (non-blocking)
    void this.processNext();

    return mr;
  }

  /**
   * Queue a branch directly without a worker reference.
   * Useful for testing or manual merge requests.
   *
   * @param input - Merge request input
   * @returns The created merge request
   */
  queueDirect(input: MergeRequestInput): MergeRequest {
    const mr = this.queue.enqueue(input);
    this.emit('branch:queued', mr);

    // Trigger processing (non-blocking)
    void this.processNext();

    return mr;
  }

  /**
   * Process the next item in the queue.
   * Only ONE merge processes at a time (serialized).
   */
  async processNext(): Promise<void> {
    // Guard: only one merge at a time
    if (this.processing) {
      return;
    }

    // Guard: check if stopped
    if (this.stopped) {
      return;
    }

    // Dequeue next MR (highest priority)
    const mr = this.queue.dequeue();
    if (!mr) {
      return;
    }

    this.processing = true;
    this.emit('merge:started', mr);

    try {
      // Execute merge
      const result = await this.merger.merge(mr.branch, mr.taskId);

      if (result.success) {
        // Success!
        this.queue.updateStatus(mr.id, 'merged');
        this.conflictResolver.resetAttempts(mr.branch);
        this.emit('merge:completed', mr, result.mergeCommit!);
      } else if (result.conflict && result.conflictFiles) {
        // Conflict detected
        await this.handleConflict(mr, result.conflictFiles);
      } else {
        // Other failure
        await this.handleFailure(mr, result);
      }
    } catch (error) {
      // Unexpected error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.queue.updateStatus(mr.id, 'failed', errorMessage);
      this.emit('merge:failed', mr, errorMessage);
    } finally {
      this.processing = false;
    }

    // Process next item if queue is not empty
    if (!this.stopped && this.queue.getPending().length > 0) {
      void this.processNext();
    }
  }

  /**
   * Handle a merge conflict.
   *
   * @param mr - The merge request with conflict
   * @param conflictFiles - List of files with conflicts
   */
  private async handleConflict(
    mr: MergeRequest,
    conflictFiles: string[]
  ): Promise<void> {
    this.queue.updateStatus(mr.id, 'conflict');
    this.emit('merge:conflict', mr, conflictFiles);
    this.emit('conflict:resolving', mr, this.config.onConflict);

    // Attempt resolution
    const result = await this.conflictResolver.resolve(
      mr,
      conflictFiles,
      this.queue,
      this.pool,
      this.config.onConflict
    );

    if (result.escalated) {
      this.emit('conflict:escalated', mr, conflictFiles);
    }

    // If requeued, processing will continue when processNext is called again
  }

  /**
   * Handle a merge failure (non-conflict).
   *
   * @param mr - The merge request that failed
   * @param result - The merge result with error details
   */
  private async handleFailure(
    mr: MergeRequest,
    result: MergeResult
  ): Promise<void> {
    const errorMessage = result.error ?? 'Unknown merge failure';

    // Check if we should retry
    if (mr.retryCount < this.config.maxRetries) {
      // Requeue for retry
      this.queue.updateStatus(mr.id, 'failed', errorMessage);
      this.queue.requeue(mr.id);
    } else {
      // Max retries exceeded
      this.queue.updateStatus(
        mr.id,
        'failed',
        `${errorMessage} (after ${this.config.maxRetries} retries)`
      );
      this.emit('merge:failed', mr, errorMessage);
    }
  }

  /**
   * Set up event forwarding from ConflictResolver.
   */
  private setupConflictResolverEvents(): void {
    this.conflictResolver.on('conflict:escalated', (branch, files) => {
      // Find the MR for this branch
      const mr = this.queue.getAll().find((m) => m.branch === branch);
      if (mr) {
        this.emit('conflict:escalated', mr, files);
      }
    });
  }

  /**
   * Get the underlying merge queue.
   */
  getQueue(): MergeQueue {
    return this.queue;
  }

  /**
   * Get the underlying merger.
   */
  getMerger(): Merger {
    return this.merger;
  }

  /**
   * Get the underlying conflict resolver.
   */
  getConflictResolver(): ConflictResolver {
    return this.conflictResolver;
  }

  /**
   * Check if a merge is currently processing.
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get all pending merge requests.
   */
  getPending(): MergeRequest[] {
    return this.queue.getPending();
  }

  /**
   * Get all merged (completed) merge requests.
   */
  getMerged(): MergeRequest[] {
    return this.queue.getMerged();
  }

  /**
   * Get all failed merge requests.
   */
  getFailed(): MergeRequest[] {
    return this.queue.getFailed();
  }

  /**
   * Get merge requests that encountered conflicts.
   */
  getConflicts(): MergeRequest[] {
    return this.queue.getConflicts();
  }

  /**
   * Stop the refinery and prevent further processing.
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Start the refinery (after being stopped).
   */
  start(): void {
    this.stopped = false;

    // Resume processing if there are pending items
    if (this.queue.getPending().length > 0) {
      void this.processNext();
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.stop();
    this.conflictResolver.dispose();
    this.removeAllListeners();
  }
}
