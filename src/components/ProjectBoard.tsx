import {
  type DropAnimation,
  defaultDropAnimationSideEffects,
  MeasuringStrategy,
} from "@dnd-kit/core";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useRef } from "react";

import type { BoardColumn, PriorityDefinition, Project, Task } from "../../types";
import { useBoardDnDController } from "../hooks/useBoardDnDController";
import { useBoardKeyboardNav } from "../hooks/useBoardKeyboardNav";

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
    const handleKeyDown = (e: KeyboardEvent) => keyboardHandlers.onKeyDown(e as any);
    board.addEventListener("keydown", handleKeyDown);
    board.setAttribute("tabIndex", "0");
    return () => board.removeEventListener("keydown", handleKeyDown);
  }, [keyboardHandlers]);

  const dropAnimation: DropAnimation = {
    duration: 250,
    easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
    sideEffects: defaultDropAnimationSideEffects({
      styles: { active: { opacity: "0.4" } },
    }),
  };

  const measuringConfig = {
    droppable: { strategy: MeasuringStrategy.Always, frequency: 100 },
  };
  const activeTask = activeDrag?.type === "task" ? (activeDrag.data as Task) : null;
  const activeColumn = activeDrag?.type === "column" ? (activeDrag.data as BoardColumn) : null;

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
    getTasksByContext,
    onCopyTask,
    projectName,
    projects,
    onMoveToWorkspace,
  };

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
    </Suspense>
  );
};

export default ProjectBoard;
