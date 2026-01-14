/**
 * ABOUTME: Low-level git operations for worktree management.
 * Provides functions for creating, removing, and listing git worktrees.
 */

import { spawn } from 'node:child_process';
import type { GitWorktreeInfo, GitOperationResult } from './types.js';

/**
 * Execute a git command and return the result
 */
async function execGit(
  args: string[],
  cwd?: string
): Promise<GitOperationResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, output: stdout.trim() });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Git command failed with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: `Failed to execute git: ${err.message}`,
      });
    });
  });
}

/**
 * Parse the output of `git worktree list --porcelain`
 */
function parseWorktreeListOutput(output: string): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = [];
  const entries = output.split('\n\n').filter((entry) => entry.trim());

  for (const entry of entries) {
    const lines = entry.split('\n');
    const info: Partial<GitWorktreeInfo> = {
      isMain: false,
      isBare: false,
      isLocked: false,
      isPrunable: false,
    };

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        info.path = line.slice('worktree '.length);
      } else if (line.startsWith('HEAD ')) {
        info.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        // Remove refs/heads/ prefix
        const branch = line.slice('branch '.length);
        info.branch = branch.replace(/^refs\/heads\//, '');
      } else if (line === 'bare') {
        info.isBare = true;
        info.isMain = true;
      } else if (line === 'detached') {
        info.branch = null;
      } else if (line === 'locked') {
        info.isLocked = true;
      } else if (line.startsWith('prunable')) {
        info.isPrunable = true;
      }
    }

    // The first worktree in the list is the main one (unless it's bare)
    if (worktrees.length === 0 && !info.isBare) {
      info.isMain = true;
    }

    if (info.path && info.head !== undefined) {
      worktrees.push(info as GitWorktreeInfo);
    }
  }

  return worktrees;
}

/**
 * Create a new git worktree
 *
 * @param path - Absolute path where the worktree will be created
 * @param branch - Branch name for the worktree (will be created as new branch)
 * @param startPoint - Starting point for the new branch (default: HEAD)
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function createWorktree(
  path: string,
  branch: string,
  startPoint?: string,
  cwd?: string
): Promise<GitOperationResult> {
  // Use -b to create a new branch
  const args = ['worktree', 'add', '-b', branch, path];
  if (startPoint) {
    args.push(startPoint);
  }

  return execGit(args, cwd);
}

/**
 * Remove a git worktree
 *
 * @param path - Path to the worktree to remove
 * @param force - Force removal even if there are uncommitted changes
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function removeWorktree(
  path: string,
  force = false,
  cwd?: string
): Promise<GitOperationResult> {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(path);

  return execGit(args, cwd);
}

/**
 * List all git worktrees
 *
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function listWorktrees(cwd?: string): Promise<GitWorktreeInfo[]> {
  const result = await execGit(['worktree', 'list', '--porcelain'], cwd);

  if (!result.success) {
    return [];
  }

  return parseWorktreeListOutput(result.output);
}

/**
 * Push a branch to the remote
 *
 * @param branch - Branch name to push
 * @param remote - Remote name (default: "origin")
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function pushBranch(
  branch: string,
  remote = 'origin',
  cwd?: string
): Promise<GitOperationResult> {
  return execGit(['push', '-u', remote, branch], cwd);
}

/**
 * Delete a local branch
 *
 * @param branch - Branch name to delete
 * @param force - Force deletion even if branch is not fully merged
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function deleteBranch(
  branch: string,
  force = false,
  cwd?: string
): Promise<GitOperationResult> {
  const flag = force ? '-D' : '-d';
  return execGit(['branch', flag, branch], cwd);
}

/**
 * Prune worktree information for deleted worktrees
 *
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function pruneWorktrees(cwd?: string): Promise<GitOperationResult> {
  return execGit(['worktree', 'prune'], cwd);
}

/**
 * Get the root directory of the git repository
 *
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function getRepoRoot(cwd?: string): Promise<string | null> {
  const result = await execGit(['rev-parse', '--show-toplevel'], cwd);
  return result.success ? result.output : null;
}

/**
 * Check if a branch exists
 *
 * @param branch - Branch name to check
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function branchExists(
  branch: string,
  cwd?: string
): Promise<boolean> {
  const result = await execGit(
    ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
    cwd
  );
  return result.success;
}

/**
 * Get the current branch name
 *
 * @param cwd - Working directory for git commands (default: process.cwd())
 */
export async function getCurrentBranch(cwd?: string): Promise<string | null> {
  const result = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return result.success ? result.output : null;
}
