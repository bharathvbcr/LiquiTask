import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    DndContext,
    closestCorners,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent,
    DragCancelEvent,
    DropAnimation,
    MeasuringStrategy,
    CollisionDetection,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    horizontalListSortingStrategy,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import { Task, BoardColumn, PriorityDefinition, Project } from '../../types';
import { SortableColumn } from './board/SortableColumn';
import { SortableTask } from './board/SortableTask';
import { DroppableCell } from './board/DroppableCell';
import { TaskCard } from '../../components/TaskCard';
import { useBoardKeyboardNav } from '../hooks/useBoardKeyboardNav';

interface ProjectBoardProps {
    columns: BoardColumn[];
    priorities: PriorityDefinition[];
    tasks: Task[];
    allTasks: Task[];
    boardGrouping: 'none' | 'priority';
    onUpdateColumns: (cols: BoardColumn[]) => void;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    getTasksByContext: (statusId: string, priorityId?: string) => Task[];
    isCompact?: boolean;
    onCopyTask?: (message: string) => void;
    projectName?: string;
    projects?: Project[];
    onMoveToWorkspace?: (taskId: string, projectId: string) => void;
    addToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

// Unified drag state
interface ActiveDrag {
    type: 'task' | 'column';
    id: string;
    data: Task | BoardColumn;
}

// Drop target resolution result
interface DropTarget {
    status: string;
    priority?: string;
    order?: number;
}

/**
 * Simple collision detection: prefer pointer-based hits, fallback to closest corners.
 */
const kanbanCollisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
        return pointerCollisions;
    }
    return closestCorners(args);
};

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
    isCompact = false,
    onCopyTask,
    projectName,
    projects = [],
    onMoveToWorkspace,
    addToast,
}) => {
    // Single source of truth for drag state
    const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
    const [highlightedZone, setHighlightedZone] = useState<string | null>(null);
    const boardRef = useRef<HTMLDivElement>(null);

    const safeColumns = useMemo(() => columns || [], [columns]);
    const safePriorities = useMemo(() => priorities || [], [priorities]);
    const columnIds = useMemo(() => safeColumns.map((col) => col.id), [safeColumns]);

    // Keyboard navigation
    const {
        focusedColumnIndex,
        focusedTaskId,
        handlers: keyboardHandlers,
    } = useBoardKeyboardNav({
        columns: safeColumns,
        tasks,
        onMoveTask,
        onEditTask,
        onDeleteTask,
        getTasksByContext,
        boardGrouping,
        isEnabled: true,
    });

    // Make board focusable and handle keyboard events
    useEffect(() => {
        const board = boardRef.current;
        if (!board) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            keyboardHandlers.onKeyDown(e as unknown as React.KeyboardEvent);
        };

        board.addEventListener('keydown', handleKeyDown);
        board.setAttribute('tabIndex', '0');
        // Don't auto-focus - let user click or tab to activate keyboard nav

        return () => {
            board.removeEventListener('keydown', handleKeyDown);
        };
    }, [keyboardHandlers]);

    // Helper to show toast
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
        if (addToast) {
            addToast(message, type);
        } else {
            // console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }, [addToast]);

    // Sensors with reasonable activation constraints
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(TouchSensor, {
            activationConstraint: { delay: 150, tolerance: 8 },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Calculate order for inserting task before a target task
    const calculateInsertOrder = useCallback((
        targetTask: Task,
        tasksInContext: Task[],
        draggedTaskId: string
    ): number => {
        const targetIndex = tasksInContext.findIndex(t => t.id === targetTask.id);
        if (targetIndex === -1) {
            return (targetTask.order ?? 0) + 1;
        }

        const targetOrder = targetTask.order ?? targetIndex;
        const prevTask = tasksInContext[targetIndex - 1];

        if (!prevTask || prevTask.id === draggedTaskId) {
            return targetOrder - 0.5;
        }

        const prevOrder = prevTask.order ?? (targetIndex - 1);
        return (prevOrder + targetOrder) / 2;
    }, []);

    // Check WIP limit
    const isOverWipLimit = useCallback((statusId: string, excludeTaskId?: string): boolean => {
        const column = safeColumns.find(c => c.id === statusId);
        if (!column?.wipLimit || column.wipLimit === 0) {
            return false;
        }
        const tasksInColumn = tasks.filter(t => t.status === statusId && t.id !== excludeTaskId);
        return tasksInColumn.length >= column.wipLimit;
    }, [safeColumns, tasks]);

    // Resolve drop target from overId
    const resolveDropTarget = useCallback((
        overId: string,
        draggedTask: Task
    ): DropTarget | null => {
        // Priority grouping: check for composite ID (priorityId::statusId)
        if (boardGrouping === 'priority' && overId.includes('::')) {
            const [priorityId, statusId] = overId.split('::');
            if (safeColumns.some(c => c.id === statusId)) {
                return { status: statusId, priority: priorityId };
            }
        }

        // Check if dropped on a column or column drop zone
        const columnMatch = safeColumns.find(c =>
            c.id === overId || `drop-${c.id}` === overId
        );
        if (columnMatch) {
            return { status: columnMatch.id };
        }

        // Check if dropped on a task
        const overTask = tasks.find(t => t.id === overId);
        if (overTask) {
            const tasksInContext = boardGrouping === 'priority'
                ? getTasksByContext(overTask.status, overTask.priority)
                : getTasksByContext(overTask.status);

            return {
                status: overTask.status,
                priority: boardGrouping === 'priority' ? overTask.priority : undefined,
                order: calculateInsertOrder(overTask, tasksInContext, draggedTask.id),
            };
        }

        return null;
    }, [boardGrouping, safeColumns, tasks, getTasksByContext, calculateInsertOrder]);

    // Event handlers
    function handleDragStart(event: DragStartEvent) {
        const { active } = event;
        const id = String(active.id);
        const data = active.data.current;

        if (data?.type === 'task' && data.task) {
            setActiveDrag({ type: 'task', id, data: data.task });
        } else if (data?.type === 'column' && data.column) {
            setActiveDrag({ type: 'column', id, data: data.column });
        } else {
            // Fallback: try to find by ID
            const task = tasks.find(t => t.id === id);
            if (task) {
                setActiveDrag({ type: 'task', id, data: task });
                return;
            }
            const column = safeColumns.find(c => c.id === id);
            if (column) {
                setActiveDrag({ type: 'column', id, data: column });
            }
        }
    }

    function handleDragOver(event: DragOverEvent) {
        const overId = event.over ? String(event.over.id) : null;
        setHighlightedZone(overId);
    }

    function handleDragEnd(event: DragEndEvent) {
        const { over } = event;

        if (!activeDrag || !over) {
            setActiveDrag(null);
            setHighlightedZone(null);
            return;
        }

        const overId = String(over.id);

        if (activeDrag.type === 'column') {
            handleColumnReorder(activeDrag.id, overId);
        } else if (activeDrag.type === 'task') {
            handleTaskDrop(activeDrag.data as Task, overId);
        }

        setActiveDrag(null);
        setHighlightedZone(null);
    }

    function handleDragCancel(_event: DragCancelEvent) {
        setActiveDrag(null);
        setHighlightedZone(null);
    }

    function handleColumnReorder(activeId: string, overId: string) {
        if (activeId === overId) return;

        const oldIndex = safeColumns.findIndex(c => c.id === activeId);
        const newIndex = safeColumns.findIndex(c => c.id === overId);

        if (oldIndex !== -1 && newIndex !== -1) {
            onUpdateColumns(arrayMove(safeColumns, oldIndex, newIndex));
        }
    }

    function handleTaskDrop(task: Task, overId: string) {
        const dropTarget = resolveDropTarget(overId, task);

        if (!dropTarget) {
            showToast('Could not determine drop target', 'error');
            return;
        }

        const { status, priority, order } = dropTarget;

        // Validate column exists
        const targetColumn = safeColumns.find(c => c.id === status);
        if (!targetColumn) {
            showToast('Invalid column', 'error');
            return;
        }

        // Check if task still exists
        const currentTask = tasks.find(t => t.id === task.id);
        if (!currentTask) {
            showToast('Task no longer exists', 'error');
            return;
        }

        // Check WIP limit (only if moving to different column)
        if (status !== task.status && isOverWipLimit(status, task.id)) {
            showToast(`Column "${targetColumn.title}" has reached its WIP limit`, 'error');
            return;
        }

        // Determine what changed
        const statusChanged = status !== task.status;
        const priorityChanged = priority !== undefined && priority !== task.priority;
        const orderChanged = order !== undefined;

        // Only move if something changed
        if (statusChanged || priorityChanged || orderChanged) {
            try {
                onMoveTask(
                    task.id,
                    status,
                    priorityChanged ? priority : undefined,
                    order
                );
            } catch (error) {
                console.error('Error moving task:', error);
                showToast('Failed to move task', 'error');
            }
        }
    }

    // Helper to create composite drop zone ID for priority view
    const getDropZoneId = (priorityId: string, statusId: string) => `${priorityId}::${statusId}`;

    // Animation config
    const dropAnimation: DropAnimation = {
        duration: 250,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.4' } },
        }),
    };

    const measuringConfig = {
        droppable: {
            strategy: MeasuringStrategy.Always,
            frequency: 100,
        },
    };

    // Extract active items for DragOverlay
    const activeTask = activeDrag?.type === 'task' ? activeDrag.data as Task : null;
    const activeColumn = activeDrag?.type === 'column' ? activeDrag.data as BoardColumn : null;

    // Priority grouping view
    if (boardGrouping === 'priority') {
        return (
            <DndContext
                sensors={sensors}
                collisionDetection={kanbanCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
                measuring={measuringConfig}
            >
                <div
                    ref={boardRef}
                    className="flex flex-col gap-8 outline-none min-w-0 w-full h-full"
                    tabIndex={0}
                >
                    {/* Column headers */}
                    <div className="flex gap-6 sticky top-[120px] z-20 pb-4 bg-[#020000]/90 backdrop-blur-md -mx-6 px-[44px] pt-4 border-b border-white/5 overflow-x-auto scrollbar-hide min-w-0">
                        {safeColumns.map((col) => {
                            const tasksInCol = getTasksByContext(col.id);
                            return (
                                <div key={col.id} className="flex-1 min-w-[300px] flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="w-1.5 h-6 rounded-full"
                                            style={{ backgroundColor: col.color || '#64748b' }}
                                        />
                                        <h3 className="font-bold text-slate-300 text-xs tracking-wide uppercase">{col.title}</h3>
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-black/40 text-slate-400 border border-white/10">
                                            {tasksInCol.length}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Priority rows */}
                    {safePriorities.map((prio) => (
                        <div key={prio.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-lg min-w-0 w-full">
                            <div className="flex items-center gap-3 mb-5 px-2">
                                <div
                                    className="w-2 h-8 rounded-full shadow-[0_0_8px_currentColor]"
                                    style={{ backgroundColor: prio.color, color: prio.color }}
                                />
                                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: prio.color }}>
                                    {prio.label}
                                </span>
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-black/40 text-slate-400 border border-white/10">
                                    {tasks.filter(t => t.priority === prio.id).length} tasks
                                </span>
                            </div>
                            <div className="flex gap-6 overflow-x-auto scrollbar-hide min-w-0 w-full">
                                {safeColumns.map((column) => {
                                    const cellTasks = getTasksByContext(column.id, prio.id);
                                    const dropZoneId = getDropZoneId(prio.id, column.id);
                                    const isHighlighted = highlightedZone === dropZoneId;

                                    return (
                                        <DroppableCell
                                            key={`${prio.id}-${column.id}`}
                                            id={dropZoneId}
                                            className={`flex-1 min-w-[300px] flex flex-col gap-4 min-h-[200px] p-4 rounded-xl border transition-all duration-300 ${isHighlighted
                                                ? 'border-blue-500/60 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.2)] scale-[1.01]'
                                                : 'border-white/10 hover:border-white/15 bg-[#0a0a0a]/40'
                                                }`}
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
                                                        isCompact={isCompact}
                                                        onCopyTask={onCopyTask}
                                                        projectName={projectName}
                                                        projects={projects}
                                                        onMoveToWorkspace={onMoveToWorkspace}
                                                        isFocused={task.id === focusedTaskId}
                                                    />
                                                ))}
                                            </SortableContext>
                                            {cellTasks.length === 0 && (
                                                <div className={`flex-1 min-h-[150px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 text-xs transition-all ${isHighlighted
                                                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-400 scale-105'
                                                    : 'border-white/10 text-slate-600 hover:border-white/15'
                                                    }`}>
                                                    <div className="text-xl opacity-50">📋</div>
                                                    <span className="text-slate-500">{isHighlighted ? 'Drop here' : 'Empty'}</span>
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
                            <div className="scale-110 rotate-3 cursor-grabbing shadow-2xl shadow-black/70 border-2 border-red-500/50 rounded-2xl overflow-hidden">
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
                                    onCopyTask={onCopyTask}
                                    projectName={projectName}
                                    projects={projects}
                                    onMoveToWorkspace={onMoveToWorkspace}
                                />
                            </div>
                        )}
                    </DragOverlay>,
                    document.body
                )}
            </DndContext>
        );
    }

    // Standard column view
    return (
        <DndContext
            sensors={sensors}
            collisionDetection={kanbanCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            measuring={measuringConfig}
        >
            <div
                ref={boardRef}
                className="flex flex-col h-full outline-none"
                tabIndex={0}
            >
                <div className="flex gap-6 h-full overflow-x-auto pb-4 px-2 pr-6 scrollbar-hide min-w-0">
                    <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                        {safeColumns.map((col, colIndex) => {
                            const tasksInColumn = getTasksByContext(col.id);
                            const isHighlighted = highlightedZone === col.id || highlightedZone === `drop-${col.id}`;
                            const isFocusedColumn = colIndex === focusedColumnIndex;

                            return (
                                <SortableColumn
                                    key={col.id}
                                    column={col}
                                    tasks={tasksInColumn}
                                    priorities={safePriorities}
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
                                priorities={safePriorities}
                                isCompletedColumn={false}
                                onMoveTask={() => { }}
                                onEditTask={() => { }}
                                onUpdateTask={() => { }}
                                onDeleteTask={() => { }}
                                allTasks={allTasks}
                                isCompact={isCompact}
                                projects={projects}
                                onMoveToWorkspace={onMoveToWorkspace}
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
