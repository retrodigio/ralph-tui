# Implementation Plan: Parallel Workers with Worktree Isolation

## Overview

Transform ralph-tui from a single-agent sequential executor into a multi-worker parallel system where each worker operates in an isolated git worktree, with a refinery component handling merge coordination.

### Goals

1. **Parallel Execution**: Multiple workers processing independent tasks simultaneously
2. **Worktree Isolation**: Each worker operates in its own git worktree (no conflicts during work)
3. **Refinery Merge Queue**: Coordinated merging with conflict detection and resolution
4. **Dependency Awareness**: Only dispatch tasks whose dependencies are merged
5. **Rate Limit Coordination**: Shared rate limit state with fallback chain across workers
6. **Enhanced TUI**: Visualize all workers, merge queue, and system health

### Non-Goals (v1)

- Cross-repo convoys (single repo focus)
- Mail system for worker communication (direct coordination via pool)
- Persistent worker identities/CVs (stateless workers)
- Integration branches per epic (direct to main)

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           ralph-tui                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐ │
│  │ Scheduler  │──▶│ WorkerPool │──▶│  Workers   │──▶│  Refinery  │ │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘ │
│        │                │                │                │         │
│        ▼                ▼                ▼                ▼         │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐   ┌────────────┐ │
│  │   Beads    │   │ RateLimit  │   │  Worktree  │   │   Merge    │ │
│  │  + bv      │   │ Coordinator│   │  Manager   │   │   Queue    │ │
│  └────────────┘   └────────────┘   └────────────┘   └────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### New Directory Structure

```
src/
├── engine/
│   └── index.ts              # Existing (becomes single-worker engine)
├── pool/
│   ├── index.ts              # WorkerPool - orchestrates workers
│   ├── scheduler.ts          # Task selection using bv
│   ├── worker.ts             # Worker abstraction (wraps engine)
│   └── rate-limit-coordinator.ts  # Shared rate limit state
├── worktree/
│   ├── index.ts              # WorktreeManager
│   ├── names.ts              # Themed name pool (mad-max, etc.)
│   └── git.ts                # Git worktree operations
├── refinery/
│   ├── index.ts              # Refinery coordinator
│   ├── queue.ts              # Merge queue (beads-backed)
│   ├── merger.ts             # Git merge operations
│   └── conflict.ts           # Conflict detection/resolution
├── tui/
│   ├── components/
│   │   ├── WorkerPanel.tsx       # NEW: Individual worker view
│   │   ├── WorkerListPanel.tsx   # NEW: All workers overview
│   │   ├── RefineryPanel.tsx     # NEW: Merge queue status
│   │   └── ... (existing)
│   └── App.tsx               # Updated for multi-worker
└── ...
```

---

## Phase 1: Foundation (Worktree & Worker Abstraction)

### 1.1 Worktree Manager

**File**: `src/worktree/index.ts`

```typescript
interface WorktreeConfig {
  baseDir: string;           // ".ralph-workers"
  branchPrefix: string;      // "work"
}

interface Worktree {
  name: string;              // "nux"
  path: string;              // "/repo/.ralph-workers/nux"
  branch: string;            // "work/nux/gt-abc"
  taskId: string | null;
  createdAt: Date;
}

class WorktreeManager {
  // Create worktree for a task
  async create(name: string, taskId: string): Promise<Worktree>;

  // Remove worktree after merge
  async remove(name: string): Promise<void>;

  // List active worktrees
  async list(): Promise<Worktree[]>;

  // Reconcile state (cleanup orphans on startup)
  async reconcile(): Promise<void>;
}
```

**Git Operations** (`src/worktree/git.ts`):
```typescript
// git worktree add <path> -b <branch> [<start-point>]
async function createWorktree(path: string, branch: string, startPoint?: string): Promise<void>;

// git worktree remove <path>
async function removeWorktree(path: string): Promise<void>;

// git worktree list --porcelain
async function listWorktrees(): Promise<WorktreeInfo[]>;

// git push origin <branch>
async function pushBranch(worktreePath: string, branch: string): Promise<void>;
```

### 1.2 Name Pool

**File**: `src/worktree/names.ts`

```typescript
class NamePool {
  private nextId: number = 1;
  private released: number[] = [];  // Recycled IDs

  // Get next available name (worker1, worker2, ...)
  acquire(): string {
    if (this.released.length > 0) {
      const id = this.released.shift()!;
      return `worker${id}`;
    }
    return `worker${this.nextId++}`;
  }

  // Return name to pool for reuse
  release(name: string): void {
    const match = name.match(/^worker(\d+)$/);
    if (match) {
      this.released.push(parseInt(match[1], 10));
      this.released.sort((a, b) => a - b);  // Keep sorted for predictable reuse
    }
  }

  // Reconcile with existing worktrees on startup
  reconcile(inUse: string[]): void {
    const usedIds = inUse
      .map(n => n.match(/^worker(\d+)$/))
      .filter(Boolean)
      .map(m => parseInt(m![1], 10));

    this.nextId = usedIds.length > 0 ? Math.max(...usedIds) + 1 : 1;
    this.released = [];
  }
}
```

### 1.3 Worker Abstraction

**File**: `src/pool/worker.ts`

```typescript
interface WorkerConfig {
  name: string;
  worktree: Worktree;
  agent: AgentPlugin;
  tracker: TrackerPlugin;
}

interface WorkerState {
  status: 'idle' | 'working' | 'rate-limited' | 'done' | 'error';
  task: Task | null;
  iteration: number;
  startedAt: Date | null;
  agent: string;            // Current agent name
  output: string;           // Latest output
  subagents: SubagentTrace[];
}

class Worker extends EventEmitter {
  readonly name: string;
  readonly worktree: Worktree;
  state: WorkerState;

  // Assign task to worker
  async assignTask(task: Task): Promise<void>;

  // Execute current task (single iteration)
  async executeIteration(): Promise<IterationResult>;

  // Switch agent (for rate limit fallback)
  async switchAgent(agentName: string): Promise<void>;

  // Pause/resume
  pause(): void;
  resume(): void;

  // Events: 'task:started', 'task:completed', 'rate-limited', 'error'
}
```

**Relationship to Existing Engine**:
- The existing `ExecutionEngine` becomes the core of a single `Worker`
- Extract agent execution logic into reusable functions
- Worker wraps engine with worktree-specific configuration

---

## Phase 2: Worker Pool & Scheduling

### 2.1 Scheduler

**File**: `src/pool/scheduler.ts`

```typescript
interface SchedulerConfig {
  maxWorkers: number | 'unlimited';
  strictDependencies: boolean;  // Only run tasks with merged deps
}

interface TaskAssignment {
  task: Task;
  track: number;           // Parallel track from bv
  dependencies: string[];  // Task IDs that must be merged first
}

class Scheduler {
  constructor(tracker: TrackerPlugin, config: SchedulerConfig);

  // Get tasks ready for execution (deps merged, not assigned)
  async getReadyTasks(): Promise<TaskAssignment[]>;

  // Check if task dependencies are satisfied
  async areDependenciesMerged(taskId: string): Promise<boolean>;

  // Mark task as assigned (prevent double-assignment)
  assignTask(taskId: string, workerName: string): void;

  // Mark task as merged (unblocks dependents)
  markMerged(taskId: string): void;

  // Uses bv --robot-plan for parallel track detection
  private async queryParallelTracks(): Promise<Track[]>;
}
```

**bv Integration**:
```typescript
// Query bv for ready tasks with parallel tracks
async function getParallelPlan(): Promise<{
  tracks: Array<{
    track: number;
    issues: string[];
    unblocks: string[];
  }>;
  summary: {
    total_tracks: number;
    highest_impact: string;
  };
}>;
```

### 2.2 Rate Limit Coordinator

**File**: `src/pool/rate-limit-coordinator.ts`

```typescript
interface AgentRateLimitState {
  status: 'available' | 'limited';
  limitedAt: Date | null;
  retryAfter: Date | null;
  consecutiveLimits: number;
}

class RateLimitCoordinator extends EventEmitter {
  private agents: Map<string, AgentRateLimitState>;
  private fallbackChain: string[];

  // Mark agent as rate-limited (called by worker)
  markLimited(agent: string, retryAfter?: Date): void;

  // Mark agent as available (called by recovery probe)
  markAvailable(agent: string): void;

  // Get next available agent in fallback chain
  getAvailableFallback(currentAgent: string): string | null;

  // Check if all agents are limited
  allAgentsLimited(): boolean;

  // Start background recovery probe
  startRecoveryProbe(intervalMs: number): void;

  // Events: 'agent:limited', 'agent:available', 'all:limited', 'all:recovered'
}
```

### 2.3 Worker Pool

**File**: `src/pool/index.ts`

```typescript
interface PoolConfig {
  maxWorkers: number | 'unlimited';
  worktreeBaseDir: string;
  nameTheme: string;
  fallbackAgents: string[];
  strictDependencies: boolean;
}

interface PoolState {
  status: 'idle' | 'running' | 'paused' | 'all-limited';
  workers: Map<string, Worker>;
  pendingMerges: number;
  tasksCompleted: number;
  tasksRemaining: number;
}

class WorkerPool extends EventEmitter {
  private workers: Map<string, Worker>;
  private scheduler: Scheduler;
  private rateLimits: RateLimitCoordinator;
  private worktrees: WorktreeManager;
  private namePool: NamePool;
  private refinery: Refinery;

  // Start the pool (spawn initial workers)
  async start(): Promise<void>;

  // Stop all workers gracefully
  async stop(): Promise<void>;

  // Pause/resume all workers
  pause(): void;
  resume(): void;

  // Main dispatch loop
  private async dispatchLoop(): Promise<void> {
    while (this.running) {
      // 1. Get ready tasks from scheduler
      const readyTasks = await this.scheduler.getReadyTasks();

      // 2. For each ready task, spawn worker if under limit
      for (const assignment of readyTasks) {
        if (this.canSpawnWorker()) {
          await this.spawnWorker(assignment.task);
        }
      }

      // 3. Check for completed workers, queue for refinery
      for (const worker of this.workers.values()) {
        if (worker.state.status === 'done') {
          await this.queueForMerge(worker);
        }
      }

      // 4. Process refinery queue
      await this.refinery.processNext();

      // 5. Cleanup merged worktrees
      await this.cleanupMergedWorkers();

      // 6. Wait before next iteration
      await this.sleep(1000);
    }
  }

  private async spawnWorker(task: Task): Promise<Worker>;
  private async queueForMerge(worker: Worker): Promise<void>;
  private async cleanupMergedWorkers(): Promise<void>;

  // Handle rate limit from worker
  private async onWorkerRateLimited(worker: Worker, agent: string): Promise<void>;

  // Events: 'worker:spawned', 'worker:completed', 'worker:rate-limited',
  //         'merge:queued', 'merge:completed', 'pool:all-limited'
}
```

---

## Phase 3: Refinery (Merge Coordination)

### 3.1 Merge Queue

**File**: `src/refinery/queue.ts`

```typescript
interface MergeRequest {
  id: string;
  branch: string;           // "work/nux/gt-abc"
  workerName: string;
  taskId: string;
  priority: number;
  createdAt: Date;
  status: 'queued' | 'merging' | 'conflict' | 'merged' | 'failed';
  retryCount: number;
  error?: string;
}

class MergeQueue {
  private queue: MergeRequest[];

  // Add branch to merge queue
  enqueue(request: Omit<MergeRequest, 'id' | 'status' | 'retryCount'>): MergeRequest;

  // Get next MR to process (priority-ordered)
  dequeue(): MergeRequest | null;

  // Update MR status
  updateStatus(id: string, status: MergeRequest['status'], error?: string): void;

  // Get queue state
  getAll(): MergeRequest[];
  getPending(): MergeRequest[];

  // Priority scoring (adapted from gastown)
  private calculatePriority(mr: MergeRequest): number;
}
```

### 3.2 Merger

**File**: `src/refinery/merger.ts`

```typescript
interface MergeConfig {
  targetBranch: string;      // "main"
  runTests: boolean;
  testCommand: string;       // "bun run test && bun run build"
  retryFlakyTests: number;
  deleteAfterMerge: boolean;
}

interface MergeResult {
  success: boolean;
  conflict: boolean;
  testsFailed: boolean;
  mergeCommit?: string;
  error?: string;
  conflictFiles?: string[];
}

class Merger {
  constructor(repoPath: string, config: MergeConfig);

  // Attempt to merge a branch
  async merge(branch: string, taskId: string): Promise<MergeResult>;

  // Check for conflicts without merging
  async checkConflicts(branch: string): Promise<string[]>;

  // Run tests in repo root
  async runTests(): Promise<{ success: boolean; output: string }>;

  // Delete merged branch
  async deleteBranch(branch: string): Promise<void>;
}
```

### 3.3 Conflict Resolution

**File**: `src/refinery/conflict.ts`

```typescript
type ConflictStrategy = 'rebase' | 'escalate';

interface ConflictResolution {
  strategy: ConflictStrategy;

  // For 'rebase': spawn worker to rebase
  async resolveByRebase(
    branch: string,
    targetBranch: string,
    pool: WorkerPool
  ): Promise<void>;

  // For 'escalate': pause and notify user
  async escalate(
    branch: string,
    conflictFiles: string[],
    emitter: EventEmitter
  ): Promise<void>;
}
```

### 3.4 Refinery Coordinator

**File**: `src/refinery/index.ts`

```typescript
interface RefineryConfig {
  targetBranch: string;
  runTests: boolean;
  testCommand: string;
  onConflict: ConflictStrategy;
  maxRetries: number;
}

class Refinery extends EventEmitter {
  private queue: MergeQueue;
  private merger: Merger;
  private conflictResolver: ConflictResolution;
  private processing: boolean;

  // Queue a completed worker's branch for merge
  async queueBranch(worker: Worker): Promise<MergeRequest>;

  // Process next item in queue
  async processNext(): Promise<void> {
    if (this.processing) return;

    const mr = this.queue.dequeue();
    if (!mr) return;

    this.processing = true;
    this.emit('merge:started', mr);

    try {
      // 1. Pull latest target branch
      await this.merger.pullTarget();

      // 2. Attempt merge
      const result = await this.merger.merge(mr.branch, mr.taskId);

      if (result.success) {
        // 3a. Success: mark merged, notify
        this.queue.updateStatus(mr.id, 'merged');
        this.emit('merge:completed', mr, result.mergeCommit);
      } else if (result.conflict) {
        // 3b. Conflict: resolve based on strategy
        await this.handleConflict(mr, result.conflictFiles);
      } else {
        // 3c. Other failure (tests, etc.)
        this.handleFailure(mr, result);
      }
    } finally {
      this.processing = false;
    }
  }

  private async handleConflict(mr: MergeRequest, files: string[]): Promise<void>;
  private handleFailure(mr: MergeRequest, result: MergeResult): void;

  // Events: 'merge:started', 'merge:completed', 'merge:conflict', 'merge:failed'
}
```

---

## Phase 4: TUI Updates

**Note**: These are additional/toggleable panels that complement the existing UI. The existing LeftPanel (task list), RightPanel (task details/output), and Header components will be enhanced as needed to support parallel mode, while preserving single-worker mode compatibility.

### 4.1 New Components (Toggleable Panels)

**WorkerListPanel** (`src/tui/components/WorkerListPanel.tsx`):
```tsx
// Shows all active workers with status
interface Props {
  workers: Map<string, WorkerState>;
  selectedWorker: string | null;
  onSelectWorker: (name: string) => void;
}

// Display:
// ▶ nux      gt-abc  [████░░░░] 45%  building...
// ▶ furiosa  gt-def  [███████░] 78%  testing...
// ○ toast    (idle)  waiting for deps...
```

**WorkerPanel** (`src/tui/components/WorkerPanel.tsx`):
```tsx
// Shows detailed view of selected worker
interface Props {
  worker: Worker;
  showOutput: boolean;
  showSubagents: boolean;
}

// Display:
// Worker: nux
// Task: gt-abc - Add user authentication
// Branch: work/nux/gt-abc
// Agent: claude (primary)
// Status: working (iteration 3)
//
// Output:
// > Running npm test...
// > ✓ 42 tests passed
```

**RefineryPanel** (`src/tui/components/RefineryPanel.tsx`):
```tsx
// Shows merge queue status
interface Props {
  queue: MergeRequest[];
  currentMerge: MergeRequest | null;
}

// Display:
// MERGE QUEUE (2 pending)
// ├─ work/toast/gt-xyz  ⏳ merging...
// ├─ work/slit/gt-qrs   ○ queued (P2)
// └─ work/nux/gt-abc    ○ queued (P3)
//
// Last merged: gt-xyz (2m ago)
// Tests: passing ✓
```

### 4.2 Updated Layout

```
┌─ Ralph TUI (Parallel Mode) ─────────────────────────────────────────┐
│ ● Running  3 workers  [████████░░] 4/6 tasks  ⏱ 12:34              │
├─────────────────────────────────────────────────────────────────────┤
│ WORKERS                    │ SELECTED WORKER                        │
│ ─────────────────────────  │ ─────────────────────────────────────  │
│ ▶ nux      gt-abc   45%    │ Worker: nux                            │
│ ▶ furiosa  gt-def   78%    │ Task: gt-abc - Add auth                │
│ ○ toast    (idle)          │ Branch: work/nux/gt-abc                │
│                            │ Agent: claude                          │
│ ─────────────────────────  │                                        │
│ REFINERY                   │ Output:                                │
│ ─────────────────────────  │ > Implementing login form...           │
│ Queue: 1                   │ > Added validation logic               │
│ └─ gt-xyz ⏳ testing...    │ > Running tests...                     │
│                            │                                        │
│ Merged: 2 today            │ Subagents:                             │
│ Conflicts: 0               │ └─ explore (2.3s) ✓                    │
├─────────────────────────────────────────────────────────────────────┤
│ [p]ause  [+/-]workers  [w]orker view  [r]efinery  [?]help          │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.3 New Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `w` | Toggle worker list / detail view |
| `r` | Toggle refinery panel |
| `1-9` | Select worker by number |
| `+` | Spawn additional worker (if under limit) |
| `-` | Reduce max workers |
| `m` | Force merge next in queue |

---

## Phase 5: Configuration & CLI

### 5.1 Config Updates

**`.ralph-tui/config.toml`**:
```toml
[pool]
mode = "parallel"           # "single" | "parallel"
maxWorkers = 3              # number | "unlimited"
nameTheme = "mad-max"       # "mad-max" | "minerals" | "elements"
worktreeDir = ".ralph-workers"

[pool.scheduling]
strictDependencies = true   # Only run tasks with merged deps
useParallelTracks = true    # Use bv --robot-plan for track detection

[refinery]
targetBranch = "main"
runTests = true
testCommand = "bun run test && bun run build"
onConflict = "rebase"       # "rebase" | "escalate"
deleteAfterMerge = true
retryFlakyTests = 2

[agents]
primary = "claude"
fallback = ["opencode"]     # Fallback chain for rate limits
```

### 5.2 CLI Updates

```bash
# Run in parallel mode (new default if mode=parallel in config)
ralph-tui run

# Run in legacy single mode
ralph-tui run --single

# Specify worker count
ralph-tui run --workers=5
ralph-tui run --workers=unlimited

# Check pool status
ralph-tui status
# Output:
# Pool: running (3 workers)
# Workers:
#   nux: working on gt-abc (45%)
#   furiosa: working on gt-def (78%)
#   toast: idle
# Refinery: 1 queued, 0 merging
# Rate limits: all agents available

# View refinery queue
ralph-tui refinery status
ralph-tui refinery list

# Manual merge trigger
ralph-tui refinery merge-next
```

---

## Phase 6: Migration & Compatibility

### 6.1 Backward Compatibility

- **Default mode**: Keep `single` as default for existing users
- **Config migration**: Auto-detect old config, add `[pool]` section
- **Session files**: New format for parallel sessions, but read old format

### 6.2 Session File Updates

**Old format** (single worker):
```json
{
  "version": 1,
  "sessionId": "...",
  "status": "running",
  "currentIteration": 5,
  "iterations": [...]
}
```

**New format** (parallel):
```json
{
  "version": 2,
  "sessionId": "...",
  "mode": "parallel",
  "status": "running",
  "pool": {
    "workers": {
      "nux": { "task": "gt-abc", "iteration": 3, "status": "working" },
      "furiosa": { "task": "gt-def", "iteration": 5, "status": "done" }
    },
    "mergeQueue": [...],
    "completedTasks": ["gt-xyz", "gt-qrs"]
  }
}
```

---

## Implementation Order

### Track 1: Core Infrastructure (Foundation)
```
1.1 WorktreeManager + git operations
1.2 NamePool
1.3 Worker abstraction (wrapping existing engine)
    └─ Can test: single worker in worktree
```

### Track 2: Pool & Scheduling (Parallel)
```
2.1 RateLimitCoordinator (extract from engine)
2.2 Scheduler (bv integration)
2.3 WorkerPool
    └─ Can test: multiple workers, no refinery yet
```

### Track 3: Refinery (Parallel with Track 2)
```
3.1 MergeQueue
3.2 Merger (git operations)
3.3 ConflictResolution
3.4 Refinery coordinator
    └─ Can test: manual merge queue processing
```

### Track 4: Integration
```
4.1 Connect WorkerPool → Refinery
4.2 End-to-end flow testing
4.3 Session persistence updates
```

### Track 5: TUI
```
5.1 WorkerListPanel
5.2 WorkerPanel
5.3 RefineryPanel
5.4 Layout updates
5.5 Keyboard shortcuts
```

### Track 6: Polish
```
6.1 Config updates
6.2 CLI updates
6.3 Documentation
6.4 Migration tooling
```

---

## Testing Strategy

### Unit Tests
- WorktreeManager: create, remove, list, reconcile
- NamePool: acquire, release, exhaustion
- Scheduler: task selection, dependency checking
- MergeQueue: enqueue, dequeue, priority ordering
- Merger: conflict detection, test running

### Integration Tests
- Worker + Worktree: task execution in isolated worktree
- Pool + Scheduler: parallel task dispatch
- Refinery + Pool: merge queue processing
- Rate limit coordination across workers

### E2E Tests
- Full parallel run with 3 workers
- Rate limit fallback scenario
- Conflict resolution flow
- Recovery from crash

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Git worktree edge cases | Extensive testing, reconcile on startup |
| Race conditions in pool | Single dispatch loop, no concurrent mutations |
| Rate limit coordination bugs | Conservative fallback, manual override |
| Merge conflicts block progress | Escalate option, manual merge command |
| TUI complexity | Progressive disclosure, sensible defaults |

---

## Success Criteria

1. **Parallel Execution**: 3+ workers running simultaneously
2. **Isolation**: No cross-contamination between worktrees
3. **Merge Success**: Clean merges with test verification
4. **Rate Limit Handling**: Graceful fallback, recovery
5. **Dependency Ordering**: Tasks only run when deps merged
6. **TUI Usability**: Clear visibility into all workers
7. **Performance**: No degradation vs single-worker mode
8. **Reliability**: Crash recovery, orphan cleanup

---

## Design Decisions (Resolved)

1. **Worktree location**: `.ralph-workers/` in repo root ✓
2. **Branch naming**: `work/{worker}/{task}` (e.g., `work/worker1/gt-abc`) ✓
3. **Conflict resolution**: Auto-rebase ✓
4. **Worker limits**: Hard cap - don't spawn more if all agents are rate-limited ✓
5. **Merge slot**: Serialize all merges (one at a time, safer) ✓
6. **Worker naming**: Sequential numbers (`worker1`, `worker2`, ...) instead of themed names ✓

---

## Appendix: Beads Integration Points

### Task Status Flow
```
open → in_progress (assigned to worker)
     → closed (merged to main)
```

### bv Queries Used
```bash
# Get parallel tracks
bv --robot-plan

# Get ready tasks (no blockers)
bv --robot-triage

# Check if task deps are closed
bd show <task-id>  # Check depends_on field
```

### Merge Request Tracking (Optional)
Could create MR beads for audit trail:
```bash
bd create --type=merge-request --title="Merge work/nux/gt-abc" \
  --fields='{"branch":"work/nux/gt-abc","source":"gt-abc","worker":"nux"}'
```
