import {
  type DropAnimation,
  defaultDropAnimationSideEffects,
  MeasuringStrategy,
} from "@dnd-kit/core";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentProfile, AgentRun, BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
import { AgentDropTray } from "../../components/agents/AgentDropTray";
import agentDispatchService from "../../services/agents/agentDispatchService";
import agentMcpService from "../../services/agents/agentMcpService";
import agentRunService from "../../services/agents/agentRunService";
import deadLetterService from "../../services/deadLetterService";
import { attentionTaskIdSet } from "../../core/board/deriveAttentionLane";
import { visibleBoardColumns } from "../../utils/boardColumns";
import { useBoardDnDController } from "../../hooks/useBoardDnDController";
import { useBoardKeyboardNav } from "../../hooks/useBoardKeyboardNav";
import { useBulkSelection } from "../../hooks/useBulkSelection";
import BulkActionsBar from "../../components/BulkActionsBar";
import { SkeletonLoader } from "../../components/SkeletonLoader";

const StandardBoardView = lazy(() => import("./StandardBoardView"));
const PriorityBoardView = lazy(() => import("./PriorityBoardView"));

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
  /** Agent teammates available as drag-and-drop handoff targets. */
  agents?: AgentProfile[];
  /** Called when a card is dropped on an agent chip. */
  onAssignTaskToAgent?: (task: Task, agentId: string) => void;
  onApproveAgentWork?: (task: Task, run: AgentRun) => void;
  onRejectAgentWork?: (task: Task, run: AgentRun, feedback: string) => void;
  onFocusedColumnChange?: (index: number) => void;
  onQuickAddFromTask?: (task: Task) => void;
  onDuplicateAsQuickAdd?: (task: Task) => void;
  onQuickAddDropHoverChange?: (hovering: boolean) => void;
}

const BoardLoadingFallback: React.FC = () => (
  <div className="h-full w-full overflow-x-auto p-4">
    <SkeletonLoader type="column" count={3} />
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
    agents = [],
    onAssignTaskToAgent,
    onApproveAgentWork,
    onRejectAgentWork,
    onFocusedColumnChange,
    onQuickAddFromTask,
    onDuplicateAsQuickAdd,
    onQuickAddDropHoverChange,
  } = props;

  type BoardLaneFilter = "all" | "attention";
  const [laneFilter, setLaneFilter] = useState<BoardLaneFilter>("all");
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>(() => agentRunService.getRuns());
  const [pendingPermissions, setPendingPermissions] = useState(() =>
    agentMcpService.getPendingPermissions(),
  );
  const [deadLetterCount, setDeadLetterCount] = useState(() => deadLetterService.getOpen().length);

  useEffect(() => agentRunService.subscribe(setAgentRuns), []);
  useEffect(() => agentMcpService.subscribePermissions(setPendingPermissions), []);
  useEffect(() => deadLetterService.subscribe((open) => setDeadLetterCount(open.length)), []);

  const attentionIds = useMemo(() => {
    const deadLetterTaskIds = new Set<string>();
    for (const letter of deadLetterService.getOpen()) {
      if (letter.taskId) deadLetterTaskIds.add(letter.taskId);
    }
    return attentionTaskIdSet({
      tasks: allTasks.length ? allTasks : tasks,
      runs: agentRuns,
      pendingPermissions,
      deadLetterTaskIds,
    });
  }, [allTasks, tasks, agentRuns, pendingPermissions, deadLetterCount]);

  const boardTasks = useMemo(
    () => (laneFilter === "attention" ? tasks.filter((t) => attentionIds.has(t.id)) : tasks),
    [tasks, laneFilter, attentionIds],
  );

  const visibleColumns = useMemo(
    () => visibleBoardColumns(columns, allTasks.length ? allTasks : tasks),
    [columns, allTasks, tasks],
  );

  const boardRef = useRef<HTMLDivElement>(null);
  const { selectNone, ...bulkSelection } = useBulkSelection({ items: boardTasks });
  const selectedTasks = useMemo(
    () => boardTasks.filter((task) => bulkSelection.selectedIds.has(task.id)),
    [boardTasks, bulkSelection.selectedIds],
  );
  const uniqueAssignees = useMemo(
    () =>
      Array.from(new Set(boardTasks.map((task) => task.assignee).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [boardTasks],
  );
  const availableTags = useMemo(
    () =>
      Array.from(new Set(boardTasks.flatMap((task) => task.tags ?? []))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [boardTasks],
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
    isQuickAddDropHover,
    splash,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnDController({
    columns: visibleColumns,
    tasks: boardTasks,
    boardGrouping,
    onUpdateColumns,
    onMoveTask,
    canMoveTask,
    getTasksByContext,
    showToast,
    onAssignToAgent: onAssignTaskToAgent,
    onQuickAddFromTask,
  });

  useEffect(() => {
    onQuickAddDropHoverChange?.(isQuickAddDropHover);
  }, [isQuickAddDropHover, onQuickAddDropHoverChange]);

  const {
    focusedColumnIndex,
    focusedTaskId,
    handlers: keyboardHandlers,
  } = useBoardKeyboardNav({
    columns: visibleColumns,
    tasks: boardTasks,
    onMoveTask,
    canMoveTask,
    onEditTask,
    onDeleteTask,
    getTasksByContext,
    boardGrouping,
    onMoveBlocked: emitMoveBlocked,
    isEnabled: true,
    onFocusedColumnChange,
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

  const agentTray = onAssignTaskToAgent ? (
    <AgentDropTray
      agents={agents}
      visible={activeTask !== null}
      draggedTask={activeTask ?? undefined}
      offerSetup={agentDispatchService.canOfferSetup()}
    />
  ) : undefined;

  const commonProps = {
    sensors,
    collisionDetection: kanbanCollisionDetection,
    measuringConfig,
    dropAnimation,
    boardRef,
    columns: visibleColumns,
    priorities,
    tasks: boardTasks,
    allTasks,
    highlightedZone,
    splash,
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
    onArchiveTask,
    selectedTaskIds: bulkSelection.selectedIds,
    onToggleTaskSelection: bulkSelection.toggleSelect,
    getTasksByContext,
    onCopyTask,
    onDuplicateAsQuickAdd,
    projectName,
    projects,
    onMoveToWorkspace,
    agentTray,
    onApproveAgentWork,
    onRejectAgentWork,
    agentDispatchEnabled: Boolean(onAssignTaskToAgent),
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
      {onAssignTaskToAgent && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Board</span>
          <button
            type="button"
            onClick={() => setLaneFilter("all")}
            className={`liquid-badge text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
              laneFilter === "all"
                ? "border-red-500/40 bg-red-500/10 text-white"
                : "border-white/10 text-slate-400 hover:text-white"
            }`}
          >
            All Tasks
          </button>
          <button
            type="button"
            onClick={() => setLaneFilter("attention")}
            className={`liquid-badge text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
              laneFilter === "attention"
                ? "border-red-500/40 bg-red-500/10 text-white"
                : "border-white/10 text-slate-400 hover:text-white"
            }`}
          >
            Needs Attention
            {attentionIds.size > 0 && (
              <span className="ml-1.5 text-red-400">{attentionIds.size}</span>
            )}
          </button>
        </div>
      )}
      {boardGrouping === "priority" ? (
        <PriorityBoardView {...commonProps} />
      ) : (
        <StandardBoardView
          {...commonProps}
          activeColumn={activeColumn}
          columnIds={visibleColumns.map((c) => c.id)}
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
        onSendToAgents={
          agents.length > 0 && onAssignTaskToAgent
            ? () =>
                clearSelectionAfter(() => {
                  // Smart-matched fan-out; the dispatch service emits one
                  // summary toast (sent / queued / skipped) when done.
                  void agentDispatchService.dispatchMany(selectedTasks);
                })
            : undefined
        }
      />
    </Suspense>
  );
};

export default ProjectBoard;
