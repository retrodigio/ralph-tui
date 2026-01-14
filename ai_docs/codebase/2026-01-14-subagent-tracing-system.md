---
date: 2026-01-14T00:00:00Z
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Subagent Tracing System"
tags: [subagent, tracing, parser, jsonl, lifecycle, hierarchy, execution-engine]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Subagent Tracing System

## Overview

The Subagent Tracing System is responsible for parsing, tracking, and visualizing Claude Code subagent lifecycle events. When Claude Code spawns subagents via the Task tool, this system extracts structured information from the JSONL output stream, tracks parent-child hierarchies, and provides real-time visibility into subagent activity through the TUI.

The system consists of three main components:
1. **SubagentTraceParser** - Core parser for extracting lifecycle events from JSONL
2. **Streaming JSONL Parser** - Handles incremental parsing of chunked output
3. **Execution Engine Integration** - Coordinates tracing with the iteration lifecycle

## Architecture

### Component Overview

```
Claude Code JSONL Output
         │
         ▼
┌─────────────────────────────────────┐
│  ClaudeAgentPlugin                  │
│  createStreamingJsonlParser()       │
│  - Accumulates partial lines        │
│  - Parses complete JSON lines       │
└─────────────────────────────────────┘
         │
         ▼ ClaudeJsonlMessage
┌─────────────────────────────────────┐
│  SubagentTraceParser                │
│  processMessage()                   │
│  - Detects Task tool invocations    │
│  - Tracks hierarchy via activeStack │
│  - Emits lifecycle events           │
└─────────────────────────────────────┘
         │
         ▼ SubagentEvent
┌─────────────────────────────────────┐
│  ExecutionEngine                    │
│  handleSubagentEvent()              │
│  - Updates engine state             │
│  - Calculates depth                 │
│  - Builds tree for TUI              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  TUI Components                     │
│  SubagentTreePanel                  │
│  SubagentSection                    │
│  - Renders hierarchy                │
│  - Shows status indicators          │
└─────────────────────────────────────┘
```

### Data Flow

1. **Input**: Claude Code CLI outputs JSONL when `--output-format stream-json` is enabled
2. **Streaming Parser**: Chunks are accumulated until complete lines are available
3. **Message Processing**: Each JSON message is analyzed for Task tool patterns
4. **Event Emission**: Spawn, progress, complete, and error events are emitted
5. **State Update**: Engine state is updated with subagent tracking data
6. **Persistence**: Completed iteration traces are saved with logs
7. **Visualization**: TUI renders hierarchical tree view

## Components

### SubagentTraceParser Class

**Location**: `src/plugins/agents/tracing/parser.ts`

The core parser that extracts subagent lifecycle events from Claude Code JSONL output.

**Purpose**: Process streaming JSONL messages to detect Task tool invocations, track parent-child relationships, and emit structured lifecycle events.

**Implementation**:

```typescript
export class SubagentTraceParser {
  // Map of subagent ID to state
  private subagents: Map<string, SubagentState> = new Map();

  // Stack of active subagent IDs for hierarchy tracking
  private activeStack: string[] = [];

  // Callback for emitting events
  private onEvent?: SubagentEventCallback;

  // Whether to track parent-child hierarchy
  private trackHierarchy: boolean;

  // All emitted events for replay/debugging
  private events: SubagentEvent[] = [];

  // Map of tool_use_id to subagent ID for correlating tool results
  private toolUseIdToSubagentId: Map<string, string> = new Map();
}
```

**Key Methods**:

| Method | Purpose |
|--------|---------|
| `processMessage(message)` | Process single JSONL message, detect events |
| `processMessages(messages)` | Batch process multiple messages |
| `getActiveSubagents()` | Get currently running subagents |
| `getAllSubagents()` | Get all tracked subagents |
| `getSubagent(id)` | Get specific subagent by ID |
| `getEvents()` | Get all emitted events |
| `getCurrentDepth()` | Get current nesting depth |
| `getSummary()` | Get aggregate activity summary |
| `reset()` | Clear parser state for new iteration |

**Event Detection Logic**:

The parser detects events by analyzing message structure:

1. **Task Tool Invocation** (spawn): `message.tool?.name === 'Task'` or content blocks with `type: 'tool_use', name: 'Task'`
2. **Tool Result** (completion): `message.raw.type === 'tool_result'` or `message.type === 'result'`
3. **Error Message**: `message.raw.type === 'error'` or presence of `raw.error` object

### Type Definitions

**Location**: `src/plugins/agents/tracing/types.ts`

**SubagentEventType**:
```typescript
type SubagentEventType = 'spawn' | 'progress' | 'complete' | 'error';
```

**SubagentEventBase**: Common fields for all events
- `id`: Unique identifier for subagent instance
- `type`: Lifecycle event type
- `timestamp`: ISO 8601 timestamp
- `agentType`: Type of agent (e.g., 'Explore', 'Bash', 'Plan')
- `description`: Human-readable task description
- `parentId`: Parent subagent ID if nested

**SubagentSpawnEvent**: Extends base with:
- `prompt`: Task/prompt given to subagent
- `model`: Model being used (optional)

**SubagentCompleteEvent**: Extends base with:
- `exitStatus`: 'success' or other status
- `durationMs`: Execution duration
- `result`: Summary of accomplishment (optional)

**SubagentErrorEvent**: Extends base with:
- `errorMessage`: Error description
- `errorCode`: Error code (optional)
- `durationMs`: Duration before error (optional)

**SubagentState**: Runtime state of tracked subagent
- `id`, `agentType`, `description`, `status`
- `parentId`, `childIds[]`: Hierarchy tracking
- `spawnedAt`, `endedAt`, `durationMs`: Timing
- `prompt`, `result`: Input and output

**SubagentTraceSummary**: Aggregate statistics
- `totalSpawned`, `completed`, `errored`, `running`
- `maxDepth`: Maximum nesting observed
- `totalDurationMs`: Sum of all durations
- `byAgentType`: Count by agent type

### Module Exports

**Location**: `src/plugins/agents/tracing/index.ts`

Barrel file exporting:
- `SubagentTraceParser` class
- All type definitions

### Streaming JSONL Parser

**Location**: `src/plugins/agents/builtin/claude.ts`

**ClaudeAgentPlugin.createStreamingJsonlParser()**:

Creates a stateful parser for handling chunked streaming output where data may split across line boundaries.

```typescript
static createStreamingJsonlParser(): {
  push: (chunk: string) => JsonlParseResult[];
  flush: () => JsonlParseResult[];
  getState: () => { messages: ClaudeJsonlMessage[]; fallback: string[] };
}
```

**Implementation Details**:
- Maintains internal buffer for partial lines
- `push(chunk)`: Adds data, returns parsed complete lines
- `flush()`: Processes remaining buffer at stream end
- `getState()`: Returns accumulated messages and fallback text

**ClaudeJsonlMessage Interface**:
```typescript
interface ClaudeJsonlMessage {
  type?: string;        // 'assistant', 'user', 'result', 'system'
  message?: string;     // Text content
  tool?: {
    name?: string;
    input?: Record<string, unknown>;
  };
  result?: unknown;
  cost?: {
    inputTokens?: number;
    outputTokens?: number;
    totalUSD?: number;
  };
  sessionId?: string;
  raw: Record<string, unknown>;  // Original parsed JSON
}
```

## Subagent Lifecycle Events

### Spawn Event

Triggered when Claude Code invokes the Task tool to spawn a subagent.

**Detection Pattern**:
```typescript
// Via message.tool
message.tool?.name === 'Task'

// Via raw content blocks
raw.type === 'assistant' && raw.content[].type === 'tool_use' && name === 'Task'
```

**Extracted Data**:
- `subagent_type` from tool input
- `description` from tool input
- `prompt` from tool input
- `model` from tool input (optional)

**Hierarchy Assignment**:
- Parent ID from top of active stack (if tracking enabled)
- New ID pushed to active stack
- tool_use_id mapped for result correlation

### Progress Event

Indicates intermediate updates during subagent execution.

**Note**: Currently defined in types but not actively detected by the parser. The parser focuses on spawn/complete/error events.

### Complete Event

Triggered when a subagent finishes successfully.

**Detection Pattern**:
```typescript
raw.type === 'tool_result' || message.type === 'result'
```

**Processing**:
1. Correlate via `tool_use_id` or use top of active stack
2. Extract result content from `raw.content`
3. Calculate duration from spawn time
4. Update subagent state to 'completed'
5. Remove from active stack

### Error Event

Triggered when a subagent encounters an error.

**Detection Patterns**:
```typescript
raw.type === 'error'
message.type === 'error'
typeof raw.error === 'object'
raw.is_error === true
raw.content.includes('error')  // Heuristic
```

**Processing**:
1. Extract error message and code from error object
2. Update subagent state to 'error'
3. Remove from active stack
4. Emit error event with details

## Hierarchy Tracking

The parser maintains parent-child relationships through:

### Active Stack

A stack (`activeStack: string[]`) tracks the current execution context:

```typescript
// On spawn
const parentId = this.activeStack[this.activeStack.length - 1];
this.activeStack.push(newSubagentId);

// On complete/error
const stackIndex = this.activeStack.indexOf(subagentId);
this.activeStack.splice(stackIndex, 1);
```

### State Linkage

Each `SubagentState` maintains bidirectional links:
- `parentId`: Points to parent subagent
- `childIds[]`: List of child subagent IDs

When spawning:
```typescript
if (parentId) {
  const parentState = this.subagents.get(parentId);
  if (parentState) {
    parentState.childIds.push(id);
  }
}
```

### Depth Calculation

Depth is calculated by traversing the parent chain:

```typescript
private calculateSubagentDepth(subagentId: string): number {
  let depth = 1;
  let current = this.subagentParser.getSubagent(subagentId);

  while (current?.parentId) {
    depth++;
    current = this.subagentParser.getSubagent(current.parentId);
  }

  return depth;
}
```

### Tree Building

The engine builds a tree structure for TUI rendering:

```typescript
getSubagentTree(): SubagentTreeNode[] {
  // First pass: create nodes for all subagents
  for (const state of this.state.subagents.values()) {
    nodeMap.set(state.id, { state, children: [] });
  }

  // Second pass: build tree structure
  for (const state of this.state.subagents.values()) {
    if (state.parentId && nodeMap.has(state.parentId)) {
      nodeMap.get(state.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}
```

## Execution Engine Integration

**Location**: `src/engine/index.ts`

### Initialization

The engine initializes the parser in its constructor:

```typescript
this.subagentParser = new SubagentTraceParser({
  onEvent: (event) => this.handleSubagentEvent(event),
  trackHierarchy: true,
});
```

### Per-Iteration Reset

At the start of each iteration, tracking is reset:

```typescript
// Reset subagent tracking for this iteration
this.state.subagents.clear();
this.subagentParser.reset();
```

### Integration with Agent Execution

During agent execution:

```typescript
// Check if agent supports subagent tracing
const supportsTracing = this.agent!.meta.supportsSubagentTracing;

// Create streaming JSONL parser if tracing is enabled
const jsonlParser = supportsTracing
  ? ClaudeAgentPlugin.createStreamingJsonlParser()
  : null;

// Execute with subagentTracing flag
const handle = this.agent!.execute(prompt, [], {
  subagentTracing: supportsTracing,
  onStdout: (data) => {
    // Parse JSONL output for subagent events if tracing is enabled
    if (jsonlParser) {
      const results = jsonlParser.push(data);
      for (const result of results) {
        if (result.success) {
          this.subagentParser.processMessage(result.message);
        }
      }
    }
  },
});
```

### Event Handling

When subagent events are detected:

```typescript
private handleSubagentEvent(event: SubagentEvent): void {
  const parserState = this.subagentParser.getSubagent(event.id);
  if (!parserState) return;

  // Calculate depth for this subagent
  const depth = this.calculateSubagentDepth(event.id);

  // Convert to engine state format and update map
  const engineState = toEngineSubagentState(parserState, depth);
  this.state.subagents.set(event.id, engineState);
}
```

### State Conversion

Parser state is converted to engine state format:

```typescript
// From src/engine/types.ts
function toEngineSubagentState(
  parserState: SubagentState,
  depth: number
): EngineSubagentState {
  return {
    id: parserState.id,
    type: parserState.agentType,
    description: parserState.description,
    status: parserState.status,
    startedAt: parserState.spawnedAt,
    completedAt: parserState.endedAt,
    parentId: parserState.parentId,
    children: [...parserState.childIds],
    durationMs: parserState.durationMs,
    depth,
  };
}
```

### Persistence

After iteration completion, traces are persisted:

```typescript
const events = this.subagentParser.getEvents();
const states = this.subagentParser.getAllSubagents();
const subagentTrace =
  events.length > 0 ? buildSubagentTrace(events, states) : undefined;

await saveIterationLog(config.cwd, result, stdout, stderr, {
  subagentTrace,
  // ... other options
});
```

### SubagentTrace Structure

```typescript
interface SubagentTrace {
  events: SubagentEvent[];           // Full timeline
  hierarchy: SubagentHierarchyNode[];  // Tree structure
  stats: SubagentTraceStats;         // Aggregate stats
}

interface SubagentTraceStats {
  totalSubagents: number;
  byType: Record<string, number>;
  totalDurationMs: number;
  failureCount: number;
  maxDepth: number;
}
```

## Configuration

### Agent Configuration

The Claude agent plugin declares tracing support:

```typescript
readonly meta: AgentPluginMeta = {
  supportsSubagentTracing: true,
  structuredOutputFormat: 'jsonl',
  // ...
};
```

### Execution Options

Tracing is enabled via `AgentExecuteOptions`:

```typescript
interface AgentExecuteOptions {
  // ... other options
  subagentTracing?: boolean;
}
```

### TUI Detail Level

Users can configure display detail via `subagentTracingDetail`:

```typescript
type SubagentDetailLevel = 'off' | 'minimal' | 'moderate' | 'full';
```

- `off`: No subagent display
- `minimal`: Single-line summaries
- `moderate`: Collapsible sections (default expanded)
- `full`: Full detail with all output

## Usage Examples

### Basic Parser Usage

```typescript
const parser = new SubagentTraceParser({
  onEvent: (event) => console.log('Subagent event:', event),
  trackHierarchy: true,
});

// Process JSONL messages as they arrive
parser.processMessage(jsonlMessage);

// Get current state
const activeSubagents = parser.getActiveSubagents();
const summary = parser.getSummary();
```

### Streaming JSONL Parsing

```typescript
const jsonlParser = ClaudeAgentPlugin.createStreamingJsonlParser();

// Process chunks as they arrive
process.stdout.on('data', (chunk) => {
  const results = jsonlParser.push(chunk.toString());
  for (const result of results) {
    if (result.success) {
      subagentParser.processMessage(result.message);
    }
  }
});

// Flush at end of stream
process.stdout.on('end', () => {
  const remaining = jsonlParser.flush();
  for (const result of remaining) {
    if (result.success) {
      subagentParser.processMessage(result.message);
    }
  }
});
```

### Accessing Tree for TUI

```typescript
const engine = new ExecutionEngine(config);

// Get hierarchical tree for rendering
const tree = engine.getSubagentTree();

// Tree structure: SubagentTreeNode[]
// Each node has: { state: EngineSubagentState, children: SubagentTreeNode[] }
```

## Testing

### Unit Testing Parser

Test detection of Task tool invocations:

```typescript
const message: ClaudeJsonlMessage = {
  type: 'assistant',
  tool: {
    name: 'Task',
    input: {
      subagent_type: 'Explore',
      description: 'Search for files',
      prompt: 'Find all TypeScript files',
    },
  },
  raw: { /* ... */ },
};

const events = parser.processMessage(message);
expect(events[0].type).toBe('spawn');
expect(events[0].agentType).toBe('Explore');
```

### Testing Hierarchy

```typescript
// Spawn parent
parser.processMessage(parentSpawnMessage);

// Spawn child (while parent running)
parser.processMessage(childSpawnMessage);

const parent = parser.getSubagent(parentId);
const child = parser.getSubagent(childId);

expect(child.parentId).toBe(parentId);
expect(parent.childIds).toContain(childId);
```

## Related Documentation

- Engine System: `ai_docs/codebase/2026-01-14-execution-engine.md` (if exists)
- Log Persistence: See `src/logs/persistence.ts`
- TUI Components: See `src/tui/components/SubagentTreePanel.tsx`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented SubagentTraceParser class
- Documented JSONL streaming parser
- Documented lifecycle events (spawn/progress/complete/error)
- Documented hierarchy tracking mechanism
- Documented execution engine integration
