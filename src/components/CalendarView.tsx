import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Grid3X3, Rows } from 'lucide-react';
import { Task, PriorityDefinition } from '../../types';
import {
    DndContext,
    pointerWithin,
    DragStartEvent,
    DragEndEvent,
    DragOverEvent,
    DragCancelEvent,
    useSensor,
    useSensors,
    PointerSensor,
    TouchSensor,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DropAnimation,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { createPortal } from 'react-dom';

interface CalendarViewProps {
    tasks: Task[];
    priorities: PriorityDefinition[];
    onTaskClick: (task: Task) => void;
    onAddTask: (date: Date) => void;
    onUpdateDueDate?: (taskId: string, newDate: Date) => void;
}

type ViewMode = 'month' | 'week';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Draggable Task Component
interface DraggableTaskProps {
    task: Task;
    priorityColor: string;
    onClick: () => void;
}

// Normalize date to start of day (strip time)
const normalizeDate = (date: Date): Date => {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
};

// Get date key for consistent matching
const getDateKey = (date: Date): string => {
    return normalizeDate(date).toDateString();
};

const DraggableTask: React.FC<DraggableTaskProps> = ({ task, priorityColor, onClick }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        isDragging,
    } = useDraggable({
        id: task.id,
        data: { type: 'task', task },
    });

    const style: React.CSSProperties = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
    };

    return (
        <button
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            onClick={onClick}
            className="w-full text-left px-2 py-1 rounded-md text-[10px] font-medium truncate transition-all hover:scale-[1.02] border border-transparent hover:border-white/20"
            style={{
                ...style,
                backgroundColor: `${priorityColor}20`,
                borderLeft: `2px solid ${priorityColor}`,
                color: priorityColor,
            }}
        >
            {task.title}
        </button>
    );
};

// Droppable Day Cell Component
interface DroppableDayCellProps {
    date: Date;
    dateKey: string;
    isToday: boolean;
    isCurrentMonth: boolean;
    viewMode: 'month' | 'week';
    onAddTask: (date: Date) => void;
    children: React.ReactNode;
}

const DroppableDayCell: React.FC<DroppableDayCellProps> = ({
    date,
    dateKey,
    isToday,
    isCurrentMonth,
    viewMode,
    children,
}) => {
    const { setNodeRef, isOver } = useDroppable({
        id: dateKey,
        data: { type: 'date', date },
    });

    return (
        <div
            ref={setNodeRef}
            className={`
                group relative rounded-xl border transition-all min-h-[100px]
                ${viewMode === 'week' ? 'min-h-[400px]' : ''}
                ${isToday
                    ? 'bg-red-950/30 border-red-500/30'
                    : 'bg-black/20 border-white/5 hover:border-white/10'
                }
                ${!isCurrentMonth && viewMode === 'month' ? 'opacity-40' : ''}
                ${isOver ? 'border-blue-500/50 bg-blue-500/10 ring-2 ring-blue-500/30' : ''}
            `}
        >
            {children}
        </div>
    );
};

export const CalendarView: React.FC<CalendarViewProps> = ({
    tasks,
    priorities,
    onTaskClick,
    onAddTask,
    onUpdateDueDate,
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [activeTask, setActiveTask] = useState<Task | null>(null);

    // Sensors for drag and drop
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(TouchSensor, {
            activationConstraint: { delay: 150, tolerance: 8 },
        })
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get days for current month view
    const monthDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const totalDays = lastDay.getDate();

        const days: Date[] = [];

        // Add padding days from previous month
        for (let i = startPadding - 1; i >= 0; i--) {
            days.push(new Date(year, month, -i));
        }

        // Add current month days
        for (let i = 1; i <= totalDays; i++) {
            days.push(new Date(year, month, i));
        }

        // Add padding days for next month to complete grid
        const remaining = 42 - days.length; // 6 rows * 7 days
        for (let i = 1; i <= remaining; i++) {
            days.push(new Date(year, month + 1, i));
        }

        return days;
    }, [currentDate]);

    // Get days for week view
    const weekDays = useMemo(() => {
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - currentDate.getDay());

        return Array.from({ length: 7 }, (_, i) => {
            const day = new Date(startOfWeek);
            day.setDate(startOfWeek.getDate() + i);
            return day;
        });
    }, [currentDate]);

    const displayDays = viewMode === 'month' ? monthDays : weekDays;

    // Group tasks by date
    const tasksByDate = useMemo(() => {
        const map = new Map<string, Task[]>();

        tasks.forEach(task => {
            if (task.dueDate) {
                const dateKey = getDateKey(new Date(task.dueDate));
                const existing = map.get(dateKey) || [];
                map.set(dateKey, [...existing, task]);
            }
        });

        return map;
    }, [tasks]);

    const navigate = (direction: 'prev' | 'next') => {
        setCurrentDate(prev => {
            const newDate = new Date(prev);
            if (viewMode === 'month') {
                newDate.setMonth(prev.getMonth() + (direction === 'next' ? 1 : -1));
            } else {
                newDate.setDate(prev.getDate() + (direction === 'next' ? 7 : -7));
            }
            return newDate;
        });
    };

    const goToToday = () => setCurrentDate(new Date());

    const isToday = (date: Date) => date.toDateString() === today.toDateString();
    const isCurrentMonth = (date: Date) => date.getMonth() === currentDate.getMonth();

    const getPriorityColor = (priorityId: string) => {
        return priorities.find(p => p.id === priorityId)?.color || '#64748b';
    };

    // Drag handlers
    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        const task = tasks.find(t => t.id === active.id);
        if (task) {
            setActiveTask(task);
        }
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event;
        if (over) {
            // const overId = String(over.id);
            // Check if it's a date cell
            if (over.data.current?.type === 'date') {
                // setHighlightedDate(overId);
            }
        }
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over || !onUpdateDueDate) {
            setActiveTask(null);
            return;
        }

        const task = tasks.find(t => t.id === active.id);
        const dropData = over.data.current;

        if (task && dropData?.type === 'date' && dropData.date) {
            const targetDate = normalizeDate(new Date(dropData.date));
            const currentDueDate = task.dueDate ? normalizeDate(new Date(task.dueDate)) : null;

            // Only update if the date actually changed
            if (!currentDueDate || targetDate.getTime() !== currentDueDate.getTime()) {
                onUpdateDueDate(task.id, targetDate);
            }
        }

        setActiveTask(null);
    };

    const handleDragCancel = (_event: DragCancelEvent) => {
        setActiveTask(null);
    };

    const dropAnimation: DropAnimation = {
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        sideEffects: defaultDropAnimationSideEffects({
            styles: { active: { opacity: '0.4' } },
        }),
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            <div className="h-full flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                            <CalendarIcon size={24} className="text-red-400" />
                            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                        </h2>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => navigate('prev')}
                                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                aria-label="Previous"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <button
                                onClick={goToToday}
                                className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                            >
                                Today
                            </button>
                            <button
                                onClick={() => navigate('next')}
                                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                aria-label="Next"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1 border border-white/5">
                        <button
                            onClick={() => setViewMode('month')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'month'
                                ? 'bg-red-500/20 text-red-400'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <Grid3X3 size={14} /> Month
                        </button>
                        <button
                            onClick={() => setViewMode('week')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'week'
                                ? 'bg-red-500/20 text-red-400'
                                : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            <Rows size={14} /> Week
                        </button>
                    </div>
                </div>

                {/* Day Headers */}
                <div className="grid grid-cols-7 gap-1 mb-2">
                    {DAYS.map(day => (
                        <div
                            key={day}
                            className="text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-2"
                        >
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Grid */}
                <div className={`grid grid-cols-7 gap-1 flex-1 ${viewMode === 'week' ? 'grid-rows-1' : 'grid-rows-6'}`}>
                    {displayDays.map((date, i) => {
                        const dateKey = getDateKey(date);
                        const dayTasks = tasksByDate.get(dateKey) || [];
                        const isCurrentMonthDay = isCurrentMonth(date);
                        const isTodayDate = isToday(date);

                        return (
                            <DroppableDayCell
                                key={i}
                                date={date}
                                dateKey={dateKey}
                                isToday={isTodayDate}
                                isCurrentMonth={isCurrentMonthDay}
                                viewMode={viewMode}
                                onAddTask={onAddTask}
                            >
                                {/* Date Number */}
                                <div className="flex items-center justify-between p-2">
                                    <span className={`
                                    text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full
                                    ${isTodayDate ? 'bg-red-500 text-white' : 'text-slate-400'}
                                `}>
                                        {date.getDate()}
                                    </span>

                                    {/* Add Task Button */}
                                    <button
                                        onClick={() => onAddTask(date)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-white hover:bg-white/10 rounded transition-all"
                                        aria-label="Add task"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>

                                {/* Tasks */}
                                <div className="px-1 pb-1 space-y-1 overflow-y-auto max-h-[80px]">
                                    {dayTasks.slice(0, viewMode === 'week' ? 10 : 3).map(task => (
                                        <DraggableTask
                                            key={task.id}
                                            task={task}
                                            priorityColor={getPriorityColor(task.priority)}
                                            onClick={() => onTaskClick(task)}
                                        />
                                    ))}
                                    {dayTasks.length > (viewMode === 'week' ? 10 : 3) && (
                                        <div className="text-[10px] text-slate-500 text-center">
                                            +{dayTasks.length - (viewMode === 'week' ? 10 : 3)} more
                                        </div>
                                    )}
                                </div>
                            </DroppableDayCell>
                        );
                    })}
                </div>
            </div>

            {/* Drag Overlay */}
            {createPortal(
                <DragOverlay dropAnimation={dropAnimation}>
                    {activeTask && (
                        <div className="px-2 py-1 rounded-md text-[10px] font-medium shadow-2xl scale-105 rotate-2"
                            style={{
                                backgroundColor: `${getPriorityColor(activeTask.priority)}40`,
                                borderLeft: `2px solid ${getPriorityColor(activeTask.priority)}`,
                                color: getPriorityColor(activeTask.priority),
                            }}
                        >
                            {activeTask.title}
                        </div>
                    )}
                </DragOverlay>,
                document.body
            )}
        </DndContext>
    );
};

export default CalendarView;
