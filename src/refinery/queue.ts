/**
 * ABOUTME: Merge request queue with priority ordering.
 * Implements a serialized merge queue where only ONE merge processes at a time.
 * Priority is based on task priority, unblock count, and time in queue.
 */

import { randomUUID } from 'crypto';
import type {
  MergeRequest,
  MergeRequestInput,
  MergeRequestStatus,
} from './types.js';

/**
 * Weight factors for priority calculation
 */
const PRIORITY_WEIGHTS = {
  /** Weight for task priority (P0=0 to P4=4, inverted so lower = better) */
  taskPriority: 1000,
  /** Weight for unblock count (tasks depending on this) */
  unblockCount: 100,
  /** Weight for time in queue (milliseconds, for FIFO tiebreaker) */
  timeInQueue: 0.001,
};

/**
 * MergeQueue manages merge requests with priority ordering.
 * Only ONE merge processes at a time (serialized to avoid conflicts).
 */
export class MergeQueue {
  private queue: MergeRequest[] = [];

  /**
   * Add a branch to the merge queue.
   * @param input - The merge request input
   * @returns The created merge request with generated id and initial status
   */
  enqueue(input: MergeRequestInput): MergeRequest {
    const request: MergeRequest = {
      ...input,
      id: randomUUID(),
      status: 'queued',
      retryCount: 0,
    };

    this.queue.push(request);
    return request;
  }

  /**
   * Get the next merge request to process (highest priority).
   * Returns null if no queued requests are available.
   * @returns The next merge request to process, or null
   */
  dequeue(): MergeRequest | null {
    const pending = this.getPending();
    if (pending.length === 0) {
      return null;
    }

    // Sort by priority score (higher score = process first)
    const sorted = [...pending].sort((a, b) => {
      const scoreA = this.calculatePriority(a);
      const scoreB = this.calculatePriority(b);
      return scoreB - scoreA;
    });

    const next = sorted[0];
    next.status = 'merging';
    return next;
  }

  /**
   * Update the status of a merge request.
   * @param id - The merge request ID
   * @param status - The new status
   * @param error - Optional error message (for 'conflict' or 'failed' status)
   */
  updateStatus(
    id: string,
    status: MergeRequestStatus,
    error?: string
  ): void {
    const request = this.queue.find((mr) => mr.id === id);
    if (!request) {
      throw new Error(`Merge request not found: ${id}`);
    }

    request.status = status;
    if (error !== undefined) {
      request.error = error;
    }

    // Increment retry count on conflict or failed
    if (status === 'conflict' || status === 'failed') {
      request.retryCount++;
    }
  }

  /**
   * Requeue a failed or conflicted merge request.
   * Resets status to 'queued' so it can be retried.
   * @param id - The merge request ID
   */
  requeue(id: string): void {
    const request = this.queue.find((mr) => mr.id === id);
    if (!request) {
      throw new Error(`Merge request not found: ${id}`);
    }

    if (request.status !== 'conflict' && request.status !== 'failed') {
      throw new Error(
        `Cannot requeue merge request with status: ${request.status}`
      );
    }

    request.status = 'queued';
    request.error = undefined;
  }

  /**
   * Get all merge requests in the queue.
   * @returns All merge requests
   */
  getAll(): MergeRequest[] {
    return [...this.queue];
  }

  /**
   * Get all pending (queued) merge requests.
   * @returns Merge requests with status 'queued'
   */
  getPending(): MergeRequest[] {
    return this.queue.filter((mr) => mr.status === 'queued');
  }

  /**
   * Get the merge request currently being processed.
   * @returns The merge request with status 'merging', or null
   */
  getMerging(): MergeRequest | null {
    return this.queue.find((mr) => mr.status === 'merging') ?? null;
  }

  /**
   * Get all merged (completed) merge requests.
   * @returns Merge requests with status 'merged'
   */
  getMerged(): MergeRequest[] {
    return this.queue.filter((mr) => mr.status === 'merged');
  }

  /**
   * Get merge requests that encountered conflicts.
   * @returns Merge requests with status 'conflict'
   */
  getConflicts(): MergeRequest[] {
    return this.queue.filter((mr) => mr.status === 'conflict');
  }

  /**
   * Get failed merge requests.
   * @returns Merge requests with status 'failed'
   */
  getFailed(): MergeRequest[] {
    return this.queue.filter((mr) => mr.status === 'failed');
  }

  /**
   * Get a specific merge request by ID.
   * @param id - The merge request ID
   * @returns The merge request, or undefined if not found
   */
  get(id: string): MergeRequest | undefined {
    return this.queue.find((mr) => mr.id === id);
  }

  /**
   * Remove a merge request from the queue.
   * @param id - The merge request ID
   * @returns True if removed, false if not found
   */
  remove(id: string): boolean {
    const index = this.queue.findIndex((mr) => mr.id === id);
    if (index === -1) {
      return false;
    }
    this.queue.splice(index, 1);
    return true;
  }

  /**
   * Get the current queue size.
   * @returns Number of merge requests in the queue
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if there's a merge in progress.
   * @returns True if a merge is currently processing
   */
  isMerging(): boolean {
    return this.getMerging() !== null;
  }

  /**
   * Calculate priority score for a merge request.
   * Higher score = higher priority.
   *
   * Priority factors:
   * - Task priority: P0 (4 points) > P1 (3 points) > ... > P4 (0 points)
   * - Unblock count: More tasks depending = higher priority
   * - Time in queue: Older requests get slight priority (FIFO tiebreaker)
   *
   * @param mr - The merge request
   * @returns Priority score (higher = process first)
   */
  private calculatePriority(mr: MergeRequest): number {
    // Invert priority (P0=0 becomes 4, P4=4 becomes 0)
    const invertedPriority = 4 - Math.min(mr.priority, 4);

    // Time in queue in milliseconds
    const timeInQueue = Date.now() - mr.createdAt.getTime();

    // Calculate weighted score
    const score =
      invertedPriority * PRIORITY_WEIGHTS.taskPriority +
      mr.unblockCount * PRIORITY_WEIGHTS.unblockCount +
      timeInQueue * PRIORITY_WEIGHTS.timeInQueue;

    return score;
  }
}
