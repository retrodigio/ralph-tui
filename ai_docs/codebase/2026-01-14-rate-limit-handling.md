---
date: 2026-01-14T12:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Rate Limit Detection and Handling System"
tags: [rate-limit, error-handling, fallback-agents, backoff, resilience, execution-engine]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
priority: 5
---

# Rate Limit Detection and Handling System

## Overview

The Rate Limit Detection and Handling System provides resilient execution for Ralph TUI when AI agents encounter API rate limits. The system detects rate limit conditions from agent output, implements exponential backoff retry logic, supports automatic fallback to alternate agents, and attempts recovery to the primary agent between iterations.

This system ensures continuous task execution even when API quotas are exceeded by intelligently managing agent switching and retry delays.

## Architecture

The rate limit handling system follows a layered architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                     ExecutionEngine                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐│
│  │ RateLimitDetector│  │ Backoff Logic    │  │ Agent Switching││
│  │ (Detection)      │  │ (Retry Delays)   │  │ (Fallbacks)    ││
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘│
│           │                     │                     │         │
│           └─────────────────────┼─────────────────────┘         │
│                                 │                               │
│                    ┌────────────▼────────────┐                  │
│                    │    Rate Limit State     │                  │
│                    │  (Tracking & Recovery)  │                  │
│                    └─────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Stderr-only detection**: Rate limit detection examines only stderr to avoid false positives from agent-generated code containing rate limit keywords
2. **Agent-specific patterns**: Different AI providers use different error formats, so patterns are organized by agent type
3. **Exponential backoff with base 3**: Uses formula `baseBackoffMs * 3^attempt` for aggressive backoff (5s, 15s, 45s)
4. **Primary agent recovery**: Automatically tests primary agent between iterations to return from fallback when rate limits lift

## Components

### RateLimitDetector Class

**Location**: `src/engine/rate-limit-detector.ts:141-302`

**Purpose**: Detects rate limit conditions from agent output by matching against known patterns for various AI providers.

**Implementation**:

The `RateLimitDetector` class provides a single public method `detect()` that analyzes agent output:

```typescript
export class RateLimitDetector {
  detect(input: RateLimitDetectionInput): RateLimitDetectionResult {
    // Only checks stderr to avoid false positives
    // Matches against common + agent-specific patterns
    // Extracts retry-after hints when available
  }
}
```

**Detection Input Interface**:

```typescript
interface RateLimitDetectionInput {
  stderr: string;           // Primary source for detection
  stdout?: string;          // Not used for detection (false positive prevention)
  exitCode?: number;        // Secondary confirmation signal
  agentId?: string;         // Enables agent-specific pattern matching
}
```

**Detection Result Interface**:

```typescript
interface RateLimitDetectionResult {
  isRateLimit: boolean;     // Whether rate limit was detected
  message?: string;         // Extracted error message (up to 200 chars)
  retryAfter?: number;      // Suggested retry delay in seconds
}
```

### Pattern Matching System

**Location**: `src/engine/rate-limit-detector.ts:52-128`

**Purpose**: Provides regex patterns to identify rate limit errors from different AI providers.

**Common Patterns** (applied to all agents):

| Pattern | Description | Retry-After Extraction |
|---------|-------------|----------------------|
| `HTTP/status/error/code 429` | HTTP 429 status codes in error context | `retry-after: Ns` |
| `rate-limit` | Generic rate limit phrase | `retry-after: Ns` |
| `too many requests` | Common error message | `N seconds` |
| `quota-exceeded` | API quota exceeded | `N seconds` |
| `overloaded` | Service overload | `N seconds` |

**Agent-Specific Patterns**:

**Claude (Anthropic)**:
- `anthropic.*rate-limit` - Anthropic API rate limits
- `API rate limit exceeded` - Claude CLI error format
- `claude.*is currently overloaded` - Claude service overload
- `api-error.*429` - HTTP 429 in API error context

**OpenCode (OpenAI)**:
- `openai.*rate-limit` - OpenAI API rate limits
- `tokens per minute` - TPM limit errors
- `requests per minute` - RPM limit errors
- `azure.*throttl` - Azure OpenAI throttling

**Loose Fallback Patterns** (with exit code confirmation):
- `throttl` - Generic throttling
- `limit.*exceeded` / `exceeded.*limit` - Limit exceeded variations
- `capacity` - Capacity errors
- `backoff` - Backoff signals

### Exponential Backoff Retry Logic

**Location**: `src/engine/index.ts:1176-1199`

**Purpose**: Calculates progressive retry delays to allow rate limits to reset.

**Backoff Formula**: `baseBackoffMs * 3^attempt`

With default `baseBackoffMs` of 5000ms:
- Attempt 0: 5 seconds
- Attempt 1: 15 seconds
- Attempt 2: 45 seconds

**Implementation**:

```typescript
private calculateBackoffDelay(
  attempt: number,
  retryAfter?: number
): { delayMs: number; usedRetryAfter: boolean } {
  // Prefer retryAfter from rate limit response if available
  if (retryAfter !== undefined && retryAfter > 0) {
    return { delayMs: retryAfter * 1000, usedRetryAfter: true };
  }

  // Otherwise use exponential backoff
  const delayMs = this.rateLimitConfig.baseBackoffMs * Math.pow(3, attempt);
  return { delayMs, usedRetryAfter: false };
}
```

**Retry Handling Flow**:

```typescript
private async handleRateLimitWithBackoff(
  task: TrackerTask,
  rateLimitResult: RateLimitDetectionResult,
  iteration: number
): Promise<boolean> {
  // 1. Check if max retries exceeded
  // 2. Calculate backoff delay
  // 3. Increment retry count
  // 4. Emit iteration:rate-limited event
  // 5. Wait for delay
  // 6. Return true to signal retry
}
```

### Fallback Agent Switching

**Location**: `src/engine/index.ts:1543-1631`

**Purpose**: Switches to alternate agents when the primary agent exhausts rate limit retries.

**Agent Selection Logic**:

```typescript
private getNextFallbackAgent(): string | undefined {
  const fallbackAgents = this.config.agent.fallbackAgents;
  if (!fallbackAgents || fallbackAgents.length === 0) {
    return undefined;
  }

  // Find first fallback not yet rate-limited
  for (const fallbackPlugin of fallbackAgents) {
    if (!this.rateLimitedAgents.has(fallbackPlugin)) {
      return fallbackPlugin;
    }
  }

  return undefined;
}
```

**Fallback Initialization Process**:

1. Get next available fallback agent from ordered list
2. Create agent config inheriting options from primary
3. Get instance from agent registry
4. Verify fallback is available via `detect()`
5. Switch active agent via `switchToFallbackAgent()`
6. Clear rate limit retry count for current task

**State Updates on Switch**:

```typescript
private switchAgent(newAgentPlugin: string, reason: ActiveAgentReason): void {
  // Update activeAgent state
  this.state.activeAgent = {
    plugin: newAgentPlugin,
    reason,  // 'primary' or 'fallback'
    since: now,
  };

  // Update rateLimitState
  if (reason === 'fallback') {
    this.state.rateLimitState = {
      ...this.state.rateLimitState,
      limitedAt: now,
      fallbackAgent: newAgentPlugin,
    };
  }

  // Record switch for iteration logging
  this.currentIterationAgentSwitches.push({ at, from, to, reason });

  // Emit agent:switched event
}
```

### Primary Agent Recovery Testing

**Location**: `src/engine/index.ts:1397-1512`

**Purpose**: Tests if the primary agent's rate limit has lifted between iterations.

**Recovery Test Configuration**:

```typescript
const PRIMARY_RECOVERY_TEST_TIMEOUT_MS = 5000;  // 5 second timeout
const PRIMARY_RECOVERY_TEST_PROMPT = 'Reply with just the word "ok".';
```

**Recovery Decision Logic**:

```typescript
private shouldRecoverPrimaryAgent(): boolean {
  // Only attempt if currently on fallback
  if (this.state.activeAgent?.reason !== 'fallback') {
    return false;
  }

  // Check if recovery is enabled in config
  return this.rateLimitConfig.recoverPrimaryBetweenIterations;
}
```

**Recovery Test Flow**:

```typescript
private async attemptPrimaryAgentRecovery(): Promise<boolean> {
  // 1. Execute minimal test prompt with short timeout
  const handle = this.primaryAgentInstance.execute(
    PRIMARY_RECOVERY_TEST_PROMPT,
    [],
    { cwd: this.config.cwd, timeout: PRIMARY_RECOVERY_TEST_TIMEOUT_MS }
  );

  const result = await handle.promise;

  // 2. Check for rate limit in test output
  const rateLimitResult = this.rateLimitDetector.detect({
    stderr: result.stderr,
    stdout: result.stdout,
    exitCode: result.exitCode,
    agentId: primaryAgent,
  });

  // 3. If no rate limit, switch back to primary
  if (!rateLimitResult.isRateLimit && result.status === 'completed') {
    this.agent = this.primaryAgentInstance;
    this.switchAgent(primaryAgent, 'primary');
    this.rateLimitedAgents.clear();
    return true;
  }

  return false;
}
```

### Rate Limit State Machine

**Location**: `src/engine/types.ts:32-45`, `src/engine/index.ts`

**Purpose**: Tracks rate limit status and agent transitions across iterations.

**State Interface**:

```typescript
interface RateLimitState {
  primaryAgent: string;      // Plugin ID of primary agent
  limitedAt?: string;        // ISO 8601 timestamp when rate limited
  fallbackAgent?: string;    // Plugin ID of active fallback
}
```

**State Transitions**:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Rate Limit State Machine                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐     rate limit      ┌─────────────────────┐  │
│   │   Primary   │ ──────────────────► │  Retrying (1..N)    │  │
│   │   Agent     │                     │  (exponential back) │  │
│   └──────▲──────┘                     └──────────┬──────────┘  │
│          │                                       │              │
│          │ recovery                    max retries exceeded     │
│          │ test passes                           │              │
│          │                                       ▼              │
│   ┌──────┴──────┐     next fallback    ┌─────────────────────┐ │
│   │  Recovery   │ ◄─────────────────── │  Fallback Agent     │ │
│   │  Testing    │   available?         │  (task execution)   │ │
│   └─────────────┘                      └──────────┬──────────┘ │
│                                                   │             │
│                              all agents limited   │             │
│                                                   ▼             │
│                                        ┌─────────────────────┐ │
│                                        │   Engine Paused     │ │
│                                        │  (user intervention)│ │
│                                        └─────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**State Clearing**:

- On task completion: `rateLimitedAgents` set is cleared
- On recovery to primary: `limitedAt` and `fallbackAgent` are cleared from `rateLimitState`
- On new task: `rateLimitRetryMap` entry for previous task is removed

## Data Flow

### Rate Limit Detection Flow

```
Agent Execution
       │
       ▼
┌──────────────────┐
│  Agent Output    │
│  (stdout/stderr) │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ RateLimitDetector│
│    .detect()     │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
[detected] [not detected]
    │              │
    ▼              ▼
handleRateLimit   continue
WithBackoff       execution
```

### Agent Switching Flow

```
Rate Limit Detected
       │
       ▼
┌────────────────────┐
│  Calculate Backoff │
│  (retryAfter or    │
│   exponential)     │
└────────┬───────────┘
         │
         ▼
    ┌─────────┐
    │ Retry?  │
    └────┬────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
  [yes]     [max retries]
    │              │
    │              ▼
    │    ┌────────────────┐
    │    │getNextFallback │
    │    │    Agent       │
    │    └───────┬────────┘
    │            │
    │       ┌────┴────┐
    │       │         │
    │       ▼         ▼
    │  [available] [none]
    │       │          │
    │       ▼          ▼
    │    switch     emit
    │    agent    all-limited
    │       │      + pause
    ▼       ▼
   wait   retry task
   delay  with new agent
    │
    ▼
  retry
  iteration
```

## Configuration

### RateLimitHandlingConfig

**Location**: `src/config/types.ts:14-26`

```typescript
interface RateLimitHandlingConfig {
  enabled?: boolean;                          // Default: true
  maxRetries?: number;                        // Default: 3
  baseBackoffMs?: number;                     // Default: 5000
  recoverPrimaryBetweenIterations?: boolean;  // Default: true
}
```

### Configuration File Examples

**Basic TOML Configuration**:

```toml
agent = "claude"
fallbackAgents = ["opencode"]

[rateLimitHandling]
enabled = true
maxRetries = 3
baseBackoffMs = 5000
recoverPrimaryBetweenIterations = true
```

**Agent-Specific Configuration**:

```toml
[[agents]]
name = "claude"
plugin = "claude"
fallbackAgents = ["opencode", "custom-agent"]

[agents.rateLimitHandling]
maxRetries = 5
baseBackoffMs = 10000
```

### Default Values

**Location**: `src/config/types.ts:29-36`

```typescript
const DEFAULT_RATE_LIMIT_HANDLING: Required<RateLimitHandlingConfig> = {
  enabled: true,
  maxRetries: 3,
  baseBackoffMs: 5000,
  recoverPrimaryBetweenIterations: true,
};
```

## Engine Events

### Rate Limit Related Events

**IterationRateLimitedEvent** (`iteration:rate-limited`):

```typescript
interface IterationRateLimitedEvent {
  type: 'iteration:rate-limited';
  timestamp: string;
  iteration: number;
  task: TrackerTask;
  retryAttempt: number;      // 1-based retry count
  maxRetries: number;
  delayMs: number;           // Actual delay being used
  rateLimitMessage?: string;
  usedRetryAfter: boolean;   // True if delay from response header
}
```

**AgentSwitchedEvent** (`agent:switched`):

```typescript
interface AgentSwitchedEvent {
  type: 'agent:switched';
  timestamp: string;
  previousAgent: string;
  newAgent: string;
  reason: 'primary' | 'fallback';
  rateLimitState?: RateLimitState;
}
```

**AllAgentsLimitedEvent** (`agent:all-limited`):

```typescript
interface AllAgentsLimitedEvent {
  type: 'agent:all-limited';
  timestamp: string;
  task: TrackerTask;
  triedAgents: string[];
  rateLimitState: RateLimitState;
}
```

**AgentRecoveryAttemptedEvent** (`agent:recovery-attempted`):

```typescript
interface AgentRecoveryAttemptedEvent {
  type: 'agent:recovery-attempted';
  timestamp: string;
  primaryAgent: string;
  fallbackAgent: string;
  success: boolean;
  testDurationMs: number;
  rateLimitMessage?: string;
}
```

## Integration Points

### With ExecutionEngine

The rate limit system integrates into the main execution loop in `runIteration()`:

1. After agent execution completes, call `checkForRateLimit()`
2. If rate limit detected, call `handleRateLimitWithBackoff()`
3. If max retries exceeded, call `tryFallbackAgent()`
4. At loop start, call `shouldRecoverPrimaryAgent()` and `attemptPrimaryAgentRecovery()`

### With Agent Plugins

The detector uses the `agentId` from config to select agent-specific patterns:

```typescript
const rateLimitResult = this.rateLimitDetector.detect({
  stderr,
  stdout,
  exitCode,
  agentId: this.config.agent.plugin,  // 'claude', 'opencode', etc.
});
```

### With Session Logging

Agent switches are recorded in iteration logs via `currentIterationAgentSwitches`:

```typescript
interface AgentSwitchEntry {
  at: string;      // ISO timestamp
  from: string;    // Previous agent plugin
  to: string;      // New agent plugin
  reason: 'primary' | 'fallback';
}
```

## Usage Examples

### Configuring Fallback Agents

```toml
# ralph.toml
agent = "claude"
fallbackAgents = ["opencode"]

[rateLimitHandling]
maxRetries = 5
baseBackoffMs = 3000
```

### Handling All-Agents-Limited Scenario

When all configured agents are rate limited:
1. Engine emits `agent:all-limited` event
2. Engine calls `pause()` to suspend execution
3. TUI displays rate limit status
4. User can wait and resume, or adjust configuration

### Monitoring Agent Switches

Subscribe to engine events:

```typescript
engine.on((event) => {
  if (event.type === 'agent:switched') {
    console.log(`Switched from ${event.previousAgent} to ${event.newAgent}`);
    console.log(`Reason: ${event.reason}`);
  }

  if (event.type === 'agent:recovery-attempted') {
    console.log(`Recovery ${event.success ? 'succeeded' : 'failed'}`);
  }
});
```

## Related Documentation

- Agent Plugin System: Documents the AgentPlugin interface used by fallback agents
- Error Handling System: Documents the ErrorHandlingConfig that operates alongside rate limit handling
- Session Management: Documents how rate limit state is persisted across sessions

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented RateLimitDetector class and pattern matching
- Documented exponential backoff formula and implementation
- Documented fallback agent switching mechanism
- Documented primary agent recovery testing
- Documented rate limit state machine and transitions
- Added configuration reference and examples
