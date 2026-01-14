---
date: 2026-01-14T00:00:00Z
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Session Management System"
tags: [session, lock, persistence, recovery, graceful-shutdown, active-tasks]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Session Management System

## Overview

The session management system in Ralph TUI provides single-instance enforcement, state persistence, resume functionality, stale session detection/recovery, active task tracking, and graceful shutdown handling. The system ensures that only one Ralph instance runs per repository at a time and that session state can be recovered after crashes or interruptions.

## Architecture

The session management system is composed of four main modules:

| Module | Location | Purpose |
|--------|----------|---------|
| Types | `src/session/types.ts` | Type definitions for session state, lock files, and related structures |
| Index | `src/session/index.ts` | Core session operations, lock management, and module exports |
| Lock | `src/session/lock.ts` | Single-instance enforcement with user-friendly prompts |
| Persistence | `src/session/persistence.ts` | Full session state persistence and recovery |

## Components

### Session Types (`src/session/types.ts`)

**Location**: `src/session/types.ts`
**Purpose**: Defines all TypeScript types and interfaces for the session management system.

#### SessionStatus Type

```typescript
export type SessionStatus =
  | 'running'     // Session is actively executing
  | 'paused'      // Session manually paused by user
  | 'completed'   // Session finished successfully
  | 'failed'      // Session terminated due to error
  | 'interrupted';// Session stopped by signal (Ctrl+C)
```

#### LockFile Interface

The lock file structure stored in `.ralph-tui/ralph.lock`:

```typescript
export interface LockFile {
  pid: number;        // Process ID holding the lock
  sessionId: string;  // Associated session identifier
  acquiredAt: string; // ISO 8601 timestamp
  cwd: string;        // Working directory
  hostname: string;   // Host machine name
}
```

#### SessionMetadata Interface

Basic session metadata stored for compatibility:

```typescript
export interface SessionMetadata {
  id: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  agentPlugin: string;
  trackerPlugin: string;
  epicId?: string;
  prdPath?: string;
  currentIteration: number;
  maxIterations: number;
  totalTasks: number;
  tasksCompleted: number;
  cwd: string;
}
```

#### SessionCheckResult Interface

Result structure from checking for existing sessions:

```typescript
export interface SessionCheckResult {
  hasSession: boolean;
  session?: SessionMetadata;
  isLocked: boolean;
  lock?: LockFile;
  isStale: boolean;
}
```

### Core Session Operations (`src/session/index.ts`)

**Location**: `src/session/index.ts`
**Purpose**: Provides the main session and lock management functions.

#### File Locations

```typescript
const SESSION_DIR = '.ralph-tui';
const LOCK_FILE = 'ralph.lock';
const SESSION_FILE = 'session.json';
```

All session data is stored in the `.ralph-tui/` directory relative to the working directory.

#### Process Detection

The `isProcessRunning()` function checks if a process is still alive:

```typescript
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 tests process existence
    return true;
  } catch {
    return false;
  }
}
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `checkSession(cwd)` | Checks for existing session and lock status |
| `acquireLock(cwd, sessionId)` | Creates lock file for single-instance enforcement |
| `releaseLock(cwd)` | Removes lock file |
| `cleanStaleLock(cwd)` | Removes lock if owning process no longer running |
| `createSession(options)` | Creates new session with metadata |
| `saveSession(session)` | Persists session metadata to disk |
| `updateSessionStatus(cwd, status)` | Updates session status |
| `updateSessionIteration(cwd, iteration, tasksCompleted)` | Updates iteration progress |
| `updateSessionMaxIterations(cwd, maxIterations)` | Updates max iterations dynamically |
| `endSession(cwd, status)` | Ends session and releases lock |
| `resumeSession(cwd)` | Resumes existing session with fresh lock |

### Lock Management (`src/session/lock.ts`)

**Location**: `src/session/lock.ts`
**Purpose**: Single-instance enforcement with user-friendly prompts and stale lock handling.

#### LockCheckResult Interface

```typescript
export interface LockCheckResult {
  isLocked: boolean;  // Another process is running
  isStale: boolean;   // Lock exists but process is dead
  lock?: LockFile;    // Lock file contents if present
}
```

#### LockAcquisitionResult Interface

```typescript
export interface LockAcquisitionResult {
  acquired: boolean;
  error?: string;
  existingPid?: number;
}
```

#### Lock Acquisition Flow

The `acquireLockWithPrompt()` function handles lock acquisition with these scenarios:

1. **No lock exists**: Acquire immediately
2. **Lock held by running process**: Block with error message
3. **Stale lock detected**: Prompt user (or auto-clean in non-interactive mode)
4. **Force flag set**: Override existing lock

```typescript
export async function acquireLockWithPrompt(
  cwd: string,
  sessionId: string,
  options: {
    force?: boolean;        // Override existing lock
    nonInteractive?: boolean; // Skip prompts (headless mode)
  } = {}
): Promise<LockAcquisitionResult>
```

#### Stale Lock Handling

When a stale lock is detected (process no longer running), the system displays a warning:

```
  Stale lock detected

A previous Ralph session did not exit cleanly:
  PID:      12345 (no longer running)
  Started:  1/14/2026, 10:30:00 AM
  Host:     hostname

This may happen if Ralph was terminated unexpectedly (crash, kill -9, etc.).
```

The user is prompted to remove the stale lock and continue.

#### Cleanup Handlers Registration

The `registerLockCleanupHandlers()` function sets up process signal handlers:

```typescript
export function registerLockCleanupHandlers(cwd: string): () => void {
  // Handles: exit, SIGTERM, uncaughtException, unhandledRejection
  // Returns cleanup function to remove handlers
}
```

Handlers are registered for:
- `exit`: Synchronous cleanup (limited)
- `SIGTERM`: Graceful shutdown signal
- `uncaughtException`: Unexpected errors
- `unhandledRejection`: Promise rejections

### Session Persistence (`src/session/persistence.ts`)

**Location**: `src/session/persistence.ts`
**Purpose**: Full session state persistence including task statuses, iteration history, and tracker state.

#### PersistedSessionState Interface

The complete session state structure stored in `.ralph-tui/session.json`:

```typescript
export interface PersistedSessionState {
  version: 1;                          // Schema version
  sessionId: string;                   // Unique identifier
  status: SessionStatus;               // Current status
  startedAt: string;                   // ISO 8601 start time
  updatedAt: string;                   // ISO 8601 last update
  pausedAt?: string;                   // When paused (if applicable)
  currentIteration: number;            // 0-based iteration count
  maxIterations: number;               // Limit (0 = unlimited)
  tasksCompleted: number;              // Completed count
  isPaused: boolean;                   // Paused flag
  agentPlugin: string;                 // Active agent
  model?: string;                      // Model if specified
  trackerState: TrackerStateSnapshot;  // Tracker configuration
  iterations: PersistedIterationResult[]; // History
  skippedTaskIds: string[];            // Tasks skipped
  cwd: string;                         // Working directory
  activeTaskIds: string[];             // Tasks currently in_progress
  subagentPanelVisible?: boolean;      // UI preference
}
```

#### TaskStatusSnapshot Interface

```typescript
export interface TaskStatusSnapshot {
  id: string;
  title: string;
  status: TrackerTaskStatus;
  completedInSession: boolean;
}
```

#### TrackerStateSnapshot Interface

```typescript
export interface TrackerStateSnapshot {
  plugin: string;
  epicId?: string;
  prdPath?: string;
  totalTasks: number;
  tasks: TaskStatusSnapshot[];
}
```

#### PersistedIterationResult Interface

```typescript
export interface PersistedIterationResult {
  iteration: number;      // 1-based for display
  status: IterationResult['status'];
  taskId: string;
  taskTitle: string;
  taskCompleted: boolean;
  durationMs: number;
  error?: string;
  startedAt: string;
  endedAt: string;
}
```

#### Key Persistence Functions

| Function | Purpose |
|----------|---------|
| `hasPersistedSession(cwd)` | Check if session file exists |
| `loadPersistedSession(cwd)` | Load and validate session state |
| `savePersistedSession(state)` | Save session state to disk |
| `deletePersistedSession(cwd)` | Remove session file |
| `createPersistedSession(options)` | Create new session state |
| `updateSessionAfterIteration(state, result)` | Update after iteration |
| `pauseSession(state)` | Mark session as paused |
| `resumePersistedSession(state)` | Mark session as running |
| `completeSession(state)` | Mark session as completed |
| `failSession(state, error)` | Mark session as failed |
| `isSessionResumable(state)` | Check if session can resume |
| `getSessionSummary(state)` | Get summary for display |

#### Active Task Tracking

Active task tracking enables crash recovery by tracking which tasks the session set to `in_progress`:

```typescript
// Add task to active list when starting work
export function addActiveTask(state, taskId): PersistedSessionState

// Remove from active list when completed
export function removeActiveTask(state, taskId): PersistedSessionState

// Clear all active tasks (graceful shutdown)
export function clearActiveTasks(state): PersistedSessionState

// Get list of active task IDs
export function getActiveTasks(state): string[]
```

#### Stale Session Detection and Recovery

The `detectAndRecoverStaleSession()` function handles automatic recovery:

```typescript
export interface StaleSessionRecoveryResult {
  wasStale: boolean;
  clearedTaskCount: number;
  previousStatus?: SessionStatus;
}

export async function detectAndRecoverStaleSession(
  cwd: string,
  checkLock: (cwd: string) => Promise<{ isLocked: boolean; isStale: boolean }>
): Promise<StaleSessionRecoveryResult>
```

A session is considered stale if:
1. Status is `'running'` (indicating it was active)
2. Lock file is stale (process no longer running) or missing

Recovery actions:
1. Clear `activeTaskIds` (tasks that were being worked on)
2. Set status to `'interrupted'` (so it can be resumed)
3. Save the recovered session

## Data Flow

### Session Startup Flow

```
User runs "ralph-tui run"
          |
          v
   Check for config
          |
          v
   Initialize plugins
          |
          v
+-- detectAndRecoverStaleSession() <-- Early recovery before prompts
|         |
|         v
|  Check for existing session
|         |
|         v
|  +-- Session exists? --+
|  |                     |
|  v (yes)              v (no)
|  promptResumeOrNew()   |
|         |              |
|         v              v
|  +-- Resume? --+  Create new session
|  |            |       |
|  v (yes)     v (no)   |
|  Resume   Delete old  |
|    |          |       |
|    +----+-----+-------+
|         |
|         v
+-> acquireLockWithPrompt()
          |
          v
   registerLockCleanupHandlers()
          |
          v
   createSession() / resumeSession()
          |
          v
   Create ExecutionEngine
          |
          v
   createPersistedSession()
          |
          v
   savePersistedSession()
          |
          v
   Start TUI or Headless execution
```

### Iteration Lifecycle Flow

```
Engine selects task
       |
       v
tracker.updateTaskStatus(taskId, 'in_progress')
       |
       v
Emit 'task:activated' event
       |
       v
addActiveTask(state, taskId)  <-- Track for crash recovery
       |
       v
savePersistedSession(state)
       |
       v
Execute agent with prompt
       |
       v
+-- Task completed? --+
|                     |
v (yes)              v (no)
removeActiveTask()    Continue next iteration
       |
       v
updateSessionAfterIteration()
       |
       v
savePersistedSession()
```

### Graceful Shutdown Flow

```
User presses Ctrl+C or q
          |
          v
Interrupt handler triggered
          |
          v
+-- Show confirmation dialog (TUI) --+
|                                     |
v (confirm)                    v (cancel)
gracefulShutdown()              Resume
       |
       v
getActiveTasks(state)
       |
       v
engine.resetTasksToOpen(activeTasks)  <-- Reset in_progress to open
       |
       v
clearActiveTasks(state)
       |
       v
savePersistedSession(state)
       |
       v
releaseLock(cwd)
       |
       v
Exit process
```

### Stale Session Recovery Flow

```
User runs "ralph-tui run" or "ralph-tui resume"
          |
          v
detectAndRecoverStaleSession(cwd, checkLock)
          |
          v
+-- Has persisted session? --+
|                            |
v (yes)                     v (no)
Load session                 Return (no recovery needed)
   |
   v
+-- Status is 'running'? --+
|                          |
v (yes)                   v (no)
Check lock status          Return (not stale)
   |
   v
+-- Lock stale or missing? --+
|                            |
v (yes)                     v (no)
Session is STALE             Return (process still running)
   |
   v
Clear activeTaskIds
   |
   v
Set status to 'interrupted'
   |
   v
Save recovered session
   |
   v
Return recovery result
```

## Configuration

### Session Directory Structure

```
.ralph-tui/
  ralph.lock        # Lock file for single-instance enforcement
  session.json      # Full session state
  iterations/       # Per-iteration logs (separate module)
  progress.md       # Cross-iteration progress summary
  config.toml       # Project configuration (separate module)
```

### Lock File Format (`.ralph-tui/ralph.lock`)

```json
{
  "pid": 12345,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "acquiredAt": "2026-01-14T10:30:00.000Z",
  "cwd": "/path/to/project",
  "hostname": "my-machine"
}
```

### Session File Format (`.ralph-tui/session.json`)

```json
{
  "version": 1,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "startedAt": "2026-01-14T10:30:00.000Z",
  "updatedAt": "2026-01-14T10:35:00.000Z",
  "currentIteration": 5,
  "maxIterations": 20,
  "tasksCompleted": 3,
  "isPaused": false,
  "agentPlugin": "claude",
  "model": "opus",
  "trackerState": {
    "plugin": "beads",
    "epicId": "epic-123",
    "totalTasks": 10,
    "tasks": [...]
  },
  "iterations": [...],
  "skippedTaskIds": [],
  "cwd": "/path/to/project",
  "activeTaskIds": ["task-7"],
  "subagentPanelVisible": false
}
```

## Usage Examples

### Checking Session Status

```typescript
import { checkSession } from '../session/index.js';

const result = await checkSession(cwd);
if (result.hasSession) {
  console.log(`Session exists: ${result.session?.id}`);
}
if (result.isLocked) {
  console.log(`Locked by PID: ${result.lock?.pid}`);
}
if (result.isStale) {
  console.log('Lock is stale (process no longer running)');
}
```

### Acquiring Lock with Prompts

```typescript
import { acquireLockWithPrompt, registerLockCleanupHandlers } from '../session/index.js';

const lockResult = await acquireLockWithPrompt(cwd, sessionId, {
  force: options.force,
  nonInteractive: options.headless,
});

if (!lockResult.acquired) {
  console.error(lockResult.error);
  process.exit(1);
}

// Register cleanup handlers for graceful shutdown
const cleanup = registerLockCleanupHandlers(cwd);
```

### Creating and Managing Session State

```typescript
import {
  createPersistedSession,
  savePersistedSession,
  addActiveTask,
  removeActiveTask,
  updateSessionAfterIteration,
} from '../session/index.js';

// Create initial state
let state = createPersistedSession({
  sessionId: session.id,
  agentPlugin: 'claude',
  trackerPlugin: 'beads',
  epicId: 'epic-123',
  maxIterations: 20,
  tasks: taskList,
  cwd: process.cwd(),
});

// Save initial state
await savePersistedSession(state);

// Track active task
state = addActiveTask(state, taskId);
await savePersistedSession(state);

// After iteration completes
state = updateSessionAfterIteration(state, iterationResult);
if (iterationResult.taskCompleted) {
  state = removeActiveTask(state, taskId);
}
await savePersistedSession(state);
```

### Detecting and Recovering Stale Sessions

```typescript
import { detectAndRecoverStaleSession, checkLock } from '../session/index.js';

const recovery = await detectAndRecoverStaleSession(cwd, checkLock);
if (recovery.wasStale) {
  console.log('Recovered stale session');
  console.log(`Cleared ${recovery.clearedTaskCount} stuck tasks`);
}
```

## Integration Points

### With ExecutionEngine (`src/engine/index.ts`)

The engine uses session functions for:
- `updateSessionIteration()` - After each iteration
- `updateSessionStatus()` - On stop/pause
- `updateSessionMaxIterations()` - When adding iterations dynamically

### With Run Command (`src/commands/run.tsx`)

The run command orchestrates:
- Early stale session recovery
- Lock acquisition with prompts
- Session creation and persistence
- Event-based state updates (task:activated, iteration:completed, etc.)
- Graceful shutdown with task reset

### With Resume Command (`src/commands/resume.tsx`)

The resume command handles:
- Stale session recovery before resuming
- Lock acquisition for resumed session
- State restoration from persisted file

### With Status Command (`src/commands/status.ts`)

The status command uses:
- `hasPersistedSession()` - Check for session file
- `loadPersistedSession()` - Load session data
- `getSessionSummary()` - Display summary
- `checkLock()` - Show lock status

## Testing

Test files for session management are expected at:
- `src/session/__tests__/index.test.ts`
- `src/session/__tests__/lock.test.ts`
- `src/session/__tests__/persistence.test.ts`

Key test scenarios:
1. Lock acquisition and release
2. Stale lock detection and cleanup
3. Session persistence round-trip
4. Active task tracking through iteration lifecycle
5. Stale session recovery
6. Graceful shutdown task reset

## Related Documentation

- Engine system documentation (iteration execution)
- Tracker plugin documentation (task status management)
- TUI component documentation (interrupt handling UI)

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented lock files for single-instance enforcement
- Documented session persistence and resume functionality
- Documented stale session detection/recovery
- Documented active task tracking
- Documented graceful shutdown handling
