---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Interactive Setup Wizard"
tags: [setup, wizard, configuration, plugins, prompts, first-time-user, skill-installer]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Interactive Setup Wizard

## Overview

The Interactive Setup Wizard is Ralph TUI's guided configuration system for first-time users. When a user runs Ralph TUI in a project without an existing `.ralph-tui/config.toml` configuration file, the wizard automatically launches to collect necessary settings for tracker plugins, agent plugins, iteration limits, and optional AI skills.

The setup system is implemented across five files in the `src/setup/` directory:

| File | Purpose |
|------|---------|
| `wizard.ts` | Main wizard orchestration, plugin detection, configuration generation |
| `prompts.ts` | Terminal input utilities with styled prompts (text, select, boolean, number, path) |
| `skill-installer.ts` | AI skill installation to `~/.claude/skills/` |
| `types.ts` | TypeScript type definitions for setup state and answers |
| `index.ts` | Module exports and public API |

## Architecture

### Module Structure

```
src/setup/
  index.ts          # Public exports (types + functions)
  types.ts          # SetupAnswers, SetupResult, SetupOptions, PluginDetection, etc.
  wizard.ts         # runSetupWizard(), checkAndRunSetup(), projectConfigExists()
  prompts.ts        # promptText(), promptSelect(), promptBoolean(), promptNumber(), etc.
  skill-installer.ts # installSkill(), listBundledSkills(), isSkillInstalled()
```

### Data Flow

```
User runs "ralph-tui run"
         |
         v
checkAndRunSetup() called
         |
         v
projectConfigExists() checks for .ralph-tui/config.toml
         |
    +----+----+
    |         |
 exists    missing
    |         |
    v         v
 return    runSetupWizard()
 null           |
                v
        detectTrackerPlugins() -> registry.getRegisteredPlugins()
                |
                v
        promptSelect() for tracker choice
                |
                v
        collectTrackerOptions() via getSetupQuestions()
                |
                v
        detectAgentPlugins() -> registry.getRegisteredPlugins()
                |
                v
        promptSelect() for agent choice
                |
                v
        promptNumber() for maxIterations
        promptBoolean() for autoCommit
                |
                v
        listBundledSkills() -> skills/*/SKILL.md
                |
                v
        installSkill() for each approved skill
                |
                v
        saveConfig() writes .ralph-tui/config.toml
                |
                v
        return SetupResult
```

## Components

### wizard.ts - Main Wizard Orchestration

**Location**: `src/setup/wizard.ts`

**Purpose**: Orchestrates the entire setup flow, from detecting available plugins to saving the final configuration file.

#### Key Functions

##### `projectConfigExists(cwd?: string): Promise<boolean>`

Checks whether a configuration file already exists at `.ralph-tui/config.toml` in the specified working directory.

```typescript
const configPath = join(cwd, '.ralph-tui', 'config.toml');
await access(configPath, constants.R_OK);
```

##### `detectTrackerPlugins(): Promise<PluginDetection[]>`

Discovers all registered tracker plugins by:
1. Getting the tracker registry singleton via `getTrackerRegistry()`
2. Registering built-in trackers via `registerBuiltinTrackers()`
3. Initializing the registry (loads user plugins)
4. Iterating over registered plugins to build detection results

Returns an array of `PluginDetection` objects containing:
- `id`: Plugin identifier (e.g., "beads", "json", "beads-bv")
- `name`: Human-readable name
- `description`: Short description
- `available`: Always `true` for trackers (no runtime detection needed)
- `version`: Plugin version

##### `detectAgentPlugins(): Promise<PluginDetection[]>`

Discovers agent plugins with CLI availability detection:
1. Gets the agent registry singleton
2. Registers built-in agents
3. For each plugin, calls `instance.detect()` to check if the CLI is installed
4. Returns detection results with `available` reflecting actual CLI presence

For agents, the `detect()` method checks if the agent CLI executable exists in the system PATH (e.g., `claude` for Claude Code, `opencode` for OpenCode).

##### `collectTrackerOptions(trackerId: string): Promise<Record<string, unknown>>`

Collects tracker-specific configuration options:
1. Creates a plugin instance
2. Calls `instance.getSetupQuestions()` to get plugin-defined questions
3. Presents each question using the appropriate prompt utility
4. Returns a map of option ID to user-provided value

##### `saveConfig(answers: SetupAnswers, cwd: string): Promise<string>`

Writes the collected configuration to disk:
1. Creates `.ralph-tui/` directory if it doesn't exist
2. Builds a `StoredConfig` object from answers
3. Serializes to TOML using `smol-toml`
4. Adds a header comment
5. Writes to `.ralph-tui/config.toml`

Generated configuration example:
```toml
# Ralph TUI Configuration
# Generated by setup wizard
# See: ralph-tui config help

tracker = "beads"
agent = "claude"
maxIterations = 10
autoCommit = false

[trackerOptions]
epicId = "EPIC-123"
```

##### `runSetupWizard(options?: SetupOptions): Promise<SetupResult>`

The main entry point for the interactive wizard. Executes the following steps:

**Step 1: Pre-flight checks**
- Verify config doesn't already exist (unless `force: true`)
- Print welcome banner

**Step 2: Tracker Selection**
- Display available trackers with `promptSelect()`
- Collect tracker-specific options via `collectTrackerOptions()`

**Step 3: Agent Selection**
- Display available agents with availability indicators
- Auto-detect and highlight available agents
- Collect agent selection

**Step 4: Iteration Settings**
- Prompt for `maxIterations` (default: 10, range: 0-1000)
- Prompt for `autoCommit` preference (default: false)

**Step 5: Skills Installation**
- List bundled skills from `skills/` directory
- For each skill, prompt to install/update
- Install selected skills to `~/.claude/skills/`

**Step 6: Save and Complete**
- Save configuration
- Print success message with next steps

##### `checkAndRunSetup(options?: SetupOptions & { skipSetup?: boolean }): Promise<SetupResult | null>`

Convenience function for first-time user detection:
- Returns `null` if configuration exists (no setup needed)
- Returns `null` with info message if `skipSetup: true`
- Otherwise runs `runSetupWizard()`

### prompts.ts - Terminal Input Utilities

**Location**: `src/setup/prompts.ts`

**Purpose**: Provides styled, cross-platform terminal prompts using Node.js readline.

#### ANSI Color Scheme

```typescript
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',    // Question marks, numbers
  green: '\x1b[32m',   // Success indicators
  yellow: '\x1b[33m',  // Required field markers, warnings
  blue: '\x1b[34m',    // Info messages
  magenta: '\x1b[35m', // Section headers
};
```

#### Prompt Functions

##### `promptText(prompt, options): Promise<string>`

Text input with validation support.

**Options**:
- `default`: Default value if empty
- `required`: Whether input is required
- `pattern`: Regex pattern for validation
- `help`: Help text displayed above prompt

**Behavior**: Recursively reprompts on validation failure.

##### `promptBoolean(prompt, options): Promise<boolean>`

Yes/no input with intelligent defaults.

**Display**: Shows `(Y/n)` or `(y/N)` based on default value.

**Accepted inputs**: `y`, `yes`, `n`, `no` (case-insensitive)

##### `promptSelect<T>(prompt, choices, options): Promise<T>`

Numbered list selection.

**Display format**:
```
? Which issue tracker do you want to use?*

  > 1) Beads Tracker (recommended)
    2) JSON Tracker Simple file-based tracker
    3) Beads-BV BV-enhanced beads tracker

  Enter number (1-3) (default: Beads Tracker):
```

**Features**:
- Highlights default option with `>`
- Shows descriptions in dim text
- Validates numeric input range

##### `promptNumber(prompt, options): Promise<number>`

Numeric input with range validation.

**Options**:
- `min`: Minimum allowed value
- `max`: Maximum allowed value
- `default`: Default value

##### `promptPath(prompt, options): Promise<string>`

Path input (wrapper around `promptText` with path-specific help).

##### `promptQuestion(question: AnySetupQuestion): Promise<unknown>`

Universal dispatcher for plugin-defined setup questions. Routes to the appropriate prompt function based on `question.type`:

| Type | Handler |
|------|---------|
| `text`, `password` | `promptText()` |
| `boolean` | `promptBoolean()` |
| `select` | `promptSelect()` |
| `multiselect` | `promptSelect()` (single selection fallback) |
| `path` | `promptPath()` |

#### Output Functions

##### `printSection(title: string): void`

Prints a magenta section header with decorative line:
```
━━━ Issue Tracker Selection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

##### `printSuccess(message: string): void`

Prints green checkmark with message: `[check] Configuration saved`

##### `printError(message: string): void`

Prints yellow X with message: `[x] Failed to install skill`

##### `printInfo(message: string): void`

Prints blue info icon with message: `[i] Press Ctrl+C to cancel`

### skill-installer.ts - AI Skill Installation

**Location**: `src/setup/skill-installer.ts`

**Purpose**: Installs bundled AI skills from the ralph-tui package to the user's Claude Code skills directory.

#### Directory Paths

- **Source**: `<ralph-tui-root>/skills/` (bundled with package)
- **Target**: `~/.claude/skills/` (user's Claude Code installation)

#### Functions

##### `getClaudeSkillsDir(): string`

Returns the target installation directory: `~/.claude/skills/`

##### `getBundledSkillsDir(): string`

Returns the source skills directory relative to the package installation. Uses `import.meta.url` to derive the path.

##### `listBundledSkills(): Promise<SkillInfo[]>`

Discovers available skills by:
1. Reading the bundled skills directory
2. For each subdirectory containing `SKILL.md`
3. Extracting the description from YAML frontmatter
4. Returning skill metadata

**Returns**: Array of `SkillInfo` objects:
```typescript
interface SkillInfo {
  name: string;        // Directory name (e.g., "ralph-tui-prd")
  description: string; // From SKILL.md frontmatter
  sourcePath: string;  // Full path to skill directory
}
```

##### `isSkillInstalled(skillName: string): Promise<boolean>`

Checks if a skill directory exists at `~/.claude/skills/<skillName>`.

##### `installSkill(skillName: string, options?): Promise<SkillInstallResult>`

Installs a single skill:
1. Verify source SKILL.md exists
2. Check if already installed (skip unless `force: true`)
3. Create target directory
4. Copy SKILL.md to target

**Returns**: `SkillInstallResult` with:
- `success`: Whether installation succeeded
- `path`: Installation path
- `skipped`: Whether skipped due to existing installation
- `error`: Error message if failed

##### `installAllSkills(options?): Promise<Map<string, SkillInstallResult>>`

Installs all bundled skills, returning a map of skill name to result.

#### Bundled Skills

The ralph-tui package includes these skills:

| Skill | Description |
|-------|-------------|
| `ralph-tui-prd` | PRD (Product Requirements Document) skill |
| `ralph-tui-create-beads` | Creates beads tracker configuration |
| `ralph-tui-create-json` | Creates JSON tracker configuration |

### types.ts - Type Definitions

**Location**: `src/setup/types.ts`

**Purpose**: Defines TypeScript interfaces for setup state, answers, results, and options.

#### Core Types

##### `AnySetupQuestion`

Union type combining tracker and agent setup questions:
```typescript
type AnySetupQuestion = SetupQuestion | AgentSetupQuestion;
```

##### `SetupWizardState`

Tracks wizard progress:
```typescript
interface SetupWizardState {
  currentStep: number;
  totalSteps: number;
  answers: SetupAnswers;
  complete: boolean;
  error?: string;
}
```

##### `SetupAnswers`

Collected configuration values:
```typescript
interface SetupAnswers {
  tracker: string;                    // Plugin ID
  trackerOptions: Record<string, unknown>;
  agent: string;                      // Plugin ID
  agentOptions: Record<string, unknown>;
  maxIterations: number;
  autoCommit: boolean;
}
```

##### `SetupResult`

Return value from `runSetupWizard()`:
```typescript
interface SetupResult {
  success: boolean;
  answers?: SetupAnswers;
  configPath?: string;
  error?: string;
  cancelled?: boolean;
}
```

##### `SetupOptions`

Options for wizard execution:
```typescript
interface SetupOptions {
  cwd?: string;        // Working directory
  force?: boolean;     // Overwrite existing config
  useDefaults?: boolean; // Skip prompts
}
```

##### `PluginDetection`

Plugin availability information:
```typescript
interface PluginDetection {
  id: string;
  name: string;
  description: string;
  available: boolean;
  version?: string;
  error?: string;
}
```

### index.ts - Module Exports

**Location**: `src/setup/index.ts`

**Purpose**: Provides the public API for the setup module.

**Exports**:
- All types from `types.ts`
- `runSetupWizard`, `checkAndRunSetup`, `projectConfigExists` from `wizard.ts`
- All prompt functions and print utilities from `prompts.ts`

## Data Flow

### First-Time User Flow

```
1. User executes: ralph-tui run
                     |
2. Main entry point calls checkAndRunSetup()
                     |
3. projectConfigExists() checks .ralph-tui/config.toml
                     |
                  missing
                     |
4. runSetupWizard() starts
                     |
5. Print welcome banner
   "Ralph TUI Setup Wizard"
                     |
6. detectTrackerPlugins()
   - getTrackerRegistry()
   - registerBuiltinTrackers()
   - registry.initialize()
   - Return [beads, json, beads-bv]
                     |
7. promptSelect("Which issue tracker?")
   User selects: beads
                     |
8. collectTrackerOptions("beads")
   - Create beads plugin instance
   - getSetupQuestions() returns [epicId question]
   - promptQuestion() for each
   - Return {epicId: "EPIC-123"}
                     |
9. detectAgentPlugins()
   - getAgentRegistry()
   - registerBuiltinAgents()
   - For each: instance.detect()
   - Return [{claude, available: true}, {opencode, available: false}]
                     |
10. promptSelect("Which agent CLI?")
    Auto-selects: claude (detected)
                     |
11. promptNumber("Maximum iterations?")
    User enters: 10
                     |
12. promptBoolean("Auto-commit?")
    User enters: n
                     |
13. listBundledSkills()
    Returns: [ralph-tui-prd, ralph-tui-create-beads, ralph-tui-create-json]
                     |
14. For each skill:
    promptBoolean("Install skill: X?")
    installSkill(X, {force: true})
                     |
15. saveConfig(answers, cwd)
    - mkdir .ralph-tui/
    - stringify to TOML
    - write config.toml
                     |
16. Print success:
    "Configuration saved to: .ralph-tui/config.toml"
    "You can now run Ralph TUI with: ralph-tui run"
                     |
17. Return SetupResult { success: true, answers, configPath }
```

### Configuration Generation

The wizard generates a TOML configuration file with the structure defined in `StoredConfig`:

```toml
# Ralph TUI Configuration
# Generated by setup wizard
# See: ralph-tui config help

tracker = "beads"
agent = "claude"
maxIterations = 10
autoCommit = false

[trackerOptions]
epicId = "EPIC-123"

[agentOptions]
# Empty by default, can be customized later
```

## Configuration

### Generated Config Structure

The setup wizard produces a `.ralph-tui/config.toml` file using the shorthand format:

| Field | Type | Description |
|-------|------|-------------|
| `tracker` | string | Selected tracker plugin ID |
| `trackerOptions` | object | Plugin-specific tracker options |
| `agent` | string | Selected agent plugin ID |
| `agentOptions` | object | Plugin-specific agent options |
| `maxIterations` | number | Max tasks per run (0 = unlimited) |
| `autoCommit` | boolean | Auto-commit after successful tasks |

### Plugin Setup Questions

Both tracker and agent plugins can define setup questions via `getSetupQuestions()`. The wizard presents these during configuration:

**SetupQuestion interface**:
```typescript
interface SetupQuestion {
  id: string;
  prompt: string;
  type: 'text' | 'password' | 'boolean' | 'select' | 'multiselect' | 'path';
  choices?: Array<{value: string; label: string; description?: string}>;
  default?: string | boolean | string[];
  required?: boolean;
  pattern?: string;
  help?: string;
}
```

## API Reference

### Public Functions

#### `runSetupWizard(options?: SetupOptions): Promise<SetupResult>`

Runs the interactive setup wizard.

**Parameters**:
- `options.cwd`: Working directory (default: `process.cwd()`)
- `options.force`: Overwrite existing config (default: `false`)
- `options.useDefaults`: Skip interactive prompts (default: `false`)

**Returns**: `SetupResult` with success status, answers, and config path.

#### `checkAndRunSetup(options?: SetupOptions & {skipSetup?: boolean}): Promise<SetupResult | null>`

Checks if setup is needed and optionally runs the wizard.

**Returns**:
- `null` if config exists or `skipSetup: true`
- `SetupResult` if wizard was run

#### `projectConfigExists(cwd?: string): Promise<boolean>`

Checks if `.ralph-tui/config.toml` exists.

### Prompt Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `promptText` | `prompt, options` | `Promise<string>` | Text input |
| `promptBoolean` | `prompt, options` | `Promise<boolean>` | Yes/no input |
| `promptSelect<T>` | `prompt, choices, options` | `Promise<T>` | Numbered list selection |
| `promptNumber` | `prompt, options` | `Promise<number>` | Numeric input |
| `promptPath` | `prompt, options` | `Promise<string>` | File path input |
| `promptQuestion` | `question` | `Promise<unknown>` | Universal dispatcher |

### Output Functions

| Function | Parameters | Description |
|----------|------------|-------------|
| `printSection` | `title` | Magenta section header |
| `printSuccess` | `message` | Green checkmark message |
| `printError` | `message` | Yellow X message |
| `printInfo` | `message` | Blue info message |

### Skill Installation Functions

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `listBundledSkills` | none | `Promise<SkillInfo[]>` | List available skills |
| `isSkillInstalled` | `skillName` | `Promise<boolean>` | Check if installed |
| `installSkill` | `skillName, options` | `Promise<SkillInstallResult>` | Install single skill |
| `installAllSkills` | `options` | `Promise<Map<string, SkillInstallResult>>` | Install all skills |

## Usage Examples

### Running the Setup Wizard Programmatically

```typescript
import { runSetupWizard, checkAndRunSetup } from './setup/index.js';

// Option 1: Always run wizard (for 'ralph-tui setup' command)
const result = await runSetupWizard({
  cwd: '/path/to/project',
  force: true, // Overwrite existing config
});

if (result.success) {
  console.log('Config saved to:', result.configPath);
} else if (result.cancelled) {
  console.log('Setup cancelled by user');
} else {
  console.error('Setup failed:', result.error);
}

// Option 2: Only run if needed (for 'ralph-tui run' command)
const setupResult = await checkAndRunSetup({
  cwd: '/path/to/project',
  skipSetup: false,
});

if (setupResult === null) {
  // Config already exists, proceed with run
} else if (setupResult.success) {
  // Config was created, proceed with run
}
```

### Using Prompt Utilities Elsewhere

```typescript
import {
  promptSelect,
  promptBoolean,
  printSection,
  printSuccess,
} from './setup/prompts.js';

printSection('Epic Selection');

const epicId = await promptSelect<string>(
  'Select an epic to work on:',
  [
    { value: 'EPIC-1', label: 'Feature A', description: '5 tasks remaining' },
    { value: 'EPIC-2', label: 'Feature B', description: '3 tasks remaining' },
  ],
  { default: 'EPIC-1' }
);

const confirm = await promptBoolean('Start working on this epic?', {
  default: true,
});

if (confirm) {
  printSuccess(`Working on ${epicId}`);
}
```

## Integration Points

### Command Integration

The setup wizard is invoked from `src/commands/setup.ts`:

```typescript
import { runSetupWizard, printError } from '../setup/index.js';

export async function executeSetupCommand(args: string[]): Promise<void> {
  const parsed = parseSetupArgs(args);
  const result = await runSetupWizard({
    cwd: parsed.cwd,
    force: parsed.force,
  });
  // Handle result...
}
```

### Plugin Registry Integration

The wizard interacts with plugin registries to detect available options:

1. **Tracker Registry** (`src/plugins/trackers/registry.ts`)
   - `getTrackerRegistry()` returns singleton
   - `registerBuiltinTrackers()` adds beads, json, beads-bv
   - `getRegisteredPlugins()` returns metadata array

2. **Agent Registry** (`src/plugins/agents/registry.ts`)
   - `getAgentRegistry()` returns singleton
   - `registerBuiltinAgents()` adds claude, opencode
   - Agent plugins have `detect()` method for CLI availability

### Prompt Reuse

The prompt utilities are reused by other components:

| File | Usage |
|------|-------|
| `src/session/lock.ts` | `promptBoolean()` for session conflict resolution |
| `src/commands/convert.ts` | Various prompts for conversion wizard |
| `src/prd/wizard.ts` | PRD creation wizard uses all prompt types |

## Testing

The setup module can be tested by:

1. **Unit testing** prompt functions with mocked readline
2. **Integration testing** wizard flow with mock registries
3. **E2E testing** with actual CLI execution

Key test scenarios:
- First-time setup creates valid config
- Existing config is not overwritten without `--force`
- Ctrl+C cancellation is handled gracefully
- Invalid input triggers validation and reprompt
- Agent detection correctly identifies installed CLIs

## Related Documentation

- Configuration System: `ai_docs/codebase/config-system.md` (if available)
- Plugin System: `ai_docs/codebase/plugin-system.md` (if available)
- CLI Commands: `ai_docs/codebase/cli-commands.md` (if available)

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented all five setup module files
- Covered plugin detection, prompting utilities, configuration generation
- Documented checkAndRunSetup flow for first-time users
- Added data flow diagrams and API reference
