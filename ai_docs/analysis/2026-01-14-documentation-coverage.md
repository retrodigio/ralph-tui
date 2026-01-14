---
date: 2026-01-14T16:45:00Z
author: Chris Crabtree
git_commit: 48d15b99df484a706d60cb26311058e7ceb1fd3a
branch: main
repository: ralph-tui
analysis_type: documentation_coverage
status: complete
---

# Documentation Coverage Analysis

**Date**: 2026-01-14
**Analyzed By**: Chris Crabtree
**Repository**: ralph-tui
**Branch**: main
**Commit**: 48d15b99df484a706d60cb26311058e7ceb1fd3a

## Executive Summary

- **Total Documentation Files**: 0
- **Documented Features**: 0
- **Undocumented Features**: 15
- **Documentation Coverage**: 0%
- **Documentation Health**: Poor (no AI documentation exists)

This is a fresh start - no AI documentation has been generated yet for this codebase. The `ai_docs/codebase/` directory does not exist.

## Currently Documented

### Recent Documentation

No AI documentation files exist in `ai_docs/codebase/`.

### Documentation Age

- **Recent** (< 1 week): 0 documents
- **Current** (1 week - 1 month): 0 documents
- **Aging** (1-3 months): 0 documents
- **Stale** (> 3 months): 0 documents

**Note**: The project does have user-facing documentation at [ralph-tui.com](https://ralph-tui.com) and a README.md, but no AI-focused architecture documentation exists.

## Undocumented Features

### Documentation Tracker

This table tracks all undocumented features and their documentation progress. Use `/ai-doc` without arguments to automatically work through this list in priority order.

| Priority | Feature Name | Status | AI Doc Prompt |
|----------|-------------|--------|---------------|
| 1 | Execution Engine | ready | Document the ExecutionEngine class including the iteration loop, task selection, error handling strategies (retry/skip/abort), rate limit detection with exponential backoff, agent switching/fallback system, subagent tracing integration, and event emission patterns |
| 2 | Plugin Architecture | ready | Document the plugin system architecture covering both agent plugins and tracker plugins, including the registry pattern, base plugin classes, plugin configuration, built-in plugins (claude/opencode agents, beads/beads-bv/json trackers), and how to extend with custom plugins |
| 3 | Configuration System | ready | Document the configuration system including TOML file loading (global and project configs), schema validation with Zod, config merging strategy, runtime options, agent/tracker config resolution, and the setup status checking |
| 4 | Session Management | ready | Document the session management system including lock files for single-instance enforcement, session persistence, resume functionality, stale session detection/recovery, active task tracking, and graceful shutdown handling |
| 5 | Rate Limit Handling | ready | Document the rate limit detection and handling system including the RateLimitDetector class, pattern matching for different agent error formats, exponential backoff retry logic, fallback agent switching, primary agent recovery testing, and the rate limit state machine |
| 6 | Template System | ready | Document the Handlebars-based prompt template system including built-in templates for different trackers (default/beads/beads-bv/json), template variable injection, custom template support, template loading from user config directory, and the bundled prompts |
| 7 | TUI Components | ready | Document the Terminal User Interface components built with OpenTUI/React including the component hierarchy, theme system, keyboard shortcut handling, dashboard view, iteration history panel, subagent tracing panel, and output parser |
| 8 | PRD System | ready | Document the PRD (Product Requirements Document) creation system including the wizard flow, clarifying questions, PRD generator, markdown parser, JSON conversion, and the AI chat mode for PRD generation |
| 9 | Chat Engine | ready | Document the ChatEngine class for multi-turn AI conversations including conversation history management, prompt building with system context, PRD detection in responses, streaming output handling, and the createPrdChatEngine factory |
| 10 | Logging System | ready | Document the logging system including iteration log persistence, structured logging for headless/CI mode, progress tracking across iterations, log cleanup utilities, and subagent trace building |
| 11 | Subagent Tracing | ready | Document the subagent tracing system including the SubagentTraceParser class, JSONL streaming parser, subagent lifecycle events (spawn/progress/complete/error), hierarchy tracking, and integration with the execution engine |
| 12 | Notifications | ready | Document the desktop notification system including cross-platform notification sending via node-notifier, sound playback system, completion/error/max-iterations notifications, and configuration resolution |
| 13 | Interruption Handling | ready | Document the interruption handling system including Ctrl+C signal handling, confirmation dialog flow, double-press detection for forced exit, and graceful shutdown coordination |
| 14 | CLI Commands | ready | Document all CLI commands (run, resume, status, logs, setup, create-prd, convert, config, template, plugins, docs) including argument parsing, command execution flow, and headless mode support |
| 15 | Setup Wizard | ready | Document the interactive setup wizard including plugin detection, prompting utilities, configuration generation, and the checkAndRunSetup flow for first-time users |

**Status Values:**
- `ready` - Ready to be documented (default)
- `in-progress` - Currently being documented by an agent
- `complete` - Documentation has been created

**Note**: When `/ai-doc` is run without a prompt, it will:
1. Find the highest priority feature with status `ready`
2. Verify documentation doesn't already exist
3. Update status to `in-progress` and begin documentation
4. Update status to `complete` when finished

### High Priority (Critical/Complex)

#### 1. Execution Engine
- **Location**: `src/engine/index.ts` (1700+ lines) and `src/engine/types.ts`
- **Type**: Core Business Logic
- **Complexity**: High
- **Why Document**: The heart of Ralph TUI - manages the entire task execution loop, handles errors, rate limits, agent switching, and emits events. Understanding this is essential for any maintenance or extension.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the ExecutionEngine class including the iteration loop, task selection, error handling strategies (retry/skip/abort), rate limit detection with exponential backoff, agent switching/fallback system, subagent tracing integration, and event emission patterns"
  ```

#### 2. Plugin Architecture
- **Location**: `src/plugins/agents/` (8 files) and `src/plugins/trackers/` (7 files)
- **Type**: Extension System / Architecture
- **Complexity**: High
- **Why Document**: Core extensibility mechanism. Developers need to understand this to add new AI agents or task trackers.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the plugin system architecture covering both agent plugins and tracker plugins, including the registry pattern, base plugin classes, plugin configuration, built-in plugins (claude/opencode agents, beads/beads-bv/json trackers), and how to extend with custom plugins"
  ```

#### 3. Configuration System
- **Location**: `src/config/index.ts` (780 lines), `src/config/schema.ts`, `src/config/types.ts`
- **Type**: Core Infrastructure
- **Complexity**: High
- **Why Document**: Complex multi-source config loading (global + project), Zod validation, runtime option merging. Critical for understanding how settings flow through the system.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the configuration system including TOML file loading (global and project configs), schema validation with Zod, config merging strategy, runtime options, agent/tracker config resolution, and the setup status checking"
  ```

#### 4. Session Management
- **Location**: `src/session/index.ts` (400 lines), `src/session/persistence.ts`, `src/session/lock.ts`
- **Type**: State Management / Recovery
- **Complexity**: High
- **Why Document**: Enables crash recovery, resume functionality, and prevents multiple instances. Complex state machine with lock files.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the session management system including lock files for single-instance enforcement, session persistence, resume functionality, stale session detection/recovery, active task tracking, and graceful shutdown handling"
  ```

#### 5. Rate Limit Handling
- **Location**: `src/engine/rate-limit-detector.ts`, integrated in `src/engine/index.ts`
- **Type**: Error Handling / Resilience
- **Complexity**: High
- **Why Document**: Critical for production reliability. Complex state machine with exponential backoff, agent fallback, and recovery testing.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the rate limit detection and handling system including the RateLimitDetector class, pattern matching for different agent error formats, exponential backoff retry logic, fallback agent switching, primary agent recovery testing, and the rate limit state machine"
  ```

### Medium Priority (Important/Moderate Complexity)

#### 6. Template System
- **Location**: `src/templates/` (5 files - engine.ts, builtin.ts, prompts.ts, types.ts, index.ts)
- **Type**: Prompt Engineering
- **Complexity**: Medium
- **Why Document**: Essential for understanding how prompts are built. Users may want to customize prompts.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the Handlebars-based prompt template system including built-in templates for different trackers (default/beads/beads-bv/json), template variable injection, custom template support, template loading from user config directory, and the bundled prompts"
  ```

#### 7. TUI Components
- **Location**: `src/tui/` (5 files) and `src/tui/components/`
- **Type**: User Interface
- **Complexity**: Medium
- **Why Document**: React-based terminal UI using OpenTUI. Understanding the component structure helps with UI modifications.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the Terminal User Interface components built with OpenTUI/React including the component hierarchy, theme system, keyboard shortcut handling, dashboard view, iteration history panel, subagent tracing panel, and output parser"
  ```

#### 8. PRD System
- **Location**: `src/prd/` (6 files - wizard.ts, generator.ts, parser.ts, questions.ts, types.ts, index.ts)
- **Type**: Feature Module
- **Complexity**: Medium
- **Why Document**: Key workflow feature - how users create PRDs that drive task execution.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the PRD (Product Requirements Document) creation system including the wizard flow, clarifying questions, PRD generator, markdown parser, JSON conversion, and the AI chat mode for PRD generation"
  ```

#### 9. Chat Engine
- **Location**: `src/chat/engine.ts` (360 lines), `src/chat/types.ts`
- **Type**: AI Integration
- **Complexity**: Medium
- **Why Document**: Powers the `--chat` mode for AI-assisted PRD creation. Multi-turn conversation management.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the ChatEngine class for multi-turn AI conversations including conversation history management, prompt building with system context, PRD detection in responses, streaming output handling, and the createPrdChatEngine factory"
  ```

#### 10. Logging System
- **Location**: `src/logs/` (5 files - persistence.ts, structured-logger.ts, progress.ts, types.ts, index.ts)
- **Type**: Infrastructure
- **Complexity**: Medium
- **Why Document**: Essential for debugging and CI/CD. Includes iteration logs, structured logging, and progress tracking.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the logging system including iteration log persistence, structured logging for headless/CI mode, progress tracking across iterations, log cleanup utilities, and subagent trace building"
  ```

### Lower Priority (Supporting Features)

#### 11. Subagent Tracing
- **Location**: `src/plugins/agents/tracing/` (3 files - parser.ts, types.ts, index.ts)
- **Type**: Observability
- **Complexity**: Medium
- **Why Document**: Useful for understanding nested agent calls. Parses JSONL output for subagent lifecycle events.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the subagent tracing system including the SubagentTraceParser class, JSONL streaming parser, subagent lifecycle events (spawn/progress/complete/error), hierarchy tracking, and integration with the execution engine"
  ```

#### 12. Notifications
- **Location**: `src/notifications.ts` (230 lines), `src/sound.ts`
- **Type**: User Experience
- **Complexity**: Low
- **Why Document**: Cross-platform desktop notifications with sound. Simple but useful reference.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the desktop notification system including cross-platform notification sending via node-notifier, sound playback system, completion/error/max-iterations notifications, and configuration resolution"
  ```

#### 13. Interruption Handling
- **Location**: `src/interruption/handler.ts`, `src/interruption/types.ts`
- **Type**: System Integration
- **Complexity**: Low
- **Why Document**: Signal handling for graceful shutdown. Important for understanding how Ralph handles Ctrl+C.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the interruption handling system including Ctrl+C signal handling, confirmation dialog flow, double-press detection for forced exit, and graceful shutdown coordination"
  ```

#### 14. CLI Commands
- **Location**: `src/commands/` (10 files) and `src/cli.tsx`
- **Type**: User Interface
- **Complexity**: Low-Medium
- **Why Document**: Entry point for all user interactions. Useful reference for understanding command flows.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document all CLI commands (run, resume, status, logs, setup, create-prd, convert, config, template, plugins, docs) including argument parsing, command execution flow, and headless mode support"
  ```

#### 15. Setup Wizard
- **Location**: `src/setup/` (5 files - wizard.ts, prompts.ts, skill-installer.ts, types.ts, index.ts)
- **Type**: Onboarding
- **Complexity**: Low
- **Why Document**: First-time user experience. Understanding this helps improve onboarding.
- **Suggested Command**:
  ```bash
  /ai-doc
  # Prompt: "Document the interactive setup wizard including plugin detection, prompting utilities, configuration generation, and the checkAndRunSetup flow for first-time users"
  ```

## Potentially Stale Documentation

No existing documentation to evaluate for staleness.

## Recommended Documentation Roadmap

### Phase 1: Critical Gaps (Week 1)
1. `/ai-doc` - Document Execution Engine
2. `/ai-doc` - Document Plugin Architecture
3. `/ai-doc` - Document Configuration System

### Phase 2: Core Infrastructure (Week 2)
1. `/ai-doc` - Document Session Management
2. `/ai-doc` - Document Rate Limit Handling
3. `/ai-doc` - Document Template System

### Phase 3: Feature Modules (Week 3)
1. `/ai-doc` - Document TUI Components
2. `/ai-doc` - Document PRD System
3. `/ai-doc` - Document Chat Engine
4. `/ai-doc` - Document Logging System

### Phase 4: Supporting Features (Week 4+)
1. `/ai-doc` - Document Subagent Tracing
2. `/ai-doc` - Document Notifications
3. `/ai-doc` - Document Interruption Handling
4. `/ai-doc` - Document CLI Commands
5. `/ai-doc` - Document Setup Wizard

## Codebase Overview

### Project Structure
```
ralph-tui/
├── src/
│   ├── cli.tsx           # CLI entry point (240 lines)
│   ├── index.ts          # Main exports
│   ├── notifications.ts  # Desktop notifications
│   ├── sound.ts          # Sound playback
│   ├── chat/             # AI chat mode (3 files)
│   ├── commands/         # CLI commands (10 files)
│   ├── config/           # Configuration (3 files)
│   ├── engine/           # Execution engine (3 files)
│   ├── interruption/     # Signal handling (3 files)
│   ├── logs/             # Logging system (5 files)
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (8 files)
│   │   └── trackers/     # Tracker plugins (7 files)
│   ├── prd/              # PRD generation (6 files)
│   ├── session/          # Session management (4 files)
│   ├── setup/            # Setup wizard (5 files)
│   ├── templates/        # Prompt templates (5 files)
│   └── tui/              # Terminal UI (5 files)
├── skills/               # Bundled skills (3 directories)
├── website/              # Documentation website
└── docs/                 # Static assets
```

### Key Components Identified

1. **Execution Engine**: 3 files (1700+ lines main)
   - Main files: `src/engine/index.ts`, `types.ts`, `rate-limit-detector.ts`
   - Status: Undocumented

2. **Plugin System**: 15 files
   - Agents: `src/plugins/agents/` (8 files)
   - Trackers: `src/plugins/trackers/` (7 files)
   - Status: Undocumented

3. **Configuration**: 3 files (780 lines main)
   - Main files: `src/config/index.ts`, `schema.ts`, `types.ts`
   - Status: Undocumented

4. **Session Management**: 4 files
   - Main files: `src/session/index.ts`, `persistence.ts`, `lock.ts`
   - Status: Undocumented

5. **CLI Commands**: 10 files
   - Main files: `src/commands/*.ts`
   - Status: Undocumented

6. **TUI Components**: 5+ files
   - Main files: `src/tui/`, `src/tui/components/`
   - Status: Undocumented

7. **PRD System**: 6 files
   - Main files: `src/prd/wizard.ts`, `generator.ts`, `parser.ts`
   - Status: Undocumented

8. **Chat Engine**: 3 files
   - Main files: `src/chat/engine.ts`, `types.ts`
   - Status: Undocumented

### Technology Stack Detected

- **Language**: TypeScript
- **Runtime**: Bun
- **UI Framework**: React (via OpenTUI)
- **Templating**: Handlebars
- **Validation**: Zod
- **Configuration**: TOML (via smol-toml)
- **Notifications**: node-notifier
- **Key Dependencies**: @opentui/core, @opentui/react, yaml, zod

## Next Steps

1. **Immediate Actions**:
   - Start with the Execution Engine - it's the core of the system
   - Document Plugin Architecture next for extensibility understanding
   - Follow with Configuration System for deployment clarity

2. **Ongoing**:
   - Document new features as they're developed
   - Update docs when making significant changes
   - Run `/ai-doc-analysis` periodically to track coverage

3. **Quick Wins**:
   - Document Notifications module (simple, standalone, 230 lines)
   - Document Interruption Handling (small, well-contained)
   - Document Setup Wizard (helps new contributors understand onboarding)

## Appendix: All Suggested Commands

For easy copy-paste, here are all the suggested `/ai-doc` commands:

```bash
# High Priority (Week 1)
/ai-doc  # Document the ExecutionEngine class including the iteration loop, task selection, error handling strategies
/ai-doc  # Document the plugin system architecture covering both agent and tracker plugins
/ai-doc  # Document the configuration system including TOML loading, Zod validation, config merging

# Core Infrastructure (Week 2)
/ai-doc  # Document the session management system including lock files, persistence, resume
/ai-doc  # Document the rate limit detection and handling system
/ai-doc  # Document the Handlebars-based prompt template system

# Feature Modules (Week 3)
/ai-doc  # Document the TUI components built with OpenTUI/React
/ai-doc  # Document the PRD creation system
/ai-doc  # Document the ChatEngine class for multi-turn AI conversations
/ai-doc  # Document the logging system

# Supporting Features (Week 4+)
/ai-doc  # Document the subagent tracing system
/ai-doc  # Document the desktop notification system
/ai-doc  # Document the interruption handling system
/ai-doc  # Document all CLI commands
/ai-doc  # Document the interactive setup wizard
```

---

*Analysis generated by ai-docs-manager plugin*
*Re-run `/ai-doc-analysis` to update this report*
