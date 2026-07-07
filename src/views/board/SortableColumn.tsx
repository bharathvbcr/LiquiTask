import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon } from "lucide-react";
import type React from "react";
import type { AgentRun, BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
import { useVirtualTaskList } from "../../hooks/useVirtualScroll";
import { SortableTask } from "./SortableTask";

interface SortableColumnProps {
  column: BoardColumn;
  tasks: Task[];
  priorities: PriorityDefinition[];
  allTasks: Task[];
  onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  isCompact?: boolean;
  onCopyTask?: (message: string) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  isHighlighted?: boolean;
  isFocusedColumn?: boolean;
  focusedTaskId?: string | null;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: (taskId: string, shiftKey?: boolean) => void;
  onApproveAgentWork?: (task: Task, run: AgentRun) => void;
  onRejectAgentWork?: (task: Task, run: AgentRun, feedback: string) => void;
}

export const SortableColumn: React.FC<SortableColumnProps> = ({
  column,
  tasks,
  priorities,
  allTasks,
  onMoveTask,
  onEditTask,
  onUpdateTask,
  onDeleteTask,
  isCompact,
  onCopyTask,
  projectName,
  projects = [],
  onMoveToWorkspace,
  isHighlighted = false,
  isFocusedColumn = false,
  focusedTaskId = null,
  selectedTaskIds,
  onToggleTaskSelection,
  onApproveAgentWork,
  onRejectAgentWork,
}) => {
  // Column header is draggable for reordering columns
  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: "column", column },
  });

  // Column body is droppable for receiving tasks
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `drop-${column.id}`,
    data: { type: "column", column },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const wipLimit = column.wipLimit || 0;
  const isOverLimit = wipLimit > 0 && tasks.length > wipLimit;
  const accentColor = column.color.startsWith("#") ? column.color : "#64748b";
  const showDropHighlight = isOver || isHighlighted;

  // Virtual scrolling for task lists with more than 30 tasks
  const shouldUseVirtualScroll = tasks.length > 30;
  const estimatedHeight = isCompact ? 120 : 180;
  const {
    containerRef: virtualScrollRef,
    visibleTasks,
    containerStyle,
  } = useVirtualTaskList(tasks, estimatedHeight);

  const tasksToRender = shouldUseVirtualScroll ? visibleTasks : tasks;

  // Minimal empty / drop-target state — a single subtle dashed well, no icon.
  const emptyState = (
    <div
      className={`flex-1 min-h-[140px] rounded-xl border border-dashed flex items-center justify-center px-4 text-xs transition-colors duration-300 ${
        showDropHighlight
          ? "border-red-500/50 bg-red-500/[0.06] text-red-400"
          : "border-white/[0.06] text-slate-600"
      }`}
    >
      <span className="pointer-events-none select-none italic">
        {showDropHighlight ? "Drop task here" : "No tasks"}
      </span>
    </div>
  );

  return (
    <div
      ref={setSortableRef}
      style={style}
      className="flex-1 flex flex-col min-w-[360px] max-w-[440px] scroll-mt-48"
    >
      {/* Draggable Header */}
      <div
        {...attributes}
        {...listeners}
        className={`flex items-center justify-between mb-5 px-8 py-3 cursor-grab active:cursor-grabbing transition-all rounded-xl hover:bg-white/5 ${
          isFocusedColumn ? "ring-2 ring-red-500/50 bg-red-500/5" : ""
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor] shrink-0"
            style={{
              backgroundColor: isOverLimit ? "#ef4444" : accentColor,
              color: isOverLimit ? "#ef4444" : accentColor,
            }}
          />
          <div className="flex items-center gap-2.5">
            <h3
              className={`font-bold text-sm tracking-wide uppercase ${isOverLimit ? "text-red-400" : isFocusedColumn ? "text-red-400" : "text-slate-200"}`}
            >
              {column.title}
            </h3>
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-all ${
                isOverLimit
                  ? "bg-red-500/20 text-red-400 border-red-500/50 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                  : tasks.length > 0
                    ? "bg-white/10 text-slate-300 border-white/10"
                    : "bg-white/5 text-slate-500 border-white/5"
              }`}
            >
              {tasks.length}
              {wipLimit > 0 && ` / ${wipLimit}`}
            </span>
          </div>
          {isOverLimit && (
            <AlertOctagon size={16} className="text-red-500 animate-pulse shrink-0" />
          )}
        </div>
      </div>

      {/* Droppable Task Area */}
      <div
        className={`flex-1 rounded-3xl p-3 flex flex-col gap-4 transition-all duration-500 ${
          isOverLimit
            ? "bg-red-900/10 border-red-500/20"
            : "bg-transparent border border-transparent"
        }`}
      >
        <div
          ref={setDroppableRef}
          className={`h-full rounded-2xl border p-1 flex flex-col gap-3 min-h-[300px] transition-all duration-300 ${
            showDropHighlight
              ? "bg-red-500/5 border-red-500/40 drag-over-glow scale-[1.01]"
              : "bg-transparent border-transparent"
          } ${shouldUseVirtualScroll ? "overflow-hidden" : ""}`}
        >
          {shouldUseVirtualScroll ? (
            <div
              ref={virtualScrollRef}
              className="flex-1 overflow-y-auto custom-scrollbar"
              style={{ height: '100%', ...containerStyle }}
            >
              <SortableContext
                items={tasksToRender.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
                id={`sortable-${column.id}`}
              >
                {tasksToRender.length > 0 ? (
                  tasksToRender.map((task) => (
                    <SortableTask
                      key={task.id}
                      task={task}
                      priorities={priorities}
                      isCompletedColumn={column.isCompleted}
                      onMoveTask={onMoveTask}
                      onEditTask={onEditTask}
                      onUpdateTask={onUpdateTask}
                      onDeleteTask={onDeleteTask}
                      allTasks={allTasks}
                      isCompact={isCompact}
                      onCopyTask={onCopyTask}
                      projectName={projectName}
                      projects={projects}
                      onMoveToWorkspace={onMoveToWorkspace}
                      isFocused={task.id === focusedTaskId}
                      isSelected={selectedTaskIds?.has(task.id) ?? false}
                      onToggleSelect={onToggleTaskSelection}
                      onApproveAgentWork={onApproveAgentWork}
                      onRejectAgentWork={onRejectAgentWork}
                    />
                  ))
                ) : (
                  emptyState
                )}
              </SortableContext>
            </div>
          ) : (
            <SortableContext
              items={tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
              id={`sortable-${column.id}`}
            >
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <SortableTask
                    key={task.id}
                    task={task}
                    priorities={priorities}
                    isCompletedColumn={column.isCompleted}
                    onMoveTask={onMoveTask}
                    onEditTask={onEditTask}
                    onUpdateTask={onUpdateTask}
                    onDeleteTask={onDeleteTask}
                    allTasks={allTasks}
                    isCompact={isCompact}
                    onCopyTask={onCopyTask}
                    projectName={projectName}
                    projects={projects}
                    onMoveToWorkspace={onMoveToWorkspace}
                    isFocused={task.id === focusedTaskId}
                    isSelected={selectedTaskIds?.has(task.id) ?? false}
                    onToggleSelect={onToggleTaskSelection}
                    onApproveAgentWork={onApproveAgentWork}
                    onRejectAgentWork={onRejectAgentWork}
                  />
                ))
              ) : (
                emptyState
              )}
            </SortableContext>
          )}
        </div>
      </div>
    </div>
  );
};
