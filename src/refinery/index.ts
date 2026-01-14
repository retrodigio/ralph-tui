/**
 * ABOUTME: Barrel export for the merge refinery module.
 * Provides the MergeQueue for managing merge requests with priority ordering,
 * Merger for executing git merge operations, and ConflictResolver for
 * handling merge conflicts with rebase or escalation strategies.
 */

export { MergeQueue } from './queue.js';
export { Merger } from './merger.js';
export {
  ConflictResolver,
  DEFAULT_CONFLICT_CONFIG,
  type ConflictStrategy,
  type ConflictResolverConfig,
  type ConflictResolverEvents,
  type ConflictResolutionResult,
} from './conflict.js';
export type {
  MergeConfig,
  MergeRequest,
  MergeRequestInput,
  MergeRequestStatus,
  MergeResult,
  TestResult,
} from './types.js';
