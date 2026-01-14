---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Configuration System"
tags: [config, toml, zod, validation, schema, merging, runtime, agents, trackers, setup]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Configuration System

## Overview

The Ralph TUI configuration system provides a layered configuration approach that supports both global user preferences and project-specific overrides. Configuration files use TOML format and are validated at runtime using Zod schemas. The system handles loading, parsing, validating, merging, and building the final runtime configuration from multiple sources including CLI flags.

## Architecture

The configuration system follows a hierarchical override pattern:

```
Defaults → Global Config → Project Config → CLI Options
```

Each layer can override values from previous layers, with CLI options having the highest precedence.

### Core Design Principles

1. **TOML Format**: Uses `smol-toml` for parsing/serializing human-readable configuration files
2. **Schema Validation**: Zod schemas provide type-safe validation with descriptive error messages
3. **Layered Merging**: Global config sets defaults, project config overrides for project-specific needs
4. **Plugin Architecture**: Agent and tracker configurations are resolved through plugin registries
5. **Shorthand Support**: Common settings can use simplified syntax alongside detailed configurations

## Components

### Main Configuration Module

**Location**: `src/config/index.ts`
**Purpose**: Central module for loading, merging, validating, and building runtime configuration

The module exports:
- `loadStoredConfig()` - Loads and merges global + project configs
- `loadStoredConfigWithSource()` - Same as above but includes source metadata
- `buildConfig()` - Builds complete runtime config from stored config + CLI options
- `validateConfig()` - Validates the final runtime configuration
- `saveProjectConfig()` - Persists config to project directory
- `checkSetupStatus()` - Checks if setup has been completed
- `requireSetup()` - Guards commands that need configuration

### Schema Validation Module

**Location**: `src/config/schema.ts`
**Purpose**: Zod schemas for validating configuration structure and types

Key schemas:
- `StoredConfigSchema` - Main configuration file schema
- `AgentPluginConfigSchema` - Agent plugin configuration
- `TrackerPluginConfigSchema` - Tracker plugin configuration
- `ErrorHandlingConfigSchema` - Error handling settings
- `RateLimitHandlingConfigSchema` - Rate limit handling settings
- `NotificationsConfigSchema` - Notification settings

### Type Definitions

**Location**: `src/config/types.ts`
**Purpose**: TypeScript interfaces and default values for configuration

Key types:
- `StoredConfig` - Structure of TOML config files
- `RalphConfig` - Complete runtime configuration
- `RuntimeOptions` - CLI-provided options
- `ConfigValidationResult` - Validation result structure

## Configuration Files

### Global Configuration

**Path**: `~/.config/ralph-tui/config.toml`

The global configuration file stores user-wide defaults that apply across all projects. This is ideal for:
- Default agent preferences (e.g., always use Claude)
- Personal notification settings
- Default error handling behavior
- Fallback agent configurations

### Project Configuration

**Path**: `.ralph-tui/config.toml` (searched upward from cwd)

Project-specific configuration that overrides global settings. Located in a `.ralph-tui` directory at the project root or any parent directory. The search algorithm:

1. Start at current working directory
2. Look for `.ralph-tui/config.toml`
3. If not found, move to parent directory
4. Repeat until found or filesystem root reached

## Schema Validation with Zod

### StoredConfigSchema

The main schema validates all configuration file fields:

```typescript
export const StoredConfigSchema = z
  .object({
    // Default selections
    defaultAgent: z.string().optional(),
    defaultTracker: z.string().optional(),

    // Core settings
    maxIterations: z.number().int().min(0).max(1000).optional(),
    iterationDelay: z.number().int().min(0).max(300000).optional(),
    outputDir: z.string().optional(),
    autoCommit: z.boolean().optional(),

    // Plugin configurations
    agents: z.array(AgentPluginConfigSchema).optional(),
    trackers: z.array(TrackerPluginConfigSchema).optional(),

    // Shorthand fields
    agent: z.string().optional(),
    agentOptions: AgentOptionsSchema.optional(),
    tracker: z.string().optional(),
    trackerOptions: TrackerOptionsSchema.optional(),

    // Error handling
    errorHandling: ErrorHandlingConfigSchema.optional(),

    // Fallback and rate limiting
    fallbackAgents: z.array(z.string().min(1)).optional(),
    rateLimitHandling: RateLimitHandlingConfigSchema.optional(),

    // Other settings
    prompt_template: z.string().optional(),
    subagentTracingDetail: SubagentDetailLevelSchema.optional(),
    notifications: NotificationsConfigSchema.optional(),
  })
  .strict();
```

### Error Handling Schema

```typescript
export const ErrorHandlingConfigSchema = z.object({
  strategy: z.enum(['retry', 'skip', 'abort']).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(300000).optional(),
  continueOnNonZeroExit: z.boolean().optional(),
});
```

### Agent Plugin Config Schema

```typescript
export const AgentPluginConfigSchema = z.object({
  name: z.string().min(1, 'Agent name is required'),
  plugin: z.string().min(1, 'Agent plugin type is required'),
  default: z.boolean().optional(),
  command: z.string().optional(),
  defaultFlags: z.array(z.string()).optional(),
  timeout: z.number().int().min(0).optional(),
  options: AgentOptionsSchema.optional().default({}),
  fallbackAgents: z.array(z.string().min(1)).optional(),
  rateLimitHandling: RateLimitHandlingConfigSchema.optional(),
});
```

### Validation Function

```typescript
export function validateStoredConfig(config: unknown): ConfigParseResult {
  const result = StoredConfigSchema.safeParse(config);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors into friendly messages
  const errors: ConfigValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return { success: false, errors };
}
```

### Error Formatting

```typescript
export function formatConfigErrors(
  errors: ConfigValidationError[],
  configPath: string
): string {
  const lines = [`Configuration error in ${configPath}:`];
  for (const error of errors) {
    lines.push(`  - ${error.path}: ${error.message}`);
  }
  return lines.join('\n');
}
```

## Config Merging Strategy

### Merge Function

The `mergeConfigs()` function combines global and project configurations:

```typescript
function mergeConfigs(global: StoredConfig, project: StoredConfig): StoredConfig {
  const merged: StoredConfig = { ...global };

  // Override scalar values from project
  if (project.defaultAgent !== undefined) merged.defaultAgent = project.defaultAgent;
  if (project.defaultTracker !== undefined) merged.defaultTracker = project.defaultTracker;
  if (project.maxIterations !== undefined) merged.maxIterations = project.maxIterations;
  // ... more scalar overrides

  // Replace arrays entirely if present in project config
  if (project.agents !== undefined) merged.agents = project.agents;
  if (project.trackers !== undefined) merged.trackers = project.trackers;
  if (project.fallbackAgents !== undefined) merged.fallbackAgents = project.fallbackAgents;

  // Merge nested objects (shallow merge)
  if (project.agentOptions !== undefined) {
    merged.agentOptions = { ...merged.agentOptions, ...project.agentOptions };
  }
  if (project.trackerOptions !== undefined) {
    merged.trackerOptions = { ...merged.trackerOptions, ...project.trackerOptions };
  }
  if (project.errorHandling !== undefined) {
    merged.errorHandling = { ...merged.errorHandling, ...project.errorHandling };
  }

  return merged;
}
```

### Merge Rules

| Field Type | Behavior |
|------------|----------|
| Scalar values | Project overrides global |
| Arrays | Project replaces global entirely |
| Nested objects | Shallow merge (project keys override global keys) |
| Undefined values | Inherited from global |

## Runtime Options

The `RuntimeOptions` interface defines CLI-provided overrides:

```typescript
export interface RuntimeOptions {
  agent?: string;           // Override agent plugin
  model?: string;           // Override model for agent
  tracker?: string;         // Override tracker plugin
  epicId?: string;          // Epic ID for beads trackers
  prdPath?: string;         // PRD file path for JSON tracker
  iterations?: number;      // Maximum iterations
  iterationDelay?: number;  // Delay between iterations
  cwd?: string;             // Working directory
  resume?: boolean;         // Resume existing session
  force?: boolean;          // Force start
  headless?: boolean;       // Run without TUI
  onError?: ErrorHandlingStrategy;  // Error handling override
  maxRetries?: number;      // Max retries override
  promptPath?: string;      // Custom prompt file path
  outputDir?: string;       // Output directory override
  progressFile?: string;    // Progress file path
  notify?: boolean;         // Notifications override
}
```

## Agent Config Resolution

The `getDefaultAgentConfig()` function resolves which agent to use:

### Resolution Priority

1. **CLI `--agent` flag** - Highest priority
2. **Config `agent` shorthand** - e.g., `agent = "claude"`
3. **Config `defaultAgent`** - Named reference to agents array
4. **First agent in `agents` array with `default = true`**
5. **First agent in `agents` array**
6. **First built-in plugin** (fallback to "claude")

### Shorthand Application

Agent options from shorthand fields are automatically applied:

```typescript
const applyAgentOptions = (config: AgentPluginConfig): AgentPluginConfig => {
  let result = config;

  // Apply agentOptions shorthand
  if (storedConfig.agentOptions) {
    result = {
      ...result,
      options: { ...result.options, ...storedConfig.agentOptions },
    };
  }

  // Apply fallbackAgents shorthand (only if not set on agent)
  if (storedConfig.fallbackAgents && !result.fallbackAgents) {
    result = { ...result, fallbackAgents: storedConfig.fallbackAgents };
  }

  // Apply rateLimitHandling shorthand
  if (storedConfig.rateLimitHandling && !result.rateLimitHandling) {
    result = { ...result, rateLimitHandling: storedConfig.rateLimitHandling };
  }

  return result;
};
```

## Tracker Config Resolution

The `getDefaultTrackerConfig()` function follows similar resolution:

### Resolution Priority

1. **CLI `--tracker` flag** - Highest priority
2. **Config `tracker` shorthand** - e.g., `tracker = "beads-bv"`
3. **Config `defaultTracker`** - Named reference to trackers array
4. **First tracker in `trackers` array with `default = true`**
5. **First tracker in `trackers` array**
6. **First built-in plugin** (fallback to "beads-bv")

### Automatic Tracker Switching

When `--prd` is specified without explicit `--tracker`, the system auto-switches to the JSON tracker:

```typescript
if (options.prdPath && !options.tracker) {
  const registry = getTrackerRegistry();
  if (registry.hasPlugin('json')) {
    trackerConfig = {
      name: 'json',
      plugin: 'json',
      options: {},
    };
  }
}
```

## Setup Status Checking

### SetupCheckResult Interface

```typescript
export interface SetupCheckResult {
  ready: boolean;           // Whether setup is complete
  configExists: boolean;    // Whether any config file exists
  agentConfigured: boolean; // Whether an agent is configured
  configPath: string | null; // Path to config found
  message?: string;         // Human-readable status message
}
```

### checkSetupStatus Function

Verifies configuration completeness:

```typescript
export async function checkSetupStatus(
  cwd: string = process.cwd()
): Promise<SetupCheckResult> {
  const { config, source } = await loadStoredConfigWithSource(cwd);

  const configExists = source.globalLoaded || source.projectLoaded;
  const configPath = source.projectPath || source.globalPath;
  const agentConfigured = !!(config.agent || config.defaultAgent);

  if (!configExists) {
    return {
      ready: false,
      configExists: false,
      agentConfigured: false,
      configPath: null,
      message: 'No configuration found. Run "ralph-tui setup" to configure.',
    };
  }

  if (!agentConfigured) {
    return {
      ready: false,
      configExists: true,
      agentConfigured: false,
      configPath,
      message: 'No agent configured. Run "ralph-tui setup" to configure an agent.',
    };
  }

  return {
    ready: true,
    configExists: true,
    agentConfigured: true,
    configPath,
  };
}
```

### requireSetup Function

Guards commands that need configuration:

```typescript
export async function requireSetup(
  cwd: string = process.cwd(),
  commandName: string = 'This command'
): Promise<void> {
  const status = await checkSetupStatus(cwd);

  if (!status.ready) {
    console.error(`${commandName} requires ralph-tui to be configured.`);
    if (status.message) {
      console.error(`  ${status.message}`);
    }
    console.error('Quick setup:');
    console.error('  ralph-tui setup');
    process.exit(1);
  }
}
```

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐
│  Global Config  │     │  Project Config │
│  (~/.config/    │     │ (.ralph-tui/    │
│   ralph-tui/    │     │  config.toml)   │
│   config.toml)  │     │                 │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │    loadConfigFile()   │
         ▼                       ▼
    ┌────────────────────────────────────┐
    │         validateStoredConfig()      │
    │           (Zod validation)          │
    └────────────────┬───────────────────┘
                     │
                     ▼
    ┌────────────────────────────────────┐
    │            mergeConfigs()           │
    │     (project overrides global)      │
    └────────────────┬───────────────────┘
                     │
                     ▼
    ┌────────────────────────────────────┐
    │           StoredConfig              │
    └────────────────┬───────────────────┘
                     │
    ┌────────────────┴───────────────────┐
    │                                     │
    ▼                                     ▼
┌──────────────┐               ┌──────────────┐
│ RuntimeOptions│              │  Plugin      │
│ (CLI flags)   │              │  Registries  │
└──────┬───────┘               └──────┬───────┘
       │                              │
       └──────────────┬───────────────┘
                      │
                      ▼
         ┌────────────────────────┐
         │      buildConfig()      │
         │   (resolve agents,      │
         │    trackers, apply      │
         │    CLI overrides)       │
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │     validateConfig()    │
         │   (runtime validation)  │
         └───────────┬────────────┘
                     │
                     ▼
         ┌────────────────────────┐
         │      RalphConfig        │
         │  (final runtime config) │
         └────────────────────────┘
```

## Configuration Examples

### Minimal Project Config

```toml
# .ralph-tui/config.toml
agent = "claude"
tracker = "beads-bv"
```

### Full Configuration Example

```toml
# .ralph-tui/config.toml
defaultAgent = "claude"
defaultTracker = "beads"
maxIterations = 20
iterationDelay = 2000
autoCommit = true
outputDir = ".ralph-tui/iterations"
progressFile = ".ralph-tui/progress.md"
prompt_template = ".ralph-tui/prompt.md"
subagentTracingDetail = "moderate"

# Shorthand agent options
agentOptions = { model = "opus" }

# Fallback agents for rate limiting
fallbackAgents = ["opencode", "cursor"]

# Rate limit handling
[rateLimitHandling]
enabled = true
maxRetries = 3
baseBackoffMs = 5000
recoverPrimaryBetweenIterations = true

# Error handling
[errorHandling]
strategy = "skip"
maxRetries = 3
retryDelayMs = 5000
continueOnNonZeroExit = false

# Notifications
[notifications]
enabled = true
sound = "off"

# Agent configurations (detailed format)
[[agents]]
name = "claude"
plugin = "claude"
default = true
options = { model = "opus" }
fallbackAgents = ["opencode"]

[[agents]]
name = "opencode"
plugin = "opencode"
options = {}

# Tracker configurations
[[trackers]]
name = "beads"
plugin = "beads-bv"
default = true
options = {}
```

## Default Values

```typescript
export const DEFAULT_ERROR_HANDLING: ErrorHandlingConfig = {
  strategy: 'skip',
  maxRetries: 3,
  retryDelayMs: 5000,
  continueOnNonZeroExit: false,
};

export const DEFAULT_CONFIG: Omit<RalphConfig, 'agent' | 'tracker'> = {
  maxIterations: 10,
  iterationDelay: 1000,
  cwd: process.cwd(),
  outputDir: '.ralph-tui/iterations',
  progressFile: '.ralph-tui/progress.md',
  showTui: true,
  errorHandling: DEFAULT_ERROR_HANDLING,
};

export const DEFAULT_RATE_LIMIT_HANDLING: Required<RateLimitHandlingConfig> = {
  enabled: true,
  maxRetries: 3,
  baseBackoffMs: 5000,
  recoverPrimaryBetweenIterations: true,
};
```

## Integration Points

### Setup Wizard

**Location**: `src/setup/wizard.ts`

The setup wizard uses the configuration system to:
- Detect available plugins via registries
- Collect user preferences through interactive prompts
- Save configuration via `saveProjectConfig()`

### Execution Engine

**Location**: `src/engine/index.ts`

The engine receives `RalphConfig` from `buildConfig()` and uses it to:
- Initialize agent and tracker plugins
- Configure error handling behavior
- Set up rate limit handling with fallback agents
- Control iteration limits and delays

### Config Show Command

**Location**: `src/commands/config.ts`

The `config show` command uses:
- `loadStoredConfigWithSource()` to display merged config with source info
- `serializeConfig()` to output TOML format

## Related Documentation

- Plugin System: Agent and tracker plugin architectures
- Setup Wizard: Interactive configuration setup
- Execution Engine: How config drives the agent loop

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented TOML file loading (global and project configs)
- Documented schema validation with Zod
- Documented config merging strategy
- Documented runtime options and agent/tracker config resolution
- Documented setup status checking
