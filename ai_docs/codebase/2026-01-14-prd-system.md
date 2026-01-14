---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "PRD (Product Requirements Document) System"
tags: [prd, wizard, generator, parser, chat, ai, json, beads, user-stories]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# PRD (Product Requirements Document) System

## Overview

The PRD System in ralph-tui provides a comprehensive workflow for creating Product Requirements Documents through two main approaches:

1. **Interactive Wizard Mode** - A traditional step-by-step command-line wizard that collects feature information through predefined clarifying questions
2. **AI Chat Mode** - An AI-powered conversational interface that dynamically generates PRDs based on natural language interaction

The system supports generating PRDs in markdown format, with optional conversion to JSON (`prd.json`) or Beads issue tracker format for automated execution by AI agents.

## Architecture

The PRD system is organized into two main subsystems:

```
src/prd/                    # Core PRD generation logic (wizard mode)
  types.ts                  # Type definitions
  questions.ts              # Clarifying questions
  generator.ts              # PRD generation logic
  parser.ts                 # Markdown PRD parser
  wizard.ts                 # Interactive wizard runner
  index.ts                  # Module exports

src/chat/                   # AI chat engine (chat mode)
  types.ts                  # Chat type definitions
  engine.ts                 # Multi-turn conversation engine

src/tui/components/
  PrdChatApp.tsx           # React component for chat UI

src/commands/
  create-prd.tsx           # CLI command handler

skills/
  ralph-tui-prd/           # AI skill for PRD generation
  ralph-tui-create-json/   # AI skill for JSON conversion
  ralph-tui-create-beads/  # AI skill for Beads conversion
```

## Components

### Type Definitions (`src/prd/types.ts`)

Defines the core data structures for the PRD system:

**Location**: `src/prd/types.ts`
**Purpose**: Central type definitions for PRD documents and generation options

#### ClarifyingQuestion

Represents a single clarifying question asked during PRD creation:

```typescript
interface ClarifyingQuestion {
  id: string;                                                    // Unique identifier
  question: string;                                              // Question text to display
  category: 'scope' | 'users' | 'requirements' | 'constraints' | 'success';
  followUp?: string;                                             // Optional follow-up prompt
}
```

#### ClarifyingAnswers

Collected answers from the clarifying questions:

```typescript
interface ClarifyingAnswers {
  featureDescription: string;                // Feature description from user
  answers: Record<string, string>;           // Answers keyed by question ID
}
```

#### PrdUserStory

Represents a user story within the PRD:

```typescript
interface PrdUserStory {
  id: string;                    // e.g., "US-001"
  title: string;                 // Short title
  description: string;           // Full description
  acceptanceCriteria: string[];  // List of criteria
  priority: number;              // 1=highest, 4=lowest
  labels?: string[];             // Tags
  dependsOn?: string[];          // Dependency story IDs
}
```

#### GeneratedPrd

The complete PRD document structure:

```typescript
interface GeneratedPrd {
  name: string;              // Feature name/title
  slug: string;              // Kebab-case for filenames
  description: string;       // High-level summary
  targetUsers: string;       // User personas
  problemStatement: string;  // Why this feature is needed
  solution: string;          // Proposed solution
  successMetrics: string;    // Measurement criteria
  constraints: string;       // Limitations
  userStories: PrdUserStory[];
  technicalNotes?: string;   // Optional technical considerations
  branchName: string;        // Git branch suggestion
  createdAt: string;         // ISO timestamp
}
```

#### PrdGenerationOptions

Configuration for PRD generation:

```typescript
interface PrdGenerationOptions {
  cwd?: string;              // Working directory (default: process.cwd())
  storyCount?: number;       // User stories to generate (default: 5)
  outputDir?: string;        // Output directory (default: ./tasks)
  generateJson?: boolean;    // Also generate prd.json
  storyPrefix?: string;      // Story ID prefix (default: "US-")
  force?: boolean;           // Skip confirmation prompts
}
```

### Clarifying Questions (`src/prd/questions.ts`)

**Location**: `src/prd/questions.ts`
**Purpose**: Defines the standard set of questions for gathering PRD context

The module exports `CLARIFYING_QUESTIONS`, an array of 5 predefined questions:

| ID | Category | Question | Follow-up |
|----|----------|----------|-----------|
| `users` | users | "Who are the target users for this feature?" | "Can you describe their role or use case in more detail?" |
| `problem` | requirements | "What problem does this feature solve?" | "What is the current pain point or workflow limitation?" |
| `success` | success | "How will you know when this feature is complete and successful?" | "Are there specific metrics or acceptance criteria in mind?" |
| `constraints` | constraints | "Are there any constraints or limitations to consider?" | (none) |
| `scope` | scope | "What is explicitly OUT of scope for this feature?" | "Any edge cases or advanced functionality to defer?" |

Helper functions:
- `getQuestionCount()` - Returns total question count (5)
- `getQuestionById(id)` - Retrieves a specific question
- `getQuestionIds()` - Returns array of all question IDs

### PRD Generator (`src/prd/generator.ts`)

**Location**: `src/prd/generator.ts`
**Purpose**: Transforms clarifying answers into structured PRD documents

#### Key Functions

**`slugify(text: string): string`**
Converts text to kebab-case for file naming.

**`generateBranchName(featureName: string): string`**
Creates a git branch name prefixed with `feature/`.

**`generateUserStories(answers: ClarifyingAnswers, options?: PrdGenerationOptions): PrdUserStory[]`**
Generates user stories from answers using heuristic-based approach:
- US-001: Core functionality implementation (priority 1)
- US-002: Input validation and error handling (priority 2)
- US-003: Success metrics based on user answers (priority 2)
- US-004: Edge cases and constraints handling (priority 3)
- US-005: User documentation and help (priority 4)

**`generatePrd(answers: ClarifyingAnswers, options?: PrdGenerationOptions): GeneratedPrd`**
Creates a complete PRD structure from answers.

**`renderPrdMarkdown(prd: GeneratedPrd): string`**
Renders the PRD as formatted markdown with sections:
- Header with name, generation date, branch name
- Overview
- Target Users
- Problem Statement
- Proposed Solution
- Success Metrics
- Constraints (if specified)
- User Stories with acceptance criteria, dependencies, priorities
- Technical Notes (if present)

**`convertToPrdJson(prd: GeneratedPrd): object`**
Converts PRD to JSON format compatible with the JSON tracker:

```json
{
  "name": "Feature Name",
  "description": "...",
  "branchName": "feature/feature-name",
  "userStories": [
    {
      "id": "US-001",
      "title": "...",
      "description": "...",
      "acceptanceCriteria": [...],
      "priority": 1,
      "passes": false,
      "labels": [],
      "dependsOn": []
    }
  ],
  "metadata": {
    "createdAt": "2026-01-14T...",
    "version": "1.0.0"
  }
}
```

### Markdown Parser (`src/prd/parser.ts`)

**Location**: `src/prd/parser.ts`
**Purpose**: Parses existing PRD markdown documents back into structured format

#### ParsedPrd Interface

```typescript
interface ParsedPrd {
  name: string;              // PRD title
  description: string;       // Overview content
  userStories: PrdUserStory[];
  branchName?: string;       // From metadata
  createdAt?: string;        // From metadata
  warnings: string[];        // Non-fatal parsing issues
}
```

#### Parsing Patterns

The parser uses regex patterns to extract:

| Pattern | Purpose |
|---------|---------|
| `USER_STORY_HEADER_PATTERN` | Matches `### US-001: Title` or `## US-001: Title` |
| `PRD_TITLE_PATTERN` | Matches `# PRD: Feature Name` or `# Feature Name` |
| `BRANCH_NAME_PATTERN` | Extracts branch from `> Branch: \`feature/...\`` |
| `CREATED_DATE_PATTERN` | Extracts date from `> Generated: ...` |
| `ACCEPTANCE_CRITERIA_PATTERN` | Finds `**Acceptance Criteria:**` sections |
| `PRIORITY_PATTERN` | Extracts `**Priority:** P[1-4]` |
| `DEPENDS_ON_PATTERN` | Extracts `**Depends on:** US-001, US-002` |
| `CHECKLIST_ITEM_PATTERN` | Matches `- [ ]` or `- [x]` items |

#### Key Functions

**`parsePrdMarkdown(markdown: string, options?: ParseOptions): ParsedPrd`**
Main parsing function that extracts:
- Title and description
- Branch name and creation date from metadata
- All user story sections with their details
- Generates warnings for missing elements

**`parsedPrdToGeneratedPrd(parsed: ParsedPrd, branchNameOverride?: string): GeneratedPrd`**
Converts parsed PRD to GeneratedPrd format for JSON export.

### Interactive Wizard (`src/prd/wizard.ts`)

**Location**: `src/prd/wizard.ts`
**Purpose**: Runs the step-by-step PRD creation wizard

#### Workflow

1. **Welcome Banner** - Displays "Ralph TUI - PRD Creator" header
2. **Feature Description** - Prompts for feature description (required)
3. **Clarifying Questions** - Iterates through `CLARIFYING_QUESTIONS`:
   - Shows progress (e.g., "(1/5)")
   - If answer is brief (<20 chars) and follow-up exists, prompts for more detail
4. **PRD Generation** - Calls `generatePrd()` and `renderPrdMarkdown()`
5. **Summary Display** - Shows feature name, branch, story count, and story list
6. **File Output** - Saves to `{outputDir}/prd-{slug}.md`
   - Prompts for overwrite confirmation if file exists (unless `--force`)

#### Key Functions

**`runPrdWizard(options?: PrdGenerationOptions): Promise<PrdGenerationResult>`**
Main entry point for wizard mode. Returns:

```typescript
interface PrdGenerationResult {
  success: boolean;
  markdownPath?: string;    // Path to generated file
  jsonPath?: string;        // Path to JSON (if generated)
  prd?: GeneratedPrd;       // Generated content
  error?: string;           // Error message
  cancelled?: boolean;      // User cancelled
}
```

**`prdExists(featureName: string, options?: PrdGenerationOptions): Promise<string | null>`**
Checks if a PRD already exists for the given feature name.

## AI Chat Mode

The AI Chat Mode provides a conversational interface for PRD generation using an AI agent.

### Chat Types (`src/chat/types.ts`)

**Location**: `src/chat/types.ts`
**Purpose**: Type definitions for multi-turn AI conversations

#### ChatMessage

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}
```

#### ChatStatus

```typescript
type ChatStatus = 'idle' | 'processing' | 'error' | 'completed';
```

#### ChatEvent Types

The engine emits events for state tracking:
- `message:sent` - User message was sent
- `message:received` - Assistant response received
- `status:changed` - Status transition
- `error:occurred` - Error happened
- `prd:detected` - Complete PRD detected in response

### Chat Engine (`src/chat/engine.ts`)

**Location**: `src/chat/engine.ts`
**Purpose**: Manages multi-turn conversations with AI agents

#### PRD System Prompt

The engine uses a system prompt instructing the AI to:
1. Ask clarifying questions with lettered options (A, B, C, D)
2. Ask questions one set at a time, adapting to answers
3. Generate the complete PRD when sufficient context is gathered
4. Wrap the final PRD in `[PRD]...[/PRD]` markers

#### ChatEngine Class

```typescript
class ChatEngine {
  constructor(config: ChatEngineConfig);

  on(listener: ChatEventListener): () => void;  // Subscribe to events
  getHistory(): ChatMessage[];                   // Get conversation history
  getStatus(): ChatStatus;                       // Current status
  sendMessage(content: string, options?: SendMessageOptions): Promise<SendMessageResult>;
  reset(): void;                                 // Reset conversation
  getAgent(): AgentPlugin;                       // Get agent instance
}
```

#### Prompt Building

The `buildPrompt()` method constructs prompts with:
1. System prompt wrapped in `<system>` tags
2. Conversation history wrapped in `<conversation>` tags
3. Current user message
4. "Assistant:" prompt for response

#### PRD Detection

The `detectPrd()` method uses two strategies:

1. **Marker-based**: Looks for `[PRD]...[/PRD]` markers (preferred)
2. **Heading-based**: Looks for `# PRD: Feature Name` as fallback

When a PRD is detected, a `prd:detected` event is emitted with:
- `prdContent` - The extracted PRD content
- `featureName` - Feature name from PRD header

### PrdChatApp Component (`src/tui/components/PrdChatApp.tsx`)

**Location**: `src/tui/components/PrdChatApp.tsx`
**Purpose**: React TUI component for the PRD chat interface

#### Component Phases

1. **Chat Phase** - Full-screen chat for PRD generation
2. **Review Phase** - Split view with chat (60%) and PRD preview (40%)

#### Props

```typescript
interface PrdChatAppProps {
  agent: AgentPlugin;                              // AI agent to use
  cwd?: string;                                    // Working directory
  outputDir?: string;                              // Output dir (default: ./tasks)
  timeout?: number;                                // Agent timeout (default: 180000ms)
  onComplete: (result: PrdCreationResult) => void; // Success callback
  onCancel: () => void;                            // Cancel callback
  onError?: (error: string) => void;               // Error callback
}
```

#### Tracker Options

After PRD generation, offers task creation:
- **[1] JSON (prd.json)** - Always available
- **[2] Beads issues** - Available if `.beads/` directory exists
- **[3] Done** - Exit without creating tasks

#### Key Features

- Real-time streaming of AI responses
- Quit confirmation dialog (Esc key in chat phase)
- PRD preview panel in review phase
- Automatic file saving on PRD detection

### Create-PRD Command (`src/commands/create-prd.tsx`)

**Location**: `src/commands/create-prd.tsx`
**Purpose**: CLI command handler for `ralph-tui create-prd` / `ralph-tui prime`

#### Command-Line Arguments

| Argument | Short | Description |
|----------|-------|-------------|
| `--cwd` | `-C` | Working directory |
| `--output` | `-o` | Output directory for PRD files |
| `--agent` | `-a` | Agent plugin to use |
| `--timeout` | `-t` | Timeout for AI calls (ms) |
| `--force` | `-f` | Overwrite without prompting |
| `--help` | `-h` | Show help |

#### Execution Flow

1. Parse command arguments
2. Verify setup is complete (`requireSetup()`)
3. Load configured agent plugin
4. Run `PrdChatApp` with OpenTUI renderer
5. On completion with tracker selection, launch `ralph-tui run`

## AI Skills

The PRD system integrates with three AI skills for PRD generation and conversion.

### ralph-tui-prd Skill

**Location**: `skills/ralph-tui-prd/SKILL.md`
**Purpose**: Guides AI through PRD generation

Key behaviors:
- Ask 3-5 clarifying questions with lettered options (A, B, C, D)
- Always ask about quality gates (required commands)
- Adaptive questioning based on answers
- Output PRD wrapped in `[PRD]...[/PRD]` markers

Required PRD sections:
1. Introduction/Overview
2. Goals
3. Quality Gates (commands that must pass)
4. User Stories (US-XXX format)
5. Functional Requirements (FR-X format)
6. Non-Goals (Out of Scope)
7. Technical Considerations (optional)
8. Success Metrics
9. Open Questions

### ralph-tui-create-json Skill

**Location**: `skills/ralph-tui-create-json/SKILL.md`
**Purpose**: Converts PRD markdown to `prd.json` format

Key behaviors:
1. Extract quality gates from PRD
2. Parse user stories
3. Append quality gates to each story's acceptance criteria
4. Set up `dependsOn` relationships
5. Output to `./tasks/prd.json`

Output schema:
```json
{
  "project": "...",
  "branchName": "ralph/feature-name",
  "description": "...",
  "userStories": [...]
}
```

### ralph-tui-create-beads Skill

**Location**: `skills/ralph-tui-create-beads/SKILL.md`
**Purpose**: Converts PRD to Beads issue tracker format

Key behaviors:
1. Extract quality gates from PRD
2. Create epic bead for feature
3. Create child beads for each user story
4. Set up dependencies with `bd dep add`
5. Write to `.beads/beads.jsonl`

Uses `bd create` command syntax for bead creation.

## Data Flow

### Wizard Mode Flow

```
User Input -> collectAnswers() -> generatePrd() -> renderPrdMarkdown() -> File Output
                    |
                    v
           CLARIFYING_QUESTIONS (5 questions)
                    |
                    v
           ClarifyingAnswers { featureDescription, answers }
                    |
                    v
           GeneratedPrd with user stories
                    |
                    v
           Markdown file: tasks/prd-{slug}.md
```

### AI Chat Mode Flow

```
User Message -> ChatEngine.sendMessage() -> Agent.execute() -> Response
                        |                                          |
                        v                                          v
            buildPrompt() with history                    detectPrd() check
                        |                                          |
                        v                                          v
            System prompt + conversation              If PRD found: emit 'prd:detected'
                        |                                          |
                        v                                          v
               Agent generates response                  PrdChatApp saves file
                                                                   |
                                                                   v
                                                    Enter review phase (split view)
                                                                   |
                                                                   v
                                              User selects tracker: JSON or Beads
                                                                   |
                                                                   v
                                              AI converts using appropriate skill
```

### JSON Conversion Flow

```
PRD Markdown -> parsePrdMarkdown() -> ParsedPrd -> parsedPrdToGeneratedPrd() -> convertToPrdJson() -> prd.json
                     |                                                                  |
                     v                                                                  v
            Extract: title, description,                                 JSON with userStories array
            branchName, userStories,                                     Each story: passes=false
            warnings
```

## Configuration

### Default Values

| Setting | Default | Description |
|---------|---------|-------------|
| Output directory | `./tasks` | Where PRD files are saved |
| Story count | 5 | User stories to generate in wizard mode |
| Story prefix | `US-` | Prefix for story IDs |
| Agent timeout | 180000ms | 3 minutes for AI responses |
| Max history | 50 messages | Conversation context limit |

### Output Files

| File | Description |
|------|-------------|
| `tasks/prd-{slug}.md` | Markdown PRD document |
| `tasks/prd.json` | JSON format for JSON tracker |
| `.beads/beads.jsonl` | Beads issue format |

## Integration Points

### Agent Plugin System

The PRD system integrates with ralph-tui's agent plugin system:
- Uses `AgentPlugin.execute()` for AI interactions
- Supports streaming via `onStdout` callback
- Respects `timeout` configuration
- Works with any configured agent (Claude, OpenCode, etc.)

### Tracker Plugins

Generated PRDs can be consumed by:
- **JSON Tracker** (`src/plugins/trackers/builtin/json.ts`) - Reads `prd.json`
- **Beads Tracker** - Reads from `.beads/beads.jsonl`

### TUI Components

The PrdChatApp component uses:
- `ChatView` - Reusable chat interface component
- `ConfirmationDialog` - Quit confirmation overlay
- OpenTUI primitives (`box`, `text`, `scrollbox`)

## Usage Examples

### CLI Commands

```bash
# Start AI-powered PRD creation (primary method)
ralph-tui create-prd
ralph-tui prime            # Alias

# With options
ralph-tui create-prd --agent claude --output ./docs --timeout 300000

# Show help
ralph-tui create-prd --help
```

### Programmatic Usage

```typescript
import {
  runPrdWizard,
  generatePrd,
  parsePrdMarkdown,
  convertToPrdJson
} from './prd/index.js';

// Run interactive wizard
const result = await runPrdWizard({ outputDir: './tasks' });

// Generate PRD from answers
const prd = generatePrd(answers, { storyCount: 5 });

// Parse existing PRD
const parsed = parsePrdMarkdown(markdownContent);

// Convert to JSON
const json = convertToPrdJson(prd);
```

## Related Documentation

- Agent plugins: `src/plugins/agents/`
- Tracker plugins: `src/plugins/trackers/`
- TUI theme system: `src/tui/theme.ts`
- Setup wizard: `src/setup/`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented wizard flow, clarifying questions, generator, parser
- Documented AI chat mode with ChatEngine and PrdChatApp
- Documented JSON conversion and Beads integration
- Documented AI skills (ralph-tui-prd, ralph-tui-create-json, ralph-tui-create-beads)
