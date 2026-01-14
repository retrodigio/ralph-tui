/**
 * ABOUTME: WorkerPanel component for displaying detailed view of a selected worker.
 * Shows worker name, task info, branch, agent status, output, and subagent traces.
 * Supports toggling output and subagents sections for space management.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { colors } from '../theme.js';
import type { WorkerState, SubagentTraceState } from '../../pool/types.js';

/**
 * Props for the WorkerPanel component
 */
export interface WorkerPanelProps {
  /** Worker name */
  name: string;
  /** Worker state */
  worker: WorkerState;
  /** Whether to show the output section */
  showOutput: boolean;
  /** Whether to show the subagents section */
  showSubagents: boolean;
  /** Panel width for truncation calculations */
  width?: number;
}

/**
 * Format duration in human-readable format.
 * Shows milliseconds for short durations, seconds for longer ones.
 */
function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Format elapsed time from a start date to now.
 */
function formatElapsedTime(startedAt: Date | null): string {
  if (!startedAt) return '';
  const elapsedMs = Date.now() - startedAt.getTime();
  return formatDuration(elapsedMs);
}

/**
 * Get the status indicator symbol for a subagent status.
 */
function getSubagentStatusIcon(status: SubagentTraceState['status']): string {
  switch (status) {
    case 'running':
      return '◐';
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

/**
 * Get the color for a subagent status.
 */
function getSubagentStatusColor(status: SubagentTraceState['status']): string {
  switch (status) {
    case 'running':
      return colors.status.info;
    case 'completed':
      return colors.status.success;
    case 'error':
      return colors.status.error;
    default:
      return colors.fg.muted;
  }
}

/**
 * Truncate text to fit within a maximum width.
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get display text for worker status.
 */
function getStatusDisplayText(worker: WorkerState): string {
  switch (worker.status) {
    case 'working':
      return `working (iteration ${worker.iteration})`;
    case 'idle':
      return 'idle';
    case 'rate-limited':
      return 'rate-limited';
    case 'done':
      return 'done (pending merge)';
    case 'error':
      return `error: ${worker.error ?? 'unknown'}`;
    default:
      return worker.status;
  }
}

/**
 * Get color for worker status display.
 */
function getStatusColor(status: WorkerState['status']): string {
  switch (status) {
    case 'working':
      return colors.status.success;
    case 'idle':
      return colors.fg.dim;
    case 'rate-limited':
      return colors.status.warning;
    case 'done':
      return colors.accent.primary;
    case 'error':
      return colors.status.error;
    default:
      return colors.fg.muted;
  }
}

/**
 * Props for the OutputSection component.
 */
interface OutputSectionProps {
  /** Output text to display */
  output: string;
  /** Maximum width for lines */
  maxWidth: number;
}

/**
 * Renders the output section with scrollable content.
 * Shows the latest lines of agent output.
 */
function OutputSection({ output, maxWidth }: OutputSectionProps): ReactNode {
  if (!output) {
    return (
      <box style={{ paddingLeft: 1 }}>
        <text fg={colors.fg.dim}>(no output yet)</text>
      </box>
    );
  }

  // Split output into lines and take last N lines that fit
  const lines = output.trim().split('\n');
  const maxLines = 8;
  const displayLines = lines.slice(-maxLines);

  return (
    <scrollbox
      style={{
        flexGrow: 1,
        width: '100%',
        maxHeight: maxLines + 1,
      }}
    >
      {displayLines.map((line, index) => (
        <box key={index} style={{ paddingLeft: 1, paddingRight: 1 }}>
          <text fg={colors.fg.secondary}>
            <span fg={colors.fg.dim}>&gt; </span>
            {truncateText(line, maxWidth - 4)}
          </text>
        </box>
      ))}
    </scrollbox>
  );
}

/**
 * Props for the SubagentsSection component.
 */
interface SubagentsSectionProps {
  /** Array of subagent traces */
  subagents: SubagentTraceState[];
  /** Maximum width for lines */
  maxWidth: number;
}

/**
 * Renders the subagents section with trace visualization.
 * Format: └─ type (duration) status
 */
function SubagentsSection({
  subagents,
  maxWidth: _maxWidth,
}: SubagentsSectionProps): ReactNode {
  if (subagents.length === 0) {
    return (
      <box style={{ paddingLeft: 1 }}>
        <text fg={colors.fg.dim}>(no subagents)</text>
      </box>
    );
  }

  // Show last N subagents
  const maxSubagents = 6;
  const displaySubagents = subagents.slice(-maxSubagents);

  return (
    <scrollbox
      style={{
        flexGrow: 1,
        width: '100%',
        maxHeight: maxSubagents + 1,
      }}
    >
      {displaySubagents.map((subagent) => {
        const statusIcon = getSubagentStatusIcon(subagent.status);
        const statusColor = getSubagentStatusColor(subagent.status);
        const durationStr = formatDuration(subagent.durationMs);
        const typeDisplay = subagent.type;

        return (
          <box key={subagent.id} style={{ paddingLeft: 1, paddingRight: 1 }}>
            <text>
              <span fg={colors.fg.dim}>└─ </span>
              <span fg={colors.accent.tertiary}>{typeDisplay}</span>
              <span fg={colors.fg.muted}>
                {' '}
                ({durationStr || '…'})
              </span>
              <span fg={statusColor}> {statusIcon}</span>
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
}

/**
 * WorkerPanel component showing detailed view of a selected worker.
 * Displays: worker name, task info, branch, agent status, output, and subagent traces.
 * Features: togglable output/subagents sections for space management.
 * Wrapped in React.memo to prevent unnecessary re-renders.
 */
export const WorkerPanel = memo(function WorkerPanel({
  name,
  worker,
  showOutput,
  showSubagents,
  width = 50,
}: WorkerPanelProps): ReactNode {
  // Calculate max width for content (panel width minus padding and border)
  const maxContentWidth = Math.max(20, width - 4);

  // Extract task info
  const task = worker.task;
  const taskId = task?.id ?? '(no task)';
  const taskTitle = task?.title ?? '';

  // Build branch name from worker name and task ID
  const branchName = task ? `work/${name}/${task.id}` : '(no branch)';

  // Agent and status info
  const agentName = worker.agent || '(none)';
  const statusText = getStatusDisplayText(worker);
  const statusColor = getStatusColor(worker.status);

  // Elapsed time
  const elapsedTime = formatElapsedTime(worker.startedAt);

  // Title with worker name
  const title = `Worker: ${name}`;

  return (
    <box
      title={title}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 40,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor:
          worker.status === 'working'
            ? colors.border.active
            : colors.border.normal,
      }}
    >
      {/* Header section: task, branch, agent, status */}
      <box
        style={{
          flexDirection: 'column',
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
        }}
      >
        {/* Task line */}
        <text>
          <span fg={colors.fg.muted}>Task: </span>
          <span fg={colors.accent.primary}>{taskId}</span>
          {taskTitle && (
            <span fg={colors.fg.secondary}>
              {' '}
              - {truncateText(taskTitle, maxContentWidth - taskId.length - 10)}
            </span>
          )}
        </text>

        {/* Branch line */}
        <text>
          <span fg={colors.fg.muted}>Branch: </span>
          <span fg={colors.fg.secondary}>
            {truncateText(branchName, maxContentWidth - 10)}
          </span>
        </text>

        {/* Agent line */}
        <text>
          <span fg={colors.fg.muted}>Agent: </span>
          <span fg={colors.accent.tertiary}>{agentName}</span>
          <span fg={colors.fg.dim}> (primary)</span>
        </text>

        {/* Status line */}
        <text>
          <span fg={colors.fg.muted}>Status: </span>
          <span fg={statusColor}>{statusText}</span>
          {elapsedTime && (
            <span fg={colors.fg.dim}> [{elapsedTime}]</span>
          )}
        </text>
      </box>

      {/* Output section (if enabled) */}
      {showOutput && (
        <box
          style={{
            flexDirection: 'column',
            marginTop: 1,
            flexGrow: 1,
            flexShrink: 1,
          }}
        >
          <box style={{ paddingLeft: 1 }}>
            <text fg={colors.fg.muted}>Output:</text>
          </box>
          <OutputSection output={worker.output} maxWidth={maxContentWidth} />
        </box>
      )}

      {/* Subagents section (if enabled) */}
      {showSubagents && (
        <box
          style={{
            flexDirection: 'column',
            marginTop: 1,
            flexGrow: 1,
            flexShrink: 1,
          }}
        >
          <box style={{ paddingLeft: 1 }}>
            <text fg={colors.fg.muted}>Subagents:</text>
          </box>
          <SubagentsSection
            subagents={worker.subagents}
            maxWidth={maxContentWidth}
          />
        </box>
      )}

      {/* Show hint when both sections are hidden */}
      {!showOutput && !showSubagents && (
        <box style={{ paddingLeft: 1, marginTop: 1 }}>
          <text fg={colors.fg.dim}>
            Press 'o' for output, 't' for subagents
          </text>
        </box>
      )}
    </box>
  );
});
