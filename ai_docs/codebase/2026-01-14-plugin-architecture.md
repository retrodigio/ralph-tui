---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b9
branch: main
repository: ralph-tui
topic: "Plugin Architecture"
tags: [plugins, agents, trackers, registry, extensibility, architecture]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Plugin Architecture

## Overview

Ralph TUI uses a plugin architecture to support multiple AI agents and task trackers. This design allows users to choose their preferred tools and extend the system with custom implementations. The architecture consists of two parallel plugin systems:

- **Agent Plugins**: Execute prompts via AI coding assistants (e.g., Claude Code, OpenCode)
- **Tracker Plugins**: Manage task lists and track progress (e.g., Beads, JSON files)

Both systems follow the same patterns: a base abstract class, a type system, a singleton registry, factory functions, and built-in implementations.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ralph TUI Core                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────┐      ┌──────────────────────┐        │
│  │   Agent Registry     │      │   Tracker Registry   │        │
│  │   (singleton)        │      │   (singleton)        │        │
│  └──────────┬───────────┘      └──────────┬───────────┘        │
│             │                              │                    │
│  ┌──────────▼───────────┐      ┌──────────▼───────────┐        │
│  │   BaseAgentPlugin    │      │  BaseTrackerPlugin   │        │
│  │   (abstract)         │      │  (abstract)          │        │
│  └──────────┬───────────┘      └──────────┬───────────┘        │
│             │                              │                    │
│  ┌──────────┴───────────┐      ┌──────────┴───────────┐        │
│  │   Built-in Agents    │      │  Built-in Trackers   │        │
│  │   ├── claude         │      │  ├── beads           │        │
│  │   └── opencode       │      │  ├── beads-bv        │        │
│  │                      │      │  └── json            │        │
│  └──────────────────────┘      └──────────────────────┘        │
│                                                                 │
│  ┌──────────────────────┐      ┌──────────────────────┐        │
│  │   User Plugins       │      │   User Plugins       │        │
│  │   ~/.config/ralph-   │      │   ~/.config/ralph-   │        │
│  │   tui/plugins/agents │      │   tui/plugins/       │        │
│  │                      │      │   trackers           │        │
│  └──────────────────────┘      └──────────────────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Agent Plugin System

#### Base Class: BaseAgentPlugin
**Location**: `src/plugins/agents/base.ts`

The abstract base class that all agent plugins must extend. It provides:

- Plugin metadata management via the `meta` property
- Configuration handling through `initialize(config)`
- Readiness checking via `isReady()`
- Setup questions for interactive configuration
- Abstract method `execute()` that subclasses must implement

```typescript
export abstract class BaseAgentPlugin {
  abstract readonly meta: AgentPluginMeta;
  protected config: Record<string, unknown> = {};
  protected ready: boolean = false;

  async initialize(config: Record<string, unknown>): Promise<void>;
  abstract execute(options: AgentExecuteOptions): Promise<AgentExecuteResult>;
  async isReady(): Promise<boolean>;
  getSetupQuestions(): SetupQuestion[];
  async validateSetup(answers: Record<string, unknown>): Promise<string | null>;
}
```

#### Types
**Location**: `src/plugins/agents/types.ts`

Key type definitions:

| Type | Purpose |
|------|---------|
| `AgentPluginMeta` | Plugin metadata (id, name, description, version, capabilities) |
| `AgentPluginConfig` | Runtime configuration for a plugin instance |
| `AgentPluginFactory` | Factory function signature for creating plugin instances |
| `AgentExecuteOptions` | Options passed to the execute method |
| `AgentExecuteResult` | Result returned from execute method |
| `SetupQuestion` | Interactive setup question definition |

**AgentPluginMeta** capabilities:
- `supportsStreaming`: Can stream output in real-time
- `supportsInterrupt`: Can be interrupted mid-execution
- `supportsFileContext`: Can receive file context for the prompt
- `defaultCommand`: The CLI command used to invoke the agent

#### Registry: AgentRegistry
**Location**: `src/plugins/agents/registry.ts`

A singleton registry that manages all agent plugins:

```typescript
class AgentRegistry {
  // Singleton access
  static getInstance(): AgentRegistry;

  // Plugin registration
  registerBuiltin(factory: AgentPluginFactory): void;
  register(factory: AgentPluginFactory): void;

  // Plugin discovery
  async initialize(): Promise<void>;  // Discovers user plugins

  // Plugin access
  hasPlugin(id: string): boolean;
  getPlugin(id: string): AgentPluginFactory | undefined;
  createInstance(id: string): BaseAgentPlugin | undefined;
  getRegisteredPlugins(): AgentPluginMeta[];
  isBuiltin(id: string): boolean;
}

// Convenience function
export function getAgentRegistry(): AgentRegistry;
```

#### Built-in Agent Plugins

##### Claude Agent
**Location**: `src/plugins/agents/builtin/claude.ts`

Integrates with Claude Code CLI (`claude` command):

```typescript
export class ClaudeAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI agent',
    version: '1.0.0',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    defaultCommand: 'claude',
  };

  // Executes via: claude --print --output-format stream-json
  // Parses JSONL output for structured results
  async execute(options: AgentExecuteOptions): Promise<AgentExecuteResult>;
}
```

Key features:
- JSONL output parsing for structured results
- Support for `--model` flag to specify model
- Streaming output with real-time updates
- Interruptible execution
- Exports `ClaudeJsonlMessage` type for parsing agent output

##### OpenCode Agent
**Location**: `src/plugins/agents/builtin/opencode.ts`

Integrates with OpenCode CLI (`opencode` command):

```typescript
export class OpenCodeAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode CLI agent for AI-assisted coding',
    version: '1.0.0',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    defaultCommand: 'opencode',
  };
}
```

#### Subagent Tracing
**Location**: `src/plugins/agents/tracing/`

A subsystem for tracking Claude Code subagent lifecycle events:

| File | Purpose |
|------|---------|
| `types.ts` | Event types (spawn, progress, complete, error) and state interfaces |
| `parser.ts` | `SubagentTraceParser` class for parsing JSONL and tracking subagent hierarchy |
| `index.ts` | Public exports |

The `SubagentTraceParser` processes Claude Code JSONL output to detect Task tool invocations and track subagent execution:

```typescript
const parser = new SubagentTraceParser({
  onEvent: (event) => console.log('Subagent event:', event)
});

parser.processMessage(jsonlMessage);
const states = parser.getActiveSubagents();
const summary = parser.getSummary();
```

### Tracker Plugin System

#### Base Class: BaseTrackerPlugin
**Location**: `src/plugins/trackers/base.ts`

The abstract base class for all tracker plugins:

```typescript
export abstract class BaseTrackerPlugin {
  abstract readonly meta: TrackerPluginMeta;
  protected config: Record<string, unknown> = {};
  protected ready: boolean = false;

  async initialize(config: Record<string, unknown>): Promise<void>;
  abstract getTasks(filter?: TaskFilter): Promise<TrackerTask[]>;
  abstract completeTask(id: string, reason?: string): Promise<TaskCompletionResult>;
  abstract updateTaskStatus(id: string, status: TrackerTaskStatus): Promise<TrackerTask | undefined>;

  // Optional methods with default implementations
  async getTask(id: string): Promise<TrackerTask | undefined>;
  async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined>;
  async getEpics(): Promise<TrackerTask[]>;
  async sync(): Promise<SyncResult>;
  async isComplete(filter?: TaskFilter): Promise<boolean>;

  // Helper for filtering tasks
  protected filterTasks(tasks: TrackerTask[], filter?: TaskFilter): TrackerTask[];
}
```

#### Types
**Location**: `src/plugins/trackers/types.ts`

Key type definitions:

| Type | Purpose |
|------|---------|
| `TrackerPluginMeta` | Plugin metadata with capability flags |
| `TrackerPluginConfig` | Runtime configuration for a plugin instance |
| `TrackerPluginFactory` | Factory function signature |
| `TrackerTask` | Unified task representation |
| `TrackerTaskStatus` | Status enum: open, in_progress, completed, cancelled, blocked |
| `TaskPriority` | Priority levels 0-4 (0 = highest) |
| `TaskFilter` | Filter options for querying tasks |
| `TaskCompletionResult` | Result of completing a task |
| `SyncResult` | Result of syncing with external system |
| `SetupQuestion` | Interactive setup question definition |

**TrackerPluginMeta** capabilities:
- `supportsBidirectionalSync`: Can sync changes both ways
- `supportsHierarchy`: Supports parent/child task relationships
- `supportsDependencies`: Supports task dependencies (blocks/depends-on)

#### Registry: TrackerRegistry
**Location**: `src/plugins/trackers/registry.ts`

A singleton registry managing all tracker plugins:

```typescript
class TrackerRegistry {
  static getInstance(): TrackerRegistry;

  registerBuiltin(factory: TrackerPluginFactory): void;
  register(factory: TrackerPluginFactory): void;
  async initialize(): Promise<void>;

  hasPlugin(id: string): boolean;
  getPlugin(id: string): TrackerPluginFactory | undefined;
  createInstance(id: string): BaseTrackerPlugin | undefined;
  getRegisteredPlugins(): TrackerPluginMeta[];
  isBuiltin(id: string): boolean;
}

export function getTrackerRegistry(): TrackerRegistry;
```

#### Built-in Tracker Plugins

##### Beads Tracker
**Location**: `src/plugins/trackers/builtin/beads.ts`

Integrates with the `bd` (beads) CLI for git-backed issue tracking:

```typescript
export class BeadsTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'beads',
    name: 'Beads Issue Tracker',
    description: 'Track issues using the bd (beads) CLI',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  // Configuration options
  private beadsDir: string = '.beads';
  private epicId: string = '';
  protected labels: string[] = [];
}
```

Key features:
- Full CRUD operations via `bd` commands with `--json` output
- Epic/parent filtering for scoped task views
- Label-based filtering
- Git synchronization via `bd sync`
- Status mapping between beads (open, in_progress, closed, cancelled) and TrackerTaskStatus

##### Beads-BV Tracker (Smart Mode)
**Location**: `src/plugins/trackers/builtin/beads-bv.ts`

Extends `BeadsTrackerPlugin` with graph-aware task selection using `bv`:

```typescript
export class BeadsBvTrackerPlugin extends BeadsTrackerPlugin {
  override readonly meta: TrackerPluginMeta = {
    id: 'beads-bv',
    name: 'Beads + Beads Viewer (Smart Mode)',
    description: 'Smart task selection using bv graph analysis (PageRank, critical path)',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };
}
```

Key features:
- Uses `bv --robot-triage` for dependency-aware task recommendations
- Caches task reasoning with scores and breakdown
- Falls back to base beads behavior if `bv` is unavailable
- Provides `TaskReasoning` interface with score breakdown (PageRank, betweenness, etc.)
- Auto-refreshes triage data after task completion

##### JSON Tracker
**Location**: `src/plugins/trackers/builtin/json.ts`

File-based tracking using `prd.json` format:

```typescript
export class JsonTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'json',
    name: 'JSON File Tracker',
    description: 'Track tasks in a local prd.json file',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: true,
    supportsDependencies: true,
  };
}
```

Key features:
- Reads/writes `prd.json` files with user stories
- Schema validation with helpful error messages via `PrdJsonSchemaError`
- File caching with TTL for performance
- Maps `passes: boolean` to completed/open status
- Supports acceptance criteria, labels, and dependencies

**prd.json Schema:**
```json
{
  "name": "Feature Name",
  "branchName": "feature/my-feature",
  "userStories": [
    {
      "id": "US-001",
      "title": "Story title",
      "description": "As a user, I want...",
      "acceptanceCriteria": ["Criterion 1"],
      "priority": 1,
      "passes": false,
      "dependsOn": []
    }
  ]
}
```

## Data Flow

### Plugin Initialization Flow

```
1. Application starts
   │
2. registerBuiltinAgents() / registerBuiltinTrackers()
   │  - Registers factory functions for built-in plugins
   │
3. registry.initialize()
   │  - Scans ~/.config/ralph-tui/plugins/agents/ or /trackers/
   │  - Loads and registers user plugins
   │
4. buildConfig(runtimeOptions)
   │  - Loads TOML config files (global + project)
   │  - Resolves which plugins to use
   │  - Returns RalphConfig with AgentPluginConfig + TrackerPluginConfig
   │
5. registry.createInstance(pluginId)
   │  - Creates plugin instance via factory
   │
6. plugin.initialize(config.options)
   │  - Plugin-specific initialization
   │  - Sets ready state
```

### Task Execution Flow

```
1. Tracker.getTasks(filter)
   │  - Query tasks from backend (bd, prd.json, etc.)
   │
2. Tracker.getNextTask(filter)
   │  - Select optimal task (beads-bv uses graph analysis)
   │
3. Build prompt with task context
   │
4. Agent.execute({ prompt, files, ... })
   │  - Spawn CLI process (claude, opencode)
   │  - Stream/collect output
   │  - Parse results
   │
5. Tracker.completeTask(id) or updateTaskStatus(id, status)
   │  - Update backend
   │
6. Tracker.sync() (if supported)
   │  - Synchronize with git/remote
```

## Configuration

### Configuration Files

Ralph TUI uses TOML configuration files at two levels:

1. **Global config**: `~/.config/ralph-tui/config.toml`
2. **Project config**: `.ralph-tui/config.toml` (overrides global)

### Plugin Configuration Schema

**Agent Plugin Configuration:**
```toml
[[agents]]
name = "my-claude"           # Unique name for this configuration
plugin = "claude"            # Plugin ID to use
default = true               # Make this the default agent
command = "claude"           # CLI command (optional override)
defaultFlags = ["--verbose"] # Default CLI flags
timeout = 300000             # Timeout in milliseconds

[agents.options]
# Plugin-specific options
model = "claude-sonnet-4-20250514"

[agents.rateLimitHandling]
enabled = true
maxRetries = 3
baseBackoffMs = 5000

fallbackAgents = ["opencode"]  # Agents to try on rate limit
```

**Tracker Plugin Configuration:**
```toml
[[trackers]]
name = "my-beads"            # Unique name
plugin = "beads-bv"          # Plugin ID
default = true               # Make this the default tracker

[trackers.options]
beadsDir = ".beads"          # Path to beads directory
labels = ["ralph"]           # Labels to filter by
```

**Shorthand Configuration:**
```toml
# Simpler alternative for common cases
agent = "claude"
tracker = "beads-bv"

[agentOptions]
model = "claude-sonnet-4-20250514"

[trackerOptions]
labels = ["ralph"]

fallbackAgents = ["opencode"]
```

### Runtime Options (CLI)

CLI flags override configuration file settings:

| Flag | Purpose |
|------|---------|
| `--agent <id>` | Override agent plugin |
| `--model <name>` | Override model for agent |
| `--tracker <id>` | Override tracker plugin |
| `--epic <id>` | Epic ID for beads trackers |
| `--prd <path>` | PRD file path for JSON tracker |

## Usage Examples

### Listing Plugins

```bash
# List all agent plugins
ralph-tui plugins agents

# List all tracker plugins
ralph-tui plugins trackers
```

### Running with Different Plugins

```bash
# Use Claude agent with beads-bv tracker (default)
ralph-tui run --epic my-epic-id

# Use JSON tracker
ralph-tui run --tracker json --prd ./tasks.json

# Override model
ralph-tui run --model claude-sonnet-4-20250514 --epic my-epic-id
```

## Integration Points

### Engine Integration

The execution engine (`src/engine/`) interacts with plugins via:

1. `buildConfig()` - Resolves plugin configuration
2. `registry.createInstance()` - Instantiates plugins
3. `plugin.initialize()` - Configures plugin instance
4. `tracker.getTasks()` / `tracker.getNextTask()` - Get work items
5. `agent.execute()` - Execute AI agent
6. `tracker.completeTask()` / `tracker.updateTaskStatus()` - Update progress

### CLI Integration

The `plugins` command (`src/commands/plugins.ts`) provides introspection:

```typescript
export async function listAgentPlugins(): Promise<AgentPluginInfo[]>;
export async function listTrackerPlugins(): Promise<TrackerPluginInfo[]>;
export async function printAgentPlugins(): Promise<void>;
export async function printTrackerPlugins(): Promise<void>;
```

## Extending with Custom Plugins

### Creating a Custom Agent Plugin

1. Create a file in `~/.config/ralph-tui/plugins/agents/my-agent.ts`:

```typescript
import { BaseAgentPlugin, AgentPluginMeta, AgentExecuteOptions, AgentExecuteResult } from 'ralph-tui';

export class MyAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'my-agent',
    name: 'My Custom Agent',
    description: 'Custom AI agent implementation',
    version: '1.0.0',
    supportsStreaming: true,
    supportsInterrupt: false,
    supportsFileContext: true,
    defaultCommand: 'my-agent-cli',
  };

  async execute(options: AgentExecuteOptions): Promise<AgentExecuteResult> {
    // Implementation: spawn CLI, handle output, return result
    const { prompt, files, onOutput } = options;

    // ... execute your agent ...

    return {
      success: true,
      output: 'Agent output',
      exitCode: 0,
    };
  }
}

// Export factory function (required)
export default function createMyAgent() {
  return new MyAgentPlugin();
}
```

2. The plugin will be auto-discovered on next run.

### Creating a Custom Tracker Plugin

1. Create a file in `~/.config/ralph-tui/plugins/trackers/my-tracker.ts`:

```typescript
import { BaseTrackerPlugin, TrackerPluginMeta, TrackerTask, TaskFilter, TaskCompletionResult, TrackerTaskStatus } from 'ralph-tui';

export class MyTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'my-tracker',
    name: 'My Custom Tracker',
    description: 'Custom task tracker implementation',
    version: '1.0.0',
    supportsBidirectionalSync: false,
    supportsHierarchy: true,
    supportsDependencies: false,
  };

  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    // Fetch tasks from your backend
    const tasks = await this.fetchFromBackend();
    return this.filterTasks(tasks, filter);
  }

  async completeTask(id: string, reason?: string): Promise<TaskCompletionResult> {
    // Mark task complete in your backend
    return { success: true, message: `Task ${id} completed` };
  }

  async updateTaskStatus(id: string, status: TrackerTaskStatus): Promise<TrackerTask | undefined> {
    // Update task status in your backend
    return this.getTask(id);
  }
}

// Export factory function (required)
export default function createMyTracker() {
  return new MyTrackerPlugin();
}
```

2. Configure in `config.toml`:

```toml
tracker = "my-tracker"

[trackerOptions]
# Your custom options
apiUrl = "https://api.example.com"
```

## Testing

### Plugin Discovery

Plugins are discovered during `registry.initialize()`:

1. Built-in plugins are pre-registered via `registerBuiltinAgents()` / `registerBuiltinTrackers()`
2. User plugins are scanned from `~/.config/ralph-tui/plugins/agents/` and `trackers/`
3. Each `.ts` or `.js` file is imported and its default export (factory function) is registered

### Verifying Plugin Availability

```typescript
const agentRegistry = getAgentRegistry();
const trackerRegistry = getTrackerRegistry();

// Check if plugin exists
agentRegistry.hasPlugin('claude');      // true
trackerRegistry.hasPlugin('beads-bv');  // true

// Get plugin metadata
const plugins = agentRegistry.getRegisteredPlugins();
// Returns: AgentPluginMeta[]
```

## Related Documentation

- Configuration system: `src/config/`
- Execution engine: `src/engine/`
- CLI commands: `src/commands/`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented agent plugins (claude, opencode)
- Documented tracker plugins (beads, beads-bv, json)
- Documented registry pattern and base classes
- Documented configuration system
- Added extension guide for custom plugins
