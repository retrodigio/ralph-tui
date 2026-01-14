/**
 * ABOUTME: Integration layer connecting WorkerPool and Refinery for end-to-end
 * parallel workflow. Wires worker completion events to merge queue and
 * merge completion events to scheduler/cleanup callbacks.
 */

import type { WorkerPool } from './worker-pool.js';
import type { Refinery } from '../refinery/refinery.js';
import type { Worker } from './worker.js';
import type { MergeRequest } from '../refinery/types.js';

/**
 * Handles the bidirectional integration between WorkerPool and Refinery.
 *
 * Connection points:
 * 1. Worker completion → Refinery.queueBranch()
 * 2. Merge completion → Scheduler.markMerged() + optional cleanup
 * 3. Merge failure/conflict → event propagation for monitoring
 *
 * Usage:
 * ```typescript
 * const pool = new WorkerPool(...);
 * const refinery = new Refinery(...);
 * const integration = new PoolRefineryIntegration(pool, refinery);
 * integration.wire();
 *
 * // Later, when shutting down:
 * integration.unwire();
 * ```
 */
export class PoolRefineryIntegration {
  private pool: WorkerPool;
  private refinery: Refinery;

  /** Cleanup functions for event listeners */
  private cleanupFns: Array<() => void> = [];

  /** Whether integration is currently wired */
  private wired = false;

  /** Map of workerName to taskId for cleanup tracking */
  private pendingMerges: Map<string, string> = new Map();

  constructor(pool: WorkerPool, refinery: Refinery) {
    this.pool = pool;
    this.refinery = refinery;
  }

  /**
   * Wire up the bidirectional event handlers between Pool and Refinery.
   *
   * This establishes the following connections:
   * - Worker completes → branch queued in Refinery
   * - Merge completes → scheduler updated, worker cleaned up
   * - Merge fails/conflicts → events propagated for monitoring
   */
  wire(): void {
    if (this.wired) {
      return;
    }

    // 1. Connect Refinery to Pool (for conflict resolution)
    this.refinery.setWorkerPool(this.pool);

    // 2. Worker completion → Queue branch for merge
    const onWorkerCompleted = (worker: Worker): void => {
      this.handleWorkerCompleted(worker);
    };
    this.pool.on('worker:completed', onWorkerCompleted);
    this.cleanupFns.push(() =>
      this.pool.off('worker:completed', onWorkerCompleted)
    );

    // 3. Merge completed → Update scheduler and cleanup
    const onMergeCompleted = (mr: MergeRequest): void => {
      this.handleMergeCompleted(mr);
    };
    this.refinery.on('merge:completed', onMergeCompleted);
    this.cleanupFns.push(() =>
      this.refinery.off('merge:completed', onMergeCompleted)
    );

    // 4. Merge failed → Cleanup tracking (but leave worktree for debugging)
    const onMergeFailed = (mr: MergeRequest): void => {
      this.handleMergeFailed(mr);
    };
    this.refinery.on('merge:failed', onMergeFailed);
    this.cleanupFns.push(() =>
      this.refinery.off('merge:failed', onMergeFailed)
    );

    this.wired = true;
  }

  /**
   * Unwire all event handlers.
   */
  unwire(): void {
    if (!this.wired) {
      return;
    }

    for (const cleanup of this.cleanupFns) {
      cleanup();
    }
    this.cleanupFns = [];
    this.pendingMerges.clear();
    this.wired = false;
  }

  /**
   * Check if integration is wired.
   */
  isWired(): boolean {
    return this.wired;
  }

  /**
   * Get pending merges (workers that have completed but not yet merged).
   */
  getPendingMerges(): Map<string, string> {
    return new Map(this.pendingMerges);
  }

  /**
   * Handle worker completion by queueing branch for merge.
   */
  private handleWorkerCompleted(worker: Worker): void {
    // Track for later cleanup
    const taskId = worker.worktree.taskId ?? 'unknown';
    this.pendingMerges.set(worker.name, taskId);

    // Queue the branch in refinery
    this.refinery.queueBranch(worker);
  }

  /**
   * Handle merge completion by updating scheduler and cleaning up worker.
   */
  private handleMergeCompleted(mr: MergeRequest): void {
    // Update scheduler to unblock dependents
    const scheduler = this.pool.getScheduler();
    scheduler.markMerged(mr.taskId);

    // Remove from tracking
    this.pendingMerges.delete(mr.workerName);

    // Emit pool-level merge:completed event
    this.pool.emit('merge:completed', mr.taskId);
  }

  /**
   * Handle merge failure - remove from tracking but don't cleanup worktree.
   * Failed merges leave worktrees for debugging.
   */
  private handleMergeFailed(mr: MergeRequest): void {
    // Remove from tracking
    this.pendingMerges.delete(mr.workerName);

    // Note: We intentionally don't cleanup the worktree on failure
    // This allows developers to inspect the state for debugging
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.unwire();
  }
}
