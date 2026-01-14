---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "CLI Commands"
tags: [cli, commands, argument-parsing, execution-flow, headless-mode]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# CLI Commands

## Overview

Ralph TUI provides a comprehensive command-line interface for managing AI-powered task execution. The CLI is implemented across multiple files in `src/commands/` with the main entry point in `src/cli.tsx`. The system supports 11 primary commands, each with its own argument parsing, execution flow, and help system.

## Architecture

### Entry Point

**Location**: `src/cli.tsx`

The CLI entry point is a Bun executable that:
1. Parses command-line arguments from `process.argv.slice(2)`
2. Routes to the appropriate command handler via `handleSubcommand()`
3. Defaults to the `run` command when no subcommand is provided
4. Displays help when invoked with `help`, `--help`, or `-h`

```typescript
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const handled = await handleSubcommand(args);
  if (handled) return;
  // No subcommand - default to 'run' command
  await executeRunCommand(args);
}
```

### Command Index

**Location**: `src/commands/index.ts`

Exports all command handlers and utilities:
- `executeRunCommand`, `parseRunArgs`, `printRunHelp`
- `executeResumeCommand`, `parseResumeArgs`, `printResumeHelp`
- `executeStatusCommand`, `printStatusHelp`
- `executeLogsCommand`, `parseLogsArgs`, `printLogsHelp`
- `executeSetupCommand`, `parseSetupArgs`, `printSetupHelp`
- `executeCreatePrdCommand`, `parseCreatePrdArgs`, `printCreatePrdHelp`
- `executeConvertCommand`, `parseConvertArgs`, `printConvertHelp`
- `executeConfigCommand`, `executeConfigShowCommand`, `printConfigHelp`
- `executeTemplateCommand`, `printTemplateHelp`
- `executeDocsCommand`, `parseDocsArgs`, `printDocsHelp`
- Plugin listing functions: `listTrackerPlugins`, `printTrackerPlugins`, `listAgentPlugins`, `printAgentPlugins`, `printPluginsHelp`

## Commands

### run

**Location**: `src/commands/run.tsx`
**Purpose**: Start Ralph execution with TUI or headless mode
**Aliases**: Default command (invoked when no subcommand given)

#### Argument Parsing

```typescript
interface ExtendedRuntimeOptions extends RuntimeOptions {
  noSetup?: boolean;
}

function parseRunArgs(args: string[]): ExtendedRuntimeOptions
```

| Argument | Type | Description |
|----------|------|-------------|
| `--epic <id>` | string | Epic ID for beads tracker |
| `--prd <path>` | string | PRD file path (auto-switches to json tracker) |
| `--agent <name>` | string | Override agent plugin (claude, opencode) |
| `--model <name>` | string | Override model (opus, sonnet) |
| `--tracker <name>` | string | Override tracker plugin (beads, beads-bv, json) |
| `--iterations <n>` | number | Maximum iterations (0 = unlimited) |
| `--delay <ms>` | number | Delay between iterations |
| `--cwd <path>` | string | Working directory |
| `--resume` | boolean | Resume existing session |
| `--force` | boolean | Force start even if locked |
| `--headless`, `--no-tui` | boolean | Run without TUI |
| `--no-setup` | boolean | Skip interactive setup |
| `--prompt <path>` | string | Custom prompt file |
| `--output-dir <path>` | string | Directory for iteration logs |
| `--progress-file <path>` | string | Progress file for cross-iteration context |
| `--notify` | boolean | Force enable desktop notifications |
| `--no-notify` | boolean | Force disable desktop notifications |

#### Execution Flow

1. **Check for help**: Display help if `--help` or `-h`
2. **Parse arguments**: Extract runtime options
3. **Project config check**: If no config exists and `--no-setup` not set, run setup wizard
4. **Initialize plugins**: Register built-in agents and trackers, discover user plugins
5. **Build configuration**: Merge CLI args, project config, and defaults
6. **Validate configuration**: Check for required settings
7. **Epic selection** (beads tracker): Show TUI for epic selection if none specified
8. **Stale session recovery**: Detect and recover from crashed sessions
9. **Session management**: Check for existing session, acquire lock
10. **Engine initialization**: Create ExecutionEngine, load tasks
11. **Run execution**: Either `runWithTui()` or `runHeadless()` based on options

#### Headless Mode

When `--headless` or `--no-tui` is specified:
- Structured log output format: `[timestamp] [level] [component] message`
- Components: progress, agent, engine, tracker, session, system
- Levels: INFO, WARN, ERROR, DEBUG
- Single Ctrl+C triggers graceful shutdown
- Double Ctrl+C within 1 second forces immediate exit
- Automatic task reset on interrupt

```typescript
async function runHeadless(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  notificationOptions?: NotificationRunOptions
): Promise<PersistedSessionState>
```

#### TUI Mode

When TUI is enabled (default):
- Interactive React-based UI using `@opentui/core` and `@opentui/react`
- Launches in "ready" state - user must press Enter or 's' to start
- Displays task list, progress, and agent output
- Supports interrupt dialog with Ctrl+C confirmation
- Remains open after completion for result review

```typescript
async function runWithTui(
  engine: ExecutionEngine,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  initialTasks: TrackerTask[],
  storedConfig?: StoredConfig,
  notificationOptions?: NotificationRunOptions
): Promise<PersistedSessionState>
```

---

### resume

**Location**: `src/commands/resume.tsx`
**Purpose**: Continue execution from a previously interrupted or paused session

#### Argument Parsing

```typescript
function parseResumeArgs(args: string[]): {
  cwd: string;
  headless: boolean;
  force: boolean;
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `--cwd <path>` | string | Working directory |
| `--headless` | boolean | Run without TUI |
| `--force` | boolean | Override stale lock |

#### Execution Flow

1. Check for help flag
2. Parse arguments
3. Verify session exists (`hasPersistedSession`)
4. Detect and recover stale sessions
5. Load persisted session state
6. Validate session is resumable (status: paused, running, or interrupted)
7. Check for lock conflicts
8. Initialize plugins
9. Build config from persisted state
10. Acquire lock
11. Update persisted state to running
12. Initialize and run engine

#### Session States

Sessions can be resumed if in these states:
- `paused`: Manually paused by user
- `running`: Crashed or interrupted unexpectedly
- `interrupted`: Stopped by signal (Ctrl+C)

Sessions cannot be resumed if:
- `completed`: All tasks finished
- `failed`: Execution failed with error

---

### status

**Location**: `src/commands/status.ts`
**Purpose**: Check session status (headless, for CI/scripts)

#### Argument Parsing

| Argument | Type | Description |
|----------|------|-------------|
| `--json` | boolean | Output in JSON format |
| `--cwd <path>` | string | Working directory |

#### Status Types

```typescript
type RalphStatus =
  | 'running'    // Active lock held by running process
  | 'paused'     // Session paused, resumable
  | 'completed'  // Session completed successfully
  | 'failed'     // Session failed
  | 'no-session'; // No session file exists
```

#### Exit Codes

| Code | Status |
|------|--------|
| 0 | completed (success) |
| 1 | running or paused (in progress) |
| 2 | failed or no-session (error state) |

#### JSON Output Structure

```typescript
interface StatusJsonOutput {
  status: RalphStatus;
  session?: {
    id: string;
    status: string;
    progress: { completed: number; total: number; percent: number };
    iteration: { current: number; max: number };
    elapsedSeconds: number;
    tracker: string;
    agent: string;
    model?: string;
    epicId?: string;
    prdPath?: string;
    startedAt: string;
    updatedAt: string;
    resumable: boolean;
  };
  lock?: {
    isLocked: boolean;
    isStale: boolean;
    pid?: number;
    hostname?: string;
  };
}
```

---

### logs

**Location**: `src/commands/logs.ts`
**Purpose**: View and manage iteration output logs

#### Argument Parsing

```typescript
interface LogsArgs {
  iteration?: number;
  taskId?: string;
  clean: boolean;
  keep: number;
  dryRun: boolean;
  cwd: string;
  verbose: boolean;
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `--iteration, -i <n>` | number | View specific iteration |
| `--task, -t <id>` | string | View iterations for a task ID |
| `--clean` | boolean | Clean up old logs |
| `--keep <n>` | number | Logs to keep when cleaning (default: 10) |
| `--dry-run` | boolean | Show what would be deleted |
| `--verbose, -v` | boolean | Show full output |
| `--cwd <path>` | string | Working directory |

#### Execution Flow

1. Parse arguments
2. Handle `--clean` operation if specified
3. Check if logs exist
4. If `--iteration` specified: display single iteration log
5. If `--task` specified: display all iterations for task
6. Default: list all logs with summary

#### Log Storage

Logs are stored in `.ralph-tui/iterations/` and include:
- Timestamp and duration
- Task ID and title
- Full agent stdout/stderr
- Completion status and outcome
- Metadata (agent plugin, model, epic ID)

---

### setup

**Location**: `src/commands/setup.ts`
**Purpose**: Run interactive project setup wizard
**Aliases**: `init`

#### Argument Parsing

```typescript
function parseSetupArgs(args: string[]): {
  force: boolean;
  cwd: string;
  help: boolean;
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `--force, -f` | boolean | Overwrite existing configuration |
| `--cwd <path>` | string | Working directory |
| `--help, -h` | boolean | Show help |

#### Execution Flow

1. Parse arguments
2. Check for help flag
3. Run `runSetupWizard()` from `src/setup/index.js`
4. Handle cancellation or errors

The setup wizard guides users through:
1. Selecting an issue tracker (beads, json, etc.)
2. Configuring tracker-specific options
3. Selecting an AI agent CLI (claude, opencode)
4. Setting iteration limits and auto-commit preferences

Configuration is saved to `.ralph-tui/config.toml`.

---

### create-prd

**Location**: `src/commands/create-prd.tsx`
**Purpose**: Create PRD with AI-powered conversation
**Aliases**: `prime`

#### Argument Parsing

```typescript
interface CreatePrdArgs {
  cwd?: string;
  output?: string;
  stories?: number;
  force?: boolean;
  agent?: string;
  timeout?: number;
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `--cwd, -C <path>` | string | Working directory |
| `--output, -o <dir>` | string | Output directory (default: ./tasks) |
| `--agent, -a <name>` | string | Agent plugin to use |
| `--timeout, -t <ms>` | number | Agent call timeout (default: 180000) |
| `--force, -f` | boolean | Overwrite existing files |

#### Execution Flow

1. Parse arguments
2. Verify setup is complete
3. Get configured agent
4. Launch TUI chat app (`PrdChatApp`)
5. AI guides conversation to gather requirements
6. Generate PRD markdown with user stories
7. Optionally create tracker tasks
8. Launch `ralph-tui run` with new tasks if tracker selected

---

### convert

**Location**: `src/commands/convert.ts`
**Purpose**: Convert PRD markdown to JSON or Beads format

#### Argument Parsing

```typescript
interface ConvertArgs {
  to: 'json' | 'beads';
  input: string;
  output?: string;
  branch?: string;
  labels?: string[];
  force?: boolean;
  verbose?: boolean;
}
```

| Argument | Type | Description |
|----------|------|-------------|
| `--to, -t <format>` | string | Target format: json, beads (required) |
| `<input-file>` | string | Input PRD markdown file |
| `--output, -o <path>` | string | Output file path (json format only) |
| `--branch, -b <name>` | string | Git branch name |
| `--labels, -l <labels>` | string | Comma-separated labels (beads only) |
| `--force, -f` | boolean | Overwrite without prompting |
| `--verbose, -v` | boolean | Show detailed output |

#### Execution Flow

**For JSON format:**
1. Parse markdown to extract user stories
2. Prompt for branch name if not provided
3. Validate output path
4. Convert to prd.json format
5. Validate against JSON schema
6. Write output file

**For Beads format:**
1. Check `bd` command availability
2. Create epic bead
3. Create child beads for each user story
4. Set up dependencies
5. Run `bd sync`

---

### config

**Location**: `src/commands/config.ts`
**Purpose**: Display merged configuration

#### Subcommands

| Command | Description |
|---------|-------------|
| `show` | Display merged configuration |
| `help` | Show help message |

#### Show Options

| Argument | Type | Description |
|----------|------|-------------|
| `--sources, -s` | boolean | Show configuration source files |
| `--toml, -t` | boolean | Output raw TOML |
| `--cwd <path>` | string | Working directory |

#### Configuration Sources

Configuration is merged from:
1. Global: `~/.config/ralph-tui/config.toml`
2. Project: `.ralph-tui/config.toml` (in project root or parent)
3. CLI flags (highest priority)

---

### template

**Location**: `src/commands/template.ts`
**Purpose**: Manage prompt templates

#### Subcommands

| Command | Description |
|---------|-------------|
| `show` | Display current template |
| `init` | Copy default template for customization |
| `init-prompts` | Initialize user prompt files |

#### Show Options

| Argument | Type | Description |
|----------|------|-------------|
| `--tracker <name>` | string | Template for specific tracker |
| `--custom <path>` | string | Custom template file path |

#### Init Options

| Argument | Type | Description |
|----------|------|-------------|
| `--tracker <name>` | string | Template for specific tracker |
| `--output <path>` | string | Output path (default: ./ralph-prompt.hbs) |
| `--force` | boolean | Overwrite existing file |

#### Template Variables

Available in all templates:
- Task: `{{taskId}}`, `{{taskTitle}}`, `{{taskDescription}}`, `{{acceptanceCriteria}}`
- Epic: `{{epicId}}`, `{{epicTitle}}`, `{{trackerName}}`
- Metadata: `{{labels}}`, `{{priority}}`, `{{status}}`, `{{type}}`
- Dependencies: `{{dependsOn}}`, `{{blocks}}`
- Context: `{{model}}`, `{{agentName}}`, `{{cwd}}`
- Time: `{{currentDate}}`, `{{currentTimestamp}}`

---

### plugins

**Location**: `src/commands/plugins.ts`
**Purpose**: List and inspect available plugins

#### Subcommands

| Command | Description |
|---------|-------------|
| `agents` | List available agent plugins |
| `trackers` | List available tracker plugins |

#### Execution Flow

1. Register built-in plugins
2. Initialize registry (discover user plugins)
3. List all registered plugins with metadata

#### Agent Plugin Info

```typescript
interface AgentPluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  defaultCommand: string;
  features: {
    streaming: boolean;
    interrupt: boolean;
    fileContext: boolean;
  };
}
```

#### Tracker Plugin Info

```typescript
interface TrackerPluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  features: {
    bidirectionalSync: boolean;
    hierarchy: boolean;
    dependencies: boolean;
  };
}
```

---

### docs

**Location**: `src/commands/docs.ts`
**Purpose**: Open documentation in browser

#### Argument Parsing

| Argument | Type | Description |
|----------|------|-------------|
| `<section>` | string | Documentation section |
| `--url, -u` | boolean | Print URL only |

#### Documentation Sections

| Section | Path |
|---------|------|
| (none) | `#readme` |
| quickstart | `#quick-start` |
| cli | `#cli-reference` |
| plugins | `#plugins` |
| templates | `#prompt-templates` |
| contributing | `/blob/main/CONTRIBUTING.md` |

#### Execution Flow

1. Parse arguments
2. Detect repository URL from git remote
3. Build documentation URL
4. Open in browser or print URL

## Headless Mode Support

### Commands with Headless Support

| Command | Headless Flag | Behavior |
|---------|---------------|----------|
| `run` | `--headless`, `--no-tui` | Structured log output, auto-start |
| `resume` | `--headless` | Structured log output |
| `status` | `--json` | JSON output with exit codes |
| `logs` | N/A | Always CLI output |
| `setup` | N/A | Always interactive |
| `create-prd` | N/A | Always TUI-based |
| `convert` | N/A | CLI with optional prompts |
| `config` | `--toml` | Machine-readable output |
| `template` | N/A | CLI output |
| `plugins` | N/A | CLI output |
| `docs` | `--url` | Print URL only |

### Structured Log Format (Headless Mode)

```
[timestamp] [level] [component] message
```

Example output:
```
[10:42:15] [INFO] [engine] Ralph started. Total tasks: 5
[10:42:15] [INFO] [progress] Iteration 1/10: Working on US-001 - Add login
[10:42:15] [INFO] [agent] Building prompt for task...
[10:42:30] [INFO] [progress] Iteration 1 finished. Task US-001: COMPLETED. Duration: 15s
```

## Data Flow

### Command Execution Pattern

1. **Entry**: `src/cli.tsx` receives arguments
2. **Routing**: `handleSubcommand()` dispatches to appropriate handler
3. **Parsing**: Each command has a `parseXxxArgs()` function
4. **Validation**: Arguments validated before execution
5. **Execution**: `executeXxxCommand()` performs the operation
6. **Output**: Results displayed via console or TUI

### Session Management Flow

```
run/resume command
    |
    v
checkSession() --> hasPersistedSession()
    |
    v
acquireLockWithPrompt()
    |
    v
createSession() / resumeSession()
    |
    v
ExecutionEngine.start()
    |
    v
savePersistedSession() (after each iteration)
    |
    v
endSession() / releaseLockNew()
```

## Related Documentation

- Engine execution: See execution engine documentation
- Session management: See session persistence documentation
- Plugin system: See plugins documentation
- Configuration: See configuration documentation

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented all 11 CLI commands
- Covered argument parsing, execution flow, and headless mode support
