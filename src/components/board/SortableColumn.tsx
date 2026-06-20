import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon, ClipboardList, Inbox } from "lucide-react";
import React from "react";
import type { BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
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

  return (
    <div
      ref={setSortableRef}
      style={style}
      className="flex-1 flex flex-col min-w-[300px] max-w-[350px] scroll-mt-48"
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
            className="w-1.5 h-8 rounded-full shadow-[0_0_8px_currentColor] shrink-0"
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
          className={`h-full rounded-2xl backdrop-blur-md border p-5 flex flex-col gap-4 min-h-[300px] transition-all duration-300 ${
            showDropHighlight
              ? "bg-red-500/5 border-red-500/40 drag-over-glow scale-[1.01]"
              : "bg-[#0a0a0a]/50 border-white/[0.07] hover:border-white/12 shadow-[inset_0_2px_10px_rgba(0,0,0,0.4)]"
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
                    />
                  ))
                ) : (
                  <div
                    className={`flex-1 min-h-[200px] rounded-xl border border-dashed flex flex-col items-center justify-center gap-3 text-sm transition-all duration-300 ${
                      showDropHighlight
                        ? "border-red-500/50 bg-red-500/8 text-red-400 scale-105 shadow-[inset_0_0_20px_rgba(239,68,68,0.08)]"
                        : "border-white/10 text-slate-500 hover:border-white/20"
                    }`}
                  >
                    <div className="pointer-events-none select-none text-center px-6">
                      {showDropHighlight ? (
                        <>
                          <Inbox size={28} className="mx-auto mb-2 text-red-400 animate-bounce" />
                          <div className="font-bold text-red-400">Drop task here</div>
                        </>
                      ) : (
                        <>
                          <ClipboardList size={28} className="mx-auto mb-2 text-slate-600" />
                          <div className="font-medium text-slate-500">No tasks</div>
                          <div className="text-xs text-slate-600 mt-0.5">
                            Drag tasks here
                          </div>
                        </>
                      )}
                    </div>
                  </div>
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
                  />
                ))
              ) : (
                <div
                  className={`flex-1 min-h-[200px] rounded-xl border border-dashed flex flex-col items-center justify-center gap-3 text-sm transition-all duration-300 ${
                    showDropHighlight
                      ? "border-red-500/50 bg-red-500/8 text-red-400 scale-105 shadow-[inset_0_0_20px_rgba(239,68,68,0.08)]"
                      : "border-white/10 text-slate-500 hover:border-white/20"
                  }`}
                >
                  <div className="pointer-events-none select-none text-center px-6">
                    {showDropHighlight ? (
                      <>
                        <Inbox size={28} className="mx-auto mb-2 text-red-400 animate-bounce" />
                        <div className="font-bold text-red-400">Drop task here</div>
                      </>
                    ) : (
                      <>
                        <ClipboardList size={28} className="mx-auto mb-2 text-slate-600" />
                        <div className="font-medium text-slate-500">No tasks</div>
                        <div className="text-xs text-slate-600 mt-0.5">
                          Drag tasks here
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </SortableContext>
          )}
        </div>
      </div>
    </div>
  );
};
