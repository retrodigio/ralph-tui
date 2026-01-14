/**
 * ABOUTME: Barrel export for the merge refinery module.
 * Provides the MergeQueue for managing merge requests with priority ordering.
 */

export { MergeQueue } from './queue.js';
export type {
  MergeRequest,
  MergeRequestInput,
  MergeRequestStatus,
} from './types.js';
