import {
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  type MeasuringStrategy,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ClipboardList, Inbox } from "lucide-react";
import type React from "react";
import { createPortal } from "react-dom";
import { TaskCard } from "../../components/TaskCard";
import type { DropSplash as DropSplashData } from "../../hooks/useBoardDnDController";
import type { AgentRun, BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
import { DropSplash } from "./DropSplash";
import { DroppableCell } from "./DroppableCell";
import { SortableTask } from "./SortableTask";

interface PriorityBoardViewProps {
  sensors: Parameters<typeof DndContext>[0]["sensors"];
  collisionDetection: CollisionDetection;
  measuringConfig: {
    droppable: {
      strategy: MeasuringStrategy;
      frequency: number;
    };
  };
  dropAnimation: DropAnimation;
  boardRef: React.RefObject<HTMLDivElement | null>;
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  tasks: Task[];
  allTasks: Task[];
  highlightedZone: string | null;
  splash: DropSplashData | null;
  focusedTaskId: string | null;
  activeTask: Task | null;
  isCompact: boolean;
  onDragStart: (event: DragStartEvent) => void;
  onDragOver: (event: DragOverEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: (event: DragCancelEvent) => void;
  onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onArchiveTask?: (taskId: string) => void;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: (taskId: string, shiftKey?: boolean) => void;
  getTasksByContext: (statusId: string, priorityId?: string) => Task[];
  onCopyTask?: (message: string) => void;
  onDuplicateAsQuickAdd?: (task: Task) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  /** Agent handoff chips shown while a card is dragged (rendered inside DndContext). */
  agentTray?: React.ReactNode;
  onApproveAgentWork?: (task: Task, run: AgentRun) => void;
  onRejectAgentWork?: (task: Task, run: AgentRun, feedback: string) => void;
  agentDispatchEnabled?: boolean;
}

const getDropZoneId = (priorityId: string, statusId: string) => `${priorityId}::${statusId}`;

const PriorityBoardView: React.FC<PriorityBoardViewProps> = ({
  sensors,
  collisionDetection,
  measuringConfig,
  dropAnimation,
  boardRef,
  columns,
  priorities,
  tasks,
  allTasks,
  highlightedZone,
  splash,
  focusedTaskId,
  activeTask,
  isCompact,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  onMoveTask,
  onEditTask,
  onUpdateTask,
  onDeleteTask,
  onArchiveTask,
  selectedTaskIds,
  onToggleTaskSelection,
  getTasksByContext,
  onCopyTask,
  onDuplicateAsQuickAdd,
  projectName,
  projects = [],
  onMoveToWorkspace,
  agentTray,
  onApproveAgentWork,
  onRejectAgentWork,
  agentDispatchEnabled = true,
}) => {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      measuring={measuringConfig}
    >
      <div ref={boardRef} className="flex flex-col gap-8 outline-none min-w-0 w-full h-full">
        {priorities.map((prio) => (
          <div
            key={prio.id}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-lg min-w-0 w-full"
          >
            <div className="flex items-center gap-3 mb-5 px-2">
              <div
                className="w-2 h-8 rounded-full shadow-[0_0_8px_currentColor]"
                style={{ backgroundColor: prio.color, color: prio.color }}
              />
              <span
                className="text-sm font-bold uppercase tracking-widest"
                style={{ color: prio.color }}
              >
                {prio.label}
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-black/40 text-slate-400 border border-white/10">
                {tasks.filter((t) => t.priority === prio.id).length} tasks
              </span>
            </div>
            <div className="flex gap-6 px-2 mb-3 min-w-0 w-full">
              {columns.map((col) => {
                const cellCount = getTasksByContext(col.id, prio.id).length;
                return (
                  <div key={col.id} className="flex-1 min-w-[300px] flex items-center gap-3 px-2">
                    <div
                      className="w-1.5 h-5 rounded-full shrink-0"
                      style={{ backgroundColor: col.color || "#64748b" }}
                    />
                    <h3 className="font-bold text-slate-400 text-xs tracking-wide uppercase">
                      {col.title}
                    </h3>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-black/40 text-slate-500 border border-white/10">
                      {cellCount}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-6 overflow-x-auto scrollbar-hide min-w-0 w-full">
              {columns.map((column) => {
                const cellTasks = getTasksByContext(column.id, prio.id);
                const dropZoneId = getDropZoneId(prio.id, column.id);
                const isHighlighted = highlightedZone === dropZoneId;

                return (
                  <DroppableCell
                    key={`${prio.id}-${column.id}`}
                    id={dropZoneId}
                    className={`flex-1 min-w-[300px] flex flex-col gap-4 min-h-[200px] p-4 rounded-xl border transition-all duration-300 ${
                      isHighlighted
                        ? "border-red-500/60 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.2)] scale-[1.01]"
                        : "border-white/10 hover:border-white/15 bg-[#0a0505]/40"
                    }`}
                  >
                    <SortableContext
                      items={cellTasks.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                      id={dropZoneId}
                    >
                      {cellTasks.map((task) => (
                        <SortableTask
                          key={task.id}
                          task={task}
                          priorities={priorities}
                          onMoveTask={onMoveTask}
                          onEditTask={onEditTask}
                          onUpdateTask={onUpdateTask}
                          onDeleteTask={onDeleteTask}
                          onArchiveTask={onArchiveTask}
                          allTasks={allTasks}
                          isCompact={isCompact}
                          onCopyTask={onCopyTask}
                          onDuplicateAsQuickAdd={onDuplicateAsQuickAdd}
                          projectName={projectName}
                          projects={projects}
                          onMoveToWorkspace={onMoveToWorkspace}
                          isFocused={task.id === focusedTaskId}
                          isSelected={selectedTaskIds?.has(task.id) ?? false}
                          onToggleSelect={onToggleTaskSelection}
                          onApproveAgentWork={onApproveAgentWork}
                          onRejectAgentWork={onRejectAgentWork}
                          agentDispatchEnabled={agentDispatchEnabled}
                        />
                      ))}
                    </SortableContext>
                    {cellTasks.length === 0 && (
                      <div
                        className={`flex-1 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 text-xs transition-all ${
                          isHighlighted
                            ? "border-red-500/60 bg-red-500/10 text-red-400 scale-105"
                            : "border-white/10 text-slate-600 hover:border-white/15"
                        }`}
                      >
                        {isHighlighted ? (
                          <Inbox size={22} className="text-red-400" />
                        ) : (
                          <ClipboardList size={22} className="text-slate-600" />
                        )}
                        <span className="text-slate-500">
                          {isHighlighted ? "Drop here" : "Empty"}
                        </span>
                      </div>
                    )}
                  </DroppableCell>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {createPortal(
        <DragOverlay dropAnimation={dropAnimation}>
          {activeTask && (
            <div className="liquid-drag-blob cursor-grabbing shadow-2xl shadow-black/70 border border-red-500/50">
              <TaskCard
                task={activeTask}
                priorities={priorities}
                onMoveTask={() => {}}
                onEditTask={() => {}}
                onUpdateTask={() => {}}
                onDeleteTask={() => {}}
                allTasks={allTasks}
                isCompact={isCompact}
                onCopyTask={onCopyTask}
                projectName={projectName}
                projects={projects}
                onMoveToWorkspace={onMoveToWorkspace}
                isSelected={selectedTaskIds?.has(activeTask.id) ?? false}
                onToggleSelect={onToggleTaskSelection}
              />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
      {agentTray && createPortal(agentTray, document.body)}
      <DropSplash splash={splash} />
    </DndContext>
  );
};

export default PriorityBoardView;
