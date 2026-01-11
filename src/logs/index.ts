/**
 * ABOUTME: Iteration logs module exports.
 * Provides persistence and management for iteration output logs.
 */

export type {
  IterationLog,
  IterationLogMetadata,
  IterationLogSummary,
  LogFilterOptions,
  LogCleanupOptions,
  LogCleanupResult,
} from './types.js';

export { ITERATIONS_DIR } from './types.js';

export {
  generateLogFilename,
  getIterationsDir,
  ensureIterationsDir,
  buildMetadata,
  saveIterationLog,
  loadIterationLog,
  listIterationLogs,
  getIterationLogByNumber,
  getIterationLogsByTask,
  cleanupIterationLogs,
  getIterationLogCount,
  hasIterationLogs,
  getIterationLogsDiskUsage,
} from './persistence.js';
