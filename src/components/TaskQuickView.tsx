import React from 'react';
import { Calendar, User, CheckSquare, Paperclip, Clock, X, ExternalLink } from 'lucide-react';
import { Task, PriorityDefinition } from '../../types';
import { formatMinutes } from '../hooks/useTimer';

interface TaskQuickViewProps {
    task: Task;
    priorities: PriorityDefinition[];
    position: { x: number; y: number };
    onClose: () => void;
    onOpenFull: (task: Task) => void;
}

export const TaskQuickView: React.FC<TaskQuickViewProps> = ({
    task,
    priorities,
    position,
    onClose,
    onOpenFull,
}) => {
    const priorityDef = priorities.find(p => p.id === task.priority) || { label: 'Unknown', color: '#64748b' };
    const completedSubtasks = task.subtasks?.filter(s => s.completed).length || 0;
    const totalSubtasks = task.subtasks?.length || 0;
    const progress = totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0;

    // Position the panel to avoid going off-screen
    const style: React.CSSProperties = {
        position: 'fixed',
        left: Math.min(position.x, window.innerWidth - 320),
        top: Math.min(position.y, window.innerHeight - 300),
        zIndex: 60,
    };

    return (
        <>
            {/* Invisible backdrop to close on click outside */}
            <div
                className="fixed inset-0 z-50"
                onClick={onClose}
            />

            <div
                style={style}
                className="w-[300px] bg-[#0a0505]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in zoom-in-95 fade-in duration-100 z-50"
            >
                {/* Header */}
                <div className="p-3 border-b border-white/5 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span
                                className="px-2 py-0.5 rounded text-[10px] font-bold uppercase"
                                style={{
                                    backgroundColor: `${priorityDef.color}20`,
                                    color: priorityDef.color,
                                }}
                            >
                                {priorityDef.label}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">{task.jobId}</span>
                        </div>
                        <h4 className="font-bold text-white text-sm leading-tight truncate">{task.title}</h4>
                        {task.subtitle && (
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{task.subtitle}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 text-slate-500 hover:text-white hover:bg-white/10 rounded transition-colors shrink-0"
                    >
                        <X size={14} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-3 space-y-3">
                    {/* Summary */}
                    {task.summary && (
                        <p className="text-xs text-slate-400 line-clamp-2">{task.summary}</p>
                    )}

                    {/* Meta Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        {/* Assignee */}
                        <div className="flex items-center gap-1.5 text-slate-400">
                            <User size={12} />
                            <span>{task.assignee || 'Unassigned'}</span>
                        </div>

                        {/* Due Date */}
                        {task.dueDate && (
                            <div className="flex items-center gap-1.5 text-slate-400">
                                <Calendar size={12} />
                                <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                            </div>
                        )}

                        {/* Time */}
                        {(task.timeEstimate > 0 || task.timeSpent > 0) && (
                            <div className="flex items-center gap-1.5 text-slate-400">
                                <Clock size={12} />
                                <span>
                                    {task.timeSpent > 0 ? formatMinutes(task.timeSpent) : '0m'}
                                    {task.timeEstimate > 0 && ` / ${formatMinutes(task.timeEstimate)}`}
                                </span>
                            </div>
                        )}

                        {/* Attachments */}
                        {task.attachments?.length > 0 && (
                            <div className="flex items-center gap-1.5 text-slate-400">
                                <Paperclip size={12} />
                                <span>{task.attachments.length} files</span>
                            </div>
                        )}
                    </div>

                    {/* Subtasks Progress */}
                    {totalSubtasks > 0 && (
                        <div>
                            <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                                <span className="flex items-center gap-1">
                                    <CheckSquare size={10} />
                                    Subtasks
                                </span>
                                <span>{completedSubtasks}/{totalSubtasks}</span>
                            </div>
                            <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${progress === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                                        }`}
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Tags */}
                    {task.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                            {task.tags.map((tag, i) => (
                                <span
                                    key={i}
                                    className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-slate-400"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-2 border-t border-white/5">
                    <button
                        onClick={() => onOpenFull(task)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <ExternalLink size={12} />
                        Open Full View
                    </button>
                </div>
            </div>
        </>
    );
};

export default TaskQuickView;
