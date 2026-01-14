/**
 * ABOUTME: RefineryPanel component for displaying merge queue status.
 * Shows queued merge requests, current merge progress, and stats
 * (merged count, conflicts, test status).
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { colors } from '../theme.js';
import type { MergeRequest, MergeRequestStatus } from '../../refinery/types.js';

/**
 * Stats for the refinery panel
 */
export interface RefineryStats {
  /** Number of merges completed today */
  merged: number;
  /** Number of conflicts encountered (resolved or pending) */
  conflicts: number;
  /** Number of failed merges */
  failed: number;
}

/**
 * Props for the RefineryPanel component
 */
export interface RefineryPanelProps {
  /** Queue of merge requests */
  queue: MergeRequest[];
  /** Currently active merge request (null if none) */
  currentMerge: MergeRequest | null;
  /** Stats about merge operations */
  stats: RefineryStats;
  /** Whether tests are currently passing */
  testsStatus?: 'passing' | 'failing' | 'running' | 'unknown';
  /** Panel width for truncation calculations */
  width?: number;
}

/**
 * Get the status indicator symbol for a merge request status.
 * - ⏳ (merging) - currently being merged
 * - ○ (queued) - waiting for merge slot
 * - ⚠ (conflict) - conflict detected, rebasing
 * - ✗ (failed) - merge failed, needs attention
 * - ✓ (merged) - successfully merged
 */
function getMergeStatusIndicator(status: MergeRequestStatus): string {
  switch (status) {
    case 'merging':
      return '⏳';
    case 'queued':
      return '○';
    case 'conflict':
      return '⚠';
    case 'failed':
      return '✗';
    case 'merged':
      return '✓';
    default:
      return '○';
  }
}

/**
 * Get the color for a merge request status.
 */
function getMergeStatusColor(status: MergeRequestStatus): string {
  switch (status) {
    case 'merging':
      return colors.status.info;
    case 'queued':
      return colors.fg.muted;
    case 'conflict':
      return colors.status.warning;
    case 'failed':
      return colors.status.error;
    case 'merged':
      return colors.status.success;
    default:
      return colors.fg.muted;
  }
}

/**
 * Get status description text for a merge request.
 */
function getMergeStatusText(status: MergeRequestStatus): string {
  switch (status) {
    case 'merging':
      return 'merging...';
    case 'queued':
      return 'queued';
    case 'conflict':
      return 'conflict';
    case 'failed':
      return 'failed';
    case 'merged':
      return 'merged';
    default:
      return status;
  }
}

/**
 * Format priority for display (P0, P1, etc.)
 */
function formatPriority(priority: number): string {
  return `P${priority}`;
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
 * Get the tree connector character based on position.
 */
function getTreeConnector(index: number, total: number): string {
  if (index === total - 1) {
    return '└─';
  }
  return '├─';
}

/**
 * Props for the QueueItemRow component.
 */
interface QueueItemRowProps {
  /** The merge request to display */
  request: MergeRequest;
  /** Index in the queue */
  index: number;
  /** Total items in queue (for tree drawing) */
  total: number;
  /** Max width for content */
  maxWidth: number;
}

/**
 * Renders a single row in the merge queue.
 * Format: ├─ work/worker1/gt-xyz  ⏳ merging...
 */
function QueueItemRow({
  request,
  index,
  total,
  maxWidth,
}: QueueItemRowProps): ReactNode {
  const connector = getTreeConnector(index, total);
  const statusIndicator = getMergeStatusIndicator(request.status);
  const statusColor = getMergeStatusColor(request.status);
  const statusText = getMergeStatusText(request.status);

  // Calculate available width for branch name
  // Format: "├─ branch  ⏳ status (P#)"
  const fixedWidth = 4 + 2 + statusText.length + 5; // connector + spacing + status + " (P#)"
  const branchWidth = Math.max(10, maxWidth - fixedWidth);

  const truncatedBranch = truncateText(request.branch, branchWidth);

  // Show priority for queued items
  const showPriority = request.status === 'queued';
  const priorityText = showPriority ? ` (${formatPriority(request.priority)})` : '';

  return (
    <box style={{ paddingLeft: 1, paddingRight: 1 }}>
      <text>
        <span fg={colors.fg.dim}>{connector} </span>
        <span fg={colors.fg.secondary}>{truncatedBranch}</span>
        <span>  </span>
        <span fg={statusColor}>{statusIndicator}</span>
        <span fg={statusColor}> {statusText}</span>
        {showPriority && <span fg={colors.fg.dim}>{priorityText}</span>}
      </text>
    </box>
  );
}

/**
 * Props for the StatsSection component.
 */
interface StatsSectionProps {
  /** Merge stats */
  stats: RefineryStats;
  /** Current test status */
  testsStatus: 'passing' | 'failing' | 'running' | 'unknown';
}

/**
 * Renders the stats section at the bottom of the panel.
 */
function StatsSection({ stats, testsStatus }: StatsSectionProps): ReactNode {
  // Get test status display
  const getTestStatusDisplay = (): { text: string; color: string } => {
    switch (testsStatus) {
      case 'passing':
        return { text: 'passing ✓', color: colors.status.success };
      case 'failing':
        return { text: 'failing ✗', color: colors.status.error };
      case 'running':
        return { text: 'running...', color: colors.status.info };
      default:
        return { text: 'unknown', color: colors.fg.muted };
    }
  };

  const testDisplay = getTestStatusDisplay();

  return (
    <box
      style={{
        flexDirection: 'column',
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
      }}
    >
      <text>
        <span fg={colors.fg.muted}>Merged: </span>
        <span fg={colors.status.success}>{stats.merged}</span>
        <span fg={colors.fg.dim}> today</span>
      </text>
      <text>
        <span fg={colors.fg.muted}>Conflicts: </span>
        <span fg={stats.conflicts > 0 ? colors.status.warning : colors.fg.secondary}>
          {stats.conflicts}
        </span>
        {stats.conflicts > 0 && (
          <span fg={colors.fg.dim}> (auto-rebased)</span>
        )}
      </text>
      <text>
        <span fg={colors.fg.muted}>Tests: </span>
        <span fg={testDisplay.color}>{testDisplay.text}</span>
      </text>
    </box>
  );
}

/**
 * RefineryPanel component showing merge queue status.
 * Displays: queue of merge requests, current merge, stats.
 * Features: priority for queued items, status indicators, test status.
 * Wrapped in React.memo to prevent unnecessary re-renders.
 */
export const RefineryPanel = memo(function RefineryPanel({
  queue,
  currentMerge,
  stats,
  testsStatus = 'unknown',
  width = 40,
}: RefineryPanelProps): ReactNode {
  // Calculate max width for content (panel width minus padding and border)
  const maxContentWidth = Math.max(20, width - 4);

  // Combine current merge with queue for display
  const displayItems: MergeRequest[] = [];
  if (currentMerge) {
    displayItems.push(currentMerge);
  }
  // Add queued items (exclude current merge if it's in the queue)
  for (const item of queue) {
    if (!currentMerge || item.id !== currentMerge.id) {
      displayItems.push(item);
    }
  }

  // Count active items for title
  const queueCount = displayItems.filter((r) => r.status === 'queued').length;
  const hasActiveMerge = currentMerge !== null;

  // Build title
  const title = hasActiveMerge
    ? `Refinery (1 active, ${queueCount} queued)`
    : queueCount > 0
      ? `Refinery (${queueCount} queued)`
      : 'Refinery';

  return (
    <box
      title={title}
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 30,
        maxWidth: 50,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: hasActiveMerge ? colors.border.active : colors.border.normal,
      }}
    >
      {/* Queue section */}
      <box style={{ flexDirection: 'column', paddingTop: 0 }}>
        <box style={{ paddingLeft: 1 }}>
          <text fg={colors.fg.muted}>Queue: {displayItems.length}</text>
        </box>

        {displayItems.length === 0 ? (
          <box style={{ paddingLeft: 1 }}>
            <text fg={colors.fg.dim}>(empty)</text>
          </box>
        ) : (
          <scrollbox
            style={{
              flexGrow: 1,
              width: '100%',
              maxHeight: 8,
            }}
          >
            {displayItems.map((request, index) => (
              <QueueItemRow
                key={request.id}
                request={request}
                index={index}
                total={displayItems.length}
                maxWidth={maxContentWidth}
              />
            ))}
          </scrollbox>
        )}
      </box>

      {/* Stats section */}
      <StatsSection stats={stats} testsStatus={testsStatus} />
    </box>
  );
});
