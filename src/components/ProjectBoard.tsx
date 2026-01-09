import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
    DropAnimation,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Maximize2, Minimize2 } from 'lucide-react';

import { Task, BoardColumn, PriorityDefinition } from '../../types';
import { SortableColumn } from './board/SortableColumn';
import { SortableTask } from './board/SortableTask';
import { TaskCard } from '../../components/TaskCard';

interface ProjectBoardProps {
    columns: BoardColumn[];
    priorities: PriorityDefinition[];
    tasks: Task[]; // tasks for current project
    allTasks: Task[]; // potentially needed for counts or other contexts
    boardGrouping: 'none' | 'priority';
    onUpdateColumns: (cols: BoardColumn[]) => void;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    getTasksByContext: (statusId: string, priorityId?: string) => Task[];
}

export const ProjectBoard: React.FC<ProjectBoardProps> = ({
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
    getTasksByContext,
}) => {
    const [, setActiveId] = useState<string | null>(null);
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [activeColumn, setActiveColumn] = useState<BoardColumn | null>(null);
    const [isCompact, setIsCompact] = useState(false);

    const safeColumns = useMemo(() => columns || [], [columns]);
    const safePriorities = useMemo(() => priorities || [], [priorities]);



    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // 5px draggable distance
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const columnIds = useMemo(() => safeColumns.map((col) => col.id), [safeColumns]);

    function onDragStart(event: DragStartEvent) {
        const { active } = event;
        const activeIdString = String(active.id); // Ensure string

        if (!activeIdString) return;
        setActiveId(activeIdString);

        const task = tasks.find((t) => t.id === activeIdString);
        if (task) {
            setActiveTask(task);
            return;
        }

        const column = safeColumns.find((c) => c.id === activeIdString);
        if (column) {
            setActiveColumn(column);
            return;
        }
    }

    function onDragOver(_event: DragOverEvent) {
        // Only handling visual logic here if we needed optimistic updates
        // For now, simpler implementation: do nothing on drag over unless switching containers
        // But since we don't control state locally (it's in App), we rely on onDragEnd.
        // DndKit might need intermediate updates for sorting.
    }

    function onDragEnd(event: DragEndEvent) {
        const { active, over } = event;
        const activeIdString = String(active.id);
        const overIdString = over ? String(over.id) : null;

        if (!overIdString) {
            setActiveId(null);
            setActiveTask(null);
            setActiveColumn(null);
            return;
        }

        // Is it a Column?
        if (activeColumn) {
            if (activeIdString !== overIdString) {
                const oldIndex = columns.findIndex((c) => c.id === activeIdString);
                const newIndex = columns.findIndex((c) => c.id === overIdString);
                if (oldIndex !== -1 && newIndex !== -1) {
                    onUpdateColumns(arrayMove(columns, oldIndex, newIndex));
                }
            }
        }

        // Is it a Task?
        if (activeTask) {
            // Find drop container
            // If dropped on top of another task, overId is a task ID.
            // If dropped on a column, overId is a column ID.

            let newStatus = '';

            // Check if dropped on a column directly
            const overColumn = columns.find(c => c.id === overIdString);
            if (overColumn) {
                newStatus = overColumn.id;
            } else {
                // Dropped on a task?
                const overTask = tasks.find(t => t.id === overIdString);
                if (overTask) {
                    newStatus = overTask.status;
                }
            }

            if (newStatus && newStatus !== activeTask.status) {
                onMoveTask(activeTask.id, newStatus);
            }

            // Reordering within same column?
            // Current App logic doesn't support manual reordering (tasks are just list).
            // If we want reordering, we need to add 'order' field to tasks.
            // For Phase 10, moving between columns is priority.
        }

        setActiveId(null);
        setActiveTask(null);
        setActiveColumn(null);
    }

    const dropAnimation: DropAnimation = {
        sideEffects: defaultDropAnimationSideEffects({
            styles: {
                active: {
                    opacity: '0.5',
                },
            },
        }),
    };

    if (boardGrouping === 'priority') {
        // Priority grouping view - renders tasks grouped by priority with columns
        // Uses composite drop zone IDs to enable DnD across both status and priority dimensions

        // Helper to create composite drop zone ID
        const getDropZoneId = (priorityId: string, statusId: string) =>
            `${priorityId}::${statusId}`;

        // Helper to parse composite drop zone ID
        const parseDropZoneId = (id: string): { priorityId: string; statusId: string } | null => {
            const parts = id.split('::');
            if (parts.length === 2) {
                return { priorityId: parts[0], statusId: parts[1] };
            }
            return null;
        };

        // Find task's current priority and status for drop target resolution
        const findTaskLocation = (taskId: string): { priorityId: string; statusId: string } | null => {
            const task = tasks.find(t => t.id === taskId);
            if (task) {
                return { priorityId: task.priority, statusId: task.status };
            }
            return null;
        };

        const handlePriorityDragStart = (event: DragStartEvent) => {
            const { active } = event;
            const activeIdString = String(active.id);
            if (!activeIdString) return;

            setActiveId(activeIdString);
            const task = tasks.find((t) => t.id === activeIdString);
            if (task) {
                setActiveTask(task);
            }
        };

        const handlePriorityDragEnd = (event: DragEndEvent) => {
            const { over } = event;
            const overIdString = over ? String(over.id) : null;

            if (!overIdString || !activeTask) {
                setActiveId(null);
                setActiveTask(null);
                return;
            }

            let newStatus = '';
            let newPriority = '';

            // Check if dropped on a drop zone (composite ID)
            const dropZone = parseDropZoneId(overIdString);
            if (dropZone) {
                newStatus = dropZone.statusId;
                newPriority = dropZone.priorityId;
            } else {
                // Dropped on a task - get that task's location
                const taskLocation = findTaskLocation(overIdString);
                if (taskLocation) {
                    newStatus = taskLocation.statusId;
                    newPriority = taskLocation.priorityId;
                }
            }

            // Only update if something changed
            if (newStatus && (newStatus !== activeTask.status || newPriority !== activeTask.priority)) {
                onMoveTask(activeTask.id, newStatus, newPriority !== activeTask.priority ? newPriority : undefined);
            }

            setActiveId(null);
            setActiveTask(null);
        };

        return (
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handlePriorityDragStart}
                onDragEnd={handlePriorityDragEnd}
            >
                <div className="flex flex-col gap-8">
                    <div className="flex gap-6 sticky top-0 z-20 pb-2 bg-[#020000]/80 backdrop-blur-md -mx-6 px-6 pt-2">
                        {safeColumns.map((col) => (
                            <div key={col.id} className="flex-1 min-w-[300px] flex items-center justify-between px-2">
                                <h3 className="font-bold text-slate-300 text-xs tracking-wide uppercase">{col.title}</h3>
                            </div>
                        ))}
                    </div>
                    {safePriorities.map((prio) => (
                        <div key={prio.id} className="rounded-3xl border border-white/5 bg-white/[0.02] p-4">
                            <div className="flex items-center gap-3 mb-4 px-2">
                                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: prio.color }}>{prio.label}</span>
                            </div>
                            <div className="flex gap-6">
                                {safeColumns.map((column) => {
                                    const cellTasks = getTasksByContext(column.id, prio.id);
                                    const dropZoneId = getDropZoneId(prio.id, column.id);
                                    return (
                                        <div
                                            key={`${prio.id}-${column.id}`}
                                            className="flex-1 min-w-[300px] flex flex-col gap-4 min-h-[120px] p-2 rounded-xl border border-transparent hover:border-white/10 transition-colors"
                                            data-droppable-id={dropZoneId}
                                        >
                                            <SortableContext
                                                items={cellTasks.map(t => t.id)}
                                                strategy={verticalListSortingStrategy}
                                                id={dropZoneId}
                                            >
                                                {cellTasks.map(task => (
                                                    <SortableTask
                                                        key={task.id}
                                                        task={task}
                                                        priorities={safePriorities}
                                                        isCompletedColumn={column.isCompleted}
                                                        onMoveTask={onMoveTask}
                                                        onEditTask={onEditTask}
                                                        onUpdateTask={onUpdateTask}
                                                        onDeleteTask={onDeleteTask}
                                                        allTasks={allTasks}
                                                    />
                                                ))}
                                            </SortableContext>
                                            {cellTasks.length === 0 && (
                                                <div
                                                    className="flex-1 min-h-[80px] rounded-lg border-2 border-dashed border-white/5 flex items-center justify-center text-slate-600 text-xs"
                                                    data-droppable-id={dropZoneId}
                                                >
                                                    Drop here
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {createPortal(
                    <DragOverlay dropAnimation={dropAnimation}>
                        {activeTask && (
                            <div className="opacity-80 rotate-2 cursor-grabbing">
                                <TaskCard
                                    task={activeTask}
                                    priorities={safePriorities}
                                    isCompletedColumn={false}
                                    onMoveTask={() => { }}
                                    onEditTask={() => { }}
                                    onUpdateTask={() => { }}
                                    onDeleteTask={() => { }}
                                    allTasks={allTasks}
                                />
                            </div>
                        )}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>
        );
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
        >
            <div className="flex flex-col h-full">
                <div className="flex justify-end mb-4 px-4 sticky left-0 right-0">
                    <button
                        onClick={() => setIsCompact(!isCompact)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-400 hover:text-white transition-all border border-white/5 hover:border-white/20"
                    >
                        {isCompact ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                        {isCompact ? 'Expand Cards' : 'Compact View'}
                    </button>
                </div>
                <div className="flex gap-6 h-full overflow-x-auto pb-4">
                    <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                        {safeColumns.map((col) => (
                            <SortableColumn
                                key={col.id}
                                column={col}
                                tasks={getTasksByContext(col.id)}
                                priorities={safePriorities}
                                allTasks={allTasks}
                                onMoveTask={onMoveTask}
                                onEditTask={onEditTask}
                                onUpdateTask={onUpdateTask}
                                onDeleteTask={onDeleteTask}
                                isCompact={isCompact}
                            />
                        ))}
                    </SortableContext>
                </div>
            </div>

            {createPortal(
                <DragOverlay dropAnimation={dropAnimation}>
                    {activeColumn && (
                        <div className="w-[300px] opacity-80 rotate-2">
                            {/* Minimal column representation */}
                            <div className="bg-[#1e1e1e] p-4 rounded-xl border border-white/10 shadow-xl">
                                <h3 className="font-bold text-slate-200">{activeColumn.title}</h3>
                            </div>
                        </div>
                    )}
                    {activeTask && (
                        <div className="opacity-80 rotate-2 cursor-grabbing">
                            <TaskCard
                                task={activeTask}
                                priorities={safePriorities}
                                isCompletedColumn={false}
                                onMoveTask={() => { }}
                                onEditTask={() => { }}
                                onUpdateTask={() => { }}
                                onDeleteTask={() => { }}
                                allTasks={allTasks}
                                isCompact={isCompact}
                            />
                        </div>
                    )}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
};

export default ProjectBoard;
