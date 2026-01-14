/**
 * ABOUTME: Barrel export for the merge refinery module.
 * Provides the Refinery coordinator that ties together MergeQueue, Merger,
 * and ConflictResolver for a complete merge pipeline. Also exports individual
 * components for direct use when needed.
 */

export {
  Refinery,
  DEFAULT_REFINERY_CONFIG,
  type RefineryConfig,
  type RefineryEvents,
} from './refinery.js';
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
