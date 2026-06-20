import {
  type DropAnimation,
  defaultDropAnimationSideEffects,
  MeasuringStrategy,
} from "@dnd-kit/core";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";

import type { BoardColumn, PriorityDefinition, Project, Task } from "../../types";
import { useBoardDnDController } from "../hooks/useBoardDnDController";
import { useBoardKeyboardNav } from "../hooks/useBoardKeyboardNav";
import { useBulkSelection } from "../hooks/useBulkSelection";
import BulkActionsBar from "./BulkActionsBar";

const StandardBoardView = lazy(() => import("./board/StandardBoardView"));
const PriorityBoardView = lazy(() => import("./board/PriorityBoardView"));

interface ProjectBoardProps {
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  tasks: Task[];
  allTasks: Task[];
  boardGrouping: "none" | "priority";
  onUpdateColumns: (cols: BoardColumn[]) => void;
  onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
  canMoveTask?: (
    taskId: string,
    newStatus: string,
    newPriority?: string,
  ) => {
    allowed: boolean;
    reason?: string;
  };
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  getTasksByContext: (statusId: string, priorityId?: string) => Task[];
  isCompact?: boolean;
  onCopyTask?: (message: string) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  onMoveBlocked?: (message: string) => void;
  addToast?: (message: string, type: "success" | "error" | "info") => void;
}

const BoardLoadingFallback: React.FC = () => (
  <div className="h-full w-full flex items-center justify-center">
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">
      Loading board...
    </div>
  </div>
);

/**
 * kanbanCollisionDetection: simplified in favor of built-in or custom detection
 */
import { type CollisionDetection, closestCorners, pointerWithin } from "@dnd-kit/core";

const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

const dropAnimation: DropAnimation = {
  duration: 250,
  easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0.4" } },
  }),
};

const measuringConfig = {
  droppable: { strategy: MeasuringStrategy.WhileDragging, frequency: 60 },
};

export const ProjectBoard: React.FC<ProjectBoardProps> = (props) => {
  const {
    columns = [],
    priorities = [],
    tasks = [],
    allTasks = [],
    boardGrouping,
    onUpdateColumns,
    onMoveTask,
    onEditTask,
    onUpdateTask,
    onDeleteTask,
    onArchiveTask,
    onMoveBlocked,
    canMoveTask,
    getTasksByContext,
    isCompact = false,
    onCopyTask,
    projectName,
    projects = [],
    onMoveToWorkspace,
    addToast,
  } = props;

  const boardRef = useRef<HTMLDivElement>(null);
  const { selectNone, ...bulkSelection } = useBulkSelection({ items: tasks });
  const selectedTasks = useMemo(
    () => tasks.filter((task) => bulkSelection.selectedIds.has(task.id)),
    [tasks, bulkSelection.selectedIds],
  );
  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(tasks.map((task) => task.assignee).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks],
  );
  const availableTags = useMemo(
    () =>
      Array.from(new Set(tasks.flatMap((task) => task.tags ?? []))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [tasks],
  );
  const showToast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info") => {
      addToast ? addToast(msg, type) : console.log(`[${type.toUpperCase()}] ${msg}`);
    },
    [addToast],
  );

  const emitMoveBlocked = useCallback(
    (message: string) => {
      onMoveBlocked ? onMoveBlocked(message) : showToast(message, "error");
    },
    [onMoveBlocked, showToast],
  );

  const {
    activeDrag,
    highlightedZone,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnDController({
    columns,
    tasks,
    boardGrouping,
    onUpdateColumns,
    onMoveTask,
    canMoveTask,
    getTasksByContext,
    showToast,
  });

  const {
    focusedColumnIndex,
    focusedTaskId,
    handlers: keyboardHandlers,
  } = useBoardKeyboardNav({
    columns,
    tasks,
    onMoveTask,
    canMoveTask,
    onEditTask,
    onDeleteTask,
    getTasksByContext,
    boardGrouping,
    onMoveBlocked: emitMoveBlocked,
    isEnabled: true,
  });

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const handleKeyDown = (e: KeyboardEvent) => keyboardHandlers.onKeyDown(e);
    board.addEventListener("keydown", handleKeyDown);
    board.setAttribute("tabIndex", "0");
    return () => board.removeEventListener("keydown", handleKeyDown);
  }, [keyboardHandlers]);

  const activeTask = activeDrag?.type === "task" ? activeDrag.data : null;
  const activeColumn = activeDrag?.type === "column" ? activeDrag.data : null;

  const commonProps = {
    sensors,
    collisionDetection: kanbanCollisionDetection,
    measuringConfig,
    dropAnimation,
    boardRef,
    columns,
    priorities,
    tasks,
    allTasks,
    highlightedZone,
    focusedTaskId,
    activeTask,
    isCompact,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDragEnd: handleDragEnd,
    onDragCancel: handleDragCancel,
    onMoveTask,
    onEditTask,
    onUpdateTask,
    onDeleteTask,
    selectedTaskIds: bulkSelection.selectedIds,
    onToggleTaskSelection: bulkSelection.toggleSelect,
    getTasksByContext,
    onCopyTask,
    projectName,
    projects,
    onMoveToWorkspace,
  };

  const updateSelectedTasks = useCallback(
    (updater: (task: Task) => Task) => {
      selectedTasks.forEach((task) => {
        onUpdateTask(updater(task));
      });
    },
    [onUpdateTask, selectedTasks],
  );

  const clearSelectionAfter = useCallback(
    (action: () => void) => {
      action();
      selectNone();
    },
    [selectNone],
  );

  return (
    <Suspense fallback={<BoardLoadingFallback />}>
      {boardGrouping === "priority" ? (
        <PriorityBoardView {...commonProps} />
      ) : (
        <StandardBoardView
          {...commonProps}
          activeColumn={activeColumn}
          columnIds={columns.map((c) => c.id)}
          focusedColumnIndex={focusedColumnIndex}
        />
      )}
      <BulkActionsBar
        selectedCount={bulkSelection.selectedCount}
        columns={columns}
        assignees={uniqueAssignees}
        priorities={priorities}
        availableTags={availableTags}
        projects={projects}
        onMove={(columnId) =>
          clearSelectionAfter(() => {
            selectedTasks.forEach((task) => {
              onMoveTask(task.id, columnId);
            });
            showToast(
              `Moved ${selectedTasks.length} task${selectedTasks.length === 1 ? "" : "s"}`,
              "success",
            );
          })
        }
        onAssign={(assignee) =>
          clearSelectionAfter(() =>
            updateSelectedTasks((task) => ({ ...task, assignee, updatedAt: new Date() })),
          )
        }
        onDelete={() =>
          clearSelectionAfter(() => {
            selectedTasks.forEach((task) => {
              onDeleteTask(task.id);
            });
          })
        }
        onSelectAll={bulkSelection.selectAll}
        onSelectNone={selectNone}
        isAllSelected={bulkSelection.isAllSelected}
        onSetPriority={(priorityId) =>
          clearSelectionAfter(() =>
            updateSelectedTasks((task) => ({
              ...task,
              priority: priorityId,
              updatedAt: new Date(),
            })),
          )
        }
        onSetDueDate={(date) =>
          clearSelectionAfter(() =>
            updateSelectedTasks((task) => ({
              ...task,
              dueDate: date ?? undefined,
              updatedAt: new Date(),
            })),
          )
        }
        onAddTag={(tag) =>
          clearSelectionAfter(() =>
            updateSelectedTasks((task) => ({
              ...task,
              tags: Array.from(new Set([...(task.tags ?? []), tag])),
              updatedAt: new Date(),
            })),
          )
        }
        onRemoveTag={(tag) =>
          clearSelectionAfter(() =>
            updateSelectedTasks((task) => ({
              ...task,
              tags: (task.tags ?? []).filter((taskTag) => taskTag !== tag),
              updatedAt: new Date(),
            })),
          )
        }
        onArchive={
          onArchiveTask
            ? () =>
                clearSelectionAfter(() => {
                  selectedTasks.forEach((task) => {
                    onArchiveTask(task.id);
                  });
                })
            : undefined
        }
        onMoveToWorkspace={
          onMoveToWorkspace
            ? (projectId) =>
                clearSelectionAfter(() => {
                  selectedTasks.forEach((task) => {
                    onMoveToWorkspace(task.id, projectId);
                  });
                })
            : undefined
        }
      />
    </Suspense>
  );
};

export default ProjectBoard;
