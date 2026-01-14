/**
 * ABOUTME: Refinery command for ralph-tui CLI.
 * Provides commands to manage the refinery queue for parallel mode.
 * Supports status, list, and merge-next subcommands.
 */

/**
 * Refinery queue item representing a worker branch ready for merge
 */
export interface RefineryQueueItem {
  /** Worker ID that produced this branch */
  workerId: string;
  /** Branch name to merge */
  branch: string;
  /** Task ID that was completed */
  taskId: string;
  /** Task title for display */
  taskTitle: string;
  /** Priority level (0-4, where 0 is highest) */
  priority: number;
  /** Timestamp when queued */
  queuedAt: string;
  /** Current status in refinery */
  status: 'queued' | 'merging' | 'testing' | 'merged' | 'conflict';
}

/**
 * Refinery status summary
 */
export interface RefineryStatus {
  /** Whether refinery is active */
  active: boolean;
  /** Number of items queued */
  queuedCount: number;
  /** Number currently merging */
  mergingCount: number;
  /** Total merged this session */
  mergedCount: number;
  /** Number of conflicts encountered */
  conflictCount: number;
  /** Whether tests are passing */
  testsStatus: 'passing' | 'failing' | 'running' | 'unknown';
  /** Number of auto-rebased conflicts */
  autoRebasedCount: number;
}

/**
 * Print refinery command help
 */
export function printRefineryHelp(): void {
  console.log(`
ralph-tui refinery - Manage the refinery queue

Usage: ralph-tui refinery <command> [options]

Commands:
  status              Show refinery queue status and statistics
  list                List items in the refinery queue
  merge-next          Manually trigger merge of the next item in queue

Options:
  --json              Output in JSON format (for status and list)
  --cwd <path>        Working directory (default: current directory)
  -h, --help          Show this help message

Description:
  The refinery manages merging completed worker branches back to main
  in parallel mode. It handles:
  - Queuing completed tasks by priority
  - Running tests before merging
  - Auto-rebasing on conflicts
  - Tracking merge statistics

Examples:
  ralph-tui refinery status              # Show queue status
  ralph-tui refinery status --json       # JSON output for scripts
  ralph-tui refinery list                # List queued items
  ralph-tui refinery merge-next          # Force merge next item
`);
}

/**
 * Format priority level for display
 */
function formatPriority(priority: number): string {
  const labels = ['P0 (Critical)', 'P1 (High)', 'P2 (Medium)', 'P3 (Low)', 'P4 (Backlog)'];
  return labels[priority] ?? `P${priority}`;
}

/**
 * Format status with icon
 */
function formatStatus(status: RefineryQueueItem['status']): string {
  switch (status) {
    case 'queued':
      return '○ queued';
    case 'merging':
      return '▶ merging';
    case 'testing':
      return '⏳ testing';
    case 'merged':
      return '✓ merged';
    case 'conflict':
      return '✗ conflict';
  }
}

/**
 * Format tests status with icon
 */
function formatTestsStatus(status: RefineryStatus['testsStatus']): string {
  switch (status) {
    case 'passing':
      return '✓ passing';
    case 'failing':
      return '✗ failing';
    case 'running':
      return '... running';
    case 'unknown':
      return '? unknown';
  }
}

/**
 * Get placeholder refinery status (no active pool)
 */
function getPlaceholderStatus(): RefineryStatus {
  return {
    active: false,
    queuedCount: 0,
    mergingCount: 0,
    mergedCount: 0,
    conflictCount: 0,
    testsStatus: 'unknown',
    autoRebasedCount: 0,
  };
}

/**
 * Get placeholder queue items (no active pool)
 */
function getPlaceholderQueue(): RefineryQueueItem[] {
  return [];
}

/**
 * Print human-readable refinery status
 */
function printHumanStatus(status: RefineryStatus): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Refinery Queue Status                       ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (!status.active) {
    console.log('  Status:      ○ Inactive (no parallel pool running)');
    console.log('');
    console.log('  The refinery is only active in parallel mode.');
    console.log('  Start with: ralph-tui run --workers=3');
    console.log('');
    return;
  }

  console.log('  Status:      ▶ Active');
  console.log('');
  console.log('  Queue:');
  console.log(`    Queued:    ${status.queuedCount}`);
  console.log(`    Merging:   ${status.mergingCount}`);
  console.log('');
  console.log('  Statistics:');
  console.log(`    Merged:    ${status.mergedCount}`);
  console.log(`    Conflicts: ${status.conflictCount} (${status.autoRebasedCount} auto-rebased)`);
  console.log(`    Tests:     ${formatTestsStatus(status.testsStatus)}`);
  console.log('');
}

/**
 * Print human-readable refinery queue list
 */
function printHumanQueue(items: RefineryQueueItem[]): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Refinery Queue List                         ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (items.length === 0) {
    console.log('  No items in queue.');
    console.log('');
    return;
  }

  console.log(`  ${items.length} item(s) in queue:`);
  console.log('');

  for (const item of items) {
    const truncatedTitle = item.taskTitle.length > 40
      ? item.taskTitle.slice(0, 37) + '...'
      : item.taskTitle;
    console.log(`  ${formatStatus(item.status)}`);
    console.log(`    Task:     ${item.taskId} - ${truncatedTitle}`);
    console.log(`    Branch:   ${item.branch}`);
    console.log(`    Worker:   ${item.workerId}`);
    console.log(`    Priority: ${formatPriority(item.priority)}`);
    console.log('');
  }
}

/**
 * Execute refinery status subcommand
 */
async function executeRefineryStatus(args: string[]): Promise<void> {
  const outputJson = args.includes('--json');

  // Get status (placeholder for now - will integrate with pool manager later)
  const status = getPlaceholderStatus();

  if (outputJson) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    printHumanStatus(status);
  }
}

/**
 * Execute refinery list subcommand
 */
async function executeRefineryList(args: string[]): Promise<void> {
  const outputJson = args.includes('--json');

  // Get queue (placeholder for now - will integrate with pool manager later)
  const items = getPlaceholderQueue();

  if (outputJson) {
    console.log(JSON.stringify({ items, count: items.length }, null, 2));
  } else {
    printHumanQueue(items);
  }
}

/**
 * Execute refinery merge-next subcommand
 */
async function executeRefineryMergeNext(_args: string[]): Promise<void> {
  // Placeholder for now - will integrate with pool manager later
  console.log('');
  console.log('Refinery merge-next command');
  console.log('');
  console.log('  No parallel pool is currently running.');
  console.log('  This command requires an active pool with queued items.');
  console.log('');
  console.log('  Start parallel mode with: ralph-tui run --workers=3');
  console.log('');
}

/**
 * Execute the refinery command
 */
export async function executeRefineryCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  // Help
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printRefineryHelp();
    return;
  }

  // Subcommands
  switch (subcommand) {
    case 'status':
      await executeRefineryStatus(args.slice(1));
      break;

    case 'list':
      await executeRefineryList(args.slice(1));
      break;

    case 'merge-next':
      await executeRefineryMergeNext(args.slice(1));
      break;

    default:
      console.error(`Unknown refinery subcommand: ${subcommand}`);
      console.error('');
      printRefineryHelp();
      process.exit(1);
  }
}
