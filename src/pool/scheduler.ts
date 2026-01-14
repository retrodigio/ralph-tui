/**
 * ABOUTME: Task scheduler with bv integration for dependency-aware task selection.
 * Uses bv's graph-aware algorithms to detect parallel execution tracks and
 * only dispatches tasks whose dependencies are already MERGED (not just completed).
 */

import { spawn } from 'node:child_process';
import type { TrackerTask, TrackerPlugin } from '../plugins/trackers/types.js';

/**
 * Configuration for the Scheduler
 */
export interface SchedulerConfig {
  /** Maximum number of concurrent workers ('unlimited' for no limit) */
  maxWorkers: number | 'unlimited';
  /** If true, only run tasks with all dependencies merged */
  strictDependencies: boolean;
}

/**
 * A task assignment with parallel track information
 */
export interface TaskAssignment {
  /** The task to be executed */
  task: TrackerTask;
  /** Parallel track number from bv analysis (tasks in same track can't run in parallel) */
  track: number;
  /** Task IDs that must be merged before this task can start */
  dependencies: string[];
}

/**
 * Parallel track from bv --robot-plan output
 */
interface BvTrack {
  track_id: number;
  issues: Array<{
    id: string;
    title: string;
    priority: number;
    depends_on?: string[];
  }>;
  parallel_with: number[];
}

/**
 * Structure of bv --robot-plan JSON output
 */
interface BvPlanOutput {
  generated_at: string;
  data_hash: string;
  plan: {
    meta: {
      version: string;
      generated_at: string;
      issue_count: number;
    };
    summary: {
      total_tracks: number;
      max_parallelism: number;
      critical_path_length: number;
      highest_impact?: {
        id: string;
        title: string;
        unblocks: number;
      };
    };
    tracks: BvTrack[];
  };
}

/**
 * Execute a bv command and return the output.
 */
async function execBv(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bv', args, {
      cwd,
      env: { ...process.env },
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
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Scheduler manages task selection and assignment using bv for dependency-aware ordering.
 * Key rule: Only dispatch tasks whose dependencies are already MERGED (not just completed).
 */
export class Scheduler {
  private tracker: TrackerPlugin;
  private config: SchedulerConfig;

  /** Set of task IDs that have been merged (their changes are in the codebase) */
  private mergedTasks: Set<string> = new Set();

  /** Map of task ID -> worker name for currently assigned tasks */
  private assignedTasks: Map<string, string> = new Map();

  /** Cached parallel tracks from bv */
  private cachedTracks: BvTrack[] = [];

  /** Working directory for bv commands */
  private workingDir: string;

  /** Whether bv is available */
  private bvAvailable = false;

  constructor(tracker: TrackerPlugin, config: SchedulerConfig) {
    this.tracker = tracker;
    this.config = config;
    this.workingDir = process.cwd();
  }

  /**
   * Initialize the scheduler and check bv availability.
   *
   * @param workingDir - Working directory for bv commands
   */
  async initialize(workingDir?: string): Promise<void> {
    if (workingDir) {
      this.workingDir = workingDir;
    }

    // Check if bv is available
    const { exitCode } = await execBv(['--version'], this.workingDir);
    this.bvAvailable = exitCode === 0;

    // Initial load of parallel tracks
    if (this.bvAvailable) {
      await this.refreshTracks();
    }
  }

  /**
   * Get tasks that are ready for execution.
   * A task is ready if:
   * 1. All its dependencies are merged (not just completed)
   * 2. It is not already assigned to a worker
   * 3. It matches the current filter (open/in_progress status)
   *
   * @returns Array of task assignments with track info
   */
  async getReadyTasks(): Promise<TaskAssignment[]> {
    // Get all open/in_progress tasks from tracker
    const tasks = await this.tracker.getTasks({
      status: ['open', 'in_progress'],
      ready: true, // Let tracker do initial dependency filtering
    });

    // Filter to only tasks not already assigned
    const unassignedTasks = tasks.filter(
      (task) => !this.assignedTasks.has(task.id)
    );

    // Apply strict dependency checking if enabled
    const readyTasks = this.config.strictDependencies
      ? await this.filterByMergedDependencies(unassignedTasks)
      : unassignedTasks;

    // Build task assignments with track info
    const assignments: TaskAssignment[] = [];
    for (const task of readyTasks) {
      const track = this.getTaskTrack(task.id);
      const dependencies = task.dependsOn ?? [];

      assignments.push({
        task,
        track,
        dependencies,
      });
    }

    // Sort by priority (lower number = higher priority)
    assignments.sort((a, b) => a.task.priority - b.task.priority);

    return assignments;
  }

  /**
   * Check if all dependencies of a task are merged.
   *
   * @param taskId - ID of the task to check
   * @returns true if all dependencies are merged
   */
  async areDependenciesMerged(taskId: string): Promise<boolean> {
    const task = await this.tracker.getTask(taskId);
    if (!task) {
      return false;
    }

    const dependencies = task.dependsOn ?? [];
    if (dependencies.length === 0) {
      return true;
    }

    return dependencies.every((depId) => this.mergedTasks.has(depId));
  }

  /**
   * Mark a task as assigned to a worker.
   * Prevents double-assignment of the same task.
   *
   * @param taskId - ID of the task being assigned
   * @param workerName - Name of the worker receiving the task
   * @throws Error if task is already assigned
   */
  assignTask(taskId: string, workerName: string): void {
    if (this.assignedTasks.has(taskId)) {
      const existingWorker = this.assignedTasks.get(taskId);
      throw new Error(
        `Task ${taskId} is already assigned to worker '${existingWorker}'`
      );
    }

    this.assignedTasks.set(taskId, workerName);
  }

  /**
   * Unassign a task from a worker (e.g., on worker failure).
   *
   * @param taskId - ID of the task to unassign
   */
  unassignTask(taskId: string): void {
    this.assignedTasks.delete(taskId);
  }

  /**
   * Mark a task as merged (its changes are in the codebase).
   * This unblocks dependent tasks.
   *
   * @param taskId - ID of the task that was merged
   */
  markMerged(taskId: string): void {
    this.mergedTasks.add(taskId);
    // Remove from assigned since it's now complete
    this.assignedTasks.delete(taskId);
  }

  /**
   * Check if a task has been merged.
   *
   * @param taskId - ID of the task to check
   * @returns true if the task is merged
   */
  isMerged(taskId: string): boolean {
    return this.mergedTasks.has(taskId);
  }

  /**
   * Check if a task is currently assigned to a worker.
   *
   * @param taskId - ID of the task to check
   * @returns true if the task is assigned
   */
  isAssigned(taskId: string): boolean {
    return this.assignedTasks.has(taskId);
  }

  /**
   * Get the worker name a task is assigned to.
   *
   * @param taskId - ID of the task
   * @returns Worker name or undefined if not assigned
   */
  getAssignedWorker(taskId: string): string | undefined {
    return this.assignedTasks.get(taskId);
  }

  /**
   * Get the number of currently assigned tasks.
   */
  getAssignedCount(): number {
    return this.assignedTasks.size;
  }

  /**
   * Get all currently assigned task IDs.
   */
  getAssignedTaskIds(): string[] {
    return Array.from(this.assignedTasks.keys());
  }

  /**
   * Check if we can assign more tasks based on maxWorkers config.
   */
  canAssignMore(): boolean {
    if (this.config.maxWorkers === 'unlimited') {
      return true;
    }
    return this.assignedTasks.size < this.config.maxWorkers;
  }

  /**
   * Get the parallel track number for a task.
   * Tasks in the same track have dependencies on each other and should not run in parallel.
   * Tasks in different tracks can run in parallel.
   *
   * @param taskId - ID of the task
   * @returns Track number (0 if not found or bv unavailable)
   */
  getTaskTrack(taskId: string): number {
    for (const track of this.cachedTracks) {
      if (track.issues.some((issue) => issue.id === taskId)) {
        return track.track_id;
      }
    }
    return 0; // Default track if not found
  }

  /**
   * Get all parallel tracks.
   *
   * @returns Array of track objects with issue lists
   */
  getTracks(): BvTrack[] {
    return [...this.cachedTracks];
  }

  /**
   * Refresh the parallel tracks cache from bv.
   */
  async refreshTracks(): Promise<void> {
    if (!this.bvAvailable) {
      return;
    }

    const tracks = await this.queryParallelTracks();
    this.cachedTracks = tracks;
  }

  /**
   * Query bv for parallel execution tracks.
   * Uses bv --robot-plan to get dependency-aware parallel tracks.
   *
   * @returns Array of parallel tracks
   */
  private async queryParallelTracks(): Promise<BvTrack[]> {
    const { stdout, exitCode, stderr } = await execBv(
      ['--robot-plan'],
      this.workingDir
    );

    if (exitCode !== 0) {
      console.error('bv --robot-plan failed:', stderr);
      return [];
    }

    try {
      const planOutput = JSON.parse(stdout) as BvPlanOutput;
      return planOutput.plan.tracks;
    } catch (err) {
      console.error('Failed to parse bv --robot-plan output:', err);
      return [];
    }
  }

  /**
   * Filter tasks to only those whose dependencies are all merged.
   *
   * @param tasks - Tasks to filter
   * @returns Tasks with all dependencies merged
   */
  private async filterByMergedDependencies(
    tasks: TrackerTask[]
  ): Promise<TrackerTask[]> {
    const ready: TrackerTask[] = [];

    for (const task of tasks) {
      const dependencies = task.dependsOn ?? [];

      // If no dependencies, task is ready
      if (dependencies.length === 0) {
        ready.push(task);
        continue;
      }

      // Check if all dependencies are merged
      const allMerged = dependencies.every((depId) =>
        this.mergedTasks.has(depId)
      );

      if (allMerged) {
        ready.push(task);
      }
    }

    return ready;
  }

  /**
   * Get scheduler state for debugging.
   */
  getState(): {
    mergedTasks: string[];
    assignedTasks: Array<{ taskId: string; workerName: string }>;
    trackCount: number;
    bvAvailable: boolean;
  } {
    return {
      mergedTasks: Array.from(this.mergedTasks),
      assignedTasks: Array.from(this.assignedTasks.entries()).map(
        ([taskId, workerName]) => ({
          taskId,
          workerName,
        })
      ),
      trackCount: this.cachedTracks.length,
      bvAvailable: this.bvAvailable,
    };
  }

  /**
   * Reset scheduler state (for testing or re-initialization).
   */
  reset(): void {
    this.mergedTasks.clear();
    this.assignedTasks.clear();
    this.cachedTracks = [];
  }
}
