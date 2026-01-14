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
}

/**
 * Parallel mode footer component showing keyboard shortcuts.
 * Uses the parallelModeKeyboardShortcuts from theme.
 */
export function ParallelModeFooter({ isPaused = false }: ParallelModeFooterProps): ReactNode {
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
        justifyContent: 'flex-start',
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
    </box>
  );
}
