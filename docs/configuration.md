# Configuration Reference

Ralph TUI uses TOML configuration files with layered precedence. This reference covers all configuration options including the new parallel mode settings.

## Configuration Files

Configuration is loaded from multiple sources with the following precedence (highest to lowest):

1. **CLI flags** - Override all other settings
2. **Project config** - `.ralph-tui/config.toml` in project directory
3. **Global config** - `~/.config/ralph-tui/config.toml`
4. **Built-in defaults**

## Quick Reference

```toml
# .ralph-tui/config.toml

# Core settings
maxIterations = 0              # 0 = unlimited
iterationDelay = 0             # ms between iterations
outputDir = ".ralph-tui/iterations"
autoCommit = true

# Default plugins
defaultAgent = "claude"
defaultTracker = "beads"

# Pool configuration (parallel mode)
[pool]
mode = "parallel"              # 'single' or 'parallel'
maxWorkers = 3                 # 1-10
worktreeDir = ".ralph-workers"

[pool.scheduling]
strictDependencies = true
useParallelTracks = true

# Refinery configuration (merge pipeline)
[refinery]
targetBranch = "main"
runTests = true
testCommand = "npm test"
onConflict = "rebase"          # 'rebase' or 'escalate'
deleteAfterMerge = true
retryFlakyTests = 2

# Agent fallback chain
[agentsSection]
primary = "claude"
fallback = ["opencode"]

# Error handling
[errorHandling]
strategy = "retry"             # 'retry', 'skip', or 'abort'
maxRetries = 3
retryDelayMs = 5000
continueOnNonZeroExit = false

# Rate limit handling
[rateLimitHandling]
enabled = true
maxRetries = 3
baseBackoffMs = 60000
recoverPrimaryBetweenIterations = true

# Notifications
[notifications]
enabled = true
sound = "off"                  # 'off', 'system', or 'ralph'

# Subagent tracing
subagentTracingDetail = "moderate"  # 'off', 'minimal', 'moderate', 'full'
```

## Core Settings

### maxIterations

Maximum number of iterations before stopping.

| Type | Default | Range |
|------|---------|-------|
| number | 0 | 0-1000 |

- `0` means unlimited iterations
- Useful for limiting runs during testing

```toml
maxIterations = 50
```

CLI: `--iterations 50`

### iterationDelay

Delay in milliseconds between iterations.

| Type | Default | Range |
|------|---------|-------|
| number | 0 | 0-300000 |

```toml
iterationDelay = 1000  # 1 second
```

CLI: `--delay 1000`

### outputDir

Directory for iteration log files.

| Type | Default |
|------|---------|
| string | `.ralph-tui/iterations` |

```toml
outputDir = "./logs/ralph"
```

CLI: `--output-dir ./logs/ralph`

### autoCommit

Whether to automatically commit changes after each task.

| Type | Default |
|------|---------|
| boolean | true |

```toml
autoCommit = false
```

### defaultAgent / defaultTracker

Default plugins to use when not specified.

```toml
defaultAgent = "claude"
defaultTracker = "beads-bv"
```

CLI: `--agent claude --tracker beads`

## Pool Configuration

The `[pool]` section controls parallel execution behavior.

### pool.mode

Execution mode.

| Type | Default | Values |
|------|---------|--------|
| string | "single" | "single", "parallel" |

- `single` - Traditional sequential execution (one task at a time)
- `parallel` - Multiple workers executing tasks simultaneously

```toml
[pool]
mode = "parallel"
```

CLI: `--workers=3` enables parallel, `--single` forces single

### pool.maxWorkers

Maximum concurrent workers in parallel mode.

| Type | Default | Range |
|------|---------|-------|
| number | 3 | 1-10 |

```toml
[pool]
maxWorkers = 5
```

CLI: `--workers=5` or `--workers=unlimited` (uses config max, capped at 10)

### pool.worktreeDir

Directory for git worktrees (relative to repo root).

| Type | Default |
|------|---------|
| string | ".ralph-workers" |

```toml
[pool]
worktreeDir = ".workers"
```

### pool.scheduling.strictDependencies

Only dispatch tasks whose dependencies have been merged.

| Type | Default |
|------|---------|
| boolean | true |

When `true`:
- Tasks with unmerged dependencies remain blocked
- Ensures task isolation and correct build state
- Recommended for projects with interdependent tasks

When `false`:
- Tasks may start before dependencies merge
- Higher parallelism but risk of conflicts
- Use only for truly independent tasks

```toml
[pool.scheduling]
strictDependencies = true
```

### pool.scheduling.useParallelTracks

Use `bv --robot-plan` for parallel track detection.

| Type | Default |
|------|---------|
| boolean | true |

When enabled, the scheduler queries bv for optimal parallel execution tracks based on dependency graph analysis.

```toml
[pool.scheduling]
useParallelTracks = true
```

## Refinery Configuration

The `[refinery]` section controls the merge pipeline for parallel mode.

### refinery.targetBranch

Branch to merge completed work into.

| Type | Default |
|------|---------|
| string | "main" |

```toml
[refinery]
targetBranch = "develop"
```

### refinery.runTests

Run tests after merge before pushing.

| Type | Default |
|------|---------|
| boolean | true |

```toml
[refinery]
runTests = true
```

### refinery.testCommand

Command to execute for testing.

| Type | Default |
|------|---------|
| string | "npm test" |

```toml
[refinery]
testCommand = "bun run test"
```

### refinery.onConflict

Strategy for handling merge conflicts.

| Type | Default | Values |
|------|---------|--------|
| string | "rebase" | "rebase", "escalate" |

**rebase**: Automatically rebase the worker branch onto the updated target branch and retry the merge. Limited by max rebase attempts.

**escalate**: Pause the merge pipeline and notify the user to resolve conflicts manually.

```toml
[refinery]
onConflict = "rebase"
```

### refinery.deleteAfterMerge

Delete worker branch after successful merge.

| Type | Default |
|------|---------|
| boolean | true |

```toml
[refinery]
deleteAfterMerge = true
```

### refinery.retryFlakyTests

Number of times to retry tests that fail intermittently.

| Type | Default | Range |
|------|---------|-------|
| number | 2 | 0-5 |

```toml
[refinery]
retryFlakyTests = 2
```

## Agent Configuration

### agentsSection.primary

Primary agent to use for execution.

| Type | Default |
|------|---------|
| string | (from defaultAgent) |

```toml
[agentsSection]
primary = "claude"
```

### agentsSection.fallback

Ordered list of fallback agents for rate limit rotation.

| Type | Default |
|------|---------|
| string[] | [] |

When the primary agent is rate-limited, workers rotate through fallback agents.

```toml
[agentsSection]
primary = "claude"
fallback = ["opencode", "custom-agent"]
```

### Agent Plugin Configuration

Configure individual agent plugins in the `[[agents]]` array:

```toml
[[agents]]
name = "claude"
plugin = "claude"
default = true
command = "claude"
defaultFlags = ["--dangerously-skip-permissions"]
timeout = 600000

[[agents]]
name = "opencode"
plugin = "opencode"
command = "opencode"
timeout = 300000
```

## Error Handling

### errorHandling.strategy

How to handle iteration failures.

| Type | Default | Values |
|------|---------|--------|
| string | "retry" | "retry", "skip", "abort" |

- `retry` - Retry the failed iteration
- `skip` - Skip the task and continue to next
- `abort` - Stop execution entirely

```toml
[errorHandling]
strategy = "retry"
```

### errorHandling.maxRetries

Maximum retry attempts for failed iterations.

| Type | Default | Range |
|------|---------|-------|
| number | 3 | 0-10 |

```toml
[errorHandling]
maxRetries = 3
```

### errorHandling.retryDelayMs

Delay in milliseconds before retrying.

| Type | Default | Range |
|------|---------|-------|
| number | 5000 | 0-300000 |

```toml
[errorHandling]
retryDelayMs = 10000  # 10 seconds
```

### errorHandling.continueOnNonZeroExit

Continue execution even if agent exits with non-zero code.

| Type | Default |
|------|---------|
| boolean | false |

```toml
[errorHandling]
continueOnNonZeroExit = true
```

## Rate Limit Handling

### rateLimitHandling.enabled

Enable automatic rate limit detection and handling.

| Type | Default |
|------|---------|
| boolean | true |

```toml
[rateLimitHandling]
enabled = true
```

### rateLimitHandling.maxRetries

Maximum retries when rate limited.

| Type | Default | Range |
|------|---------|-------|
| number | 3 | 0-10 |

```toml
[rateLimitHandling]
maxRetries = 5
```

### rateLimitHandling.baseBackoffMs

Base backoff time in milliseconds.

| Type | Default | Range |
|------|---------|-------|
| number | 60000 | 0-300000 |

```toml
[rateLimitHandling]
baseBackoffMs = 120000  # 2 minutes
```

### rateLimitHandling.recoverPrimaryBetweenIterations

Try to recover primary agent between iterations.

| Type | Default |
|------|---------|
| boolean | true |

When enabled, attempts to switch back to the primary agent after each iteration completes, in case the rate limit has lifted.

```toml
[rateLimitHandling]
recoverPrimaryBetweenIterations = true
```

## Notifications

### notifications.enabled

Enable desktop notifications for completion/errors.

| Type | Default |
|------|---------|
| boolean | true |

```toml
[notifications]
enabled = true
```

CLI: `--notify` or `--no-notify`

### notifications.sound

Sound mode for notifications.

| Type | Default | Values |
|------|---------|--------|
| string | "off" | "off", "system", "ralph" |

- `off` - No sound
- `system` - Use system notification sound
- `ralph` - Use Ralph's custom sounds

```toml
[notifications]
sound = "system"
```

## Subagent Tracing

### subagentTracingDetail

Level of detail for subagent tracing in the TUI.

| Type | Default | Values |
|------|---------|--------|
| string | "moderate" | "off", "minimal", "moderate", "full" |

- `off` - No subagent tracing
- `minimal` - Show only active subagents
- `moderate` - Show active and recent completed
- `full` - Show all subagent activity

```toml
subagentTracingDetail = "full"
```

## Tracker Configuration

Configure tracker plugins in the `[[trackers]]` array:

```toml
[[trackers]]
name = "beads"
plugin = "beads"
default = true

[[trackers]]
name = "beads-bv"
plugin = "beads-bv"

[[trackers]]
name = "json"
plugin = "json"
```

## Migration from Single Mode

To migrate an existing single-mode configuration to parallel mode:

### 1. Add Pool Configuration

```toml
# Existing config...

# Add this section
[pool]
mode = "parallel"
maxWorkers = 3
```

### 2. Add Refinery Configuration

```toml
[refinery]
targetBranch = "main"  # Your main branch
runTests = true
testCommand = "npm test"  # Your test command
```

### 3. Configure Fallback Agents (Optional)

```toml
[agentsSection]
primary = "claude"
fallback = ["opencode"]
```

### 4. Test with Single Worker First

```bash
# Start with 1 worker to verify setup
ralph-tui run --workers=1

# Then scale up
ralph-tui run --workers=3
```

## Example Configurations

### Minimal Parallel Config

```toml
[pool]
mode = "parallel"
maxWorkers = 3

[refinery]
targetBranch = "main"
```

### High-Throughput Config

```toml
[pool]
mode = "parallel"
maxWorkers = 10
worktreeDir = "/tmp/ralph-workers"  # Use fast storage

[pool.scheduling]
strictDependencies = false  # Only for independent tasks

[refinery]
targetBranch = "develop"
runTests = false  # Skip tests for speed
deleteAfterMerge = true

[agentsSection]
primary = "claude"
fallback = ["opencode"]

[rateLimitHandling]
enabled = true
maxRetries = 5
```

### Conservative Config

```toml
[pool]
mode = "parallel"
maxWorkers = 2

[pool.scheduling]
strictDependencies = true
useParallelTracks = true

[refinery]
targetBranch = "main"
runTests = true
testCommand = "npm run test:ci"
onConflict = "escalate"  # Manual conflict resolution
retryFlakyTests = 3

[errorHandling]
strategy = "abort"  # Stop on any error
```
