---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Handlebars-based Prompt Template System"
tags: [templates, handlebars, prompts, trackers, configuration, customization]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Handlebars-based Prompt Template System

## Overview

The template system in ralph-tui provides a flexible, Handlebars-based mechanism for generating agent prompts. It transforms task data from trackers into formatted instructions that agents can execute. The system supports multiple built-in templates optimized for different tracker types, custom user templates, and a hierarchical resolution order that allows for progressive customization.

The template system is the bridge between the tracker (which provides task data) and the agent (which executes work). Templates inject structured context about tasks, including IDs, descriptions, acceptance criteria, dependencies, and progress from previous iterations.

## Architecture

### File Structure

```
src/templates/
  engine.ts      # Core template engine with Handlebars compilation and rendering
  builtin.ts     # Built-in template strings for each tracker type
  prompts.ts     # Bundled prompt file contents (markdown instruction files)
  types.ts       # TypeScript interfaces for template variables and contexts
  index.ts       # Public API exports
```

### Component Relationships

```
                    +------------------+
                    |  ExecutionEngine |
                    |  (src/engine/)   |
                    +--------+---------+
                             |
                             | calls renderPrompt()
                             v
                    +------------------+
                    |  Template Engine |
                    |  (engine.ts)     |
                    +--------+---------+
                             |
          +------------------+------------------+
          |                  |                  |
          v                  v                  v
   +-----------+      +-----------+      +-----------+
   | loadTemplate|    | buildVars |      | compile   |
   | (3-tier)   |    | (context) |      | (cache)   |
   +-----------+      +-----------+      +-----------+
          |
   +------+------+------+
   |      |      |      |
   v      v      v      v
Custom  User   Builtin Templates
Path   Config  (builtin.ts)
       (~/.config/ralph-tui/)
```

## Components

### Template Engine (`src/templates/engine.ts`)

**Purpose**: Core engine that loads templates, builds variable contexts, compiles Handlebars templates, and renders final prompts.

**Key Functions**:

| Function | Description |
|----------|-------------|
| `loadTemplate()` | Loads template with 3-tier resolution: custom path -> user config -> builtin |
| `renderPrompt()` | Main entry point for rendering prompts from task + config |
| `buildTemplateVariables()` | Converts task and config into flat variable object |
| `buildTemplateContext()` | Creates full context including raw objects for advanced use |
| `getBuiltinTemplate()` | Returns built-in template for a tracker type |
| `getTemplateTypeFromPlugin()` | Maps plugin name to template type |
| `compileTemplate()` | Compiles Handlebars template with caching |
| `copyBuiltinTemplate()` | Copies builtin template to custom path |
| `initializeUserPrompts()` | Initializes `~/.config/ralph-tui/` with prompt files |
| `getBundledPrompt()` | Returns bundled markdown prompt content |
| `clearTemplateCache()` | Clears compiled template cache (for testing) |

**Template Resolution Order**:

```
1. customPath (explicit --prompt argument or config prompt_template)
        |
        v (not found or not specified)
2. ~/.config/ralph-tui/{mode-specific}.md (user config directory)
   - prompt.md for json tracker
   - prompt-beads.md for beads/beads-bv trackers
        |
        v (not found)
3. Built-in template (bundled in builtin.ts)
```

**Template Caching**:

```typescript
const templateCache = new Map<string, Handlebars.TemplateDelegate>();
```

Templates are compiled once and cached by source path. The cache key is the template source (file path or `builtin:<type>`). The `clearTemplateCache()` function is available for testing or when templates change at runtime.

**Handlebars Configuration**:

```typescript
Handlebars.compile(templateContent, {
  noEscape: true,    // Don't escape HTML entities in output
  strict: false,     // Don't throw on missing variables
});
```

### Built-in Templates (`src/templates/builtin.ts`)

**Purpose**: Contains the default Handlebars templates embedded as strings. Each tracker type has an optimized template.

**Template Types**:

| Type | Constant | Use Case |
|------|----------|----------|
| `default` | `DEFAULT_TEMPLATE` | Generic fallback for unknown trackers |
| `beads` | `BEADS_TEMPLATE` | Bead-based workflows (bd/beads CLI) |
| `beads-bv` | `BEADS_BV_TEMPLATE` | Beads with bv graph analysis |
| `json` | `JSON_TEMPLATE` | PRD-based JSON tracker workflows |

**Template Structure** (common pattern):

```handlebars
## Task/Bead/User Story
**ID**: {{taskId}}
**Title**: {{taskTitle}}

{{#if taskDescription}}
## Description
{{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
## Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if recentProgress}}
## Previous Progress
{{recentProgress}}
{{/if}}

## Instructions
[Tracker-specific instructions]

**IMPORTANT**: If the work is already complete...

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
```

**Key Differences Between Templates**:

- **DEFAULT_TEMPLATE**: Minimal, generic instructions
- **BEADS_TEMPLATE**: Includes epic context, `bd update` close instructions
- **BEADS_BV_TEMPLATE**: Adds `dependsOn` and `blocks` sections for graph-aware context
- **JSON_TEMPLATE**: PRD-focused with notes section, story-based terminology

### Bundled Prompts (`src/templates/prompts.ts`)

**Purpose**: Contains full markdown instruction files that can be copied to user config directory. These are comprehensive agent instructions, not Handlebars templates.

**Prompt Files**:

| Constant | Target File | Use Case |
|----------|-------------|----------|
| `PROMPT_JSON` | `prompt.md` | JSON/PRD tracker agent instructions |
| `PROMPT_BEADS` | `prompt-beads.md` | Beads tracker agent instructions |

**Prompt Content Summary**:

**PROMPT_JSON** (~120 lines):
- Reads PRD at `prd.json`
- Checks progress.txt for context
- Implements highest priority story where `passes: false`
- Runs quality checks
- Updates AGENTS.md for patterns
- Commits with `feat: [Story ID] - [Story Title]`
- Appends to progress.txt with learnings
- Browser testing requirements for frontend stories
- Stop condition: `<promise>COMPLETE</promise>`

**PROMPT_BEADS** (~80 lines):
- Works with bead from `bead_id`
- Stays on epic's branch (no branch switching)
- Closes bead with `bd update --status=closed`
- Browser testing with verification note
- Includes bd command reference

### Type Definitions (`src/templates/types.ts`)

**Purpose**: TypeScript interfaces ensuring type safety across the template system.

**Core Interfaces**:

**TemplateVariables** - Variables available in templates:

```typescript
interface TemplateVariables {
  // Task identity
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  acceptanceCriteria: string;

  // Hierarchy
  epicId: string;
  epicTitle: string;

  // Metadata
  trackerName: string;
  labels: string;           // Comma-separated
  priority: string;         // 0-4, 0 is critical
  status: string;
  type: string;

  // Dependencies (comma-separated)
  dependsOn: string;
  blocks: string;

  // Execution context
  model: string;
  agentName: string;
  cwd: string;

  // Timestamps
  currentDate: string;      // ISO format YYYY-MM-DD
  currentTimestamp: string; // Full ISO timestamp

  // Additional
  notes: string;
  recentProgress: string;   // From previous iterations
}
```

**TemplateContext** - Full context for advanced templates:

```typescript
interface TemplateContext {
  vars: TemplateVariables;           // Flattened variables
  task: TrackerTask;                 // Raw task object
  config: Partial<RalphConfig>;      // Runtime configuration
  epic?: {                           // Epic info if available
    id: string;
    title: string;
    description?: string;
  };
}
```

**TemplateLoadResult** / **TemplateRenderResult** - Operation results:

```typescript
interface TemplateLoadResult {
  success: boolean;
  content?: string;
  source: string;           // Path or 'builtin:<type>'
  error?: string;
}

interface TemplateRenderResult {
  success: boolean;
  prompt?: string;
  error?: string;
  source: string;
}
```

**BuiltinTemplateType** - Valid template types:

```typescript
type BuiltinTemplateType = 'default' | 'beads' | 'json' | 'beads-bv';
```

### Public API (`src/templates/index.ts`)

**Purpose**: Single export point for the template system.

**Exported Types**:
- `TemplateVariables`, `TemplateContext`, `TemplateLoadResult`, `TemplateRenderResult`
- `BuiltinTemplateType`, `TemplateConfig`

**Exported Functions**:
- `renderPrompt`, `loadTemplate`, `buildTemplateVariables`, `buildTemplateContext`
- `getBuiltinTemplate`, `getTemplateTypeFromPlugin`
- `copyBuiltinTemplate`, `getCustomTemplatePath`, `clearTemplateCache`
- `getUserConfigDir`, `getDefaultPromptFilename`, `getUserPromptPath`
- `getBundledPrompt`, `initializeUserPrompts`

**Exported Constants**:
- `DEFAULT_TEMPLATE`, `BEADS_TEMPLATE`, `BEADS_BV_TEMPLATE`, `JSON_TEMPLATE`
- `PROMPT_JSON`, `PROMPT_BEADS`

## Data Flow

### Template Rendering Flow

```
ExecutionEngine.buildPrompt()
        |
        v
renderPrompt(task, config, epic?, recentProgress?)
        |
        +--- getTemplateTypeFromPlugin(config.tracker.plugin)
        |           -> 'beads' | 'beads-bv' | 'json' | 'default'
        |
        +--- loadTemplate(customPath, trackerType, cwd)
        |           -> { success, content, source }
        |
        +--- buildTemplateContext(task, config, epic, recentProgress)
        |           -> { vars: {...}, task, config, epic }
        |
        +--- compileTemplate(content, source)  // with caching
        |           -> Handlebars.TemplateDelegate
        |
        +--- template(flatContext)
        |           -> rendered prompt string
        |
        v
{ success: true, prompt: "...", source: "builtin:beads" }
```

### Variable Injection Flow

```
TrackerTask                      RalphConfig
    |                                |
    v                                v
buildTemplateVariables(task, config, epic?, recentProgress?)
    |
    +-- taskId <- task.id
    +-- taskTitle <- task.title
    +-- taskDescription <- task.description ?? ''
    +-- acceptanceCriteria <- getAcceptanceCriteria(task)
    |       |
    |       +-- task.metadata?.acceptanceCriteria (JSON tracker)
    |       +-- extractAcceptanceCriteria(description) (Beads)
    |
    +-- epicId <- epic?.id ?? task.parentId ?? ''
    +-- epicTitle <- epic?.title ?? ''
    +-- trackerName <- config.tracker?.plugin ?? 'unknown'
    +-- labels <- task.labels?.join(', ') ?? ''
    +-- priority <- String(task.priority ?? 2)
    +-- status <- task.status
    +-- dependsOn <- task.dependsOn?.join(', ') ?? ''
    +-- blocks <- task.blocks?.join(', ') ?? ''
    +-- type <- task.type ?? ''
    +-- model <- config.model ?? ''
    +-- agentName <- config.agent?.plugin ?? 'unknown'
    +-- cwd <- config.cwd ?? process.cwd()
    +-- currentDate <- new Date().toISOString().split('T')[0]
    +-- currentTimestamp <- new Date().toISOString()
    +-- notes <- (task.metadata?.notes as string) ?? ''
    +-- recentProgress <- recentProgress ?? ''
```

### Acceptance Criteria Extraction

The system extracts acceptance criteria from two sources:

1. **JSON Tracker**: Stored in `task.metadata.acceptanceCriteria` as an array
   ```typescript
   // Format: ["Criterion 1", "Criterion 2"]
   // Output: "- [ ] Criterion 1\n- [ ] Criterion 2"
   ```

2. **Beads Tracker**: Embedded in description text
   ```typescript
   // Looks for: ## Acceptance Criteria section
   // Or: Checklist patterns (- [ ] or * [x])
   ```

## Configuration

### Config File (`prompt_template`)

Location: `.ralph-tui/config.toml`

```toml
# Custom template path (relative to cwd or absolute)
prompt_template = "my-custom-prompt.hbs"
```

### CLI Override (`--prompt`)

```bash
ralph-tui run --prompt ./custom-prompt.md
```

### User Config Directory

Location: `~/.config/ralph-tui/`

Files:
- `prompt.md` - Used by json tracker
- `prompt-beads.md` - Used by beads/beads-bv trackers

Initialize with:
```bash
ralph-tui template init-prompts
```

## CLI Commands

### `ralph-tui template show`

Display the current template being used.

```bash
# Show current template (based on config)
ralph-tui template show

# Show specific built-in template
ralph-tui template show --tracker beads

# Show custom template
ralph-tui template show --custom ./my-template.hbs
```

### `ralph-tui template init`

Copy a built-in template for customization.

```bash
# Copy default template
ralph-tui template init

# Copy beads template to custom path
ralph-tui template init --tracker beads --output ./custom.hbs

# Force overwrite
ralph-tui template init --force
```

### `ralph-tui template init-prompts`

Initialize user prompt files.

```bash
# Create ~/.config/ralph-tui/prompt.md and prompt-beads.md
ralph-tui template init-prompts

# Force overwrite existing
ralph-tui template init-prompts --force
```

## Usage Examples

### Basic Template Variables

```handlebars
## Task {{taskId}}
**Title**: {{taskTitle}}

{{#if taskDescription}}
{{taskDescription}}
{{/if}}

Labels: {{labels}}
Priority: {{priority}}
```

### Conditional Sections

```handlebars
{{#if acceptanceCriteria}}
## Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if dependsOn}}
**Blocked by**: {{dependsOn}}
{{/if}}

{{#if blocks}}
**Blocks**: {{blocks}}
{{/if}}
```

### Progress Context

```handlebars
{{#if recentProgress}}
## Previous Progress
The following work was done in earlier iterations:
{{recentProgress}}

Continue from where the previous iteration left off.
{{/if}}
```

### Advanced: Raw Object Access

Templates can access raw objects for advanced use:

```handlebars
{{!-- Access raw task metadata --}}
{{#if task.metadata.customField}}
Custom: {{task.metadata.customField}}
{{/if}}

{{!-- Access config --}}
Running in: {{config.cwd}}
```

## Integration Points

### Execution Engine Integration

Location: `src/engine/index.ts`

```typescript
import { renderPrompt } from '../templates/index.js';

async function buildPrompt(task: TrackerTask, config: RalphConfig): Promise<string> {
  // Load recent progress for context
  const recentProgress = await getRecentProgressSummary(config.cwd, 5);

  // Use the template system
  const result = renderPrompt(task, config, undefined, recentProgress);

  if (result.success && result.prompt) {
    return result.prompt;
  }

  // Fallback to hardcoded default on template failure
  console.error(`Template rendering failed: ${result.error}`);
  // ... fallback implementation
}
```

### Configuration Integration

Location: `src/config/types.ts`

```typescript
interface RalphConfig {
  // ...
  /** Custom prompt template path (resolved) */
  promptTemplate?: string;
}

interface StoredConfig {
  // ...
  /** Custom prompt template path (relative to cwd or absolute) */
  prompt_template?: string;
}
```

## Related Documentation

- Configuration System: `ai_docs/codebase/YYYY-MM-DD-configuration.md`
- Execution Engine: `ai_docs/codebase/YYYY-MM-DD-execution-engine.md`
- Tracker Plugins: `ai_docs/codebase/YYYY-MM-DD-tracker-plugins.md`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented all 5 template system files
- Documented built-in templates for 4 tracker types
- Documented bundled prompts (PROMPT_JSON, PROMPT_BEADS)
- Documented template variable injection system
- Documented 3-tier template resolution order
- Documented CLI commands (show, init, init-prompts)
