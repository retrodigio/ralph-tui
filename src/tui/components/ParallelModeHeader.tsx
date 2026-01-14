/**
 * ABOUTME: Header component for parallel mode in the Ralph TUI.
 * Displays worker count, overall progress, and elapsed time in a compact format.
 * Shows: status indicator, worker count, task progress bar, elapsed time.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators, formatElapsedTime, layout, type RalphStatus } from '../theme.js';

/**
 * Props for the ParallelModeHeader component
 */
export interface ParallelModeHeaderProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Number of active workers (currently executing) */
  activeWorkers: number;
  /** Total number of workers */
  totalWorkers: number;
  /** Number of completed tasks */
  completedTasks: number;
  /** Total number of tasks */
  totalTasks: number;
  /** Elapsed time in seconds */
  elapsedTime: number;
}

/**
 * Get compact status display for the current Ralph status in parallel mode.
 */
function getStatusDisplay(status: RalphStatus): { indicator: string; color: string; label: string } {
  switch (status) {
    case 'ready':
      return { indicator: statusIndicators.ready, color: colors.status.info, label: 'Ready' };
    case 'running':
      return { indicator: statusIndicators.running, color: colors.status.success, label: 'Running' };
    case 'selecting':
      return { indicator: statusIndicators.selecting, color: colors.status.info, label: 'Selecting' };
    case 'executing':
      return { indicator: statusIndicators.executing, color: colors.status.success, label: 'Executing' };
    case 'pausing':
      return { indicator: statusIndicators.pausing, color: colors.status.warning, label: 'Pausing' };
    case 'paused':
      return { indicator: statusIndicators.paused, color: colors.status.warning, label: 'Paused' };
    case 'stopped':
      return { indicator: statusIndicators.stopped, color: colors.fg.muted, label: 'Stopped' };
    case 'complete':
      return { indicator: statusIndicators.complete, color: colors.status.success, label: 'Complete' };
    case 'idle':
      return { indicator: statusIndicators.idle, color: colors.fg.muted, label: 'Idle' };
    case 'error':
      return { indicator: statusIndicators.blocked, color: colors.status.error, label: 'Error' };
  }
}

/**
 * Mini progress bar component for the header
 */
function MiniProgressBar({
  completed,
  total,
  width,
}: {
  completed: number;
  total: number;
  width: number;
}): ReactNode {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(emptyWidth);

  return (
    <text>
      <span fg={colors.status.success}>{filledBar}</span>
      <span fg={colors.fg.dim}>{emptyBar}</span>
    </text>
  );
}

/**
 * Parallel mode header component showing:
 * - Status indicator and label
 * - Worker count (active / total)
 * - Task progress with bar (X/Y tasks)
 * - Elapsed time
 *
 * Format: ● Running  3 workers  [████████░░] 4/6 tasks  ⏱ 12:34
 */
export function ParallelModeHeader({
  status,
  activeWorkers,
  totalWorkers,
  completedTasks,
  totalTasks,
  elapsedTime,
}: ParallelModeHeaderProps): ReactNode {
  const statusDisplay = getStatusDisplay(status);
  const formattedTime = formatElapsedTime(elapsedTime);

  // Build worker count string
  const workerCountStr = totalWorkers === 1 ? '1 worker' : `${totalWorkers} workers`;
  const activeWorkerInfo =
    activeWorkers === totalWorkers
      ? workerCountStr
      : `${activeWorkers}/${totalWorkers} workers`;

  return (
    <box
      style={{
        width: '100%',
        height: layout.header.height,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.bg.secondary,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {/* Left section: Status indicator + label */}
      <box style={{ flexDirection: 'row', gap: 1, flexShrink: 1 }}>
        <text>
          <span fg={statusDisplay.color}>{statusDisplay.indicator}</span>
          <span fg={statusDisplay.color}> {statusDisplay.label}</span>
        </text>
        {/* Worker count */}
        <text>
          <span fg={colors.fg.muted}>  </span>
          <span fg={colors.fg.secondary}>{activeWorkerInfo}</span>
        </text>
      </box>

      {/* Right section: Progress bar + task count + elapsed time */}
      <box style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
        {/* Progress bar with task count */}
        <box style={{ flexDirection: 'row', gap: 1, alignItems: 'center' }}>
          <text fg={colors.fg.muted}>[</text>
          <MiniProgressBar completed={completedTasks} total={totalTasks} width={10} />
          <text fg={colors.fg.muted}>]</text>
          <text fg={colors.fg.secondary}>
            {' '}
            {completedTasks}/{totalTasks} tasks
          </text>
        </box>
        {/* Elapsed time */}
        <text>
          <span fg={colors.fg.muted}>⏱ </span>
          <span fg={colors.fg.secondary}>{formattedTime}</span>
        </text>
      </box>
    </box>
  );
}
