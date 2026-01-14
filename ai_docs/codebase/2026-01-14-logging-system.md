---
date: 2026-01-14T00:00:00-06:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Logging System"
tags: [logging, persistence, structured-logger, progress-tracking, subagent-tracing, headless-mode, CI]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Logging System

## Overview

The Ralph TUI logging system provides comprehensive logging capabilities across four key areas: iteration log persistence, structured logging for headless/CI mode, cross-iteration progress tracking, and subagent trace building. The system is designed to support both interactive TUI sessions and automated CI/CD pipelines while maintaining a complete audit trail of agent execution.

## Architecture

The logging system is organized in the `src/logs/` directory with five main files:

| File | Purpose |
|------|---------|
| `types.ts` | Type definitions for iteration logs, subagent traces, and cleanup options |
| `persistence.ts` | Core functions for saving, loading, listing, and cleaning iteration logs |
| `structured-logger.ts` | Machine-parseable logger for headless/CI mode |
| `progress.ts` | Cross-iteration progress file management |
| `index.ts` | Module exports and public API |

### Storage Location

All iteration logs are stored in `.ralph-tui/iterations/` relative to the working directory. This is defined by the constant `ITERATIONS_DIR` in `src/logs/types.ts:31`.

## Components

### Iteration Log Persistence

**Location**: `src/logs/persistence.ts`

The iteration log persistence system saves complete execution records for each iteration, including metadata, agent output, and subagent traces.

#### Log File Format

Each iteration log file follows this structure:

```
# Iteration {N} Log

## Metadata

- **Task ID**: {taskId}
- **Task Title**: {taskTitle}
- **Status**: {status}
- **Task Completed**: Yes/No
- **Promise Detected**: Yes/No
- **Started At**: {ISO timestamp}
- **Ended At**: {ISO timestamp}
- **Duration**: {human-readable}
- **Agent**: {agentPlugin}
- **Model**: {model}

## Agent Switches (if any)
- **Switched to fallback**: {from} -> {to} at {timestamp}

--- RAW OUTPUT ---
{stdout}

--- STDERR ---
{stderr}

--- SUBAGENT TRACE ---
{JSON subagent trace data}
```

#### Key Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `generateLogFilename` | `(iteration: number, taskId: string): string` | Creates filename: `iteration-{NNN}-{sanitized-taskId}.log` |
| `getIterationsDir` | `(cwd: string, customDir?: string): string` | Returns full path to iterations directory |
| `ensureIterationsDir` | `(cwd: string, customDir?: string): Promise<void>` | Creates iterations directory if needed |
| `buildMetadata` | `(result: IterationResult, options?: BuildMetadataOptions): IterationLogMetadata` | Constructs metadata from iteration result |
| `saveIterationLog` | `(cwd: string, result: IterationResult, stdout: string, stderr: string, options?: SaveIterationLogOptions): Promise<string>` | Persists complete iteration log |
| `loadIterationLog` | `(filePath: string): Promise<IterationLog \| null>` | Loads and parses a saved log file |
| `listIterationLogs` | `(cwd: string, options?: LogFilterOptions, customDir?: string): Promise<IterationLogSummary[]>` | Lists logs with optional filtering |
| `getIterationLogByNumber` | `(cwd: string, iteration: number): Promise<IterationLog \| null>` | Retrieves specific iteration by number |
| `getIterationLogsByTask` | `(cwd: string, taskId: string, customDir?: string): Promise<IterationLog[]>` | Gets all iterations for a task |

#### IterationLogMetadata Interface

**Location**: `src/logs/types.ts:37-85`

```typescript
interface IterationLogMetadata {
  iteration: number;           // 1-based iteration number
  taskId: string;              // Task identifier
  taskTitle: string;           // Task title
  taskDescription?: string;    // Optional description
  status: IterationStatus;     // completed/failed/interrupted/skipped/running
  taskCompleted: boolean;      // Whether task was marked complete
  promiseComplete: boolean;    // Whether <promise>COMPLETE</promise> was detected
  startedAt: string;           // ISO 8601 start timestamp
  endedAt: string;             // ISO 8601 end timestamp
  durationMs: number;          // Duration in milliseconds
  error?: string;              // Error message if failed
  agentPlugin?: string;        // Agent plugin used
  model?: string;              // Model used
  epicId?: string;             // Epic ID for beads trackers
  agentSwitches?: AgentSwitchEntry[];  // Agent fallback records
  completionSummary?: string;  // Summary of completion
}
```

#### SaveIterationLogOptions Interface

**Location**: `src/logs/persistence.ts:279-291`

```typescript
interface SaveIterationLogOptions {
  config?: Partial<RalphConfig>;      // Ralph configuration
  subagentTrace?: SubagentTrace;      // Subagent trace data
  agentSwitches?: AgentSwitchEntry[]; // Agent switch records
  completionSummary?: string;         // Completion summary
}
```

### Structured Logger for Headless/CI Mode

**Location**: `src/logs/structured-logger.ts`

The structured logger provides consistent, machine-parseable output for non-interactive execution. Output follows the format: `[timestamp] [level] [component] message`.

#### Log Levels

```typescript
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
```

Level priority for filtering: DEBUG (0) < INFO (1) < WARN (2) < ERROR (3)

#### Log Components

```typescript
type LogComponent =
  | 'progress'   // Iteration progress updates
  | 'agent'      // Agent output (stdout/stderr)
  | 'engine'     // Engine lifecycle events
  | 'tracker'    // Tracker operations
  | 'session'    // Session management
  | 'system';    // System-level messages
```

#### StructuredLogger Class

**Location**: `src/logs/structured-logger.ts:72-296`

**Configuration**:
```typescript
interface StructuredLoggerConfig {
  minLevel?: LogLevel;               // Default: 'INFO'
  showTimestamp?: boolean;           // Default: true
  isoTimestamp?: boolean;            // Default: false (uses HH:mm:ss)
  stream?: NodeJS.WritableStream;    // Default: process.stdout
  errorStream?: NodeJS.WritableStream; // Default: process.stderr
}
```

**Key Methods**:

| Method | Description |
|--------|-------------|
| `log(level, component, message)` | Generic log method |
| `info(component, message)` | Log INFO message |
| `warn(component, message)` | Log WARN message (to stderr) |
| `error(component, message)` | Log ERROR message (to stderr) |
| `debug(component, message)` | Log DEBUG message |
| `agentOutput(data)` | Log agent stdout line-by-line |
| `agentError(data)` | Log agent stderr as warnings |
| `progress(iteration, max, taskId, title)` | Log iteration progress |
| `iterationComplete(iteration, taskId, completed, durationMs)` | Log iteration completion |
| `iterationFailed(iteration, taskId, error, action)` | Log iteration failure |
| `iterationRetrying(iteration, taskId, attempt, maxRetries, delayMs)` | Log retry attempts |
| `engineStarted(totalTasks)` | Log engine startup |
| `engineStopped(reason, iterations, tasksCompleted)` | Log engine shutdown |
| `sessionCreated(sessionId, agent, tracker)` | Log session creation |
| `taskCompleted(taskId, iteration)` | Log task completion |

**Example Output**:
```
[14:30:45] [INFO] [progress] Iteration 1/10: Working on US-001 - Implement login
[14:31:12] [INFO] [progress] Iteration 1 finished. Task US-001: COMPLETED. Duration: 27s
[14:31:12] [INFO] [engine] Ralph stopped. Reason: all_complete. Iterations: 1, Tasks completed: 1
```

**Usage in Code**:

The structured logger is instantiated in `src/commands/run.tsx:966`:
```typescript
const logger = createStructuredLogger();
```

### Progress Tracking Across Iterations

**Location**: `src/logs/progress.ts`

The progress system maintains a markdown file (`.ralph-tui/progress.md`) that accumulates notes from each iteration, providing context for subsequent agent runs.

#### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `PROGRESS_FILE` | `.ralph-tui/progress.md` | Default progress file path |
| `MAX_PROGRESS_SIZE` | 50,000 bytes | Maximum file size before truncation |

#### ProgressEntry Interface

**Location**: `src/logs/progress.ts:31-41`

```typescript
interface ProgressEntry {
  iteration: number;
  taskId: string;
  taskTitle: string;
  completed: boolean;
  timestamp: string;
  durationMs: number;
  notes?: string;        // Extracted completion notes
  insights?: string[];   // Extracted insight blocks
  error?: string;
}
```

#### Key Functions

| Function | Description |
|----------|-------------|
| `createProgressEntry(result: IterationResult): ProgressEntry` | Creates entry from iteration result |
| `appendProgress(cwd: string, entry: ProgressEntry): Promise<void>` | Appends entry to progress file |
| `readProgress(cwd: string): Promise<string>` | Reads full progress file content |
| `getRecentProgressSummary(cwd: string, maxEntries?: number): Promise<string>` | Gets last N entries for prompts |
| `clearProgress(cwd: string): Promise<void>` | Resets progress file |

#### Content Extraction

The progress system extracts notable content from agent output:

1. **Insights**: Pattern `★ Insight` blocks commonly used in educational output
2. **Completion Notes**: Text immediately before `<promise>COMPLETE</promise>` markers

#### Progress File Format

```markdown
# Ralph Progress Log

This file tracks progress across iterations. It's automatically updated
after each iteration and included in agent prompts for context.

---

## [checkmark] Iteration 1 - US-001: Implement login
*2026-01-14T10:30:00.000Z (45s)*

**Status:** Completed

**Notes:**
Implemented JWT-based authentication with refresh tokens.

**Insights:**
- Used bcrypt for password hashing with cost factor 12

---
```

#### Integration with Templates

The `{{recentProgress}}` template variable is populated by calling `getRecentProgressSummary()` with the last 5 iterations. This is done in `src/engine/index.ts:66`:

```typescript
const recentProgress = await getRecentProgressSummary(config.cwd, 5);
const result = renderPrompt(task, config, undefined, recentProgress);
```

#### Automatic Truncation

When the progress file exceeds 50KB, older entries are truncated while preserving the header and most recent ~40KB of entries. Truncation finds a clean entry boundary to avoid partial entries.

### Log Cleanup Utilities

**Location**: `src/logs/persistence.ts:529-560` and `src/commands/logs.ts`

#### Cleanup Functions

| Function | Description |
|----------|-------------|
| `cleanupIterationLogs(cwd, options)` | Removes old logs, keeping N most recent |
| `getIterationLogCount(cwd)` | Returns total number of log files |
| `hasIterationLogs(cwd)` | Checks if any logs exist |
| `getIterationLogsDiskUsage(cwd)` | Calculates total disk usage in bytes |

#### LogCleanupOptions Interface

**Location**: `src/logs/types.ts:206-212`

```typescript
interface LogCleanupOptions {
  keep: number;      // Number of most recent logs to keep
  dryRun?: boolean;  // Preview without deleting
}
```

#### LogCleanupResult Interface

**Location**: `src/logs/types.ts:217-229`

```typescript
interface LogCleanupResult {
  deletedCount: number;      // Number of logs deleted
  deletedFiles: string[];    // Paths of deleted files
  keptCount: number;         // Number of logs retained
  dryRun: boolean;           // Whether this was a preview
}
```

#### CLI Usage

The `ralph-tui logs` command provides cleanup functionality:

```bash
ralph-tui logs --clean --keep 10      # Delete all but 10 most recent
ralph-tui logs --clean --dry-run      # Preview cleanup
ralph-tui logs --iteration 5          # View specific iteration
ralph-tui logs --task US-005          # View all iterations for task
```

### Subagent Trace Building

**Location**: `src/logs/persistence.ts:610-707` and `src/logs/types.ts:87-152`

The subagent trace system captures the full lifecycle of Claude Code subagent invocations, building hierarchical trees and computing aggregate statistics.

#### SubagentTrace Interface

**Location**: `src/logs/types.ts:123-132`

```typescript
interface SubagentTrace {
  events: SubagentEvent[];              // Chronological event timeline
  hierarchy: SubagentHierarchyNode[];   // Hierarchical tree structure
  stats: SubagentTraceStats;            // Aggregate statistics
}
```

#### SubagentHierarchyNode Interface

**Location**: `src/logs/types.ts:91-97`

```typescript
interface SubagentHierarchyNode {
  state: SubagentState;                // Subagent state at persistence
  children: SubagentHierarchyNode[];   // Nested child subagents
}
```

#### SubagentTraceStats Interface

**Location**: `src/logs/types.ts:102-117`

```typescript
interface SubagentTraceStats {
  totalSubagents: number;              // Total spawned
  byType: Record<string, number>;      // Count by agent type
  totalDurationMs: number;             // Combined duration
  failureCount: number;                // Error count
  maxDepth: number;                    // Maximum nesting depth
}
```

#### buildSubagentTrace Function

**Location**: `src/logs/persistence.ts:610-625`

```typescript
function buildSubagentTrace(
  events: SubagentEvent[],
  states: SubagentState[]
): SubagentTrace
```

This function:
1. Builds a hierarchy tree from flat subagent states
2. Computes aggregate statistics
3. Returns complete trace ready for persistence

#### Integration with Engine

The engine calls `buildSubagentTrace` when saving iteration logs in `src/engine/index.ts:900-913`:

```typescript
const events = this.subagentParser.getEvents();
const states = this.subagentParser.getAllSubagents();
const subagentTrace = events.length > 0
  ? buildSubagentTrace(events, states)
  : undefined;

await saveIterationLog(this.config.cwd, result, agentResult.stdout, stderr, {
  config: this.config,
  subagentTrace,
  agentSwitches: [...],
  completionSummary,
});
```

## Data Flow

### Iteration Log Creation Flow

```
1. Engine completes iteration
   |
2. Engine builds metadata via buildMetadata()
   |
3. Engine collects subagent trace via buildSubagentTrace()
   |
4. saveIterationLog() called with result, stdout, stderr, options
   |
5. File written to .ralph-tui/iterations/iteration-NNN-taskId.log
   |
6. createProgressEntry() extracts key info
   |
7. appendProgress() updates .ralph-tui/progress.md
```

### Progress Context Flow

```
1. New iteration starts
   |
2. buildPrompt() calls getRecentProgressSummary(cwd, 5)
   |
3. Recent entries extracted from progress.md
   |
4. renderPrompt() includes {{recentProgress}} in template
   |
5. Agent receives context about prior iterations
```

## Configuration

### Runtime Configuration

The logging system respects these configuration options:

| Option | Effect |
|--------|--------|
| `config.outputDir` | Custom output directory for iteration logs |
| `config.cwd` | Working directory for all log operations |

### Log Filtering

The `LogFilterOptions` interface supports:

```typescript
interface LogFilterOptions {
  iteration?: number;           // Specific iteration number
  taskId?: string;              // Partial task ID match
  status?: IterationStatus[];   // Filter by status
  limit?: number;               // Max results
  offset?: number;              // Pagination offset
}
```

## Testing

The logging system can be tested by:

1. Running iterations and checking `.ralph-tui/iterations/` for log files
2. Using `ralph-tui logs` to view and validate log content
3. Checking `.ralph-tui/progress.md` for cross-iteration context
4. Running with `--no-tui` to verify structured logger output

## Related Documentation

- Agent Tracing Types: `src/plugins/agents/tracing/types.ts`
- Engine Integration: `src/engine/index.ts`
- Logs Command: `src/commands/logs.ts`
- Template System: `src/templates/` (uses `{{recentProgress}}`)

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented iteration log persistence system
- Documented structured logger for headless/CI mode
- Documented progress tracking across iterations
- Documented log cleanup utilities
- Documented subagent trace building
