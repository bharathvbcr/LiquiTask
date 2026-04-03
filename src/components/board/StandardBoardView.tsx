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
import { TaskCard } from "../../../components/TaskCard";
import type { BoardColumn, PriorityDefinition, Project, Task } from "../../../types";
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
  getTasksByContext: (statusId: string, priorityId?: string) => Task[];
  onCopyTask?: (message: string) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
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
  tasks,
  allTasks,
  highlightedZone,
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
  getTasksByContext,
  onCopyTask,
  projectName,
  projects = [],
  onMoveToWorkspace,
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
                  isCompact={isCompact}
                  onCopyTask={onCopyTask}
                  projectName={projectName}
                  isHighlighted={isHighlighted}
                  isFocusedColumn={isFocusedColumn}
                  focusedTaskId={focusedTaskId}
                />
              );
            })}
          </SortableContext>
        </div>
      </div>

      {createPortal(
        <DragOverlay dropAnimation={dropAnimation}>
          {activeColumn && (
            <div className="w-[300px] opacity-80 rotate-2">
              <div className="bg-[#1e1e1e] p-4 rounded-xl border border-white/10 shadow-xl">
                <h3 className="font-bold text-slate-200">{activeColumn.title}</h3>
              </div>
            </div>
          )}
          {activeTask && (
            <div className="scale-110 rotate-3 cursor-grabbing shadow-2xl shadow-black/70 border-2 border-red-500/50 rounded-2xl overflow-hidden">
              <TaskCard
                task={activeTask}
                priorities={priorities}
                isCompletedColumn={false}
                onMoveTask={() => {}}
                onEditTask={() => {}}
                onUpdateTask={() => {}}
                onDeleteTask={() => {}}
                allTasks={allTasks}
                isCompact={isCompact}
                projects={projects}
                onMoveToWorkspace={onMoveToWorkspace}
              />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
};

export default StandardBoardView;
