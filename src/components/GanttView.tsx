import React, { useMemo, useState } from 'react';
import { Task, BoardColumn, PriorityDefinition } from '../../types';
import { Calendar, ArrowRight, Lock } from 'lucide-react';

interface GanttViewProps {
    tasks: Task[];
    columns: BoardColumn[];
    priorities: PriorityDefinition[];
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
}

interface GanttTask extends Task {
    startDate: Date;
    endDate: Date;
    dependencies: Task[];
    isOnCriticalPath: boolean;
}

export const GanttView: React.FC<GanttViewProps> = ({
    tasks,
    priorities,
    onEditTask,
}) => {
    const [selectedDateRange, setSelectedDateRange] = useState<{ start: Date; end: Date }>(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        return { start, end };
    });

    // Calculate Gantt data
    const ganttTasks = useMemo(() => {
        return tasks
            .filter(task => task.dueDate || task.timeEstimate > 0)
            .map(task => {
                const dueDate = task.dueDate || new Date();
                const estimateDays = Math.ceil((task.timeEstimate || 0) / (8 * 60)); // Convert minutes to days (8h/day)
                const startDate = new Date(dueDate);
                startDate.setDate(startDate.getDate() - estimateDays);

                // Find dependencies
                const dependencies = task.links
                    ?.filter(link => link.type === 'blocked-by' || link.type === 'blocks')
                    .map(link => tasks.find(t => t.id === link.targetTaskId))
                    .filter((t): t is Task => t !== undefined) || [];

                return {
                    ...task,
                    startDate,
                    endDate: dueDate,
                    dependencies,
                    isOnCriticalPath: false, // Could calculate critical path
                } as GanttTask;
            })
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    }, [tasks]);

    // Calculate date range for display
    const daysInRange = useMemo(() => {
        const days: Date[] = [];
        const current = new Date(selectedDateRange.start);
        while (current <= selectedDateRange.end) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }
        return days;
    }, [selectedDateRange]);

    // Calculate task position and width
    const getTaskStyle = (task: GanttTask): React.CSSProperties => {
        const startOffset = (task.startDate.getTime() - selectedDateRange.start.getTime()) / (1000 * 60 * 60 * 24);
        const duration = (task.endDate.getTime() - task.startDate.getTime()) / (1000 * 60 * 60 * 24);
        const dayWidth = 40; // pixels per day

        return {
            left: `${startOffset * dayWidth}px`,
            width: `${Math.max(duration * dayWidth, 60)}px`,
        };
    };

    const priorityDef = (priorityId: string) =>
        priorities.find(p => p.id === priorityId) || { color: '#64748b', label: 'Unknown' };

    return (
        <div className="h-full overflow-auto p-6">
            <div className="mb-6 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Gantt View</h2>
                <div className="flex items-center gap-4">
                    <label className="sr-only">Start Date</label>
                    <input
                        type="date"
                        value={selectedDateRange.start.toISOString().split('T')[0]}
                        onChange={(e) => setSelectedDateRange(prev => ({
                            ...prev,
                            start: new Date(e.target.value)
                        }))}
                        className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 [color-scheme:dark]"
                        aria-label="Start date"
                        title="Start date"
                    />
                    <span className="text-slate-400">to</span>
                    <label className="sr-only">End Date</label>
                    <input
                        type="date"
                        value={selectedDateRange.end.toISOString().split('T')[0]}
                        onChange={(e) => setSelectedDateRange(prev => ({
                            ...prev,
                            end: new Date(e.target.value)
                        }))}
                        className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-slate-300 [color-scheme:dark]"
                        aria-label="End date"
                        title="End date"
                    />
                </div>
            </div>

            <div className="bg-[#0a0a0a]/50 rounded-2xl border border-white/10 p-4">
                {/* Header with dates */}
                <div className="mb-4 flex border-b border-white/10 pb-2">
                    <div className="w-64 shrink-0 font-bold text-xs text-slate-400 uppercase">Task</div>
                    <div className="flex-1 flex">
                        {daysInRange.map((day, idx) => (
                            <div
                                key={idx}
                                className="flex-1 text-center text-xs text-slate-500 border-l border-white/5"
                                style={{ minWidth: '40px' }}
                            >
                                {day.getDate()}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Task rows */}
                <div className="space-y-2">
                    {ganttTasks.map(task => {
                        const prio = priorityDef(task.priority);
                        const style = getTaskStyle(task);

                        return (
                            <div
                                key={task.id}
                                className="flex items-center group cursor-pointer hover:bg-white/5 rounded-lg p-2 transition-colors"
                                onClick={() => onEditTask(task)}
                            >
                                <div className="w-64 shrink-0 flex items-center gap-2">
                                    <div
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: prio.color }}
                                    />
                                    <span className="text-sm font-medium text-slate-200 truncate">
                                        {task.title}
                                    </span>
                                    {task.dependencies.length > 0 && (
                                        <div title={`Blocked by ${task.dependencies.length} task(s)`}>
                                            <Lock size={12} className="text-red-400" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 relative h-8">
                                    <div
                                        className="absolute top-1/2 -translate-y-1/2 h-6 rounded-lg flex items-center justify-center text-xs font-medium text-white shadow-lg transition-all group-hover:scale-105"
                                        style={{
                                            backgroundColor: prio.color,
                                            ...style,
                                        }}
                                    >
                                        {task.jobId}
                                    </div>
                                    {/* Dependency arrows */}
                                    {task.dependencies.map(dep => {
                                        const depTask = ganttTasks.find(t => t.id === dep.id);
                                        if (!depTask) return null;
                                        const depStyle = getTaskStyle(depTask);
                                        return (
                                            <div
                                                key={dep.id}
                                                className="absolute top-0 left-0 w-0.5 bg-red-400 opacity-50"
                                                style={{
                                                    left: `${parseFloat(depStyle.left as string) + parseFloat(depStyle.width as string)}px`,
                                                    width: `${parseFloat(style.left as string) - parseFloat(depStyle.left as string) - parseFloat(depStyle.width as string)}px`,
                                                    height: '2px',
                                                    top: '50%',
                                                }}
                                            >
                                                <ArrowRight size={8} className="absolute right-0 top-1/2 -translate-y-1/2 text-red-400" />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {ganttTasks.length === 0 && (
                    <div className="text-center py-12 text-slate-500">
                        <Calendar size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No tasks with due dates or time estimates</p>
                        <p className="text-sm mt-2">Add due dates or time estimates to see tasks in Gantt view</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GanttView;
