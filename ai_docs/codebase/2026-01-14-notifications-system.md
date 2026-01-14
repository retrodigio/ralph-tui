---
date: 2026-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "Desktop Notification System"
tags: [notifications, sound, node-notifier, cross-platform, desktop, alerts]
status: complete
last_updated: 2026-01-14
last_updated_by: Chris Crabtree
---

# Desktop Notification System

## Overview

Ralph TUI includes a desktop notification system that alerts users when long-running tasks complete, encounter errors, or reach iteration limits. The system is built on `node-notifier` for cross-platform notification delivery and includes a custom sound playback system supporting system sounds and themed Ralph Wiggum audio clips.

The notification system operates independently of the TUI, making it useful for both interactive and headless execution modes where users may not be actively monitoring the terminal.

## Architecture

The notification system consists of two primary modules:

1. **Notifications Module** (`src/notifications.ts`) - Handles desktop notification dispatch and configuration resolution
2. **Sound Module** (`src/sound.ts`) - Provides cross-platform audio playback for notification sounds

### Component Interaction Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Engine Events                       │
│  (engine:started, all:complete, engine:stopped, iteration:failed)│
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  run.tsx Event Handlers                          │
│         (runWithTui / runHeadless event subscriptions)           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│               Notification Functions                             │
│  sendCompletionNotification / sendMaxIterationsNotification /    │
│  sendErrorNotification                                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                   ┌────────────┴────────────┐
                   ▼                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│    sendNotification()       │  │  playNotificationSound()    │
│    (node-notifier)          │  │  (platform audio commands)  │
└─────────────────────────────┘  └─────────────────────────────┘
```

## Components

### Notifications Module

**Location**: `src/notifications.ts`
**Purpose**: Provides desktop notification functionality and notification-specific formatting utilities
**Lines**: 231

#### Core Functions

##### `sendNotification(options: NotificationOptions): void`

**Location**: `src/notifications.ts:39-68`

Sends a desktop notification using node-notifier. This is the low-level notification dispatch function that other notification types build upon.

```typescript
interface NotificationOptions {
  title: string;        // The notification title
  body: string;         // The notification body/message
  icon?: string;        // Optional path to an icon image
  sound?: NotificationSoundMode;  // Sound mode ('off', 'system', 'ralph')
}
```

Key implementation details:
- Wraps `node-notifier.notify()` for cross-platform delivery
- Disables node-notifier's built-in sound handling (`sound: false`) in favor of custom sound playback
- Handles errors gracefully with console warnings rather than throwing
- Triggers `playNotificationSound()` separately for cross-platform sound consistency

##### `sendCompletionNotification(options: CompletionNotificationOptions): void`

**Location**: `src/notifications.ts:139-148`

Sends a notification when all tasks complete successfully.

```typescript
interface CompletionNotificationOptions {
  durationMs: number;              // Total duration in milliseconds
  taskCount: number;               // Number of tasks completed
  sound?: NotificationSoundMode;   // Sound mode for this notification
}
```

Notification format:
- **Title**: "Ralph-TUI Complete"
- **Body**: "Completed X task(s) in Xm Ys"

##### `sendMaxIterationsNotification(options: MaxIterationsNotificationOptions): void`

**Location**: `src/notifications.ts:175-187`

Sends a notification when the maximum iteration limit is reached before all tasks complete.

```typescript
interface MaxIterationsNotificationOptions {
  iterationsRun: number;          // Number of iterations run
  tasksCompleted: number;         // Number of tasks completed
  tasksRemaining: number;         // Number of tasks remaining (open + in_progress)
  durationMs: number;             // Total duration in milliseconds
  sound?: NotificationSoundMode;  // Sound mode for this notification
}
```

Notification format:
- **Title**: "Ralph-TUI Max Iterations"
- **Body**: "Iteration limit reached after X iteration(s). Completed X, Y remaining. Duration: Xm Ys"

##### `sendErrorNotification(options: ErrorNotificationOptions): void`

**Location**: `src/notifications.ts:212-230`

Sends a notification when execution stops due to a fatal error.

```typescript
interface ErrorNotificationOptions {
  errorSummary: string;           // Brief error summary
  tasksCompleted: number;         // Number of tasks completed before failure
  durationMs: number;             // Total duration in milliseconds
  sound?: NotificationSoundMode;  // Sound mode for this notification
}
```

Implementation notes:
- Error summary is truncated to 100 characters to fit notification constraints
- Notification format:
  - **Title**: "Ralph-TUI Error"
  - **Body**: "Error: [truncated error]. Completed X task(s) before failure. Duration: Xm Ys"

##### `resolveNotificationsEnabled(config?: NotificationsConfig, cliNotify?: boolean): boolean`

**Location**: `src/notifications.ts:82-98`

Resolves the final notification enabled state by merging configuration sources with defined priority.

**Priority order** (highest to lowest):
1. CLI flag (`--notify` or `--no-notify`)
2. Config file (`notifications.enabled`)
3. Default (`true`)

##### `formatDuration(durationMs: number): string`

**Location**: `src/notifications.ts:111-116`

Formats milliseconds into "Xm Ys" human-readable format for notification messages.

Examples:
- `65000` -> `"1m 5s"`
- `30000` -> `"0m 30s"`
- `125000` -> `"2m 5s"`

### Sound Module

**Location**: `src/sound.ts`
**Purpose**: Cross-platform audio playback for notification sounds
**Lines**: 304

#### Sound Modes

The system supports three sound modes defined by `NotificationSoundMode`:

| Mode | Description |
|------|-------------|
| `'off'` | No sound (default) |
| `'system'` | Play OS default notification sound |
| `'ralph'` | Play random Ralph Wiggum sound clip |

#### Core Functions

##### `playNotificationSound(mode: NotificationSoundMode): Promise<void>`

**Location**: `src/sound.ts:229-247`

Main entry point for sound playback. Routes to appropriate handler based on mode.

##### `playSystemSound(): Promise<void>`

**Location**: `src/sound.ts:135-205`

Plays the system notification sound using platform-specific methods:

| Platform | Implementation |
|----------|----------------|
| macOS | `afplay /System/Library/Sounds/Glass.aiff` |
| Linux | `paplay /usr/share/sounds/freedesktop/stereo/complete.oga` with fallback to `message.oga` |
| Windows | PowerShell `[System.Media.SystemSounds]::Asterisk.Play()` |

##### `playRalphSound(): Promise<void>`

**Location**: `src/sound.ts:211-222`

Plays a randomly selected Ralph Wiggum sound clip from the bundled collection.

##### `playFile(filePath: string): Promise<void>`

**Location**: `src/sound.ts:55-129`

Low-level sound file playback with platform-specific commands:

| Platform | Primary Command | Fallback |
|----------|-----------------|----------|
| macOS | `afplay` | - |
| Linux | `paplay` (PulseAudio) | `aplay -q` (ALSA) |
| Windows | PowerShell `Media.SoundPlayer` | - |

Implementation notes:
- Verifies file exists before attempting playback
- Spawns processes detached to avoid blocking
- Resolves immediately after spawn (doesn't wait for playback completion)
- Handles errors gracefully with console warnings

##### `checkSoundAvailable(): Promise<boolean>`

**Location**: `src/sound.ts:255-299`

Utility function to check if sound playback is likely to work on the current system.

| Platform | Check Method |
|----------|--------------|
| macOS | `which afplay` |
| Linux | `which paplay` then `which aplay` |
| Windows | Always returns `true` (PowerShell assumed available) |

##### `getSoundsDir(): string`

**Location**: `src/sound.ts:18-31`

Resolves the path to bundled sound files, handling both development and production scenarios:

- **Development**: `src/sound.ts` -> `../assets/sounds`
- **Production**: `dist/cli.js` -> `assets/sounds` (copied during build)

#### Bundled Sound Files

**Location**: `assets/sounds/`

The following Ralph Wiggum sound clips are bundled:

| File | Description |
|------|-------------|
| `iwon.wav` | "I won! I won!" |
| `idunno.wav` | "I dunno" |
| `choc.wav` | "Chocolate" |
| `funny.wav` | "That's funny" |
| `feel.wav` | "I feel..." |
| `icecream.wav` | "Ice cream" |
| `specialr.wav` | "I'm special" |
| `daddy.wav` | "Daddy" |

Sound files are copied to the `dist/assets/sounds/` directory during the build process via the build script in `package.json`.

## Configuration

### Config File Options

**Location**: `[notifications]` section in `.ralph-tui/config.toml`

```toml
[notifications]
enabled = true     # Enable desktop notifications (default: true)
sound = "off"      # Sound mode: "off", "system", or "ralph" (default: "off")
```

### Type Definitions

**Location**: `src/config/types.ts:48-63`

```typescript
type NotificationSoundMode = 'off' | 'system' | 'ralph';

interface NotificationsConfig {
  enabled?: boolean;              // Default: true
  sound?: NotificationSoundMode;  // Default: 'off'
}
```

### Schema Validation

**Location**: `src/config/schema.ts:44-56`

The configuration is validated using Zod schemas:

```typescript
const NotificationSoundModeSchema = z.enum(['off', 'system', 'ralph']);

const NotificationsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  sound: NotificationSoundModeSchema.optional(),
});
```

### CLI Flags

| Flag | Effect |
|------|--------|
| `--notify` | Force enable notifications (overrides config) |
| `--no-notify` | Force disable notifications (overrides config) |

**Location**: `src/commands/run.tsx:177-183`

## Data Flow

### Configuration Resolution Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    CLI Flags     │     │   Config File    │     │    Defaults      │
│  (--notify/      │     │  [notifications] │     │  enabled: true   │
│  --no-notify)    │     │  enabled/sound   │     │  sound: 'off'    │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │    Priority: 1         │    Priority: 2         │    Priority: 3
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │  resolveNotificationsEnabled │
                    │     (src/notifications.ts)   │
                    └─────────────────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────┐
                    │  notificationsEnabled: bool  │
                    │  soundMode: NotificationSoundMode │
                    └─────────────────────────────┘
```

### Event-to-Notification Flow

Notifications are triggered by engine events in `src/commands/run.tsx`. The flow differs slightly between TUI and headless modes but follows the same pattern:

```
Engine Event                    → Notification Function
─────────────────────────────────────────────────────────
'all:complete'                  → sendCompletionNotification()
'engine:stopped' (max_iterations) → sendMaxIterationsNotification()
'engine:stopped' (error)        → sendErrorNotification()
'iteration:failed' (abort)      → Captures error for later notification
```

**TUI Mode Implementation**: `src/commands/run.tsx:778-814`
**Headless Mode Implementation**: `src/commands/run.tsx:1077-1112`

## Integration Points

### Execution Engine Events

The notification system subscribes to engine events via `engine.on()`:

| Event | Trigger Condition | Notification Type |
|-------|-------------------|-------------------|
| `all:complete` | All tasks finished successfully | Completion |
| `engine:stopped` | `reason === 'max_iterations'` | Max Iterations |
| `engine:stopped` | `reason === 'error'` | Error |
| `iteration:failed` | `action === 'abort'` | Error (tracked) |

### Duration Tracking

The notification system tracks execution duration by capturing `engineStartTime` on the `engine:started` event and calculating elapsed time when notifications are sent.

### node-notifier Dependency

**Package**: `node-notifier@^8.0.2`
**Type Definitions**: `@types/node-notifier@^8.0.5`

node-notifier provides cross-platform notification support:
- **macOS**: Uses Notification Center
- **Linux**: Uses `notify-send` or `libnotify`
- **Windows**: Uses Windows Toast notifications

## Usage Examples

### Programmatic Usage

```typescript
import { sendNotification, sendCompletionNotification } from 'ralph-tui';

// Basic notification
sendNotification({
  title: 'Task Status',
  body: 'Processing complete',
  sound: 'system',
});

// Completion notification with duration
sendCompletionNotification({
  durationMs: 125000,  // 2m 5s
  taskCount: 5,
  sound: 'ralph',
});
```

### Configuration Examples

**Development setup with notifications:**
```toml
[notifications]
enabled = true
sound = "system"
```

**Headless/CI setup (notifications disabled):**
```toml
[notifications]
enabled = false
```

**Fun mode with Ralph sounds:**
```toml
[notifications]
enabled = true
sound = "ralph"
```

## Related Documentation

- Configuration File Reference: `website/content/docs/configuration/config-file.mdx`
- Options Reference: `website/content/docs/configuration/options.mdx`
- Run Command: `src/commands/run.tsx`

## Changelog

### 2026-01-14 - Chris Crabtree
- Initial documentation created
- Documented notification module (src/notifications.ts)
- Documented sound module (src/sound.ts)
- Documented configuration options and CLI flags
- Documented cross-platform sound playback implementation
- Documented bundled Ralph Wiggum sound files
