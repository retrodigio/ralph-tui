---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Terminal User Interface Components"
tags: [tui, react, opentui, components, theme, keyboard, dashboard, panels, subagent]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Terminal User Interface Components

## Overview

The Ralph TUI is a React-based terminal user interface built on the OpenTUI framework (`@opentui/react`). It provides a full-featured dashboard for monitoring and controlling agent execution, including task management, iteration history tracking, subagent tracing, and real-time output display.

The TUI module is located in `src/tui/` and consists of:
- **Core files** (5 files): Module exports, theme system, type definitions, and output parser
- **Component directory** (`src/tui/components/`): 21 React component files

## Architecture

### Module Structure

```
src/tui/
  index.ts           # Module entry point and re-exports
  theme.ts           # Color palette, status indicators, keyboard shortcuts, layout constants
  types.ts           # TypeScript interfaces for component props and data structures
  output-parser.ts   # JSONL parser for agent output (batch and streaming)
  components/
    index.ts         # Component barrel exports
    App.tsx          # Basic app shell (demo/development)
    RunApp.tsx       # Main execution view with full features
    Header.tsx       # Compact header with status, progress, timing
    Footer.tsx       # Keyboard shortcut reference bar
    LeftPanel.tsx    # Task list with hierarchical display
    RightPanel.tsx   # Task details and iteration output
    ProgressDashboard.tsx  # Expanded status dashboard (toggleable)
    IterationHistoryView.tsx  # List of all iterations with status
    IterationDetailView.tsx   # Full-screen iteration detail view
    TaskDetailView.tsx        # Full task information (standalone view)
    SubagentTreePanel.tsx     # Dedicated subagent hierarchy panel
    SubagentSection.tsx       # Collapsible subagent sections in output
    HelpOverlay.tsx           # Modal keyboard shortcut reference
    ConfirmationDialog.tsx    # Yes/No confirmation modal
    SettingsView.tsx          # Configuration editor
    EpicSelectionView.tsx     # Epic/project selector
    EpicSelectionApp.tsx      # Epic selection application wrapper
    EpicLoaderOverlay.tsx     # Epic loading modal
    ChatView.tsx              # Chat interface component
    PrdChatApp.tsx            # PRD chat application wrapper
```

### Component Hierarchy

The main component tree for the execution view (`RunApp`):

```
RunApp (root)
  Header
    MiniProgressBar
  ProgressDashboard (conditional, toggled with 'd')
  Main Content Area (flex row)
    [View Mode: tasks]
      LeftPanel
        TaskRow (per task)
      RightPanel
        TaskMetadataView (details mode)
        TaskOutputView (output mode)
          TimingSummary
          SubagentSections
      SubagentTreePanel (conditional, toggled with 'T')
    [View Mode: iterations]
      IterationHistoryView
        IterationRow (per iteration)
      RightPanel (same as above)
      SubagentTreePanel (conditional)
    [View Mode: iteration-detail]
      IterationDetailView
        SubagentTreeSection
  Footer
  Overlays (positioned absolute)
    ConfirmationDialog (quit/interrupt)
    HelpOverlay
    SettingsView
    EpicLoaderOverlay
```

## Theme System

**Location**: `src/tui/theme.ts`

The theme system provides consistent styling across all TUI components with a modern dark theme inspired by Tokyo Night.

### Color Palette

```typescript
export const colors = {
  // Background colors (4 levels)
  bg: {
    primary: '#1a1b26',    // Main background
    secondary: '#24283b',  // Panels, header, footer
    tertiary: '#2f3449',   // Code blocks, nested areas
    highlight: '#3d4259',  // Selected items
  },

  // Foreground (text) colors (4 levels)
  fg: {
    primary: '#c0caf5',    // Main text
    secondary: '#a9b1d6',  // Secondary text
    muted: '#565f89',      // Subtle labels
    dim: '#414868',        // Very subtle, disabled
  },

  // Status colors for feedback
  status: {
    success: '#9ece6a',    // Green - completed, success
    warning: '#e0af68',    // Yellow/orange - paused, warning
    error: '#f7768e',      // Red - failed, blocked
    info: '#7aa2f7',       // Blue - running, info
  },

  // Task-specific status colors
  task: {
    done: '#9ece6a',       // Completed in current session
    active: '#7aa2f7',     // Currently executing
    actionable: '#9ece6a', // Ready to work on
    pending: '#565f89',    // Waiting (legacy)
    blocked: '#f7768e',    // Blocked by dependencies
    error: '#f7768e',      // Failed execution
    closed: '#414868',     // Historically completed (greyed)
  },

  // Accent colors for emphasis
  accent: {
    primary: '#7aa2f7',    // Primary accent (blue)
    secondary: '#bb9af7',  // Secondary accent (purple)
    tertiary: '#7dcfff',   // Tertiary accent (cyan)
  },

  // Border colors
  border: {
    normal: '#3d4259',     // Default borders
    active: '#7aa2f7',     // Active/focused borders
    muted: '#2f3449',      // Subtle borders
  },
};
```

### Status Indicators

Unicode symbols for visual status representation:

```typescript
export const statusIndicators = {
  // Task status
  done: '✓',          // Checkmark for completed
  active: '▶',        // Play arrow for active
  actionable: '▶',    // Ready to work (green)
  pending: '○',       // Empty circle for pending
  blocked: '⊘',       // Prohibition sign for blocked
  error: '✗',         // X for errors
  closed: '✓',        // Checkmark (greyed) for closed

  // Ralph execution status
  running: '▶',       // Play arrow
  selecting: '◐',     // Half-filled circle (selecting task)
  executing: '⏵',     // Play with bar (agent running)
  pausing: '◎',       // Target symbol (pause pending)
  paused: '⏸',        // Pause symbol
  stopped: '■',       // Stop square
  complete: '✓',      // Checkmark
  idle: '○',          // Empty circle
  ready: '◉',         // Filled target (ready to start)
};
```

### Layout Constants

```typescript
export const layout = {
  header: { height: 1 },           // Single-line compact header
  footer: { height: 3 },           // Footer with shortcuts
  progressDashboard: { height: 6 }, // Expanded dashboard
  leftPanel: {
    minWidth: 30,
    maxWidth: 50,
    defaultWidthPercent: 35,
  },
  rightPanel: { minWidth: 40 },
  padding: { small: 1, medium: 2 },
};
```

### Ralph Status Types

The `RalphStatus` type represents the execution engine state:

| Status | Description |
|--------|-------------|
| `ready` | Waiting for user to press 's' to start |
| `running` | Generic running state |
| `selecting` | Selecting next task to work on |
| `executing` | Agent actively executing on a task |
| `pausing` | Pause requested, waiting for iteration to complete |
| `paused` | Paused, awaiting resume |
| `stopped` | Not running (generic) |
| `complete` | All tasks finished successfully |
| `idle` | Stopped, no more tasks available |
| `error` | Stopped due to error |

### Task Status Types

The `TaskStatus` type represents individual task states:

| Status | Description |
|--------|-------------|
| `done` | Completed in current session (green checkmark) |
| `active` | Currently being worked on (blue arrow) |
| `actionable` | Ready with no blocking dependencies (green arrow) |
| `pending` | Waiting (legacy, prefer actionable) |
| `blocked` | Blocked by unresolved dependencies (red) |
| `error` | Execution failed (red X) |
| `closed` | Previously completed (greyed checkmark) |

## Keyboard Shortcut Handling

**Location**: `src/tui/theme.ts` (definitions) and `src/tui/components/RunApp.tsx` (handling)

### Shortcut Definitions

The theme exports two shortcut lists:

1. **`keyboardShortcuts`**: Condensed list for footer display
2. **`fullKeyboardShortcuts`**: Complete list with categories for help overlay

```typescript
export const fullKeyboardShortcuts = [
  { key: '?', description: 'Show/hide this help', category: 'General' },
  { key: 'q', description: 'Quit Ralph', category: 'General' },
  { key: 'Esc', description: 'Go back / Cancel', category: 'General' },
  { key: ',', description: 'Open settings', category: 'General' },
  { key: 's', description: 'Start execution (when ready)', category: 'Execution' },
  { key: 'p', description: 'Pause / Resume execution', category: 'Execution' },
  { key: '+', description: 'Add 10 iterations', category: 'Execution' },
  { key: '-', description: 'Remove 10 iterations', category: 'Execution' },
  { key: 'r', description: 'Refresh task list from tracker', category: 'Execution' },
  { key: 'l', description: 'Load / switch epic', category: 'Execution' },
  { key: 'd', description: 'Toggle progress dashboard', category: 'Views' },
  { key: 'h', description: 'Toggle show/hide closed tasks', category: 'Views' },
  { key: 'v', description: 'Toggle iterations / tasks view', category: 'Views' },
  { key: 'o', description: 'Toggle details / output view', category: 'Views' },
  { key: 't', description: 'Cycle subagent detail level', category: 'Views' },
  { key: 'T', description: 'Toggle subagent tree panel', category: 'Views' },
  { key: '↑ / k', description: 'Move selection up', category: 'Navigation' },
  { key: '↓ / j', description: 'Move selection down', category: 'Navigation' },
  { key: 'Enter', description: 'View selected item details', category: 'Navigation' },
  { key: 'Ctrl+C', description: 'Interrupt (with confirmation)', category: 'System' },
  { key: 'Ctrl+C ×2', description: 'Force quit immediately', category: 'System' },
];
```

### Keyboard Handler Implementation

The `RunApp` component uses the `useKeyboard` hook from OpenTUI to handle keyboard events:

```typescript
import { useKeyboard } from '@opentui/react';

// In RunApp component:
const handleKeyboard = useCallback(
  (key: { name: string; sequence?: string }) => {
    // Modal priority handling
    if (showInterruptDialog) { /* y/n/Esc only */ }
    if (showQuitDialog) { /* y/n/Esc only */ }
    if (showHelp) { /* ?/Esc to close */ }
    if (showSettings) { return; /* Let settings handle keys */ }
    if (showEpicLoader) { return; /* Let loader handle keys */ }

    // Main keyboard handling
    switch (key.name) {
      case 'q': setShowQuitDialog(true); break;
      case 'escape': /* Back or quit */ break;
      case 'up': case 'k': /* Move selection up */ break;
      case 'down': case 'j': /* Move selection down */ break;
      case 'p': /* Toggle pause/resume */ break;
      case 'v': /* Toggle view mode */ break;
      case 'd': /* Toggle dashboard */ break;
      case 'h': /* Toggle closed tasks */ break;
      case '?': setShowHelp(true); break;
      case 's': /* Start execution */ break;
      case 'r': engine.refreshTasks(); break;
      case '+': case '=': /* Add iterations */ break;
      case '-': case '_': /* Remove iterations */ break;
      case ',': /* Open settings */ break;
      case 'l': /* Open epic loader */ break;
      case 'o': /* Toggle details/output view */ break;
      case 't':
        if (key.sequence === 'T') {
          /* Toggle subagent panel (Shift+T) */
        } else {
          /* Cycle subagent detail level */
        }
        break;
      case 'return': case 'enter': /* Drill into iteration */ break;
    }
  },
  [/* dependencies */]
);

useKeyboard(handleKeyboard);
```

### Modal Priority

Keyboard handling follows a priority system:
1. **Interrupt dialog**: Only `y`, `n`, `Esc` are processed
2. **Quit dialog**: Only `y`, `n`, `Esc` are processed
3. **Help overlay**: Only `?`, `Esc` close it
4. **Settings view**: Handles its own keyboard events
5. **Epic loader**: Handles its own keyboard events
6. **Main view**: All shortcuts available

## Dashboard View

### ProgressDashboard Component

**Location**: `src/tui/components/ProgressDashboard.tsx`

The Progress Dashboard is a toggleable expanded view showing detailed execution status. It is shown/hidden with the `d` key.

**Props**:
```typescript
interface ProgressDashboardProps {
  status: RalphStatus;
  agentName: string;
  trackerName: string;
  epicName?: string;
  currentTaskId?: string;
  currentTaskTitle?: string;
}
```

**Layout** (6 lines height):
- **Top row**: Status indicator + label, epic name, agent/tracker names
- **Task row** (when executing): "Working on: [taskId] - [taskTitle]"

**Status Messages**:
| Status | Message |
|--------|---------|
| `ready` | "Ready - Press Enter or s to start" |
| `running` | "Running" |
| `selecting` | "Selecting next task..." |
| `executing` | "Agent running (taskId)" |
| `pausing` | "Pausing after current iteration..." |
| `paused` | "Paused - Press p to resume" |
| `stopped` | "Stopped" |
| `complete` | "All tasks complete!" |
| `idle` | "No more tasks available" |
| `error` | "Failed - Check logs for details" |

### Header Component

**Location**: `src/tui/components/Header.tsx`

The compact header (single line, always visible) shows essential information:

```
[Status] [Current Task] → [Agent/Tracker] [Progress Bar] [X/Y] [Iter/Max] [Timer]
```

**Features**:
- **Status indicator**: Unicode symbol + colored label
- **Current task**: Title truncated to 40 chars (when executing)
- **Agent display**: Shows fallback indicator and rate limit icon when applicable
- **Progress bar**: 8-character mini progress bar (`▓▓▓░░░░░`)
- **Task count**: `completed/total` tasks
- **Iteration counter**: `[current/max]` or `[current/∞]` for unlimited
- **Timer**: Formatted elapsed time

**Rate Limit Handling**:
When the primary agent is rate-limited and using a fallback:
- Shows rate limit icon (`⏳`)
- Agent name displays as "agentName (fallback)" in warning color
- Status line row appears: "Primary (agentName) rate limited, using fallback"

## Iteration History Panel

**Location**: `src/tui/components/IterationHistoryView.tsx`

Displays a scrollable list of all iterations with their status, task, duration, outcome, and optional subagent summary.

**Props**:
```typescript
interface IterationHistoryViewProps {
  iterations: IterationResult[];
  totalIterations: number;
  selectedIndex: number;
  runningIteration: number;
  onIterationDrillDown?: (iteration: IterationResult) => void;
  width?: number;
  subagentStats?: Map<number, SubagentTraceStats>;
}
```

**Row Format**:
```
[status] Iteration N of M  task-id  [N subagents]  duration  outcome
```

**Status Indicators**:
| Status | Symbol | Color |
|--------|--------|-------|
| `completed` | `✓` | Green |
| `running` | `▶` | Blue |
| `pending` | `○` | Grey |
| `failed` | `✗` | Red |
| `interrupted` | `⊘` | Yellow |
| `skipped` | `⊖` | Dim grey |

**Subagent Summary**: Shows count and failure indicator (e.g., "3 subagents" or "5 subagents ✗1")

### IterationDetailView Component

**Location**: `src/tui/components/IterationDetailView.tsx`

Full-screen detailed view of a single iteration, accessed by pressing Enter on an iteration in the history view.

**Sections**:
1. **Header**: Status indicator, "Iteration N of M"
2. **Task info**: Task ID and title
3. **Details box**: Status, start/end times, duration, task/promise completion flags, error
4. **Events Timeline**: Chronological list of events with timestamps
5. **Subagent Activity** (if any): Expandable tree of spawned subagents
6. **Persisted Output**: File path to the iteration log
7. **Agent Output**: Scrollable output with syntax highlighting for code blocks

**Navigation**: Press `Esc` to return to iteration list

## Subagent Tracing Panel

The TUI provides two ways to view subagent activity:

### 1. SubagentTreePanel Component

**Location**: `src/tui/components/SubagentTreePanel.tsx`

A dedicated side panel showing the subagent hierarchy. Toggled with `Shift+T`.

**Props**:
```typescript
interface SubagentTreePanelProps {
  tree: SubagentTreeNode[];
  activeSubagentId?: string;
  width?: number;
}
```

**Features**:
- **Tree structure**: Indented display showing parent-child relationships
- **Status icons**: Running (`◐`), completed (`✓`), error (`✗`)
- **Auto-highlighting**: Currently running subagent is highlighted
- **Duration display**: Shows execution time for each subagent
- **Title with counts**: "Subagents (N running / M total)"
- **Auto-scroll**: Scrolls to newest activity

**Row Format**:
```
[indent][status] [AgentType] description [duration]
```

### 2. SubagentSection Component

**Location**: `src/tui/components/SubagentSection.tsx`

Collapsible subagent sections displayed inline in the output view.

**Detail Levels** (cycled with `t` key):
| Level | Display |
|-------|---------|
| `off` | No subagent tracing, raw output only |
| `minimal` | Single line per subagent (start/complete events) |
| `moderate` | Header + collapsed summary, expandable |
| `full` | Header + nested output + full hierarchy |

**Section Header Format**:
```
[▼/▶] [status] [Subagent: type] description [duration]
```

**Collapsed Summary**: Shows status and nested subagent count

## Output Parser

**Location**: `src/tui/output-parser.ts`

Parses agent output to extract readable content from JSONL format.

### Batch Parser

```typescript
function parseAgentOutput(rawOutput: string): string
```

Handles:
- **JSONL output**: Extracts `result` field from Claude Code result events
- **Assistant events**: Extracts text content from message blocks
- **Plain text**: Passes through as-is
- **Mixed content**: Extracts readable parts

### Streaming Parser

```typescript
class StreamingOutputParser {
  push(chunk: string): string;  // Returns newly extracted content
  getOutput(): string;          // Returns accumulated parsed output
  getResultText(): string;      // Returns final result from 'result' event
  reset(): void;                // Clears state for new iteration
}
```

**Features**:
- **Real-time processing**: Extracts content as chunks arrive
- **Memory management**: Limits buffer to 100KB, trims oldest content
- **Event filtering**: Skips verbose tool_use/tool_result events
- **Result deduplication**: Saves result text separately to avoid duplicate display

### JSONL Event Types Handled

| Event Type | Handling |
|------------|----------|
| `result` | Extract `result` field (final output) |
| `assistant` | Extract text from `message.content` |
| `error` | Format as "Error: message" |
| `user` | Skip (tool results, too verbose) |
| `system` | Skip (not user-facing) |
| `tool_use` | Skip (too verbose) |
| `tool_result` | Skip (too verbose) |

## Component Props Reference

### TaskItem

```typescript
interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  description?: string;
  iteration?: number;
  priority?: TaskPriority;  // 0-4 (0=Critical, 4=Backlog)
  labels?: string[];
  type?: string;
  dependsOn?: string[];
  blocks?: string[];
  blockedByTasks?: BlockerInfo[];
  closeReason?: string;
  acceptanceCriteria?: string;
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}
```

### LeftPanelProps

```typescript
interface LeftPanelProps {
  tasks: TaskItem[];
  selectedIndex: number;
  onSelectTask?: (index: number) => void;
  onTaskDrillDown?: (task: TaskItem) => void;
}
```

### RightPanelProps

```typescript
interface RightPanelProps {
  selectedTask: TaskItem | null;
  currentIteration: number;
  iterationOutput?: string;
  viewMode?: 'details' | 'output';
  iterationTiming?: IterationTimingInfo;
  subagentDetailLevel?: SubagentDetailLevel;
  subagentTree?: SubagentTreeNode[];
  collapsedSubagents?: Set<string>;
  focusedSubagentId?: string;
  onSubagentToggle?: (id: string) => void;
}
```

### HeaderProps

```typescript
interface HeaderProps {
  status: RalphStatus;
  elapsedTime: number;
  currentTaskId?: string;
  currentTaskTitle?: string;
  completedTasks?: number;
  totalTasks?: number;
  agentName?: string;
  trackerName?: string;
  activeAgentState?: ActiveAgentState | null;
  rateLimitState?: RateLimitState | null;
  currentIteration?: number;
  maxIterations?: number;
}
```

## Data Flow

### Engine Events to UI State

The `RunApp` component subscribes to engine events and updates state accordingly:

```typescript
engine.on((event: EngineEvent) => {
  switch (event.type) {
    case 'engine:started':
      setStatus('selecting');
      setTasks(convertTasksWithDependencyStatus(event.tasks));
      break;
    case 'iteration:started':
      setCurrentIteration(event.iteration);
      setCurrentOutput('');
      outputParserRef.current.reset();
      setSubagentTree([]);
      setStatus('executing');
      setDetailsViewMode('output');  // Auto-switch to output
      break;
    case 'agent:output':
      if (event.stream === 'stdout') {
        outputParserRef.current.push(event.data);
        setCurrentOutput(outputParserRef.current.getOutput());
      }
      if (subagentDetailLevel !== 'off') {
        setSubagentTree(engine.getSubagentTree());
      }
      break;
    case 'iteration:completed':
      // Update task status, recalculate dependencies
      // Add iteration to history
      break;
    // ... other events
  }
});
```

### Task Status Calculation

Tasks are converted from tracker format with dependency-aware status:

1. **Initial conversion**: `trackerTaskToTaskItem()` maps tracker status to TUI status
2. **Dependency check**: `convertTasksWithDependencyStatus()` determines if tasks are:
   - `actionable`: No dependencies OR all dependencies resolved
   - `blocked`: Has unresolved dependencies
3. **Recalculation**: `recalculateDependencyStatus()` updates after task completion

### Historical Output Loading

For completed tasks, iteration output is loaded from disk:

```typescript
// In useEffect when selectedTask changes
if (isCompleted && !hasInMemory && !hasInCache) {
  getIterationLogsByTask(cwd, selectedTask.id).then((logs) => {
    // Cache the most recent log's output and timing
    setHistoricalOutputCache((prev) => {
      const next = new Map(prev);
      next.set(selectedTask.id, { output, timing });
      return next;
    });
  });
}
```

## Related Documentation

- Engine types: `src/engine/types.ts`
- Tracker types: `src/plugins/trackers/types.ts`
- Configuration types: `src/config/types.ts`
- Log types: `src/logs/types.ts`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented all TUI components in `src/tui/` directory
- Covered theme system, keyboard handling, dashboard, panels, and output parser
