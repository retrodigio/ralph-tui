/**
 * ABOUTME: Layout component for parallel mode in the Ralph TUI.
 * Composes ParallelModeHeader, WorkerListPanel, RefineryPanel, WorkerPanel, and ParallelModeFooter.
 *
 * Layout structure:
 * ┌─ Header ─────────────────────────────────────────────────────────┐
 * │ ● Running  3 workers  [████████░░] 4/6 tasks  ⏱ 12:34           │
 * ├──────────────────────────────────────────────────────────────────┤
 * │ LEFT COLUMN (stacked)    │ RIGHT COLUMN                         │
 * │ ┌─ WorkerListPanel ─┐    │ ┌─ WorkerPanel ─────────────────────┐│
 * │ │ Workers list      │    │ │ Selected worker details          ││
 * │ │ with selection    │    │ │ - Task info                      ││
 * │ └───────────────────┘    │ │ - Branch                         ││
 * │ ┌─ RefineryPanel ───┐    │ │ - Agent                          ││
 * │ │ Merge queue       │    │ │ - Output                         ││
 * │ │ Stats             │    │ │ - Subagents                      ││
 * │ └───────────────────┘    │ └──────────────────────────────────┘│
 * ├──────────────────────────────────────────────────────────────────┤
 * │ [p]ause  [+/-]workers  [w]orker view  [r]efinery  [?]help       │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { colors, layout } from '../theme.js';
import type { RalphStatus } from '../theme.js';
import type { WorkerState } from '../../pool/types.js';
import type { MergeRequest } from '../../refinery/types.js';
import type { RefineryStats } from './RefineryPanel.js';
import { ParallelModeHeader } from './ParallelModeHeader.js';
import { ParallelModeFooter } from './ParallelModeFooter.js';
import { WorkerListPanel } from './WorkerListPanel.js';
import { WorkerPanel } from './WorkerPanel.js';
import { RefineryPanel } from './RefineryPanel.js';

/**
 * Props for the ParallelModeLayout component
 */
export interface ParallelModeLayoutProps {
  /** Current Ralph execution status */
  status: RalphStatus;
  /** Map of worker name to worker state */
  workers: Map<string, WorkerState>;
  /** Currently selected worker name (null if none selected) */
  selectedWorker: string | null;
  /** Callback when a worker is selected */
  onSelectWorker: (name: string) => void;
  /** Merge queue for refinery */
  mergeQueue: MergeRequest[];
  /** Currently active merge (null if none) */
  currentMerge: MergeRequest | null;
  /** Refinery stats */
  refineryStats: RefineryStats;
  /** Test status for refinery */
  testsStatus?: 'passing' | 'failing' | 'running' | 'unknown';
  /** Number of completed tasks */
  completedTasks: number;
  /** Total number of tasks */
  totalTasks: number;
  /** Elapsed time in seconds */
  elapsedTime: number;
  /** Whether system is paused */
  isPaused?: boolean;
  /** Whether to show the output section in worker panel */
  showWorkerOutput?: boolean;
  /** Whether to show the subagents section in worker panel */
  showWorkerSubagents?: boolean;
}

/**
 * Calculate active worker count from workers map
 */
function countActiveWorkers(workers: Map<string, WorkerState>): number {
  let count = 0;
  for (const worker of workers.values()) {
    if (worker.status === 'working') {
      count++;
    }
  }
  return count;
}

/**
 * Empty state when no worker is selected
 */
function EmptyWorkerPanel(): ReactNode {
  return (
    <box
      title="Worker Details"
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 40,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <text fg={colors.fg.muted}>Select a worker to view details</text>
      <text fg={colors.fg.dim}>(use ↑↓ or 1-9 to select)</text>
    </box>
  );
}

/**
 * ParallelModeLayout component for displaying the parallel execution interface.
 *
 * Layout:
 * - Header: status, worker count, task progress, elapsed time
 * - Left column: WorkerListPanel (top) + RefineryPanel (bottom)
 * - Right column: WorkerPanel (selected worker details)
 * - Footer: parallel mode keyboard shortcuts
 *
 * Features:
 * - Responsive layout adapting to terminal width
 * - Worker selection for detailed view
 * - Stacked left panels for compact info display
 * - Color-coded status indicators throughout
 */
export const ParallelModeLayout = memo(function ParallelModeLayout({
  status,
  workers,
  selectedWorker,
  onSelectWorker,
  mergeQueue,
  currentMerge,
  refineryStats,
  testsStatus = 'unknown',
  completedTasks,
  totalTasks,
  elapsedTime,
  isPaused = false,
  showWorkerOutput = true,
  showWorkerSubagents = true,
}: ParallelModeLayoutProps): ReactNode {
  const { width, height } = useTerminalDimensions();

  // Calculate content area height (total height minus header and footer)
  const contentHeight = Math.max(1, height - layout.header.height - layout.footer.height);

  // Determine if we should use a compact layout for narrow terminals
  const isCompact = width < 100;

  // Calculate active workers
  const activeWorkers = countActiveWorkers(workers);

  // Get selected worker state
  const selectedWorkerState = selectedWorker ? workers.get(selectedWorker) : null;

  // Calculate panel widths
  const leftColumnWidth = isCompact ? Math.floor(width * 0.35) : Math.floor(width * 0.4);

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Parallel Mode Header */}
      <ParallelModeHeader
        status={status}
        activeWorkers={activeWorkers}
        totalWorkers={workers.size}
        completedTasks={completedTasks}
        totalTasks={totalTasks}
        elapsedTime={elapsedTime}
      />

      {/* Main content area */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: 'row',
          height: contentHeight,
        }}
      >
        {/* Left column: WorkerListPanel + RefineryPanel (stacked) */}
        <box
          style={{
            width: leftColumnWidth,
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          {/* WorkerListPanel - takes more space */}
          <box style={{ flexGrow: 2, flexShrink: 1, minHeight: 8 }}>
            <WorkerListPanel
              workers={workers}
              selectedWorker={selectedWorker}
              onSelectWorker={onSelectWorker}
              width={leftColumnWidth}
            />
          </box>

          {/* RefineryPanel - fixed smaller space */}
          <box style={{ flexGrow: 1, flexShrink: 0, minHeight: 10, maxHeight: 14 }}>
            <RefineryPanel
              queue={mergeQueue}
              currentMerge={currentMerge}
              stats={refineryStats}
              testsStatus={testsStatus}
              width={leftColumnWidth}
            />
          </box>
        </box>

        {/* Right column: WorkerPanel (selected worker details) */}
        <box
          style={{
            flexGrow: 1,
            flexShrink: 1,
            minWidth: 40,
          }}
        >
          {selectedWorkerState ? (
            <WorkerPanel
              name={selectedWorker!}
              worker={selectedWorkerState}
              showOutput={showWorkerOutput}
              showSubagents={showWorkerSubagents}
              width={width - leftColumnWidth}
            />
          ) : (
            <EmptyWorkerPanel />
          )}
        </box>
      </box>

      {/* Parallel Mode Footer */}
      <ParallelModeFooter isPaused={isPaused} />
    </box>
  );
});
