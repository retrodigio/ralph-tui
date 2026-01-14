---
date: 2025-01-14T00:00:00-08:00
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
topic: "ChatEngine for Multi-Turn AI Conversations"
tags: [chat, conversation, prd, streaming, agent, multi-turn]
status: complete
last_updated: 2025-01-14
last_updated_by: Chris Crabtree
---

# ChatEngine for Multi-Turn AI Conversations

## Overview

The ChatEngine is a core component of ralph-tui that manages multi-turn conversations with AI agents. It provides conversation state management, context building with system prompts, streaming output handling, and specialized PRD (Product Requirements Document) detection for the PRD chat feature. The engine abstracts away the complexity of maintaining conversation history and constructing prompts that include full conversational context.

## Architecture

The ChatEngine follows an event-driven architecture with the observer pattern for state changes. It wraps any `AgentPlugin` to enable multi-turn conversations by:

1. Maintaining an internal message history
2. Building context-aware prompts that include conversation history
3. Emitting events for UI updates and state transitions
4. Detecting PRD completion in agent responses

```
┌─────────────────────────────────────────────────────────────────┐
│                        ChatEngine                                │
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   Messages   │    │    Status    │    │    Listeners     │  │
│  │   History    │    │    State     │    │    (Events)      │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    buildPrompt()                          │   │
│  │   ┌─────────┐ + ┌─────────────┐ + ┌───────────────────┐  │   │
│  │   │ System  │   │ Conversation│   │ Current User      │  │   │
│  │   │ Prompt  │   │ History     │   │ Message           │  │   │
│  │   └─────────┘   └─────────────┘   └───────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AgentPlugin                            │   │
│  │              (Claude, OpenCode, etc.)                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### ChatEngine Class

**Location**: `src/chat/engine.ts:37-331`
**Purpose**: Manages multi-turn conversations with an AI agent, handling state, history, and PRD detection.

The ChatEngine class maintains:
- `messages: ChatMessage[]` - Full conversation history
- `status: ChatStatus` - Current engine state (idle, processing, error, completed)
- `listeners: Set<ChatEventListener>` - Event subscribers
- `config: Required<ChatEngineConfig>` - Fully-resolved configuration

#### Constructor

```typescript
constructor(config: ChatEngineConfig)
```

The constructor accepts a configuration object and applies defaults:
- `maxHistoryMessages`: 50 (default)
- `timeout`: 180000ms / 3 minutes (default)
- `cwd`: `process.cwd()` (default)
- `agentOptions`: `{}` (default)

#### Key Methods

##### sendMessage(content: string, options?: SendMessageOptions): Promise<SendMessageResult>

**Location**: `src/chat/engine.ts:139-264`

The primary method for sending messages and receiving responses. This method:

1. Validates the engine is not already processing
2. Creates and stores the user message with timestamp
3. Emits `message:sent` event
4. Sets status to `processing`
5. Builds the full prompt with conversation history
6. Executes the agent with streaming callbacks
7. Stores the assistant response
8. Checks for PRD detection in the response
9. Emits appropriate events (`message:received`, `prd:detected`, or `error:occurred`)
10. Returns the result with success status and response

**Streaming Support**: The method accepts `onChunk` and `onStatus` callbacks for real-time output:
```typescript
const result = await engine.sendMessage("Hello", {
  onChunk: (chunk) => console.log(chunk),
  onStatus: (status) => console.log("Status:", status)
});
```

##### buildPrompt(userMessage: string): string

**Location**: `src/chat/engine.ts:108-134`

Constructs the full prompt sent to the agent, structured as:

```xml
<system>
[System prompt from config]
</system>

<conversation>
User: [Historical user message 1]
Assistant: [Historical assistant response 1]
User: [Historical user message 2]
...
</conversation>

User: [Current user message]
Assistant:
```

The method respects `maxHistoryMessages` to limit context size by slicing from the end of the history.

##### detectPrd(response: string): PrdDetectionResult

**Location**: `src/chat/engine.ts:269-296`

Detects if a response contains a complete PRD using two strategies:

1. **Marker-based detection** (preferred): Looks for `[PRD]...[/PRD]` markers
2. **Heading-based fallback**: Looks for `# PRD: Feature Name` as the last major section

Returns:
```typescript
{
  found: boolean;
  content?: string;    // PRD content without markers
  featureName?: string // Extracted feature name
}
```

##### Event Subscription

```typescript
on(listener: ChatEventListener): () => void
```

**Location**: `src/chat/engine.ts:59-62`

Subscribe to chat events. Returns an unsubscribe function.

##### State Access Methods

- `getHistory(): ChatMessage[]` - Returns a copy of the conversation history
- `getStatus(): ChatStatus` - Returns the current engine status
- `getAgent(): AgentPlugin` - Returns the configured agent plugin
- `reset(): void` - Clears history and resets status to idle

### Type Definitions

**Location**: `src/chat/types.ts`

#### ChatMessage

```typescript
interface ChatMessage {
  role: ChatRole;              // 'user' | 'assistant' | 'system'
  content: string;             // Message content
  timestamp: Date;             // When the message was created
  metadata?: Record<string, unknown>; // Optional metadata
}
```

#### ChatStatus

```typescript
type ChatStatus =
  | 'idle'       // Ready for user input
  | 'processing' // Waiting for agent response
  | 'error'      // An error occurred
  | 'completed'; // Conversation reached terminal state
```

#### ChatEngineConfig

```typescript
interface ChatEngineConfig {
  agent: AgentPlugin;                    // Required: Agent to use
  systemPrompt: string;                  // Required: System context
  maxHistoryMessages?: number;           // Default: 50
  timeout?: number;                      // Default: 180000ms
  cwd?: string;                          // Default: process.cwd()
  agentOptions?: Partial<AgentExecuteOptions>;
}
```

#### SendMessageOptions

```typescript
interface SendMessageOptions {
  onChunk?: (chunk: string) => void;  // Streaming output callback
  onStatus?: (status: string) => void; // Progress status callback
}
```

#### SendMessageResult

```typescript
interface SendMessageResult {
  success: boolean;
  response?: ChatMessage;  // The assistant's response
  error?: string;          // Error message if failed
  durationMs?: number;     // Execution duration
}
```

### Chat Events

**Location**: `src/chat/types.ts:149-241`

The ChatEngine emits the following event types:

| Event Type | Description | Payload |
|------------|-------------|---------|
| `message:sent` | User message was sent | `message: ChatMessage` |
| `message:received` | Assistant response received | `message: ChatMessage, durationMs: number` |
| `status:changed` | Engine status changed | `previousStatus, newStatus: ChatStatus` |
| `error:occurred` | An error occurred | `error: string` |
| `prd:detected` | PRD detected in response | `prdContent: string, featureName: string` |

### Factory Function: createPrdChatEngine

**Location**: `src/chat/engine.ts:336-349`

```typescript
function createPrdChatEngine(
  agent: AgentPlugin,
  options?: { cwd?: string; timeout?: number }
): ChatEngine
```

Factory function that creates a ChatEngine pre-configured for PRD generation with the `PRD_SYSTEM_PROMPT`.

### PRD System Prompt

**Location**: `src/chat/engine.ts:22-31`

The default system prompt instructs the agent to:
1. Ask clarifying questions with lettered options (A, B, C, D)
2. Ask questions one set at a time
3. Generate complete PRD when context is sufficient
4. Wrap the final PRD in `[PRD]...[/PRD]` markers

```typescript
export const PRD_SYSTEM_PROMPT = `You are helping create a Product Requirements Document (PRD)...`;
```

### Utility Function: slugify

**Location**: `src/chat/engine.ts:354-362`

```typescript
function slugify(text: string): string
```

Converts text to a URL/filename-safe slug by:
- Converting to lowercase
- Removing special characters
- Replacing spaces with hyphens
- Collapsing multiple hyphens

## Data Flow

### Message Send Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          sendMessage() Flow                              │
└─────────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────┐
│ Check status != │  ──(processing)──▶  Return error
│   processing    │
└─────────────────┘
     │ (idle/error/completed)
     ▼
┌─────────────────┐
│  Create user    │
│    message      │
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ Push to history │ ──▶ Emit 'message:sent'
│ Set 'processing'│ ──▶ Emit 'status:changed'
└─────────────────┘
     │
     ▼
┌─────────────────┐
│  buildPrompt()  │  (system + history + current)
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ agent.execute() │ ──(streaming)──▶ onChunk(), onStderr()
└─────────────────┘
     │
     ▼
┌─────────────────┐
│ Process result  │
└─────────────────┘
     │
     ├──(success)──▶ Create assistant message
     │               Push to history
     │               Emit 'message:received'
     │               Check detectPrd()
     │               ├──(PRD found)──▶ Set 'completed'
     │               │                  Emit 'prd:detected'
     │               └──(no PRD)───▶ Set 'idle'
     │
     └──(failure)──▶ Set 'error'
                     Emit 'error:occurred'
```

### Prompt Building Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     buildPrompt() Output                         │
└─────────────────────────────────────────────────────────────────┘

<system>
[config.systemPrompt - e.g., PRD_SYSTEM_PROMPT]
</system>

<conversation>
User: [message from history[0]]
Assistant: [response from history[1]]
User: [message from history[2]]
...
[Last N messages based on maxHistoryMessages]
</conversation>

User: [current message being sent]
Assistant:
```

## Configuration

### ChatEngine Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `agent` | `AgentPlugin` | Required | The AI agent to use for responses |
| `systemPrompt` | `string` | Required | System context prepended to all prompts |
| `maxHistoryMessages` | `number` | 50 | Maximum messages to include in context |
| `timeout` | `number` | 180000 | Timeout in milliseconds (3 minutes) |
| `cwd` | `string` | `process.cwd()` | Working directory for agent execution |
| `agentOptions` | `Partial<AgentExecuteOptions>` | `{}` | Additional agent execution options |

## Usage Examples

### Basic Multi-Turn Conversation

```typescript
import { ChatEngine } from './chat/engine.js';
import { claudePlugin } from './plugins/agents/claude/index.js';

// Create engine with custom system prompt
const engine = new ChatEngine({
  agent: claudePlugin,
  systemPrompt: 'You are a helpful assistant.',
});

// Subscribe to events
const unsubscribe = engine.on((event) => {
  if (event.type === 'message:received') {
    console.log('Response:', event.message.content);
  }
});

// Send messages
await engine.sendMessage('Hello!');
await engine.sendMessage('What is the capital of France?');

// Get full history
const history = engine.getHistory();
console.log(`${history.length} messages in conversation`);

// Clean up
unsubscribe();
```

### PRD Generation with Streaming

```typescript
import { createPrdChatEngine } from './chat/engine.js';

const engine = createPrdChatEngine(agent, { cwd: '/my/project' });

// Listen for PRD detection
engine.on((event) => {
  if (event.type === 'prd:detected') {
    console.log('PRD Generated!');
    console.log('Feature:', event.featureName);
    console.log('Content:', event.prdContent);
  }
});

// Send with streaming
const result = await engine.sendMessage('I want to build a user dashboard', {
  onChunk: (chunk) => process.stdout.write(chunk),
  onStatus: (status) => console.log('\nStatus:', status),
});
```

## Integration Points

### PrdChatApp Component

**Location**: `src/tui/components/PrdChatApp.tsx`

The primary consumer of ChatEngine. It:
- Creates the engine using `createPrdChatEngine` on mount
- Subscribes to events for UI updates
- Handles the two-phase flow: chat phase and review phase
- Manages streaming output display
- Provides tracker selection (JSON/Beads) after PRD generation

### AgentPlugin Interface

**Location**: `src/plugins/agents/types.ts`

The ChatEngine depends on the AgentPlugin interface for:
- `execute(prompt, files, options)` - Execute prompts with streaming support
- `meta.name` - Display agent name in UI

## Testing

No dedicated test files exist for the ChatEngine. Testing is recommended for:
- Conversation history management
- Prompt building with various history sizes
- PRD detection with marker and heading formats
- Event emission timing and payloads
- Error handling and status transitions
- Timeout behavior

## Related Documentation

- Agent Plugin System: See `src/plugins/agents/types.ts` for the AgentPlugin interface
- TUI Components: See `src/tui/components/` for UI integration

## Changelog

### 2025-01-14 - Chris Crabtree
- Initial documentation created
