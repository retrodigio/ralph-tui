/**
 * ABOUTME: Worker class for isolated task execution.
 * Wraps agent execution in a dedicated worktree with event-based coordination.
 */

import type { AgentExecutionHandle } from '../plugins/agents/types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import { SubagentTraceParser } from '../plugins/agents/tracing/parser.js';
import type { SubagentEvent } from '../plugins/agents/tracing/types.js';
import { ClaudeAgentPlugin } from '../plugins/agents/builtin/claude.js';
import { buildSubagentTrace } from '../logs/index.js';
import type {
  WorkerConfig,
  WorkerState,
  WorkerEvent,
  WorkerEventListener,
  IterationResult,
  IterationResultStatus,
  SubagentTraceState,
} from './types.js';
import { RateLimitDetector } from '../engine/rate-limit-detector.js';

/**
 * Pattern to detect completion signal in agent output
 */
const PROMISE_COMPLETE_PATTERN = /<promise>\s*COMPLETE\s*<\/promise>/i;

/**
 * Worker wraps agent execution for isolated task processing in a worktree.
 * Emits events for coordination with the pool manager.
 */
export class Worker {
  /** Worker name (from NamePool) */
  readonly name: string;

  /** Worktree assigned to this worker */
  readonly worktree: {
    name: string;
    path: string;
    branch: string;
    taskId: string | null;
    createdAt: Date;
  };

  /** Current worker state */
  private _state: WorkerState;

  /** Event listeners */
  private listeners: WorkerEventListener[] = [];

  /** Agent plugin instance */
  private agent: WorkerConfig['agent'];

  /** Tracker plugin instance */
  private tracker: WorkerConfig['tracker'];

  /** Model to use for execution */
  private model?: string;

  /** Current execution handle */
  private currentExecution: AgentExecutionHandle | null = null;

  /** Subagent trace parser */
  private subagentParser: SubagentTraceParser;

  /** Rate limit detector */
  private rateLimitDetector: RateLimitDetector;

  /** Should stop flag */
  private shouldStop = false;

  constructor(config: WorkerConfig) {
    this.name = config.name;
    this.worktree = config.worktree;
    this.agent = config.agent;
    this.tracker = config.tracker;
    this.model = config.model;

    this._state = {
      status: 'idle',
      task: null,
      iteration: 0,
      startedAt: null,
      agent: config.agent.meta.id,
      output: '',
      subagents: [],
      paused: false,
    };

    // Initialize subagent parser
    this.subagentParser = new SubagentTraceParser({
      onEvent: (event) => this.handleSubagentEvent(event),
      trackHierarchy: true,
    });

    // Initialize rate limit detector
    this.rateLimitDetector = new RateLimitDetector();
  }

  /**
   * Get current worker state (readonly)
   */
  get state(): Readonly<WorkerState> {
    return { ...this._state, subagents: [...this._state.subagents] };
  }

  /**
   * Subscribe to worker events
   *
   * @param listener - Event handler function
   * @returns Unsubscribe function
   */
  on(listener: WorkerEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: WorkerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Create a timestamp for events
   */
  private timestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Assign a task to this worker
   *
   * @param task - Task to assign
   * @throws Error if worker already has a task
   */
  async assignTask(task: TrackerTask): Promise<void> {
    if (this._state.task !== null) {
      throw new Error(
        `Worker '${this.name}' already has task ${this._state.task.id}`
      );
    }

    if (this._state.status !== 'idle') {
      throw new Error(
        `Worker '${this.name}' is not idle (status: ${this._state.status})`
      );
    }

    this._state.task = task;
    this._state.iteration = 0;
    this._state.startedAt = new Date();
    this._state.output = '';
    this._state.subagents = [];
    this._state.error = undefined;
    this._state.status = 'working';

    // Update tracker status
    await this.tracker.updateTaskStatus(task.id, 'in_progress');

    this.emit({
      type: 'task:started',
      timestamp: this.timestamp(),
      workerName: this.name,
      task,
    });
  }

  /**
   * Execute a single iteration of the current task
   *
   * @returns Result of the iteration
   * @throws Error if no task assigned
   */
  async executeIteration(): Promise<IterationResult> {
    if (this._state.task === null) {
      throw new Error(`Worker '${this.name}' has no assigned task`);
    }

    if (this._state.status !== 'working') {
      throw new Error(
        `Worker '${this.name}' is not working (status: ${this._state.status})`
      );
    }

    // Wait if paused
    while (this._state.paused && !this.shouldStop) {
      await this.delay(100);
    }

    if (this.shouldStop) {
      return this.createInterruptedResult();
    }

    const task = this._state.task;
    this._state.iteration++;
    const iteration = this._state.iteration;

    // Reset subagent tracking for this iteration
    this.subagentParser.reset();
    this._state.subagents = [];

    this.emit({
      type: 'iteration:started',
      timestamp: this.timestamp(),
      workerName: this.name,
      task,
      iteration,
    });

    const startedAt = Date.now();

    // Build prompt for the task
    const prompt = this.buildPrompt(task);

    // Build flags
    const flags: string[] = [];
    if (this.model) {
      flags.push('--model', this.model);
    }

    // Check if agent supports subagent tracing
    const supportsTracing = this.agent.meta.supportsSubagentTracing;
    const jsonlParser = supportsTracing
      ? ClaudeAgentPlugin.createStreamingJsonlParser()
      : null;

    let stdout = '';
    let stderr = '';

    try {
      // Execute agent
      const handle = this.agent.execute(prompt, [], {
        cwd: this.worktree.path,
        flags,
        subagentTracing: supportsTracing,
        onStdout: (data) => {
          stdout += data;
          this._state.output = stdout;

          this.emit({
            type: 'output',
            timestamp: this.timestamp(),
            workerName: this.name,
            stream: 'stdout',
            data,
          });

          // Parse JSONL for subagent events
          if (jsonlParser) {
            const results = jsonlParser.push(data);
            for (const result of results) {
              if (result.success) {
                this.subagentParser.processMessage(result.message);
              }
            }
          }
        },
        onStderr: (data) => {
          stderr += data;

          this.emit({
            type: 'output',
            timestamp: this.timestamp(),
            workerName: this.name,
            stream: 'stderr',
            data,
          });
        },
      });

      this.currentExecution = handle;
      const agentResult = await handle.promise;
      this.currentExecution = null;

      // Flush remaining JSONL data
      if (jsonlParser) {
        const remaining = jsonlParser.flush();
        for (const result of remaining) {
          if (result.success) {
            this.subagentParser.processMessage(result.message);
          }
        }
      }

      const durationMs = Date.now() - startedAt;

      // Check for rate limit
      const rateLimitResult = this.rateLimitDetector.detect({
        stderr,
        stdout,
        exitCode: agentResult.exitCode,
        agentId: this.agent.meta.id,
      });

      if (rateLimitResult.isRateLimit) {
        this._state.status = 'rate-limited';

        this.emit({
          type: 'rate-limited',
          timestamp: this.timestamp(),
          workerName: this.name,
          task,
          message: rateLimitResult.message ?? 'Rate limit detected',
          retryAfter: rateLimitResult.retryAfter,
        });

        return {
          status: 'rate_limited',
          taskCompleted: false,
          promiseComplete: false,
          durationMs,
          output: stdout,
          rateLimit: {
            message: rateLimitResult.message ?? 'Rate limit detected',
            retryAfter: rateLimitResult.retryAfter,
          },
        };
      }

      // Check for completion
      const promiseComplete = PROMISE_COMPLETE_PATTERN.test(stdout);
      const taskCompleted =
        promiseComplete || agentResult.status === 'completed';

      // Determine result status
      let status: IterationResultStatus;
      if (agentResult.interrupted) {
        status = 'interrupted';
      } else if (agentResult.status === 'failed') {
        status = 'failed';
      } else if (taskCompleted) {
        status = 'task_completed';
      } else {
        status = 'completed';
      }

      // Build subagent trace
      const events = this.subagentParser.getEvents();
      const states = this.subagentParser.getAllSubagents();
      const subagentTrace =
        events.length > 0 ? buildSubagentTrace(events, states) : undefined;

      const result: IterationResult = {
        status,
        taskCompleted,
        promiseComplete,
        durationMs,
        output: stdout,
        error: agentResult.error,
        subagentTrace,
      };

      // Handle task completion
      if (taskCompleted) {
        await this.tracker.completeTask(task.id, 'Completed by worker');
        this._state.status = 'done';
        this._state.task = null;

        this.emit({
          type: 'task:completed',
          timestamp: this.timestamp(),
          workerName: this.name,
          task,
          totalIterations: iteration,
        });
      }

      this.emit({
        type: 'iteration:completed',
        timestamp: this.timestamp(),
        workerName: this.name,
        task,
        iteration,
        result,
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this._state.status = 'error';
      this._state.error = errorMessage;

      this.emit({
        type: 'error',
        timestamp: this.timestamp(),
        workerName: this.name,
        task,
        error: errorMessage,
      });

      return {
        status: 'failed',
        taskCompleted: false,
        promiseComplete: false,
        durationMs,
        output: stdout,
        error: errorMessage,
      };
    }
  }

  /**
   * Switch to a different agent (for rate limit fallback)
   *
   * @param agentInstance - New agent plugin instance to use
   */
  async switchAgent(agentInstance: WorkerConfig['agent']): Promise<void> {
    this.agent = agentInstance;
    this._state.agent = agentInstance.meta.id;

    // Clear rate limited status
    if (this._state.status === 'rate-limited') {
      this._state.status = 'working';
    }
  }

  /**
   * Pause the worker
   */
  pause(): void {
    if (this._state.paused) {
      return;
    }

    this._state.paused = true;

    this.emit({
      type: 'paused',
      timestamp: this.timestamp(),
      workerName: this.name,
    });
  }

  /**
   * Resume the worker from paused state
   */
  resume(): void {
    if (!this._state.paused) {
      return;
    }

    this._state.paused = false;

    this.emit({
      type: 'resumed',
      timestamp: this.timestamp(),
      workerName: this.name,
    });
  }

  /**
   * Stop the worker and interrupt any current execution
   */
  stop(): void {
    this.shouldStop = true;

    if (this.currentExecution) {
      this.currentExecution.interrupt();
    }
  }

  /**
   * Check if the worker is currently paused
   */
  isPaused(): boolean {
    return this._state.paused;
  }

  /**
   * Reset the worker to idle state (after task completion or error)
   */
  reset(): void {
    this._state.status = 'idle';
    this._state.task = null;
    this._state.iteration = 0;
    this._state.startedAt = null;
    this._state.output = '';
    this._state.subagents = [];
    this._state.error = undefined;
    this._state.paused = false;
    this.shouldStop = false;
  }

  /**
   * Build prompt for a task
   */
  private buildPrompt(task: TrackerTask): string {
    const lines: string[] = [];

    lines.push(`## Task`);
    lines.push(`**ID**: ${task.id}`);
    lines.push(`**Title**: ${task.title}`);

    if (task.description) {
      lines.push('');
      lines.push('## Description');
      lines.push(task.description);
    }

    lines.push('');
    lines.push('## Instructions');
    lines.push(
      'Complete the task described above. When finished, signal completion with:'
    );
    lines.push('<promise>COMPLETE</promise>');

    return lines.join('\n');
  }

  /**
   * Handle a subagent event and update state
   */
  private handleSubagentEvent(event: SubagentEvent): void {
    const parserState = this.subagentParser.getSubagent(event.id);
    if (!parserState) {
      return;
    }

    const traceState: SubagentTraceState = {
      id: parserState.id,
      type: parserState.agentType,
      description: parserState.description,
      status: parserState.status,
      startedAt: parserState.spawnedAt,
      endedAt: parserState.endedAt,
      durationMs: parserState.durationMs,
    };

    // Update subagents array
    const existingIdx = this._state.subagents.findIndex(
      (s) => s.id === event.id
    );
    if (existingIdx >= 0) {
      this._state.subagents[existingIdx] = traceState;
    } else {
      this._state.subagents.push(traceState);
    }
  }

  /**
   * Create an interrupted result
   */
  private createInterruptedResult(): IterationResult {
    return {
      status: 'interrupted',
      taskCompleted: false,
      promiseComplete: false,
      durationMs: 0,
      output: '',
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
