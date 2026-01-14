/**
 * ABOUTME: Git merge operations with test verification.
 * Implements the git workflow: pull target, merge branch, run tests, push, cleanup.
 */

import { spawn } from 'child_process';
import type { MergeConfig, MergeResult, TestResult } from './types.js';

/**
 * Merger handles git merge operations with test verification.
 * Follows the workflow: pull target -> merge -> test -> push -> cleanup.
 */
export class Merger {
  private repoPath: string;
  private config: MergeConfig;

  constructor(repoPath: string, config: MergeConfig) {
    this.repoPath = repoPath;
    this.config = config;
  }

  /**
   * Attempt to merge a branch into the target branch.
   * @param branch - The branch to merge (e.g., "work/worker1/gt-abc")
   * @param taskId - The task ID for commit message context
   * @returns The merge result
   */
  async merge(branch: string, taskId: string): Promise<MergeResult> {
    // Step 1: Pull latest target branch
    try {
      await this.pullTarget();
    } catch (err) {
      return {
        success: false,
        conflict: false,
        testsFailed: false,
        error: `Failed to pull ${this.config.targetBranch}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 2: Check for conflicts first
    const conflictFiles = await this.checkConflicts(branch);
    if (conflictFiles.length > 0) {
      return {
        success: false,
        conflict: true,
        testsFailed: false,
        conflictFiles,
        error: `Merge conflict in ${conflictFiles.length} file(s)`,
      };
    }

    // Step 3: Perform the actual merge
    try {
      await this.execGit([
        'merge',
        '--no-ff',
        branch,
        '-m',
        `Merge ${branch} (${taskId})`,
      ]);
    } catch (err) {
      // Abort any partial merge
      await this.execGit(['merge', '--abort']).catch(() => {
        // Ignore abort errors
      });
      return {
        success: false,
        conflict: false,
        testsFailed: false,
        error: `Merge failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 4: Run tests if configured
    if (this.config.runTests) {
      let testsPassed = false;
      let lastTestOutput = '';

      for (let attempt = 0; attempt <= this.config.retryFlakyTests; attempt++) {
        const testResult = await this.runTests();
        lastTestOutput = testResult.output;

        if (testResult.success) {
          testsPassed = true;
          break;
        }
      }

      if (!testsPassed) {
        // Reset to before the merge
        await this.execGit(['reset', '--hard', `origin/${this.config.targetBranch}`]);
        return {
          success: false,
          conflict: false,
          testsFailed: true,
          error: `Tests failed after ${this.config.retryFlakyTests + 1} attempt(s): ${lastTestOutput.slice(-500)}`,
        };
      }
    }

    // Step 5: Push the merge
    try {
      await this.execGit(['push', 'origin', this.config.targetBranch]);
    } catch (err) {
      // Reset to before the merge
      await this.execGit(['reset', '--hard', `origin/${this.config.targetBranch}`]);
      return {
        success: false,
        conflict: false,
        testsFailed: false,
        error: `Push failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Step 6: Get the merge commit SHA
    const mergeCommit = await this.execGit(['rev-parse', 'HEAD']);

    // Step 7: Delete merged branch if configured
    if (this.config.deleteAfterMerge) {
      await this.deleteBranch(branch).catch(() => {
        // Ignore branch deletion errors - merge was still successful
      });
    }

    return {
      success: true,
      conflict: false,
      testsFailed: false,
      mergeCommit: mergeCommit.trim(),
    };
  }

  /**
   * Check for conflicts without actually merging.
   * Uses git merge-tree to detect conflicts.
   * @param branch - The branch to check
   * @returns List of files that would conflict
   */
  async checkConflicts(branch: string): Promise<string[]> {
    try {
      // Get the merge base
      const mergeBase = await this.execGit([
        'merge-base',
        this.config.targetBranch,
        branch,
      ]);

      // Use merge-tree to check for conflicts
      const mergeTreeOutput = await this.execGit([
        'merge-tree',
        mergeBase.trim(),
        this.config.targetBranch,
        branch,
      ]);

      // Parse conflict markers from merge-tree output
      const conflictFiles: string[] = [];
      const lines = mergeTreeOutput.split('\n');
      let inConflict = false;

      for (const line of lines) {
        if (line.includes('<<<<<<<') || line.includes('changed in both')) {
          inConflict = true;
        }
        // Look for file paths in the merge-tree output
        const modeMatch = line.match(/^\d+ [a-f0-9]+ \d\t(.+)$/);
        if (modeMatch && inConflict) {
          const filePath = modeMatch[1];
          if (!conflictFiles.includes(filePath)) {
            conflictFiles.push(filePath);
          }
        }
        if (line === '') {
          inConflict = false;
        }
      }

      return conflictFiles;
    } catch {
      // If merge-tree fails, try a dry-run merge
      try {
        await this.execGit(['merge', '--no-commit', '--no-ff', branch]);
        await this.execGit(['merge', '--abort']);
        return [];
      } catch (mergeErr) {
        // Extract conflict files from error message
        const errorMsg =
          mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        const conflictMatch = errorMsg.match(/CONFLICT \([^)]+\): (.+)/g);
        if (conflictMatch) {
          return conflictMatch.map((m) => {
            const fileMatch = m.match(/CONFLICT \([^)]+\): (?:Merge conflict in )?(.+)/);
            return fileMatch ? fileMatch[1] : m;
          });
        }
        await this.execGit(['merge', '--abort']).catch(() => {});
        return [];
      }
    }
  }

  /**
   * Run tests in the repository.
   * @returns Test result with success status and output
   */
  async runTests(): Promise<TestResult> {
    return new Promise((resolve) => {
      const [command, ...args] = this.config.testCommand.split(' ');
      const child = spawn(command, args, {
        cwd: this.repoPath,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';

      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        output += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          output,
        });
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          output: `Failed to run tests: ${err.message}`,
        });
      });
    });
  }

  /**
   * Pull the latest target branch from origin.
   */
  async pullTarget(): Promise<void> {
    await this.execGit(['fetch', 'origin', this.config.targetBranch]);
    await this.execGit(['checkout', this.config.targetBranch]);
    await this.execGit(['reset', '--hard', `origin/${this.config.targetBranch}`]);
  }

  /**
   * Delete a branch both locally and from the remote.
   * @param branch - The branch to delete
   */
  async deleteBranch(branch: string): Promise<void> {
    // Delete local branch
    await this.execGit(['branch', '-D', branch]).catch(() => {
      // Ignore if local branch doesn't exist
    });

    // Delete remote branch
    await this.execGit(['push', 'origin', '--delete', branch]).catch(() => {
      // Ignore if remote branch doesn't exist
    });
  }

  /**
   * Execute a git command in the repository.
   * @param args - Arguments to pass to git
   * @returns The stdout output
   */
  private execGit(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `git ${args[0]} failed with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}
