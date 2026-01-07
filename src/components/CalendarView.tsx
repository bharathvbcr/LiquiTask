import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Grid3X3, Rows } from 'lucide-react';
import { Task, PriorityDefinition } from '../../types';

interface CalendarViewProps {
    tasks: Task[];
    priorities: PriorityDefinition[];
    onTaskClick: (task: Task) => void;
    onAddTask: (date: Date) => void;
}

type ViewMode = 'month' | 'week';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

export const CalendarView: React.FC<CalendarViewProps> = ({
    tasks,
    priorities,
    onTaskClick,
    onAddTask,
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');

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
                const dateKey = new Date(task.dueDate).toDateString();
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

    return (
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
                    const dateKey = date.toDateString();
                    const dayTasks = tasksByDate.get(dateKey) || [];
                    const isCurrentMonthDay = isCurrentMonth(date);
                    const isTodayDate = isToday(date);

                    return (
                        <div
                            key={i}
                            className={`
                group relative rounded-xl border transition-all min-h-[100px]
                ${viewMode === 'week' ? 'min-h-[400px]' : ''}
                ${isTodayDate
                                    ? 'bg-red-950/30 border-red-500/30'
                                    : 'bg-black/20 border-white/5 hover:border-white/10'
                                }
                ${!isCurrentMonthDay && viewMode === 'month' ? 'opacity-40' : ''}
              `}
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
                                    <button
                                        key={task.id}
                                        onClick={() => onTaskClick(task)}
                                        className="w-full text-left px-2 py-1 rounded-md text-[10px] font-medium truncate transition-all hover:scale-[1.02]"
                                        style={{
                                            backgroundColor: `${getPriorityColor(task.priority)}20`,
                                            borderLeft: `2px solid ${getPriorityColor(task.priority)}`,
                                            color: getPriorityColor(task.priority),
                                        }}
                                    >
                                        {task.title}
                                    </button>
                                ))}
                                {dayTasks.length > (viewMode === 'week' ? 10 : 3) && (
                                    <div className="text-[10px] text-slate-500 text-center">
                                        +{dayTasks.length - (viewMode === 'week' ? 10 : 3)} more
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default CalendarView;
