---
date: 2026-01-14T00:00:00-05:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Interruption Handling System"
tags: [interruption, signal-handling, ctrl-c, graceful-shutdown, confirmation-dialog, sigint, sigterm]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Interruption Handling System

## Overview

The interruption handling system provides graceful Ctrl+C (SIGINT) handling for Ralph TUI. It implements a multi-tier approach that balances user convenience with the need for immediate exit capabilities. The system uses a confirmation dialog flow for the first Ctrl+C press, with double-press detection for forced immediate exit.

The design ensures that:
1. Users are prompted before interrupting active work
2. A quick double-press provides an immediate escape hatch
3. Active tasks are properly reset during graceful shutdown
4. Session state is persisted for potential resumption

## Architecture

The interruption handling system consists of three primary layers:

1. **Core Interrupt Handler** (`src/interruption/handler.ts`) - State machine managing interrupt signals
2. **UI Integration** (`src/tui/components/ConfirmationDialog.tsx`) - Visual confirmation dialog
3. **Command Integration** (`src/commands/run.tsx`) - Wiring the handler to React components and engine

### Component Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                      Process Signals                             │
│                    (SIGINT, SIGTERM)                            │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    InterruptHandler                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ State Machine: idle → confirming → interrupting/force_quit│   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  • Manages SIGINT signal registration                           │
│  • Double-press detection (1000ms window)                       │
│  • Delegates to callbacks for UI and shutdown                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│ onShowDialog│  │ onConfirmed  │  │ onForceQuit │
│ onHideDialog│  │ onCancelled  │  │             │
└──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │                │                  │
       ▼                ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│Confirmation │  │  Graceful    │  │   Force     │
│   Dialog    │  │  Shutdown    │  │    Exit     │
│   (React)   │  │  (async)     │  │ process.exit│
└─────────────┘  └──────────────┘  └─────────────┘
```

## Components

### InterruptHandler
**Location**: `src/interruption/handler.ts`
**Purpose**: Core interrupt handling logic with state machine and signal management

The interrupt handler is created via the `createInterruptHandler()` factory function. It manages the complete interrupt lifecycle through a state machine with four states:

#### State Machine States

| State | Description |
|-------|-------------|
| `idle` | No interrupt in progress; normal operation |
| `confirming` | First Ctrl+C received; dialog shown, awaiting user response |
| `interrupting` | User confirmed; graceful shutdown in progress |
| `force_quit` | Double Ctrl+C detected; immediate exit |

**State Transitions**:
```
                    ┌─────────────────────────────────┐
                    │                                 │
                    ▼                                 │
              ┌─────────┐    First Ctrl+C      ┌───────────┐
              │  idle   │ ─────────────────► │ confirming │
              └─────────┘                     └───────────┘
                    ▲                               │
                    │                               │
              User presses                    ┌────┴────┐
              'n' or Esc                      │         │
                    │                         ▼         ▼
                    │                    User 'y'   Double Ctrl+C
                    │                         │         │
                    │                         ▼         ▼
              ┌─────────┐             ┌─────────────┐ ┌────────────┐
              │  idle   │ ◄────────  │ interrupting│ │ force_quit │
              └─────────┘             └─────────────┘ └────────────┘
                                            │               │
                                            ▼               ▼
                                      Graceful         Immediate
                                      Shutdown        process.exit(1)
```

#### Implementation Details

```typescript
// Factory function signature
export function createInterruptHandler(
  options: InterruptHandlerOptions
): InterruptHandler
```

**Key Constants**:
- `DEFAULT_DOUBLE_PRESS_WINDOW_MS = 1000` - Time window for double-press detection

**Internal State**:
- `state: InterruptState` - Current state machine state
- `lastSigintTime: number` - Timestamp of last SIGINT for double-press detection
- `signalHandler: (() => void) | null` - Reference to installed signal handler

**Signal Installation**:
The handler automatically installs a SIGINT listener on creation via `process.on('SIGINT', signalHandler)`. The handler is removed when `dispose()` is called.

### InterruptHandlerOptions
**Location**: `src/interruption/types.ts:23-41`
**Purpose**: Configuration interface for interrupt handler callbacks

```typescript
export interface InterruptHandlerOptions {
  /** Time window in milliseconds for double-press detection (default: 1000ms) */
  doublePressWindowMs?: number;

  /** Callback when interrupt is confirmed */
  onConfirmed: () => Promise<void>;

  /** Callback when interrupt is cancelled */
  onCancelled: () => void;

  /** Callback to show the confirmation dialog */
  onShowDialog: () => void;

  /** Callback to hide the confirmation dialog */
  onHideDialog: () => void;

  /** Callback for force quit (double Ctrl+C) */
  onForceQuit: () => void;
}
```

### InterruptHandler Interface
**Location**: `src/interruption/types.ts:46-61`
**Purpose**: Public interface returned by the factory function

```typescript
export interface InterruptHandler {
  /** Handle a SIGINT signal */
  handleSigint(): void;

  /** Handle user response to confirmation dialog */
  handleResponse(response: ConfirmationResponse): Promise<void>;

  /** Get current interrupt state */
  getState(): InterruptState;

  /** Reset to idle state */
  reset(): void;

  /** Cleanup and remove signal handlers */
  dispose(): void;
}
```

### ConfirmationDialog Component
**Location**: `src/tui/components/ConfirmationDialog.tsx`
**Purpose**: Visual confirmation dialog displayed when user presses Ctrl+C

The dialog is a modal overlay that appears centered on screen. It displays a title, message, and hint text showing available keyboard shortcuts. The component is purely presentational - keyboard handling is managed by the parent `RunApp` component.

**Props**:
```typescript
interface ConfirmationDialogProps {
  visible: boolean;  // Whether the dialog is shown
  title: string;     // Dialog title (e.g., "Interrupt Ralph?")
  message: string;   // Body message
  hint?: string;     // Keyboard hint (default: "[y] Yes  [n/Esc] No")
}
```

**Visual Appearance**:
- 50 character width, 9 lines height
- Warning-colored border (yellow/orange from theme)
- Secondary background color
- Centered within the terminal

### RunApp Integration
**Location**: `src/tui/components/RunApp.tsx:671-685`
**Purpose**: Keyboard event handling for confirmation dialog responses

When `showInterruptDialog` is true, the `RunApp` component captures keyboard events:

```typescript
// When interrupt dialog is showing, only handle y/n/Esc
if (showInterruptDialog) {
  switch (key.name) {
    case 'y':
      onInterruptConfirm?.();
      break;
    case 'n':
    case 'escape':
      onInterruptCancel?.();
      break;
  }
  return; // Don't process other keys when dialog is showing
}
```

## Data Flow

### Signal Flow: First Ctrl+C Press

1. User presses Ctrl+C
2. OS delivers SIGINT to Node.js process
3. `handleSigint()` in interrupt handler is invoked
4. Handler checks if within double-press window (no, this is first press)
5. State transitions: `idle` → `confirming`
6. `onShowDialog()` callback invoked
7. `RunAppWrapper` sets `showInterruptDialog = true`
8. React re-renders with `ConfirmationDialog` visible

### Signal Flow: User Confirms (presses 'y')

1. `RunApp.handleKeyboard()` receives 'y' keypress
2. Calls `onInterruptConfirm()` prop
3. `RunAppWrapper` sets `showInterruptDialog = false`
4. Calls `onInterruptConfirmed()` which triggers `gracefulShutdown()`
5. Interrupt handler state transitions: `confirming` → `interrupting`

### Signal Flow: Double Ctrl+C (Force Quit)

1. User presses Ctrl+C
2. Handler records timestamp, transitions to `confirming`
3. User presses Ctrl+C again within 1000ms
4. Handler detects double-press (time since last < `doublePressWindowMs`)
5. State transitions: `confirming` → `force_quit`
6. `onForceQuit()` callback invoked
7. `process.exit(1)` called for immediate termination

### Graceful Shutdown Sequence

**Location**: `src/commands/run.tsx:826-843`

```typescript
const gracefulShutdown = async (): Promise<void> => {
  // 1. Reset any active (in_progress) tasks back to open
  const activeTasks = getActiveTasks(currentState);
  if (activeTasks.length > 0) {
    const resetCount = await engine.resetTasksToOpen(activeTasks);
    if (resetCount > 0) {
      currentState = clearActiveTasks(currentState);
    }
  }

  // 2. Save current state (may be completed, interrupted, etc.)
  await savePersistedSession(currentState);

  // 3. Cleanup (dispose handler, destroy renderer)
  await cleanup();

  // 4. Resolve quit promise to exit TUI loop
  resolveQuitPromise?.();
};
```

## Configuration

### Double-Press Window

The default double-press window is 1000ms (1 second). This can be customized via the `doublePressWindowMs` option:

```typescript
const interruptHandler = createInterruptHandler({
  doublePressWindowMs: 1000, // Default value
  // ... other callbacks
});
```

### Headless Mode Differences

**Location**: `src/commands/run.tsx:951-1198`

In headless mode (no TUI), the interrupt handling is simpler:
- No confirmation dialog is shown
- First Ctrl+C triggers immediate graceful shutdown with a message
- Double Ctrl+C within 1 second forces immediate exit

```typescript
// Headless SIGINT handler
const handleSigint = async (): Promise<void> => {
  const now = Date.now();
  const timeSinceLastSigint = now - lastSigintTime;
  lastSigintTime = now;

  // Check for double-press - force quit immediately
  if (timeSinceLastSigint < DOUBLE_PRESS_WINDOW_MS) {
    logger.warn('system', 'Force quit!');
    process.exit(1);
  }

  // Single press - graceful shutdown
  await gracefulShutdown();
};
```

## Integration Points

### Engine Integration

The interrupt handler integrates with the execution engine through:

1. **engine.stop()** - Called during graceful shutdown to stop the execution loop
2. **engine.resetTasksToOpen()** - Resets any in-progress tasks back to open status
3. **engine.dispose()** - Final cleanup of engine resources

### Session Persistence Integration

The interrupt handler coordinates with session persistence:

1. **getActiveTasks()** - Retrieves tasks marked as in-progress by this session
2. **clearActiveTasks()** - Clears active task tracking after reset
3. **savePersistedSession()** - Saves final session state before exit

### SIGTERM Handling

In addition to SIGINT (Ctrl+C), the system handles SIGTERM separately:

**Location**: `src/commands/run.tsx:868`

```typescript
// Handle SIGTERM separately (always graceful, no double-press)
process.on('SIGTERM', gracefulShutdown);
```

SIGTERM always triggers graceful shutdown without the double-press mechanism.

## Usage Examples

### Creating an Interrupt Handler

```typescript
import { createInterruptHandler } from '../interruption/index.js';

const interruptHandler = createInterruptHandler({
  doublePressWindowMs: 1000,

  onConfirmed: async () => {
    // Perform graceful shutdown
    await cleanup();
  },

  onCancelled: () => {
    // User cancelled - return to normal operation
  },

  onShowDialog: () => {
    // Show confirmation dialog (set React state)
    setShowDialog(true);
  },

  onHideDialog: () => {
    // Hide confirmation dialog
    setShowDialog(false);
  },

  onForceQuit: () => {
    // Immediate exit
    process.exit(1);
  },
});

// Later, cleanup when done
interruptHandler.dispose();
```

### Integrating with React Components

**Location**: `src/commands/run.tsx:550-690`

The `RunAppWrapper` component manages the dialog state and wires callbacks:

```typescript
function RunAppWrapper({ engine, interruptHandler, onQuit, onInterruptConfirmed }) {
  const [showInterruptDialog, setShowInterruptDialog] = useState(false);

  // Wire callbacks to the interrupt handler
  (interruptHandler as any)._showDialog = () => setShowInterruptDialog(true);
  (interruptHandler as any)._hideDialog = () => setShowInterruptDialog(false);
  (interruptHandler as any)._cancelled = () => setShowInterruptDialog(false);

  return (
    <RunApp
      showInterruptDialog={showInterruptDialog}
      onInterruptConfirm={async () => {
        setShowInterruptDialog(false);
        await onInterruptConfirmed();
      }}
      onInterruptCancel={() => {
        setShowInterruptDialog(false);
        interruptHandler.reset();
      }}
      // ... other props
    />
  );
}
```

## Related Documentation

- Engine execution loop and state management
- Session persistence system
- Task status management

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented interrupt handler state machine
- Documented double-press detection mechanism
- Documented confirmation dialog flow
- Documented graceful shutdown coordination
- Documented headless mode differences
- Documented integration with engine and session persistence
