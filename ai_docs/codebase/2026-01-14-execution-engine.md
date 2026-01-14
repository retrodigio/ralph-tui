---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "ExecutionEngine Architecture"
tags: [engine, execution-loop, rate-limiting, error-handling, subagent-tracing, events, fallback-agents]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# ExecutionEngine Architecture

## Overview

The `ExecutionEngine` class is the core orchestrator of Ralph TUI, managing the agent loop that iterates through tasks from a tracker and executes them via an AI agent. Located in `src/engine/index.ts` (1700+ lines), it coordinates task selection, prompt building, agent execution, error handling, rate limit detection, agent fallback/recovery, subagent tracing, and event emission.

The engine operates as a state machine with well-defined lifecycle states and emits events at key transitions, enabling the TUI and other consumers to react to execution progress.

## Architecture

### High-Level Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Initialize │ ──► │    Start    │ ──► │   runLoop   │ ──► │    Stop     │
│   Plugins   │     │   Engine    │     │  (iterate)  │     │   Engine    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          ▼                          │
              ┌───────────┐           ┌─────────────────┐          ┌──────────┐
              │  Select   │ ◄──────► │  Run Iteration  │ ◄──────► │  Handle  │
              │   Task    │           │  with Error     │          │  Result  │
              └───────────┘           │   Handling      │          └──────────┘
                                      └─────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    ▼                          ▼                          ▼
              ┌───────────┐           ┌─────────────────┐          ┌──────────┐
              │   Build   │           │ Execute Agent   │          │  Detect  │
              │   Prompt  │           │  (streaming)    │          │  Rate    │
              └───────────┘           └─────────────────┘          │  Limit   │
                                                                   └──────────┘
```

### Design Patterns

- **State Machine**: Engine status transitions (`idle` -> `running` -> `pausing` -> `paused` -> `stopping`)
- **Event Emitter**: Typed events emitted via listener pattern for decoupled observation
- **Strategy Pattern**: Configurable error handling strategies (`retry`, `skip`, `abort`)
- **Fallback Chain**: Ordered list of fallback agents tried when primary hits rate limits
- **Exponential Backoff**: Rate limit retries with configurable base delay and multiplier

## Components

### ExecutionEngine Class

**Location**: `src/engine/index.ts:101`
**Purpose**: Central orchestrator for the task execution loop

#### Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `config` | `RalphConfig` | Merged runtime configuration |
| `agent` | `AgentPlugin \| null` | Current active agent instance |
| `tracker` | `TrackerPlugin \| null` | Task tracker instance |
| `listeners` | `EngineEventListener[]` | Registered event listeners |
| `state` | `EngineState` | Current engine state snapshot |
| `currentExecution` | `AgentExecutionHandle \| null` | Handle to interrupt current agent |
| `shouldStop` | `boolean` | Stop signal flag |
| `retryCountMap` | `Map<string, number>` | Per-task retry attempts |
| `skippedTasks` | `Set<string>` | Tasks marked as skipped |
| `subagentParser` | `SubagentTraceParser` | Parser for extracting subagent events |
| `rateLimitDetector` | `RateLimitDetector` | Rate limit condition detector |
| `rateLimitRetryMap` | `Map<string, number>` | Per-task rate limit retry attempts |
| `rateLimitedAgents` | `Set<string>` | Agents that have hit rate limits for current task |
| `primaryAgentInstance` | `AgentPlugin \| null` | Preserved primary agent for recovery |

#### Initialization

```typescript
async initialize(): Promise<void>
```

**Location**: `src/engine/index.ts:165`

Initialization performs the following steps:
1. Gets agent instance from registry using `config.agent`
2. Runs agent detection to verify availability
3. Validates configured model (if specified)
4. Stores reference to primary agent for later recovery
5. Initializes active agent state with `reason: 'primary'`
6. Initializes rate limit state tracking
7. Gets tracker instance from registry
8. Syncs tracker to get latest task state
9. Counts open/in_progress tasks for `totalTasks`

### Engine State

**Location**: `src/engine/types.ts:549`

```typescript
interface EngineState {
  status: EngineStatus;           // 'idle' | 'running' | 'pausing' | 'paused' | 'stopping'
  currentIteration: number;       // 1-based iteration counter
  currentTask: TrackerTask | null;
  totalTasks: number;
  tasksCompleted: number;
  iterations: IterationResult[];  // History of all iteration results
  startedAt: string | null;       // ISO 8601 timestamp
  currentOutput: string;          // Stdout buffer for current iteration
  currentStderr: string;          // Stderr buffer for current iteration
  subagents: Map<string, EngineSubagentState>;  // Tracked subagents
  activeAgent: ActiveAgentState | null;         // Current agent info
  rateLimitState: RateLimitState | null;        // Rate limit tracking
}
```

## The Iteration Loop

### Main Loop

**Location**: `src/engine/index.ts:321`

```typescript
private async runLoop(): Promise<void>
```

The main loop runs continuously until a stop condition is met:

```
while (!shouldStop) {
    1. Check for pausing state -> transition to paused, wait for resume
    2. Attempt primary agent recovery (if using fallback)
    3. Check max iterations limit -> stop with 'max_iterations'
    4. Check if all tasks complete -> stop with 'completed'
    5. Get next available task -> stop with 'no_tasks' if none
    6. Run iteration with error handling
    7. Handle abort strategy if iteration failed
    8. Update session with current progress
    9. Wait for configured iteration delay
}
```

### Pause/Resume Mechanism

**Location**: `src/engine/index.ts:322-348`

The engine supports graceful pause/resume:

- **Pausing**: When `pause()` is called during `running` state, status becomes `pausing`
- **Paused**: The loop detects `pausing` status, transitions to `paused`, emits `engine:paused`, then polls every 100ms waiting for resume
- **Resuming**: When `resume()` is called, status returns to `running`, loop continues and emits `engine:resumed`

### Task Selection

**Location**: `src/engine/index.ts:435`

```typescript
private async getNextAvailableTask(): Promise<TrackerTask | null>
```

Task selection logic:
1. Fetches all `open` and `in_progress` tasks from tracker
2. Iterates through tasks in order
3. Skips tasks in the `skippedTasks` set
4. Checks `tracker.isTaskReady(task.id)` to verify no unresolved dependencies
5. Returns first ready task, or `null` if none available

### Single Iteration

**Location**: `src/engine/index.ts:670`

```typescript
private async runIteration(task: TrackerTask): Promise<IterationResult>
```

Each iteration performs:

1. **Setup**: Increment iteration counter, set current task, reset output buffers
2. **Reset Tracking**: Clear subagent tracking, reset parser, clear agent switch log
3. **Emit Events**: `iteration:started`, `task:selected`
4. **Update Tracker**: Set task status to `in_progress`
5. **Emit**: `task:activated` for crash recovery tracking
6. **Build Prompt**: Use template system with recent progress context
7. **Execute Agent**:
   - Configure streaming callbacks for stdout/stderr
   - Enable subagent tracing if supported
   - Parse JSONL output for subagent events
8. **Check Rate Limit**: Detect rate limit in output
9. **Handle Rate Limit**: If detected, retry with backoff or switch to fallback
10. **Process Result**:
    - Check for `<promise>COMPLETE</promise>` signal
    - Update tracker if task completed
    - Clear rate-limited agents on task completion
11. **Save Log**: Persist iteration output with subagent trace
12. **Append Progress**: Add entry to progress file for context continuity
13. **Emit**: `iteration:completed`

### Prompt Building

**Location**: `src/engine/index.ts:64`

```typescript
async function buildPrompt(task: TrackerTask, config: RalphConfig): Promise<string>
```

Prompt construction:
1. Loads recent progress summary (last 5 iterations) via `getRecentProgressSummary()`
2. Renders prompt using template system via `renderPrompt(task, config, undefined, recentProgress)`
3. Falls back to hardcoded format if template rendering fails

The fallback prompt includes:
- Task ID and title
- Description (if present)
- Completion instructions with `<promise>COMPLETE</promise>` signal

## Error Handling Strategies

**Location**: `src/engine/types.ts:122-143`

```typescript
type ErrorHandlingStrategy = 'retry' | 'skip' | 'abort';

interface ErrorHandlingConfig {
  strategy: ErrorHandlingStrategy;
  maxRetries: number;           // Default: 3
  retryDelayMs: number;         // Default: 5000
  continueOnNonZeroExit: boolean;
}
```

### Strategy Implementation

**Location**: `src/engine/index.ts:457`

```typescript
private async runIterationWithErrorHandling(task: TrackerTask): Promise<IterationResult>
```

#### Retry Strategy

When `strategy === 'retry'`:

1. Track retry count per task in `retryCountMap`
2. If under `maxRetries`:
   - Emit `iteration:failed` with `action: 'retry'`
   - Emit `iteration:retrying` with attempt details
   - Increment retry count
   - Wait `retryDelayMs` if configured
   - Recursively call `runIterationWithErrorHandling(task)`
3. If max retries exceeded:
   - Emit `iteration:failed` with `action: 'skip'`
   - Emit `iteration:skipped` with reason
   - Add task to `skippedTasks` set
   - Clear retry count

#### Skip Strategy

When `strategy === 'skip'`:

1. Emit `iteration:failed` with `action: 'skip'`
2. Emit `iteration:skipped` with error reason
3. Add task to `skippedTasks` set
4. Continue to next task

#### Abort Strategy

When `strategy === 'abort'`:

1. Emit `iteration:failed` with `action: 'abort'`
2. Return to main loop which checks for abort condition
3. Main loop emits `engine:stopped` with `reason: 'error'`
4. Loop terminates

## Rate Limit Detection

### RateLimitDetector Class

**Location**: `src/engine/rate-limit-detector.ts:141`

Detects rate limit conditions by examining agent stderr output.

#### Detection Patterns

**Common Patterns** (all agents):
- HTTP 429 status codes in error context
- "rate limit", "rate-limit" phrases
- "too many requests"
- "quota exceeded"
- "overloaded"

**Agent-Specific Patterns**:

| Agent | Patterns |
|-------|----------|
| `claude` | Anthropic rate limit errors, API rate limit exceeded, "claude is currently overloaded" |
| `opencode` | OpenAI rate limit errors, tokens per minute, requests per minute, Azure throttling |

#### Detection Logic

```typescript
detect(input: RateLimitDetectionInput): RateLimitDetectionResult
```

1. Only checks **stderr** (not stdout) to avoid false positives from code output
2. Returns early if stderr is empty and exit code is 0
3. Checks common patterns, then agent-specific patterns
4. Extracts contextual message around match
5. Attempts to parse `retry-after` duration from output
6. Falls back to loose keyword check with exit code verification

#### Result Structure

```typescript
interface RateLimitDetectionResult {
  isRateLimit: boolean;
  message?: string;      // Contextual snippet around match
  retryAfter?: number;   // Suggested wait in seconds
}
```

### Exponential Backoff

**Location**: `src/engine/index.ts:1180`

```typescript
private calculateBackoffDelay(
  attempt: number,
  retryAfter?: number
): { delayMs: number; usedRetryAfter: boolean }
```

Backoff calculation:
1. If `retryAfter` is provided from rate limit response, use it directly (convert seconds to ms)
2. Otherwise calculate: `baseBackoffMs * 3^attempt`
3. Default base is 5000ms, producing: 5s, 15s, 45s for attempts 0, 1, 2

### Rate Limit Handling Flow

**Location**: `src/engine/index.ts:607`

```typescript
private async handleRateLimitWithBackoff(
  task: TrackerTask,
  rateLimitResult: RateLimitDetectionResult,
  iteration: number
): Promise<boolean>
```

When rate limit detected:

1. Check if retries exhausted for this task (`rateLimitRetryMap`)
2. If under max:
   - Calculate backoff delay (using retryAfter or exponential)
   - Increment retry count
   - Emit `iteration:rate-limited` event
   - Log retry attempt
   - Wait for backoff delay
   - Return `true` to signal retry
3. If exhausted:
   - Clear retry count
   - Return `false` to trigger fallback agent switch

## Agent Switching/Fallback System

### Configuration

**Location**: `src/config/types.ts:14-26`

```typescript
interface RateLimitHandlingConfig {
  enabled?: boolean;                          // Default: true
  maxRetries?: number;                        // Default: 3
  baseBackoffMs?: number;                     // Default: 5000
  recoverPrimaryBetweenIterations?: boolean;  // Default: true
}
```

Fallback agents are configured in `StoredConfig.fallbackAgents` as an ordered list of agent plugin names.

### Agent State Tracking

**Location**: `src/engine/types.ts:21-45`

```typescript
interface ActiveAgentState {
  plugin: string;              // Current agent plugin ID
  reason: 'primary' | 'fallback';
  since: string;               // ISO timestamp
}

interface RateLimitState {
  primaryAgent: string;
  limitedAt?: string;          // When primary was rate limited
  fallbackAgent?: string;      // Current fallback in use
}
```

### Switching to Fallback

**Location**: `src/engine/index.ts:1572`

```typescript
private async tryFallbackAgent(
  task: TrackerTask,
  iteration: number,
  startedAt: Date
): Promise<{ switched: boolean; allAgentsLimited: boolean }>
```

Fallback switching logic:

1. Get next available fallback from `config.agent.fallbackAgents`
2. Skip agents already in `rateLimitedAgents` set
3. Create fallback agent config inheriting primary's options
4. Get instance from agent registry
5. Verify availability via `detect()`
6. If available:
   - Set as current agent
   - Call `switchAgent()` with reason `'fallback'`
   - Clear rate limit retry count
   - Return `{ switched: true, allAgentsLimited: false }`
7. If unavailable:
   - Add to `rateLimitedAgents`
   - Recursively try next fallback
8. If no more fallbacks:
   - Return `{ switched: false, allAgentsLimited: true }`

### Agent Switch Mechanics

**Location**: `src/engine/index.ts:1325`

```typescript
private switchAgent(newAgentPlugin: string, reason: ActiveAgentReason): void
```

When switching agents:

1. Update `state.activeAgent` with new plugin, reason, and timestamp
2. Update `state.rateLimitState`:
   - For fallback: set `limitedAt` and `fallbackAgent`
   - For primary recovery: clear `limitedAt` and `fallbackAgent`
3. Record switch in `currentIterationAgentSwitches` for logging
4. Log switch to console
5. Emit `agent:switched` event

### Primary Agent Recovery

**Location**: `src/engine/index.ts:1419`

```typescript
private async attemptPrimaryAgentRecovery(): Promise<boolean>
```

Recovery is attempted between iterations when:
- Currently using a fallback agent
- `recoverPrimaryBetweenIterations` config is enabled

Recovery test process:

1. Log recovery test start
2. Execute minimal test prompt (`"Reply with just the word 'ok'."`) with 5-second timeout
3. Check result for rate limit indicators
4. Emit `agent:recovery-attempted` event with success/failure status
5. If successful:
   - Restore primary agent instance
   - Call `switchAgent()` with reason `'primary'`
   - Clear `rateLimitedAgents` set
   - Return `true`
6. If still rate limited:
   - Log failure
   - Return `false`

### All Agents Limited

When all agents (primary + fallbacks) are rate limited:

**Location**: `src/engine/index.ts:819-830`

1. Emit `agent:all-limited` event with list of tried agents
2. Call `pause()` to pause engine execution
3. User intervention required to resume

## Subagent Tracing Integration

### SubagentTraceParser

**Location**: `src/plugins/agents/tracing/parser.ts:43`

The parser extracts subagent lifecycle events from Claude Code's JSONL output.

#### Parser Initialization

**Location**: `src/engine/index.ts:146`

```typescript
this.subagentParser = new SubagentTraceParser({
  onEvent: (event) => this.handleSubagentEvent(event),
  trackHierarchy: true,
});
```

#### Event Flow

During iteration execution:

1. **JSONL Parsing**: Agent stdout is passed through streaming JSONL parser
2. **Event Detection**: Parser checks for Task tool invocations and results
3. **State Updates**: Parser maintains `SubagentState` for each subagent
4. **Engine Integration**: `handleSubagentEvent()` updates `state.subagents` map

#### Event Types

**Location**: `src/plugins/agents/tracing/types.ts:14`

| Event | Description |
|-------|-------------|
| `spawn` | Subagent started via Task tool invocation |
| `progress` | Subagent reports intermediate progress |
| `complete` | Subagent finished successfully |
| `error` | Subagent encountered an error |

#### Hierarchy Tracking

The parser maintains:
- `activeStack`: Stack of running subagent IDs for parent-child relationships
- `toolUseIdToSubagentId`: Correlation map for matching results to spawns

Each subagent state includes:
- `parentId`: Reference to parent subagent (undefined for top-level)
- `childIds`: Array of spawned child subagent IDs
- `depth`: Nesting level (computed by engine)

### Subagent Tree for TUI

**Location**: `src/engine/index.ts:1273`

```typescript
getSubagentTree(): SubagentTreeNode[]
```

Returns hierarchical tree structure:
1. Creates `SubagentTreeNode` for each tracked subagent
2. Links children to parents based on `parentId`
3. Returns array of root nodes (no parent)

## Event Emission Patterns

### Event Listener Registration

**Location**: `src/engine/index.ts:217`

```typescript
on(listener: EngineEventListener): () => void
```

- Adds listener to `listeners` array
- Returns unsubscribe function

### Event Emission

**Location**: `src/engine/index.ts:230`

```typescript
private emit(event: EngineEvent): void
```

- Iterates through all registered listeners
- Catches and ignores listener errors to prevent cascade failures

### Event Types Reference

**Location**: `src/engine/types.ts:193-529`

#### Lifecycle Events

| Event | Fields | Description |
|-------|--------|-------------|
| `engine:started` | `sessionId`, `totalTasks`, `tasks` | Engine started running |
| `engine:stopped` | `reason`, `totalIterations`, `tasksCompleted` | Engine stopped |
| `engine:paused` | `currentIteration` | Engine paused |
| `engine:resumed` | `fromIteration` | Engine resumed |
| `engine:iterations-added` | `added`, `newMax`, `previousMax`, `currentIteration` | Max iterations increased |
| `engine:iterations-removed` | `removed`, `newMax`, `previousMax`, `currentIteration` | Max iterations decreased |

#### Iteration Events

| Event | Fields | Description |
|-------|--------|-------------|
| `iteration:started` | `iteration`, `task` | Iteration began |
| `iteration:completed` | `result` | Iteration finished |
| `iteration:failed` | `iteration`, `error`, `task`, `action` | Iteration failed |
| `iteration:retrying` | `iteration`, `retryAttempt`, `maxRetries`, `task`, `previousError`, `delayMs` | Retry scheduled |
| `iteration:skipped` | `iteration`, `task`, `reason` | Task skipped |
| `iteration:rate-limited` | `iteration`, `task`, `retryAttempt`, `maxRetries`, `delayMs`, `rateLimitMessage`, `usedRetryAfter` | Rate limit detected |

#### Task Events

| Event | Fields | Description |
|-------|--------|-------------|
| `task:selected` | `task`, `iteration` | Task chosen for iteration |
| `task:activated` | `task`, `iteration` | Task set to in_progress |
| `task:completed` | `task`, `iteration` | Task completed |
| `tasks:refreshed` | `tasks` | Task list manually refreshed |

#### Agent Events

| Event | Fields | Description |
|-------|--------|-------------|
| `agent:output` | `stream`, `data`, `iteration` | Streaming agent output |
| `agent:switched` | `previousAgent`, `newAgent`, `reason`, `rateLimitState` | Agent changed |
| `agent:all-limited` | `task`, `triedAgents`, `rateLimitState` | All agents rate limited |
| `agent:recovery-attempted` | `primaryAgent`, `fallbackAgent`, `success`, `testDurationMs`, `rateLimitMessage` | Recovery test result |

#### Completion Events

| Event | Fields | Description |
|-------|--------|-------------|
| `all:complete` | `totalCompleted`, `totalIterations` | All tasks completed |

## Data Flow

### Task Execution Data Flow

```
TrackerPlugin         ExecutionEngine          AgentPlugin
     │                      │                      │
     │◄── getTasks() ───────│                      │
     │                      │                      │
     │◄── isTaskReady() ────│                      │
     │                      │                      │
     │◄── updateStatus() ───│                      │
     │                      │                      │
     │                      │──── execute() ──────►│
     │                      │                      │
     │                      │◄─ onStdout/Stderr ───│
     │                      │                      │
     │                      │◄─── promise ─────────│
     │                      │                      │
     │◄── completeTask() ───│                      │
```

### Rate Limit Handling Data Flow

```
Agent Output          RateLimitDetector        ExecutionEngine
     │                       │                       │
     │── stderr ────────────►│                       │
     │                       │                       │
     │                       │◄── detect() ──────────│
     │                       │                       │
     │                       │── isRateLimit ───────►│
     │                       │                       │
     │                       │                       │──► handleRateLimitWithBackoff()
     │                       │                       │
     │                       │                       │──► tryFallbackAgent()
     │                       │                       │
     │                       │                       │──► switchAgent()
```

## Configuration

### Rate Limit Configuration

**Location**: `src/config/types.ts:31-36`

```typescript
const DEFAULT_RATE_LIMIT_HANDLING: Required<RateLimitHandlingConfig> = {
  enabled: true,
  maxRetries: 3,
  baseBackoffMs: 5000,
  recoverPrimaryBetweenIterations: true,
};
```

### Error Handling Defaults

**Location**: `src/config/types.ts:247-252`

```typescript
const DEFAULT_ERROR_HANDLING: ErrorHandlingConfig = {
  strategy: 'skip',
  maxRetries: 3,
  retryDelayMs: 5000,
  continueOnNonZeroExit: false,
};
```

## API Reference

### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize()` | `async (): Promise<void>` | Initialize plugins and state |
| `start()` | `async (): Promise<void>` | Start execution loop |
| `stop()` | `async (): Promise<void>` | Stop execution loop |
| `pause()` | `(): void` | Request pause after current iteration |
| `resume()` | `(): void` | Resume from paused state |
| `on()` | `(listener: EngineEventListener): () => void` | Register event listener |
| `getState()` | `(): Readonly<EngineState>` | Get current state snapshot |
| `getStatus()` | `(): EngineStatus` | Get current status |
| `isPaused()` | `(): boolean` | Check if paused |
| `isPausing()` | `(): boolean` | Check if pausing |
| `addIterations()` | `async (count: number): Promise<boolean>` | Increase max iterations |
| `removeIterations()` | `async (count: number): Promise<boolean>` | Decrease max iterations |
| `continueExecution()` | `async (): Promise<void>` | Continue after adding iterations |
| `getIterationInfo()` | `(): { currentIteration, maxIterations }` | Get iteration counts |
| `refreshTasks()` | `async (): Promise<void>` | Manually refresh task list |
| `resetTasksToOpen()` | `async (taskIds: string[]): Promise<number>` | Reset tasks for crash recovery |
| `getTracker()` | `(): TrackerPlugin \| null` | Get tracker instance |
| `getSubagentTree()` | `(): SubagentTreeNode[]` | Get subagent hierarchy |
| `getActiveAgentInfo()` | `(): Readonly<ActiveAgentState> \| null` | Get active agent state |
| `getRateLimitState()` | `(): Readonly<RateLimitState> \| null` | Get rate limit state |
| `dispose()` | `async (): Promise<void>` | Clean up resources |

## Integration Points

### Plugin Integration

- **AgentPlugin**: Executes prompts, provides streaming output
- **TrackerPlugin**: Manages tasks, checks dependencies, updates status

### Template System

- **renderPrompt()**: Renders task prompt using Handlebars templates
- **getRecentProgressSummary()**: Provides context from previous iterations

### Session Management

- **updateSessionIteration()**: Persists iteration progress
- **updateSessionStatus()**: Updates session state
- **updateSessionMaxIterations()**: Persists max iteration changes

### Logging

- **saveIterationLog()**: Persists iteration output and metadata
- **appendProgress()**: Adds entry to progress file
- **buildSubagentTrace()**: Constructs trace data for logging

## Testing

Test files are located in `src/engine/__tests__/`:

- `rate-limit-detector.test.ts`: Rate limit detection patterns
- Integration tests via engine execution

## Related Documentation

- [Agent Plugins](./agents.md) - Agent plugin system
- [Tracker Plugins](./trackers.md) - Tracker plugin system
- [Template System](./templates.md) - Prompt template rendering
- [Session Management](./sessions.md) - Session persistence

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented iteration loop mechanics
- Documented error handling strategies (retry/skip/abort)
- Documented rate limit detection and exponential backoff
- Documented agent switching/fallback system
- Documented subagent tracing integration
- Documented event emission patterns
