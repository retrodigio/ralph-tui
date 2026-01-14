/**
 * ABOUTME: Type definitions for the merge refinery module.
 * Defines interfaces for merge requests, their status management,
 * and git merge operations configuration.
 */

/**
 * Status of a merge request in the queue
 */
export type MergeRequestStatus =
  | 'queued'
  | 'merging'
  | 'conflict'
  | 'merged'
  | 'failed';

/**
 * Represents a merge request in the queue
 */
export interface MergeRequest {
  /** Unique identifier for this merge request */
  id: string;
  /** Branch to merge (e.g., "work/worker1/gt-abc") */
  branch: string;
  /** Name of the worker that completed the task */
  workerName: string;
  /** Task ID associated with this merge */
  taskId: string;
  /** Priority level (lower = higher priority, P0 = 0, P4 = 4) */
  priority: number;
  /** Number of other tasks that depend on this one */
  unblockCount: number;
  /** When the merge request was created */
  createdAt: Date;
  /** Current status of the merge request */
  status: MergeRequestStatus;
  /** Number of retry attempts */
  retryCount: number;
  /** Error message if status is 'conflict' or 'failed' */
  error?: string;
}

/**
 * Input for creating a new merge request (fields auto-populated by queue)
 */
export type MergeRequestInput = Omit<
  MergeRequest,
  'id' | 'status' | 'retryCount'
>;

/**
 * Configuration for merge operations
 */
export interface MergeConfig {
  /** Target branch to merge into (e.g., "main") */
  targetBranch: string;
  /** Whether to run tests after merge */
  runTests: boolean;
  /** Command to run for tests */
  testCommand: string;
  /** Number of times to retry flaky tests before failing */
  retryFlakyTests: number;
  /** Whether to delete the branch after successful merge */
  deleteAfterMerge: boolean;
}

/**
 * Result of a merge operation
 */
export interface MergeResult {
  /** Whether the merge succeeded */
  success: boolean;
  /** Whether there was a conflict */
  conflict: boolean;
  /** Whether tests failed after merge */
  testsFailed: boolean;
  /** The merge commit SHA if successful */
  mergeCommit?: string;
  /** Error message if failed */
  error?: string;
  /** List of files with conflicts */
  conflictFiles?: string[];
}

/**
 * Result of running tests
 */
export interface TestResult {
  /** Whether tests passed */
  success: boolean;
  /** Test output (stdout/stderr) */
  output: string;
}
