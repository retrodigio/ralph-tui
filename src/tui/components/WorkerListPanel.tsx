/**
 * ABOUTME: WorkerListPanel component for displaying active workers in parallel mode.
 * Shows worker status, current task, progress, and action description.
 * Supports selection via keyboard/click for detailed worker view.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { colors } from '../theme.js';
import type { WorkerState, WorkerStatus } from '../../pool/types.js';

/**
 * Props for the WorkerListPanel component
 */
export interface WorkerListPanelProps {
  /** Map of worker name to worker state */
  workers: Map<string, WorkerState>;
  /** Currently selected worker name (null if none selected) */
  selectedWorker: string | null;
  /** Callback when a worker is selected */
  onSelectWorker: (name: string) => void;
  /** Panel width for truncation calculations */
  width?: number;
}

/**
 * Get the status indicator symbol for a worker status.
 * - ▶ (working) - actively executing task
 * - ○ (idle) - waiting for work
 * - ⚠ (rate-limited) - switched or waiting
 * - ✓ (done) - pending merge
 * - ✗ (error) - needs attention
 */
function getWorkerStatusIndicator(status: WorkerStatus): string {
  switch (status) {
    case 'working':
      return '▶';
    case 'idle':
      return '○';
    case 'rate-limited':
      return '⚠';
    case 'done':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

/**
 * Get the color for a worker status.
 * - working: green (active progress)
 * - idle: dim (waiting)
 * - rate-limited: yellow (warning)
 * - done: blue (ready for merge)
 * - error: red (attention needed)
 */
function getWorkerStatusColor(status: WorkerStatus): string {
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
 * Format task ID for display (truncate if needed).
 * Shows "gt-abc" style for worktree-based tasks.
 */
function formatTaskId(taskId: string | null, maxLen: number = 8): string {
  if (!taskId) return '(idle)';
  if (taskId.length <= maxLen) return taskId;
  // Truncate middle if longer, keeping prefix
  return taskId.slice(0, maxLen - 2) + '…';
}

/**
 * Calculate progress percentage based on iteration count.
 * Uses rough heuristic: assumes ~10 iterations typical for task completion.
 */
function calculateProgress(iteration: number): number {
  // Cap at 99% since we don't know actual completion
  const progress = Math.min(99, Math.floor((iteration / 10) * 100));
  return progress;
}

/**
 * Format progress as percentage string.
 */
function formatProgress(iteration: number): string {
  if (iteration === 0) return '';
  const progress = calculateProgress(iteration);
  return `${progress}%`;
}

/**
 * Extract current action from worker output.
 * Looks for common patterns in agent output.
 */
function extractCurrentAction(output: string, maxLen: number = 20): string {
  if (!output) return '';

  // Take the last non-empty line as current action
  const lines = output.trim().split('\n').filter(line => line.trim());
  if (lines.length === 0) return '';

  let action = lines[lines.length - 1].trim();

  // Truncate if needed
  if (action.length > maxLen) {
    action = action.slice(0, maxLen - 1) + '…';
  }

  return action;
}

/**
 * Truncate text to fit within a maximum width.
 * Adds ellipsis if text is truncated.
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Props for a single WorkerRow component.
 */
interface WorkerRowProps {
  /** Worker name */
  name: string;
  /** Worker state */
  state: WorkerState;
  /** Whether this worker is selected */
  isSelected: boolean;
  /** Maximum width for the row content */
  maxWidth: number;
}

/**
 * Renders a single row in the worker list.
 * Format: [status] worker-name   task-id   progress   action...
 */
function WorkerRow({
  name,
  state,
  isSelected,
  maxWidth,
}: WorkerRowProps): ReactNode {
  const statusIndicator = getWorkerStatusIndicator(state.status);
  const statusColor = getWorkerStatusColor(state.status);

  // Extract display values
  const taskId = state.task?.id ?? null;
  const taskIdDisplay = formatTaskId(taskId, 10);
  const progressDisplay = state.status === 'working' ? formatProgress(state.iteration) : '';
  const actionDisplay = state.status === 'working'
    ? extractCurrentAction(state.output, 15)
    : state.status === 'idle'
      ? 'waiting for deps…'
      : state.status === 'rate-limited'
        ? 'rate-limited'
        : state.status === 'error'
          ? state.error ?? 'error'
          : '';

  // Calculate available widths
  // Format: [indicator] name   taskId   progress%   action
  const nameWidth = 10;
  const taskIdWidth = 12;
  const progressWidth = 5;
  const fixedWidth = 2 + nameWidth + 3 + taskIdWidth + 3 + progressWidth + 3; // spaces and indicator
  const actionWidth = Math.max(5, maxWidth - fixedWidth);

  const truncatedName = truncateText(name, nameWidth);
  const truncatedAction = truncateText(actionDisplay, actionWidth);

  // Determine text colors based on status
  const nameColor = isSelected ? colors.fg.primary : colors.fg.secondary;
  const taskIdColor = state.status === 'idle' ? colors.fg.dim : colors.fg.muted;
  const progressColor = state.status === 'working' ? colors.status.info : colors.fg.dim;
  const actionColor = state.status === 'error'
    ? colors.status.error
    : state.status === 'rate-limited'
      ? colors.status.warning
      : colors.fg.muted;

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'row',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
      }}
    >
      <text>
        <span fg={statusColor}>{statusIndicator}</span>
        <span fg={nameColor}> {truncatedName.padEnd(nameWidth)}</span>
        <span fg={taskIdColor}>   {taskIdDisplay.padEnd(taskIdWidth)}</span>
        <span fg={progressColor}>   {progressDisplay.padStart(progressWidth)}</span>
        <span fg={actionColor}>   {truncatedAction}</span>
      </text>
    </box>
  );
}

/**
 * WorkerListPanel component showing all active workers.
 * Displays: status indicator, worker name, current task ID, progress, action.
 * Features: selection highlighting, click/keyboard interaction, color-coded status.
 * Wrapped in React.memo to prevent unnecessary re-renders.
 */
export const WorkerListPanel = memo(function WorkerListPanel({
  workers,
  selectedWorker,
  onSelectWorker: _onSelectWorker,
  width = 45,
}: WorkerListPanelProps): ReactNode {
  // Calculate max width for row content (panel width minus padding and border)
  const maxRowWidth = Math.max(30, width - 4);

  // Convert workers map to sorted array for consistent ordering
  const workerEntries = Array.from(workers.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  // Count workers by status for title
  const workingCount = workerEntries.filter(([, s]) => s.status === 'working').length;
  const totalCount = workerEntries.length;

  // Build title with counts
  const title = workingCount > 0
    ? `Workers (${workingCount} active / ${totalCount} total)`
    : `Workers (${totalCount})`;

  return (
    <box
      title={title}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 30,
        maxWidth: 60,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: selectedWorker ? colors.border.active : colors.border.normal,
      }}
    >
      <scrollbox
        style={{
          flexGrow: 1,
          width: '100%',
        }}
      >
        {workerEntries.length === 0 ? (
          <box style={{ padding: 1 }}>
            <text fg={colors.fg.muted}>No workers active</text>
          </box>
        ) : (
          workerEntries.map(([name, state]) => (
            <WorkerRow
              key={name}
              name={name}
              state={state}
              isSelected={name === selectedWorker}
              maxWidth={maxRowWidth}
            />
          ))
        )}
      </scrollbox>
    </box>
  );
});
