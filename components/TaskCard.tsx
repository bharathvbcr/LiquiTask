import React, { useState, memo } from 'react';
import { Calendar, CheckCircle, AlertTriangle, GripVertical, Pencil, Trash2, Flag, CheckSquare, Paperclip, Link as LinkIcon, Flame, ArrowDown, ArrowUp, Minus, Star, Zap, Shield, AlertCircle, Clock, ChevronDown, ChevronUp, Check, AlignLeft, Lock, ArrowRightLeft, ExternalLink, Info } from 'lucide-react';
import { Task, PriorityDefinition } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TaskCardProps {
  task: Task;
  isCompletedColumn?: boolean;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  priorities?: PriorityDefinition[];
  allTasks?: Task[]; // To resolve link names
  isCompact?: boolean;
}

const getDueDateStatus = (dueDate?: Date) => {
  if (!dueDate) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { status: 'overdue', label: `${Math.abs(diffDays)}d overdue`, color: 'text-red-400 font-bold' };
  if (diffDays === 0) return { status: 'today', label: 'Due Today', color: 'text-amber-400 font-bold' };
  if (diffDays === 1) return { status: 'tomorrow', label: 'Due Tomorrow', color: 'text-blue-300' };

  return {
    status: 'future',
    label: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(due),
    color: 'text-slate-400'
  };
};

const getPriorityIcon = (iconName?: string, size = 12) => {
  switch (iconName) {
    case 'alert-circle': return <AlertCircle size={size} />;
    case 'clock': return <Clock size={size} />;
    case 'arrow-down': return <ArrowDown size={size} />;
    case 'arrow-up': return <ArrowUp size={size} />;
    case 'zap': return <Zap size={size} />;
    case 'star': return <Star size={size} />;
    case 'shield': return <Shield size={size} />;
    case 'flame': return <Flame size={size} />;
    case 'alert-triangle': return <AlertTriangle size={size} />;
    case 'flag': return <Flag size={size} />;
    case 'minus': return <Minus size={size} />;
    default: return null;
  }
}

export const TaskCard: React.FC<TaskCardProps> = ({ task, isCompletedColumn, onMoveTask, onEditTask, onUpdateTask, onDeleteTask, priorities = [], allTasks = [], isCompact = false }) => {
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleDeliver = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMoveTask(task.id, 'Delivered');
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.stopPropagation(); // Essential to prevent bubbling to column drag
    e.dataTransfer.setData('taskId', task.id);
    e.dataTransfer.effectAllowed = 'move';
    // Delay setting isDragging to allow the browser to generate the drag image from the non-transparent element
    setTimeout(() => setIsDragging(true), 0);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleSubtaskToggle = (e: React.MouseEvent, subtaskId: string) => {
    e.stopPropagation();
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map(s =>
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const handleSubtaskTitleChange = (subtaskId: string, newTitle: string) => {
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map(s =>
      s.id === subtaskId ? { ...s, title: newTitle } : s
    );
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const dueInfo = getDueDateStatus(task.dueDate);
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const progress = subtasks.length > 0 ? (completedSubtasks / subtasks.length) * 100 : 0;
  const attachments = task.attachments || [];
  const priorityDef = priorities.find(p => p.id === task.priority) || { label: 'Unknown', color: '#64748b', icon: undefined };

  // Identify Blocking Tasks
  const blockingTasks = task.links?.filter(l => l.type === 'blocked-by').map(l => {
    return allTasks.find(t => t.id === l.targetTaskId);
  }).filter(t => t && t.status !== 'Completed' && t.status !== 'Delivered') as Task[] || [];

  const isBlocked = blockingTasks.length > 0;
  const blockerIds = blockingTasks.map(t => t.jobId).join(', ');

  const getProgressStyles = (percent: number) => {
    if (percent === 100) return 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.5)]';
    if (percent >= 66) return 'bg-gradient-to-r from-blue-500 to-cyan-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]';
    if (percent >= 33) return 'bg-gradient-to-r from-amber-500 to-orange-400 shadow-[0_0_12px_rgba(245,158,11,0.5)]';
    return 'bg-gradient-to-r from-red-500 to-pink-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]';
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`
        liquid-card group relative w-full rounded-2xl ${isCompact ? 'p-3' : 'p-5'} cursor-grab active:cursor-grabbing
        transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]
        ${isDragging ? 'opacity-40 scale-95 border-2 border-dashed border-slate-500/50 grayscale rotate-1 shadow-none' : ''}
        ${!isDragging && isBlocked ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : ''}
        ${!isDragging && dueInfo?.status === 'overdue' && !isBlocked ? 'border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.15)]' : ''}
      `}
    >

      {/* Top Row: Priority & ID */}
      <div className={`flex justify-between items-center ${isCompact ? 'mb-2' : 'mb-3'}`}>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-transparent shadow-sm transition-all"
            style={{
              backgroundColor: `${priorityDef.color}25`,
              color: priorityDef.color,
              borderColor: `${priorityDef.color}30`
            }}
          >
            {priorityDef.icon ? <span className="opacity-90">{getPriorityIcon(priorityDef.icon)}</span> : <div className="w-2 h-2 rounded-full" style={{ backgroundColor: priorityDef.color }}></div>}
            <span className="text-[11px] font-bold uppercase tracking-wider">{priorityDef.label}</span>
          </div>
          {isBlocked && (
            <div
              title={`Blocked by: ${blockerIds}`}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 text-[10px] font-bold uppercase tracking-wide cursor-help hover:bg-red-600/30 transition-colors"
            >
              <Lock size={10} /> Blocked
            </div>
          )}
        </div>

        {/* Actions (Visible on Hover) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 mr-2 bg-black/40 rounded-lg p-0.5 border border-white/5 backdrop-blur-sm">
            <button onClick={() => onEditTask(task)} className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors" title="Edit"><Pencil size={12} /></button>
            <button onClick={() => onDeleteTask(task.id)} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors" title="Delete"><Trash2 size={12} /></button>
          </div>
          <span className="text-[10px] font-mono text-slate-500 tracking-wider bg-black/30 px-2 py-0.5 rounded border border-white/5">{task.jobId}</span>
          <GripVertical size={14} className="text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {/* Main Content */}
      <div onDoubleClick={() => onEditTask(task)} className={`cursor-pointer ${isCompact ? 'mb-1' : 'mb-3'}`}>
        <h3 className={`${isCompact ? 'text-sm' : 'text-lg'} font-bold text-slate-100 leading-tight mb-1 drop-shadow-sm line-clamp-2`}>{task.title}</h3>
        {!isCompact && <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase">{task.subtitle}</p>}
      </div>

      {/* Compact Content Indicators */}
      {isCompact && (
        <div className="flex items-center gap-3 mt-2 text-slate-500">
          {task.assignee && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400" title={`Assigned to ${task.assignee}`}>
              <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-900 to-slate-800 flex items-center justify-center border border-white/10">
                <span className="text-[9px] font-bold text-indigo-300">{task.assignee.charAt(0).toUpperCase()}</span>
              </div>
            </div>
          )}

          {dueInfo && (
            <div className={`flex items-center gap-1 text-[10px] font-medium ${dueInfo.color}`} title={dueInfo.label}>
              <Clock size={10} />
              <span>{dueInfo.status === 'today' || dueInfo.status === 'overdue' ? dueInfo.label : ''}</span>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {attachments.length > 0 && <span className="flex items-center gap-0.5 text-[10px]"><Paperclip size={10} />{attachments.length}</span>}
            {subtasks.length > 0 && <span className="flex items-center gap-0.5 text-[10px]"><CheckSquare size={10} />{completedSubtasks}/{subtasks.length}</span>}
          </div>
        </div>
      )}

      {/* Expanded Content (Hidden in Compact Mode) */}
      {!isCompact && (
        <>
          {/* Summary Box (Markdown) */}
          {task.summary && (
            <div className="bg-[#050000]/40 rounded-xl p-3 border border-white/5 shadow-inner mb-3 max-h-32 overflow-y-auto custom-scrollbar group/markdown">
              <div className="flex items-start gap-2 h-full">
                <AlignLeft size={14} className="text-slate-600 mt-1 shrink-0 group-hover/markdown:text-slate-500 transition-colors" />
                <div className="text-sm text-slate-300 leading-relaxed font-medium w-full markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ _node, ...props }) => (<a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />) }}>{task.summary}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Custom Fields Display */}
          {task.customFieldValues && Object.keys(task.customFieldValues).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(task.customFieldValues).map(([key, value]) => {
                if (!value) return null;
                const isUrl = String(value).startsWith('http');
                return (
                  <div key={key} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-[10px] text-slate-300 border border-white/5 max-w-full truncate">
                    <Info size={10} className="text-slate-500" />
                    {isUrl ? (
                      <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        Link <ExternalLink size={8} />
                      </a>
                    ) : (
                      <span>{value}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Attachments Row */}
          {attachments.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2 pt-2 border-t border-white/5">
              {attachments.map(att => (
                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="group/att flex items-center gap-2 px-2.5 py-1.5 bg-black/40 hover:bg-white/5 border border-white/10 hover:border-white/20 rounded-lg text-[10px] font-medium text-slate-400 hover:text-slate-200 transition-all duration-200 hover:scale-105 hover:shadow-sm" title={att.name}>
                  {att.type === 'file' ? <Paperclip size={11} className="text-slate-500 group-hover/att:text-red-400 transition-colors" /> : <LinkIcon size={11} className="text-slate-500 group-hover/att:text-blue-400 transition-colors" />}
                  <span className="truncate max-w-[120px] decoration-slate-600/50 group-hover/att:underline">{att.name}</span>
                </a>
              ))}
            </div>
          )}

          {/* Links Footer */}
          {task.links && task.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {task.links.map((link, i) => {
                const target = allTasks.find(t => t.id === link.targetTaskId);
                if (!target) return null;
                return (
                  <div key={i} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${link.type === 'blocked-by' ? 'bg-red-900/20 border-red-500/20 text-red-300' : 'bg-blue-900/20 border-blue-500/20 text-blue-300'}`}>
                    {link.type === 'blocked-by' ? <Lock size={8} /> : link.type === 'blocks' ? <Shield size={8} /> : <ArrowRightLeft size={8} />}
                    <span className="font-bold">{link.type === 'blocked-by' ? 'Blocked by' : link.type === 'blocks' ? 'Blocks' : 'Links'}</span>
                    <span className="opacity-70">{target.jobId}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Subtasks Progress & Expansion */}
          {subtasks.length > 0 && (
            <div className="mt-3 mb-4 group/progress" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center text-[10px] text-slate-500 mb-1.5 font-medium uppercase tracking-wide cursor-pointer hover:text-slate-300 transition-colors" onClick={() => setIsSubtasksExpanded(!isSubtasksExpanded)}>
                <div className="flex items-center gap-1.5"><CheckSquare size={12} /><span>Progress</span>{isSubtasksExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</div>
                <div className="flex items-center gap-2"><span className="text-slate-600">{completedSubtasks}/{subtasks.length}</span><span className={`font-bold transition-colors ${progress === 100 ? 'text-emerald-400' : 'text-slate-400'}`}>{Math.round(progress)}%</span></div>
              </div>
              <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5 p-[1px] cursor-pointer" onClick={() => setIsSubtasksExpanded(!isSubtasksExpanded)}>
                <div className={`h-full rounded-full transition-all duration-700 ease-out ${getProgressStyles(progress)}`} style={{ width: `${progress}%` }}></div>
              </div>
              {isSubtasksExpanded && (
                <div className="mt-3 space-y-1 animate-in slide-in-from-top-2 duration-200 pl-1">
                  {subtasks.map(subtask => (
                    <div key={subtask.id} className="flex items-center gap-2 group/subtask">
                      <button onClick={(e) => handleSubtaskToggle(e, subtask.id)} className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${subtask.completed ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500' : 'border-slate-700 hover:border-slate-500 bg-black/20 text-transparent'}`}><Check size={10} strokeWidth={3} /></button>
                      <input type="text" value={subtask.title} onClick={(e) => e.stopPropagation()} onChange={(e) => handleSubtaskTitleChange(subtask.id, e.target.value)} className={`bg-transparent border-none outline-none text-xs w-full transition-colors p-0.5 rounded hover:bg-white/5 focus:bg-white/5 ${subtask.completed ? 'text-slate-600 line-through decoration-slate-700' : 'text-slate-300 focus:text-white'}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Footer: Assignee & Timeline */}
          <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-900 to-slate-800 flex items-center justify-center border border-white/10 shadow-sm">
                <span className="text-[10px] font-bold text-indigo-300">{task.assignee ? task.assignee.charAt(0).toUpperCase() : 'U'}</span>
              </div>
              <span className="font-medium text-slate-300">{task.assignee || 'Unassigned'}</span>
            </div>

            {dueInfo && (
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${dueInfo.color}`}>
                <Calendar size={14} />
                <span>{dueInfo.label}</span>
              </div>
            )}
          </div>

          {/* Action Button for Completed Column */}
          {isCompletedColumn && (
            <button onClick={handleDeliver} className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-900/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 hover:border-emerald-400 p-2.5 rounded-xl transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] group/btn">
              <CheckCircle size={16} className="group-hover/btn:scale-110 transition-transform" />
              <span className="text-xs font-bold uppercase tracking-wide">Mark Verified & Close</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

// Memoized version with custom comparator for performance
export const MemoizedTaskCard = memo(TaskCard, (prevProps, nextProps) => {
  // Only re-render if these specific props change
  const prevTask = prevProps.task;
  const nextTask = nextProps.task;

  return (
    prevTask.id === nextTask.id &&
    prevTask.title === nextTask.title &&
    prevTask.summary === nextTask.summary &&
    prevTask.status === nextTask.status &&
    prevTask.priority === nextTask.priority &&
    prevTask.assignee === nextTask.assignee &&
    prevTask.dueDate?.getTime() === nextTask.dueDate?.getTime() &&
    prevTask.subtasks?.length === nextTask.subtasks?.length &&
    prevTask.subtasks?.filter(s => s.completed).length ===
    nextTask.subtasks?.filter(s => s.completed).length &&
    prevTask.attachments?.length === nextTask.attachments?.length &&
    prevTask.links?.length === nextTask.links?.length &&
    prevTask.tags?.length === nextTask.tags?.length &&
    prevTask.timeSpent === nextTask.timeSpent &&
    prevProps.isCompletedColumn === nextProps.isCompletedColumn &&
    prevProps.priorities === nextProps.priorities
  );
});