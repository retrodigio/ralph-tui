/**
 * ABOUTME: WorktreeManager class for managing git worktrees.
 * Handles creation, removal, listing, and reconciliation of worker worktrees.
 */

import { join } from 'node:path';
import { mkdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import {
  createWorktree as gitCreateWorktree,
  removeWorktree as gitRemoveWorktree,
  listWorktrees as gitListWorktrees,
  deleteBranch,
  pruneWorktrees,
  getRepoRoot,
} from './git.js';
import {
  type WorktreeConfig,
  type Worktree,
  type CreateWorktreeOptions,
  DEFAULT_WORKTREE_CONFIG,
} from './types.js';

/**
 * Metadata file stored in each worktree directory
 */
interface WorktreeMetadata {
  name: string;
  taskId: string | null;
  createdAt: string;
}

const METADATA_FILE = '.ralph-worktree.json';

/**
 * Manager for git worktrees used by parallel workers
 */
export class WorktreeManager {
  private config: WorktreeConfig;
  private repoRoot: string;

  /**
   * Create a new WorktreeManager
   *
   * @param repoRoot - Root directory of the git repository
   * @param config - Configuration options (optional)
   */
  constructor(repoRoot: string, config?: Partial<WorktreeConfig>) {
    this.repoRoot = repoRoot;
    this.config = { ...DEFAULT_WORKTREE_CONFIG, ...config };
  }

  /**
   * Create a WorktreeManager by auto-detecting the repository root
   */
  static async create(
    cwd?: string,
    config?: Partial<WorktreeConfig>
  ): Promise<WorktreeManager> {
    const root = await getRepoRoot(cwd);
    if (!root) {
      throw new Error('Not in a git repository');
    }
    return new WorktreeManager(root, config);
  }

  /**
   * Get the base directory for worktrees
   */
  private getBaseDir(): string {
    return join(this.repoRoot, this.config.baseDir);
  }

  /**
   * Get the path for a specific worktree
   */
  private getWorktreePath(name: string): string {
    return join(this.getBaseDir(), name);
  }

  /**
   * Generate a branch name for a worktree
   */
  private getBranchName(name: string, taskId: string): string {
    return `${this.config.branchPrefix}/${name}/${taskId}`;
  }

  /**
   * Extract worktree name from a branch name
   */
  private getNameFromBranch(branch: string): string | null {
    const prefix = `${this.config.branchPrefix}/`;
    if (!branch.startsWith(prefix)) {
      return null;
    }
    const parts = branch.slice(prefix.length).split('/');
    return parts[0] || null;
  }

  /**
   * Read worktree metadata from the metadata file
   */
  private async readMetadata(
    worktreePath: string
  ): Promise<WorktreeMetadata | null> {
    try {
      const metadataPath = join(worktreePath, METADATA_FILE);
      const content = await readFile(metadataPath, 'utf-8');
      return JSON.parse(content) as WorktreeMetadata;
    } catch {
      return null;
    }
  }

  /**
   * Write worktree metadata to the metadata file
   */
  private async writeMetadata(
    worktreePath: string,
    metadata: WorktreeMetadata
  ): Promise<void> {
    const metadataPath = join(worktreePath, METADATA_FILE);
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Check if a path exists
   */
  private async pathExists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the base directory exists
   */
  private async ensureBaseDir(): Promise<void> {
    const baseDir = this.getBaseDir();
    if (!(await this.pathExists(baseDir))) {
      await mkdir(baseDir, { recursive: true });
    }
  }

  /**
   * Create a new worktree for a worker
   *
   * @param options - Options for creating the worktree
   * @returns The created worktree info
   * @throws Error if the worktree already exists or creation fails
   */
  async create(options: CreateWorktreeOptions): Promise<Worktree> {
    const { name, taskId, startPoint } = options;

    await this.ensureBaseDir();

    const worktreePath = this.getWorktreePath(name);
    const branch = this.getBranchName(name, taskId);

    // Check if worktree already exists
    if (await this.pathExists(worktreePath)) {
      throw new Error(`Worktree '${name}' already exists at ${worktreePath}`);
    }

    // Create the worktree
    const result = await gitCreateWorktree(
      worktreePath,
      branch,
      startPoint,
      this.repoRoot
    );

    if (!result.success) {
      throw new Error(`Failed to create worktree: ${result.error}`);
    }

    // Write metadata
    const createdAt = new Date();
    const metadata: WorktreeMetadata = {
      name,
      taskId,
      createdAt: createdAt.toISOString(),
    };
    await this.writeMetadata(worktreePath, metadata);

    return {
      name,
      path: worktreePath,
      branch,
      taskId,
      createdAt,
    };
  }

  /**
   * Remove a worktree
   *
   * @param name - Name of the worktree to remove
   * @param deleteBranchAfter - Whether to delete the associated branch (default: true)
   * @throws Error if removal fails
   */
  async remove(name: string, deleteBranchAfter = true): Promise<void> {
    const worktreePath = this.getWorktreePath(name);

    // Get the branch name before removal
    const worktrees = await gitListWorktrees(this.repoRoot);
    const worktree = worktrees.find((wt) => wt.path === worktreePath);
    const branchToDelete = worktree?.branch;

    // Remove the worktree
    const result = await gitRemoveWorktree(
      worktreePath,
      true, // force removal
      this.repoRoot
    );

    if (!result.success) {
      // Try removing the directory manually if git worktree remove fails
      try {
        await rm(worktreePath, { recursive: true, force: true });
        await pruneWorktrees(this.repoRoot);
      } catch {
        throw new Error(`Failed to remove worktree: ${result.error}`);
      }
    }

    // Delete the associated branch if requested
    if (deleteBranchAfter && branchToDelete) {
      await deleteBranch(branchToDelete, true, this.repoRoot);
    }
  }

  /**
   * List all managed worktrees
   *
   * @returns Array of worktree info
   */
  async list(): Promise<Worktree[]> {
    const gitWorktrees = await gitListWorktrees(this.repoRoot);
    const baseDir = this.getBaseDir();
    const worktrees: Worktree[] = [];

    for (const gitWt of gitWorktrees) {
      // Only include worktrees in our base directory
      if (!gitWt.path.startsWith(baseDir)) {
        continue;
      }

      const name = this.getNameFromBranch(gitWt.branch ?? '');
      if (!name) {
        continue;
      }

      // Try to read metadata for additional info
      const metadata = await this.readMetadata(gitWt.path);

      worktrees.push({
        name,
        path: gitWt.path,
        branch: gitWt.branch ?? '',
        taskId: metadata?.taskId ?? null,
        createdAt: metadata?.createdAt
          ? new Date(metadata.createdAt)
          : new Date(),
      });
    }

    return worktrees;
  }

  /**
   * Get a specific worktree by name
   *
   * @param name - Name of the worktree
   * @returns Worktree info or null if not found
   */
  async get(name: string): Promise<Worktree | null> {
    const worktrees = await this.list();
    return worktrees.find((wt) => wt.name === name) ?? null;
  }

  /**
   * Reconcile worktrees by cleaning up orphans
   *
   * This should be called on startup to clean up any worktrees
   * that were left behind from previous sessions.
   */
  async reconcile(): Promise<void> {
    // Prune git worktree info for deleted directories
    await pruneWorktrees(this.repoRoot);

    const baseDir = this.getBaseDir();
    if (!(await this.pathExists(baseDir))) {
      return;
    }

    // Get current git worktrees
    const gitWorktrees = await gitListWorktrees(this.repoRoot);
    const gitWorktreePaths = new Set(gitWorktrees.map((wt) => wt.path));

    // Check for orphan directories in our base dir that aren't git worktrees
    const { readdir } = await import('node:fs/promises');
    let entries: string[];
    try {
      entries = await readdir(baseDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(baseDir, entry);
      if (!gitWorktreePaths.has(entryPath)) {
        // This directory isn't a valid git worktree, remove it
        try {
          await rm(entryPath, { recursive: true, force: true });
        } catch {
          // Ignore removal errors
        }
      }
    }
  }

  /**
   * Update the task ID associated with a worktree
   *
   * @param name - Name of the worktree
   * @param taskId - New task ID (or null to unassign)
   */
  async updateTaskId(name: string, taskId: string | null): Promise<void> {
    const worktreePath = this.getWorktreePath(name);

    if (!(await this.pathExists(worktreePath))) {
      throw new Error(`Worktree '${name}' does not exist`);
    }

    const metadata = await this.readMetadata(worktreePath);
    if (!metadata) {
      throw new Error(`Worktree '${name}' has no metadata`);
    }

    metadata.taskId = taskId;
    await this.writeMetadata(worktreePath, metadata);
  }
}

// Re-export types, git operations, and name pool
export * from './types.js';
export * from './git.js';
export * from './names.js';
