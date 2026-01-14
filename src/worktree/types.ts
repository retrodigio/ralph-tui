/**
 * ABOUTME: Type definitions for the worktree module.
 * Defines interfaces for worktree configuration, metadata, and git operations.
 */

/**
 * Configuration for worktree management
 */
export interface WorktreeConfig {
  /** Base directory for worktrees (relative to repo root) */
  baseDir: string;
  /** Prefix for worktree branches */
  branchPrefix: string;
}

/**
 * Default worktree configuration
 */
export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  baseDir: '.ralph-workers',
  branchPrefix: 'work',
};

/**
 * Represents a managed git worktree
 */
export interface Worktree {
  /** Name of the worktree (e.g., "worker1") */
  name: string;
  /** Absolute path to the worktree directory */
  path: string;
  /** Branch name for this worktree */
  branch: string;
  /** Task ID currently assigned to this worktree, if any */
  taskId: string | null;
  /** When this worktree was created */
  createdAt: Date;
}

/**
 * Raw git worktree info from `git worktree list`
 */
export interface GitWorktreeInfo {
  /** Absolute path to the worktree */
  path: string;
  /** HEAD commit SHA */
  head: string;
  /** Branch name (without refs/heads/ prefix), or null if detached */
  branch: string | null;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Whether the worktree is bare */
  isBare: boolean;
  /** Whether the worktree is locked */
  isLocked: boolean;
  /** Whether the worktree is prunable (orphan) */
  isPrunable: boolean;
}

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
  /** Name for the worktree */
  name: string;
  /** Task ID to associate with the worktree */
  taskId: string;
  /** Starting point (commit/branch) for the worktree, defaults to HEAD */
  startPoint?: string;
}

/**
 * Result of a git operation
 */
export interface GitOperationResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Output from the command */
  output: string;
  /** Error message if the operation failed */
  error?: string;
}
