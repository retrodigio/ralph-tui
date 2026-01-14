/**
 * ABOUTME: Barrel export for the merge refinery module.
 * Provides the MergeQueue for managing merge requests with priority ordering,
 * and Merger for executing git merge operations.
 */

export { MergeQueue } from './queue.js';
export { Merger } from './merger.js';
export type {
  MergeConfig,
  MergeRequest,
  MergeRequestInput,
  MergeRequestStatus,
  MergeResult,
  TestResult,
} from './types.js';
