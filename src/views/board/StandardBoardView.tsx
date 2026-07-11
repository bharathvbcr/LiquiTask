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
import { horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type React from "react";
import { createPortal } from "react-dom";
import { TaskCard } from "../../components/TaskCard";
import type { DropSplash as DropSplashData } from "../../hooks/useBoardDnDController";
import type { AgentRun, BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
import { DropSplash } from "./DropSplash";
import { SortableColumn } from "./SortableColumn";

interface StandardBoardViewProps {
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
  columnIds: string[];
  columns: BoardColumn[];
  priorities: PriorityDefinition[];
  tasks: Task[];
  allTasks: Task[];
  highlightedZone: string | null;
  splash: DropSplashData | null;
  focusedColumnIndex: number;
  focusedTaskId: string | null;
  activeTask: Task | null;
  activeColumn: BoardColumn | null;
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

const StandardBoardView: React.FC<StandardBoardViewProps> = ({
  sensors,
  collisionDetection,
  measuringConfig,
  dropAnimation,
  boardRef,
  columnIds,
  columns,
  priorities,
  tasks: _tasks,
  allTasks,
  highlightedZone,
  splash,
  focusedColumnIndex,
  focusedTaskId,
  activeTask,
  activeColumn,
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
      <div ref={boardRef} className="flex flex-col h-full outline-none">
        <div className="flex gap-6 h-full overflow-x-auto pb-4 px-2 pr-6 scrollbar-hide min-w-0">
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {columns.map((col, colIndex) => {
              const tasksInColumn = getTasksByContext(col.id);
              const isHighlighted =
                highlightedZone === col.id || highlightedZone === `drop-${col.id}`;
              const isFocusedColumn = colIndex === focusedColumnIndex;

              return (
                <SortableColumn
                  key={col.id}
                  column={col}
                  tasks={tasksInColumn}
                  priorities={priorities}
                  allTasks={allTasks}
                  onMoveTask={onMoveTask}
                  onEditTask={onEditTask}
                  onUpdateTask={onUpdateTask}
                  onDeleteTask={onDeleteTask}
                  onArchiveTask={onArchiveTask}
                  isCompact={isCompact}
                  onCopyTask={onCopyTask}
                  onDuplicateAsQuickAdd={onDuplicateAsQuickAdd}
                  projectName={projectName}
                  projects={projects}
                  onMoveToWorkspace={onMoveToWorkspace}
                  isHighlighted={isHighlighted}
                  isFocusedColumn={isFocusedColumn}
                  focusedTaskId={focusedTaskId}
                  selectedTaskIds={selectedTaskIds}
                  onToggleTaskSelection={onToggleTaskSelection}
                  onApproveAgentWork={onApproveAgentWork}
                  onRejectAgentWork={onRejectAgentWork}
                  agentDispatchEnabled={agentDispatchEnabled}
                />
              );
            })}
          </SortableContext>
        </div>
      </div>

      {createPortal(
        <DragOverlay dropAnimation={dropAnimation}>
          {activeColumn && (
            <div className="w-[300px] opacity-90 rotate-2">
              <div className="liquid-glass p-4 rounded-xl border-2 border-red-500/50 shadow-2xl shadow-black/70">
                <h3 className="font-bold text-slate-200">{activeColumn.title}</h3>
              </div>
            </div>
          )}
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

export default StandardBoardView;
