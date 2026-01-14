# Parallel Mode Guide

Ralph TUI's parallel mode allows multiple AI workers to execute tasks simultaneously, dramatically increasing throughput for projects with many independent tasks. Each worker operates in its own isolated git worktree, and completed work is merged back through a serialized queue.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Getting Started](#getting-started)
- [Worktree Isolation](#worktree-isolation)
- [The Refinery: Merge Pipeline](#the-refinery-merge-pipeline)
- [Rate Limit Handling](#rate-limit-handling)
- [Configuration Reference](#configuration-reference)
- [CLI Commands](#cli-commands)
- [TUI Keyboard Shortcuts](#tui-keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Ralph TUI                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Worker Pool                                  │    │
│  │                                                                      │    │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐              │    │
│  │   │  Worker 1   │   │  Worker 2   │   │  Worker 3   │              │    │
│  │   │  "nebula"   │   │  "phoenix"  │   │  "aurora"   │              │    │
│  │   │             │   │             │   │             │              │    │
│  │   │  Task: A    │   │  Task: B    │   │  Task: C    │              │    │
│  │   │  Worktree:  │   │  Worktree:  │   │  Worktree:  │              │    │
│  │   │  .ralph-    │   │  .ralph-    │   │  .ralph-    │              │    │
│  │   │  workers/   │   │  workers/   │   │  workers/   │              │    │
│  │   │  nebula/    │   │  phoenix/   │   │  aurora/    │              │    │
│  │   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘              │    │
│  │          │                 │                 │                      │    │
│  │          │  ┌──────────────┼──────────────┐  │                      │    │
│  │          │  │     Rate Limit Coordinator  │  │                      │    │
│  │          │  │  (fallback agent rotation)  │  │                      │    │
│  │          │  └──────────────┼──────────────┘  │                      │    │
│  │          │                 │                 │                      │    │
│  │          └─────────────────┼─────────────────┘                      │    │
│  │                            ▼                                        │    │
│  │   ┌────────────────────────────────────────────────────────────┐   │    │
│  │   │                      Scheduler                              │   │    │
│  │   │  • Tracks task dependencies                                 │   │    │
│  │   │  • Assigns tasks to idle workers                           │   │    │
│  │   │  • Blocks tasks waiting on unmerged dependencies           │   │    │
│  │   └────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                          Refinery                                    │    │
│  │                                                                      │    │
│  │   ┌──────────────────────────────────────────────────────────────┐  │    │
│  │   │                    Merge Queue                                │  │    │
│  │   │  Priority: P0 > P1 > P2 > P3 > P4                            │  │    │
│  │   │  Unblock count: higher = merged first                        │  │    │
│  │   │                                                               │  │    │
│  │   │  [ Task A (P1, unblocks 3) ] ← next to merge                 │  │    │
│  │   │  [ Task B (P2, unblocks 1) ]                                 │  │    │
│  │   │  [ Task C (P2, unblocks 0) ]                                 │  │    │
│  │   └──────────────────────────────────────────────────────────────┘  │    │
│  │                              │                                       │    │
│  │                              ▼                                       │    │
│  │   ┌──────────────────────────────────────────────────────────────┐  │    │
│  │   │                      Merger                                   │  │    │
│  │   │  1. Pull latest target branch                                │  │    │
│  │   │  2. Merge worker branch                                      │  │    │
│  │   │  3. Run tests (if configured)                                │  │    │
│  │   │  4. Push to remote                                           │  │    │
│  │   └──────────────────────────────────────────────────────────────┘  │    │
│  │                              │                                       │    │
│  │                       On conflict                                    │    │
│  │                              ▼                                       │    │
│  │   ┌──────────────────────────────────────────────────────────────┐  │    │
│  │   │                 Conflict Resolver                             │  │    │
│  │   │  Strategy: 'rebase' or 'escalate'                            │  │    │
│  │   │                                                               │  │    │
│  │   │  Rebase: Auto-rebase branch onto target, retry merge         │  │    │
│  │   │  Escalate: Pause and notify user for manual resolution       │  │    │
│  │   └──────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                      │                                       │
│                                      ▼                                       │
│                            ┌──────────────┐                                  │
│                            │     main     │                                  │
│                            │   (target)   │                                  │
│                            └──────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| **Worker Pool** | Orchestrates worker lifecycle, spawns up to `maxWorkers` |
| **Worker** | Executes a single task in an isolated worktree |
| **Scheduler** | Assigns tasks respecting dependencies |
| **Rate Limit Coordinator** | Rotates through fallback agents when rate limited |
| **Refinery** | Serialized merge pipeline with queue, merger, and conflict resolver |
| **Worktree Manager** | Creates/removes git worktrees for worker isolation |

## Getting Started

### Enable Parallel Mode

Add to `.ralph-tui/config.toml`:

```toml
[pool]
mode = "parallel"
maxWorkers = 3
```

Or use CLI flags:

```bash
# Run with 3 workers
ralph-tui run --workers=3

# Run with maximum workers (10)
ralph-tui run --workers=unlimited
```

### First Run Checklist

1. **Clean git state**: Ensure your working directory is clean (no uncommitted changes)
2. **Push to remote**: The target branch should be pushed to remote for merge operations
3. **Test command**: If using tests, verify your test command works: `npm test`
4. **Disk space**: Each worktree is a full checkout; ensure adequate disk space

## Worktree Isolation

Each worker operates in its own git worktree, providing complete isolation between parallel tasks.

### How Worktrees Work

```
your-project/                    # Main repository
├── .git/                        # Shared git database
├── .ralph-workers/              # Worktree directory (configurable)
│   ├── nebula/                  # Worker 1's worktree
│   │   ├── src/
│   │   ├── package.json
│   │   └── ...
│   ├── phoenix/                 # Worker 2's worktree
│   │   ├── src/
│   │   └── ...
│   └── aurora/                  # Worker 3's worktree
│       └── ...
├── src/                         # Main working directory
└── package.json
```

### Branch Naming

Worker branches follow the pattern: `work/<worker-name>/<task-id>`

Example:
- `work/nebula/beads-abc123`
- `work/phoenix/beads-def456`

### Worktree Lifecycle

1. **Creation**: When a worker is spawned for a task
2. **Execution**: Worker runs AI agent in the worktree
3. **Completion**: Branch committed, worktree queued for merge
4. **Cleanup**: After successful merge, worktree is removed

## The Refinery: Merge Pipeline

The Refinery ensures clean, serialized merges of completed work.

### Merge Queue Priority

Merge requests are prioritized by:

1. **Task Priority** (P0 = highest, P4 = lowest)
2. **Unblock Count** (tasks that unblock more dependents merge first)
3. **Creation Time** (FIFO for equal priority)

### Merge Workflow

```
1. Worker completes task
       │
       ▼
2. Branch queued in Refinery
       │
       ▼
3. Dequeue highest priority MR
       │
       ▼
4. Pull latest target branch ──────────┐
       │                               │
       ▼                               │
5. Merge worker branch                 │
       │                               │
       ├──── Success ──────┐           │
       │                   ▼           │
       │            6. Run tests       │
       │                   │           │
       │         ├── Pass ─┴─► 7. Push │
       │         │                     │
       │         └── Fail ─► Retry     │
       │                               │
       └──── Conflict ─► 8. Resolve ───┘
```

### Conflict Resolution Strategies

**Rebase (default)**:
```toml
[refinery]
onConflict = "rebase"
```
- Automatically rebases the worker branch onto the updated target
- Re-runs the merge attempt
- Limits rebase attempts (default: 2) before escalating

**Escalate**:
```toml
[refinery]
onConflict = "escalate"
```
- Pauses the merge pipeline
- Notifies user to resolve conflicts manually
- Provides conflict file list in TUI

## Rate Limit Handling

When an AI provider rate-limits a worker, the system automatically handles it.

### Fallback Agent Chain

Configure fallback agents in `.ralph-tui/config.toml`:

```toml
[agentsSection]
primary = "claude"
fallback = ["opencode"]
```

### Rate Limit Flow

```
Worker hits rate limit
        │
        ▼
Mark agent as limited
        │
        ▼
Check fallback chain
        │
        ├── Fallback available ──► Switch agent, continue
        │
        └── No fallback ──► Worker enters rate-limited state
                                   │
                                   ▼
                           Recovery probe (30s)
                                   │
                                   ▼
                           Agent recovered ──► Resume work
```

### Pool-Wide Rate Limiting

If all agents are rate-limited:
- Pool enters `all-limited` state
- Dispatch loop pauses
- Recovery probing continues
- When any agent recovers, pool resumes

## Configuration Reference

### Pool Configuration

```toml
[pool]
# Execution mode: 'single' or 'parallel'
mode = "parallel"

# Maximum concurrent workers (1-10)
maxWorkers = 3

# Directory for git worktrees (relative to repo root)
worktreeDir = ".ralph-workers"

[pool.scheduling]
# Only dispatch tasks whose dependencies are merged
strictDependencies = true

# Use bv --robot-plan for parallel track detection
useParallelTracks = true
```

### Refinery Configuration

```toml
[refinery]
# Target branch for merges
targetBranch = "main"

# Run tests after merge
runTests = true

# Test command to execute
testCommand = "npm test"

# Conflict handling: 'rebase' or 'escalate'
onConflict = "rebase"

# Delete worker branch after successful merge
deleteAfterMerge = true

# Retry count for flaky tests
retryFlakyTests = 2
```

### Agent Fallback Configuration

```toml
[agentsSection]
# Primary agent to use
primary = "claude"

# Fallback agents for rate limit rotation
fallback = ["opencode"]
```

## CLI Commands

### Run with Parallel Mode

```bash
# Specify worker count
ralph-tui run --workers=3

# Maximum workers (reads from config, max 10)
ralph-tui run --workers=unlimited

# Force single mode (overrides config)
ralph-tui run --single
```

### Check Status

```bash
# Human-readable status with pool info
ralph-tui status

# JSON output for scripts
ralph-tui status --json
```

JSON output includes pool status:
```json
{
  "status": "running",
  "pool": {
    "mode": "parallel",
    "workerCount": 3,
    "maxWorkers": 3,
    "workers": [
      {"id": "nebula", "status": "working", "taskId": "beads-abc"},
      {"id": "phoenix", "status": "idle"},
      {"id": "aurora", "status": "rate_limited"}
    ],
    "refineryQueued": 2,
    "refineryMerging": 1,
    "allAgentsAvailable": false
  }
}
```

## TUI Keyboard Shortcuts

### Worker Management

| Key | Action |
|-----|--------|
| `w` | Toggle worker list / detail view |
| `1-9` | Select worker by number |
| `+` | Spawn additional worker (up to max) |
| `-` | Reduce max workers |
| `p` | Pause/resume all workers |

### Refinery Control

| Key | Action |
|-----|--------|
| `r` | Toggle refinery panel visibility |
| `m` | Force merge next in queue |

### Standard Controls

| Key | Action |
|-----|--------|
| `s` | Start execution |
| `d` | Toggle dashboard |
| `i` | Toggle iteration history |
| `u` | Toggle subagent tracing |
| `q` | Quit |
| `?` | Show help |

## Troubleshooting

### Worktree Issues

**"fatal: worktree already exists"**

A previous session may have left orphaned worktrees. Clean up manually:

```bash
# List existing worktrees
git worktree list

# Remove orphaned worktrees
git worktree remove .ralph-workers/nebula --force
```

**"cannot lock ref" errors**

Multiple processes may be accessing the same worktree. Ensure only one Ralph instance is running:

```bash
ralph-tui status
```

### Merge Conflicts

**Repeated rebase failures**

If auto-rebase keeps failing:
1. The conflict may require semantic understanding
2. Switch to `onConflict = "escalate"`
3. Resolve manually in the worker's worktree
4. Use `m` key to retry merge

**Finding conflict files**

Check the Refinery panel (press `r`) for:
- Tasks with "conflict" status
- List of conflicting files

### Rate Limiting

**All agents rate limited**

If the TUI shows "ALL AGENTS LIMITED":
1. Wait for recovery (probed every 30s)
2. Add more fallback agents to config
3. Reduce `maxWorkers` to decrease API load

**Fallback not working**

Verify fallback configuration:
```toml
[agentsSection]
primary = "claude"
fallback = ["opencode"]
```

Ensure fallback agents are registered:
```bash
ralph-tui plugins agents
```

### Performance

**Workers idle despite available tasks**

Check if tasks are blocked on dependencies:
```bash
bd blocked  # If using beads tracker
```

Enable parallel track detection:
```toml
[pool.scheduling]
useParallelTracks = true
```

**Disk space issues**

Each worktree is a full checkout. To reduce space:
1. Lower `maxWorkers`
2. Ensure `deleteAfterMerge = true`
3. Clean up manually: `rm -rf .ralph-workers`

### Recovery After Crash

If Ralph crashes mid-execution:

1. Check status: `ralph-tui status`
2. Resume if possible: `ralph-tui resume`
3. Clean up worktrees: `git worktree list && git worktree prune`
4. Force new session: `ralph-tui run --force`
