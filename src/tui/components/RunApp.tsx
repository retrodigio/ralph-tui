/**
 * ABOUTME: RunApp component for the Ralph TUI execution view.
 * Integrates with the execution engine to display real-time progress.
 * Handles graceful interruption with confirmation dialog.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { colors, layout } from '../theme.js';
import type { RalphStatus, TaskStatus } from '../theme.js';
import type { TaskItem } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';
import { IterationHistoryView } from './IterationHistoryView.js';
import { TaskDetailView } from './TaskDetailView.js';
import { IterationDetailView } from './IterationDetailView.js';
import { ProgressDashboard } from './ProgressDashboard.js';
import { ConfirmationDialog } from './ConfirmationDialog.js';
import { HelpOverlay } from './HelpOverlay.js';
import type { ExecutionEngine, EngineEvent, IterationResult } from '../../engine/index.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';

/**
 * View modes for the RunApp component
 * - 'tasks': Show the task list (default)
 * - 'iterations': Show the iteration history
 * - 'task-detail': Show detailed view of a single task
 * - 'iteration-detail': Show detailed view of a single iteration
 */
type ViewMode = 'tasks' | 'iterations' | 'task-detail' | 'iteration-detail';

/**
 * Props for the RunApp component
 */
export interface RunAppProps {
  /** The execution engine instance */
  engine: ExecutionEngine;
  /** Callback when quit is requested */
  onQuit?: () => Promise<void>;
  /** Callback when Enter is pressed on a task to drill into details */
  onTaskDrillDown?: (task: TaskItem) => void;
  /** Callback when Enter is pressed on an iteration to drill into details */
  onIterationDrillDown?: (iteration: IterationResult) => void;
  /** Whether the interrupt confirmation dialog is showing */
  showInterruptDialog?: boolean;
  /** Callback when user confirms interrupt */
  onInterruptConfirm?: () => void;
  /** Callback when user cancels interrupt */
  onInterruptCancel?: () => void;
}

/**
 * Convert engine status to Ralph status
 */
function engineStatusToRalphStatus(
  engineStatus: string,
  hasError: boolean
): RalphStatus {
  if (hasError) return 'error';
  switch (engineStatus) {
    case 'running':
      return 'running';
    case 'pausing':
      return 'pausing';
    case 'paused':
      return 'paused';
    case 'stopping':
    case 'idle':
      return 'stopped';
    default:
      return 'stopped';
  }
}

/**
 * Convert tracker status to TUI task status.
 * Maps: open -> pending, in_progress -> active, completed -> done, etc.
 */
function trackerStatusToTaskStatus(trackerStatus: string): TaskStatus {
  switch (trackerStatus) {
    case 'open':
      return 'pending';
    case 'in_progress':
      return 'active';
    case 'completed':
      return 'done';
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'done'; // Show cancelled as done (finished state)
    default:
      return 'pending';
  }
}

/**
 * Convert a TrackerTask to a TaskItem for display in the TUI.
 */
function trackerTaskToTaskItem(task: TrackerTask): TaskItem {
  return {
    id: task.id,
    title: task.title,
    status: trackerStatusToTaskStatus(task.status),
    description: task.description,
    priority: task.priority,
    labels: task.labels,
    type: task.type,
    dependsOn: task.dependsOn,
    blocks: task.blocks,
    assignee: task.assignee,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/**
 * Main RunApp component for execution view
 */
export function RunApp({
  engine,
  onQuit,
  onTaskDrillDown,
  onIterationDrillDown,
  showInterruptDialog = false,
  onInterruptConfirm,
  onInterruptCancel,
}: RunAppProps): ReactNode {
  const { width, height } = useTerminalDimensions();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState<RalphStatus>('running');
  const [currentIteration, setCurrentIteration] = useState(0);
  const [currentOutput, setCurrentOutput] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [epicName] = useState('Ralph');
  const [trackerName] = useState('beads');
  const [agentName] = useState('claude');
  // Dashboard visibility state
  const [showDashboard, setShowDashboard] = useState(true);
  // Completed iterations count for ETA calculation
  const [completedIterations, setCompletedIterations] = useState(0);
  // Iteration history state
  const [iterations, setIterations] = useState<IterationResult[]>([]);
  const [totalIterations] = useState(10); // Default max iterations for display
  const [viewMode, setViewMode] = useState<ViewMode>('tasks');
  const [iterationSelectedIndex, setIterationSelectedIndex] = useState(0);
  // Task detail view state
  const [detailTask, setDetailTask] = useState<TaskItem | null>(null);
  // Iteration detail view state
  const [detailIteration, setDetailIteration] = useState<IterationResult | null>(null);
  // Help overlay state
  const [showHelp, setShowHelp] = useState(false);

  // Subscribe to engine events
  useEffect(() => {
    const unsubscribe = engine.on((event: EngineEvent) => {
      switch (event.type) {
        case 'engine:started':
          setStatus('running');
          // Initialize task list from engine with proper status mapping
          if (event.tasks && event.tasks.length > 0) {
            setTasks(event.tasks.map(trackerTaskToTaskItem));
          }
          break;

        case 'engine:stopped':
          setStatus('stopped');
          if (event.reason === 'error') {
            setHasError(true);
          }
          break;

        case 'engine:paused':
          setStatus('paused');
          break;

        case 'engine:resumed':
          setStatus('running');
          break;

        case 'iteration:started':
          setCurrentIteration(event.iteration);
          setCurrentOutput('');
          // Update task list to show current task as active
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'active' as TaskStatus } : t
            )
          );
          // Select the current task
          setTasks((prev) => {
            const idx = prev.findIndex((t) => t.id === event.task.id);
            if (idx !== -1) {
              setSelectedIndex(idx);
            }
            return prev;
          });
          break;

        case 'iteration:completed':
          // Increment completed iterations for ETA calculation
          setCompletedIterations((prev) => prev + 1);
          if (event.result.taskCompleted) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === event.result.task.id
                  ? { ...t, status: 'done' as TaskStatus }
                  : t
              )
            );
          }
          // Add iteration result to history
          setIterations((prev) => {
            // Replace existing iteration or add new
            const existing = prev.findIndex((i) => i.iteration === event.result.iteration);
            if (existing !== -1) {
              const updated = [...prev];
              updated[existing] = event.result;
              return updated;
            }
            return [...prev, event.result];
          });
          break;

        case 'iteration:failed':
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'blocked' as TaskStatus } : t
            )
          );
          break;

        case 'task:selected':
          // Add task if not present
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === event.task.id);
            if (exists) return prev;
            return [
              ...prev,
              {
                id: event.task.id,
                title: event.task.title,
                status: 'pending' as TaskStatus,
                description: event.task.description,
                iteration: event.iteration,
              },
            ];
          });
          break;

        case 'task:completed':
          setTasks((prev) =>
            prev.map((t) =>
              t.id === event.task.id ? { ...t, status: 'done' as TaskStatus } : t
            )
          );
          break;

        case 'agent:output':
          if (event.stream === 'stdout') {
            setCurrentOutput((prev) => prev + event.data);
          }
          break;
      }
    });

    return unsubscribe;
  }, [engine]);

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Get initial state from engine
  useEffect(() => {
    const state = engine.getState();
    setCurrentIteration(state.currentIteration);
    setCurrentOutput(state.currentOutput);
  }, [engine]);

  // Calculate the number of items in iteration history (iterations + pending)
  const iterationHistoryLength = Math.max(iterations.length, totalIterations);

  // Handle keyboard navigation
  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      // When interrupt dialog is showing, only handle y/n/Esc
      if (showInterruptDialog) {
        switch (key.name) {
          case 'y':
            onInterruptConfirm?.();
            break;
          case 'n':
          case 'escape':
            onInterruptCancel?.();
            break;
        }
        return; // Don't process other keys when dialog is showing
      }

      // When help overlay is showing, ? or Esc closes it
      if (showHelp) {
        if (key.name === '?' || key.name === 'escape') {
          setShowHelp(false);
        }
        return; // Don't process other keys when help is showing
      }

      switch (key.name) {
        case 'q':
          // Quit the application
          onQuit?.();
          break;

        case 'escape':
          // In detail view, Esc goes back to list view
          if (viewMode === 'task-detail') {
            setViewMode('tasks');
            setDetailTask(null);
          } else if (viewMode === 'iteration-detail') {
            setViewMode('iterations');
            setDetailIteration(null);
          } else {
            onQuit?.();
          }
          break;

        case 'up':
        case 'k':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.max(0, prev - 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.max(0, prev - 1));
          }
          // No navigation in task-detail view (scrollbox handles it)
          break;

        case 'down':
        case 'j':
          if (viewMode === 'tasks') {
            setSelectedIndex((prev) => Math.min(tasks.length - 1, prev + 1));
          } else if (viewMode === 'iterations') {
            setIterationSelectedIndex((prev) => Math.min(iterationHistoryLength - 1, prev + 1));
          }
          // No navigation in task-detail view (scrollbox handles it)
          break;

        case 'p':
          // Toggle pause/resume
          // When running, pause will transition to pausing, then to paused
          // When pausing, pressing p again will cancel the pause request
          // When paused, resume will transition back to running
          if (status === 'running') {
            engine.pause();
            setStatus('pausing');
          } else if (status === 'pausing') {
            // Cancel pause request
            engine.resume();
            setStatus('running');
          } else if (status === 'paused') {
            engine.resume();
            // Status will update via engine event
          }
          break;

        case 'c':
          // Ctrl+C to stop
          if (key.name === 'c') {
            engine.stop();
          }
          break;

        case 'i':
          // Toggle between tasks and iterations view (only if not in detail view)
          if (viewMode !== 'task-detail' && viewMode !== 'iteration-detail') {
            setViewMode((prev) => (prev === 'tasks' ? 'iterations' : 'tasks'));
          }
          break;

        case 't':
          // Switch to tasks view (from any view)
          setViewMode('tasks');
          setDetailTask(null);
          setDetailIteration(null);
          break;

        case 'd':
          // Toggle dashboard visibility
          setShowDashboard((prev) => !prev);
          break;

        case '?':
          // Show help overlay
          setShowHelp(true);
          break;

        case 'return':
        case 'enter':
          if (viewMode === 'tasks') {
            // Drill into selected task details
            if (tasks[selectedIndex]) {
              setDetailTask(tasks[selectedIndex]);
              setViewMode('task-detail');
              onTaskDrillDown?.(tasks[selectedIndex]);
            }
          } else if (viewMode === 'iterations') {
            // Drill into selected iteration details
            if (iterations[iterationSelectedIndex]) {
              setDetailIteration(iterations[iterationSelectedIndex]);
              setViewMode('iteration-detail');
              onIterationDrillDown?.(iterations[iterationSelectedIndex]);
            }
          }
          // In detail views, Enter does nothing
          break;
      }
    },
    [tasks, selectedIndex, status, engine, onQuit, onTaskDrillDown, viewMode, iterations, iterationSelectedIndex, iterationHistoryLength, onIterationDrillDown, showInterruptDialog, onInterruptConfirm, onInterruptCancel, showHelp]
  );

  useKeyboard(handleKeyboard);

  // Calculate layout
  const contentHeight = Math.max(
    1,
    height - layout.header.height - layout.footer.height
  );
  const isCompact = width < 80;

  // Calculate progress
  const completedTasks = tasks.filter((t) => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Get selected task
  const selectedTask = tasks[selectedIndex] ?? null;

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header */}
      <Header
        status={engineStatusToRalphStatus(engine.getStatus(), hasError)}
        epicName={epicName}
        elapsedTime={elapsedTime}
        trackerName={trackerName || 'beads'}
      />

      {/* Progress Dashboard - toggleable with 'd' key */}
      {showDashboard && (
        <ProgressDashboard
          status={engineStatusToRalphStatus(engine.getStatus(), hasError)}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          currentIteration={currentIteration}
          maxIterations={totalIterations}
          elapsedTimeSeconds={elapsedTime}
          agentName={agentName}
          trackerName={trackerName || 'beads'}
          epicName={epicName}
          completedIterations={completedIterations}
        />
      )}

      {/* Main content area */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: isCompact ? 'column' : 'row',
          height: contentHeight,
        }}
      >
        {viewMode === 'task-detail' && detailTask ? (
          // Full-screen task detail view
          <TaskDetailView
            task={detailTask}
            onBack={() => {
              setViewMode('tasks');
              setDetailTask(null);
            }}
          />
        ) : viewMode === 'iteration-detail' && detailIteration ? (
          // Full-screen iteration detail view
          <IterationDetailView
            iteration={detailIteration}
            totalIterations={totalIterations}
            onBack={() => {
              setViewMode('iterations');
              setDetailIteration(null);
            }}
          />
        ) : viewMode === 'tasks' ? (
          <>
            <LeftPanel tasks={tasks} selectedIndex={selectedIndex} />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={currentIteration}
              iterationOutput={currentOutput}
            />
          </>
        ) : (
          <>
            <IterationHistoryView
              iterations={iterations}
              totalIterations={totalIterations}
              selectedIndex={iterationSelectedIndex}
              runningIteration={currentIteration}
              width={isCompact ? width : Math.floor(width * 0.5)}
            />
            <RightPanel
              selectedTask={selectedTask}
              currentIteration={currentIteration}
              iterationOutput={currentOutput}
            />
          </>
        )}
      </box>

      {/* Footer */}
      <Footer
        progress={progress}
        totalTasks={totalTasks}
        completedTasks={completedTasks}
      />

      {/* Interrupt Confirmation Dialog */}
      <ConfirmationDialog
        visible={showInterruptDialog}
        title="⚠ Interrupt Ralph?"
        message="Current iteration will be terminated."
        hint="[y] Yes  [n/Esc] No  [Ctrl+C] Force quit"
      />

      {/* Help Overlay */}
      <HelpOverlay visible={showHelp} />
    </box>
  );
}
