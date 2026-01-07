import React from 'react';
import { TaskCard } from '../../components/TaskCard';
import { Task, BoardColumn, PriorityDefinition } from '../../types';
import { AlertOctagon } from 'lucide-react';

interface ProjectBoardProps {
    columns: BoardColumn[];
    priorities: PriorityDefinition[];
    tasks: Task[];
    allTasks: Task[];
    boardGrouping: 'none' | 'priority';
    dragOverInfo: { colId: string; rowId?: string } | null;
    onDragOver: (e: React.DragEvent, colId: string, rowId?: string) => void;
    onDrop: (e: React.DragEvent, statusId: string, priorityId?: string) => void;
    onDragEnter: (colId: string, rowId?: string) => void;
    onColumnDragStart: (e: React.DragEvent, colId: string) => void;
    onColumnDrop: (e: React.DragEvent, targetColId: string) => void;
    onMoveTask: (taskId: string, newStatus: string, newPriority?: string) => void;
    onEditTask: (task: Task) => void;
    onUpdateTask: (task: Task) => void;
    onDeleteTask: (taskId: string) => void;
    getTasksByContext: (statusId: string, priorityId?: string) => Task[];
}

export const ProjectBoard: React.FC<ProjectBoardProps> = ({
    columns,
    priorities,
    boardGrouping,
    dragOverInfo,
    allTasks,
    onDragOver,
    onDrop,
    onDragEnter,
    onColumnDragStart,
    onColumnDrop,
    onMoveTask,
    onEditTask,
    onUpdateTask,
    onDeleteTask,
    getTasksByContext,
}) => {
    if (boardGrouping === 'priority') {
        return (
            <div
                className="flex flex-col gap-8"
                role="region"
                aria-label="Kanban board grouped by priority"
            >
                <div className="flex gap-6 sticky top-0 z-20 pb-2 bg-[#020000]/80 backdrop-blur-md -mx-6 px-6 pt-2">
                    {columns.map((col) => (
                        <div key={col.id} className="flex-1 min-w-[300px] flex items-center justify-between px-2">
                            <h3 className="font-bold text-slate-300 text-xs tracking-wide uppercase">{col.title}</h3>
                        </div>
                    ))}
                </div>

                {priorities.map((prio) => (
                    <div
                        key={prio.id}
                        className="rounded-3xl border border-white/5 bg-white/[0.02] p-4"
                        role="region"
                        aria-label={`${prio.label} priority tasks`}
                    >
                        <div className="flex items-center gap-3 mb-4 px-2">
                            <div className="h-px w-8 bg-current opacity-50" style={{ color: prio.color }}></div>
                            <span className="text-sm font-bold uppercase tracking-widest" style={{ color: prio.color }}>{prio.label}</span>
                            <div className="h-px flex-1 bg-current opacity-20" style={{ color: prio.color }}></div>
                        </div>
                        <div className="flex gap-6">
                            {columns.map((column) => {
                                const columnTasks = getTasksByContext(column.id, prio.id);
                                const isDragOver = dragOverInfo?.colId === column.id && dragOverInfo?.rowId === prio.id;
                                return (
                                    <div
                                        key={`${prio.id}-${column.id}`}
                                        className={`flex-1 min-w-[300px] rounded-2xl transition-all duration-300 ${isDragOver ? 'bg-white/5 ring-1 ring-white/20' : ''}`}
                                        onDragOver={(e) => onDragOver(e, column.id, prio.id)}
                                        onDrop={(e) => onDrop(e, column.id, prio.id)}
                                        onDragEnter={() => onDragEnter(column.id, prio.id)}
                                    >
                                        <div className="flex flex-col gap-4 min-h-[120px] p-2">
                                            {columnTasks.map(task => (
                                                <TaskCard
                                                    key={task.id}
                                                    task={task}
                                                    priorities={priorities}
                                                    isCompletedColumn={column.isCompleted}
                                                    onMoveTask={onMoveTask}
                                                    onEditTask={onEditTask}
                                                    onUpdateTask={onUpdateTask}
                                                    onDeleteTask={onDeleteTask}
                                                    allTasks={allTasks}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // Default: No grouping
    return (
        <div
            className="flex gap-6 h-full"
            role="region"
            aria-label="Kanban board"
        >
            {columns.map((column) => {
                const columnTasks = getTasksByContext(column.id);
                const isDragOver = dragOverInfo?.colId === column.id && !dragOverInfo?.rowId;
                const accentColor = column.color.startsWith('#') ? column.color : '#64748b';

                // WIP Limit Logic
                const wipLimit = column.wipLimit || 0;
                const isOverLimit = wipLimit > 0 && columnTasks.length > wipLimit;

                return (
                    <div
                        key={column.id}
                        className="flex-1 flex flex-col min-w-[300px]"
                        draggable
                        onDragStart={(e) => onColumnDragStart(e, column.id)}
                        onDrop={(e) => onColumnDrop(e, column.id)}
                        onDragOver={(e) => e.preventDefault()}
                        role="region"
                        aria-label={`${column.title} column with ${columnTasks.length} tasks`}
                    >
                        <div className="flex items-center justify-between mb-4 px-4 cursor-grab active:cursor-grabbing group/colheader">
                            <div className="flex items-center gap-3">
                                <h3
                                    className={`font-bold text-sm tracking-wide uppercase text-shadow-sm transition-colors ${isOverLimit ? 'text-red-400' : 'text-slate-200'}`}
                                    id={`column-${column.id}`}
                                >
                                    {column.title}
                                </h3>
                                <span
                                    className={`text-xs px-2 py-0.5 rounded border ${isOverLimit ? 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse' : 'bg-white/5 text-slate-400 border-white/5'}`}
                                    aria-label={`${columnTasks.length} tasks${wipLimit > 0 ? ` of ${wipLimit} limit` : ''}`}
                                >
                                    {columnTasks.length} {wipLimit > 0 && `/ ${wipLimit}`}
                                </span>
                                {isOverLimit && (
                                    <AlertOctagon
                                        size={16}
                                        className="text-red-500 animate-pulse"
                                        aria-label="Work in progress limit exceeded"
                                    />
                                )}
                            </div>
                            <div
                                className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
                                style={{ backgroundColor: isOverLimit ? '#ef4444' : accentColor, color: isOverLimit ? '#ef4444' : accentColor }}
                                aria-hidden="true"
                            ></div>
                        </div>

                        <div
                            className={`flex-1 rounded-3xl p-3 flex flex-col gap-4 transition-all duration-500 
                ${isDragOver ? 'bg-white/5 border-white/10 shadow-[inset_0_0_30px_rgba(255,255,255,0.05)]' : 'bg-transparent border border-transparent'}
                ${isOverLimit ? 'bg-red-900/10 border-red-500/20' : ''}
              `}
                            onDragOver={(e) => onDragOver(e, column.id)}
                            onDrop={(e) => onDrop(e, column.id)}
                            onDragEnter={() => onDragEnter(column.id)}
                        >
                            <div className="h-full rounded-2xl bg-[#0a0a0a]/50 backdrop-blur-md border border-white/10 p-4 flex flex-col gap-4 shadow-[inset_0_2px_10px_rgba(0,0,0,0.5)] min-h-[300px]">
                                {columnTasks.map(task => (
                                    <TaskCard
                                        key={task.id}
                                        task={task}
                                        priorities={priorities}
                                        isCompletedColumn={column.isCompleted}
                                        onMoveTask={onMoveTask}
                                        onEditTask={onEditTask}
                                        onUpdateTask={onUpdateTask}
                                        onDeleteTask={onDeleteTask}
                                        allTasks={allTasks}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default ProjectBoard;
