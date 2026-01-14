/**
 * ABOUTME: Footer component for parallel mode in the Ralph TUI.
 * Displays keyboard shortcuts specific to parallel mode operation.
 * Shows: [p]ause  [+/-]workers  [w]orker view  [r]efinery  [?]help
 */

import type { ReactNode } from 'react';
import { colors, parallelModeKeyboardShortcuts, layout } from '../theme.js';

/**
 * Props for the ParallelModeFooter component
 */
export interface ParallelModeFooterProps {
  /** Whether pause mode is active (changes [p] display) */
  isPaused?: boolean;
  /** Optional status message to display (e.g., feedback for pending actions) */
  statusMessage?: string | null;
}

/**
 * Parallel mode footer component showing keyboard shortcuts.
 * Uses the parallelModeKeyboardShortcuts from theme.
 */
export function ParallelModeFooter({ isPaused = false, statusMessage }: ParallelModeFooterProps): ReactNode {
  // Format keyboard shortcuts as a single string
  // Adjust the 'p' shortcut based on pause state
  const shortcutText = parallelModeKeyboardShortcuts
    .map(({ key, description }) => {
      if (key === 'p') {
        return `${key}:${isPaused ? 'Resume' : 'Pause All'}`;
      }
      return `${key}:${description}`;
    })
    .join('  ');

  return (
    <box
      style={{
        width: '100%',
        height: layout.footer.height,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.bg.secondary,
        paddingLeft: 1,
        paddingRight: 1,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {/* Keyboard shortcuts */}
      <box style={{ flexShrink: 1, overflow: 'hidden' }}>
        <text fg={colors.fg.muted}>{shortcutText}</text>
      </box>
      {/* Status message when present */}
      {statusMessage && (
        <box style={{ flexShrink: 0, marginLeft: 2 }}>
          <text fg={colors.status.warning}>{statusMessage}</text>
        </box>
      )}
    </box>
  );
}
