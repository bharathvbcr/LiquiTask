import React, { useState, memo, Suspense, lazy } from 'react';
import { Calendar, CheckCircle, GripVertical, Pencil, Trash2, CheckSquare, Paperclip, Lock, Info, Copy, Folder, ChevronRight, FileText, ChevronDown, ChevronUp, Check, AlignLeft, Clock } from 'lucide-react';
import { Task, PriorityDefinition, Project } from '../types';
import { InlineEditable, InlineSelect, InlineDatePicker } from '../src/components/InlineEditable';
import { getDueDateStatus, getPriorityIcon, getProgressStyles } from '../src/utils/taskCardUtils';
import { useTaskCardContextMenu } from '../src/hooks/useTaskCardContextMenu';
import { getSafeExternalUrl } from '../src/utils/safeUrl';

const MarkdownRenderer = lazy(() => import('../src/components/MarkdownRenderer'));

interface TaskCardProps {
  task: Task;
  isCompletedColumn?: boolean;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onEditTask: (task: Task) => void;
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  priorities?: PriorityDefinition[];
  allTasks?: Task[];
  isCompact?: boolean;
  onCopyTask?: (message: string) => void;
  projectName?: string;
  projects?: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  isFocused?: boolean;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task, isCompletedColumn, onMoveTask, onEditTask, onUpdateTask, onDeleteTask,
  priorities = [], allTasks = [], isCompact = false, onCopyTask, projectName,
  projects = [], onMoveToWorkspace, isFocused = false
}) => {
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);

  const {
    contextMenuVisible, setContextMenuVisible, contextMenuPosition, showWorkspaceSubmenu,
    handleContextMenu, handleCopyAsJson, handleMoveToWorkspace,
    handleWorkspaceSubmenuEnter, handleWorkspaceSubmenuLeave
  } = useTaskCardContextMenu({ task, projectName, onCopyTask, onMoveToWorkspace });

  const handleSubtaskToggle = (e: React.MouseEvent, subtaskId: string) => {
    e.stopPropagation();
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map(s => s.id === subtaskId ? { ...s, completed: !s.completed } : s);
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const handleSubtaskTitleChange = (subtaskId: string, newTitle: string) => {
    if (!task.subtasks) return;
    const newSubtasks = task.subtasks.map(s => s.id === subtaskId ? { ...s, title: newTitle } : s);
    onUpdateTask({ ...task, subtasks: newSubtasks });
  };

  const dueInfo = getDueDateStatus(task.dueDate);
  const subtasks = task.subtasks || [];
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const progress = subtasks.length > 0 ? (completedSubtasks / subtasks.length) * 100 : 0;
  const priorityDef = priorities.find(p => p.id === task.priority) || { label: 'Unknown', color: '#64748b', icon: undefined };

  const blockingTasks = task.links?.filter(l => l.type === 'blocked-by').map(l => allTasks.find(t => t.id === l.targetTaskId))
    .filter(t => t && t.status !== 'Completed' && t.status !== 'Delivered') as Task[] || [];

  const isBlocked = blockingTasks.length > 0;
  const blockerIds = blockingTasks.map(t => t.jobId).join(', ');

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        className={`
          liquid-card group relative w-full rounded-2xl ${isCompact ? 'p-3.5' : 'p-5'} cursor-grab active:cursor-grabbing
          transition-all duration-300 border border-white/10 hover:border-white/20
          ${isBlocked ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : ''}
          ${isFocused ? 'ring-2 ring-red-500/70 shadow-[0_0_20px_rgba(239,68,68,0.4)] scale-[1.02]' : ''}
          hover:shadow-lg hover:scale-[1.01]
        `}
      >
        {/* Header */}
        <div className={`flex justify-between items-center ${isCompact ? 'mb-2' : 'mb-3'}`}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-transparent" style={{ backgroundColor: `${priorityDef.color}25`, color: priorityDef.color, borderColor: `${priorityDef.color}30` }}>
              {priorityDef.icon ? <span className="opacity-90">{getPriorityIcon(priorityDef.icon)}</span> : <div className="w-2 h-2 rounded-full" style={{ backgroundColor: priorityDef.color }}></div>}
              <InlineSelect value={task.priority} options={priorities.map(p => ({ id: p.id, label: p.label, color: p.color }))} onSave={(np) => onUpdateTask({ ...task, priority: np })} />
            </div>
            {isBlocked && (
              <div title={`Blocked by: ${blockerIds}`} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 text-[10px] font-bold uppercase cursor-help">
                <Lock size={10} /> Blocked
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded-lg p-0.5 border border-white/5 backdrop-blur-sm">
              <button
                onClick={() => onEditTask(task)}
                className="p-1.5 text-slate-400 hover:text-white rounded-md transition-colors"
                title="Edit task"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={() => onDeleteTask(task.id)}
                className="p-1.5 text-slate-400 hover:text-red-400 rounded-md transition-colors"
                title="Delete task"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <span className="text-[10px] font-mono text-slate-500 bg-black/30 px-2 py-0.5 rounded border border-white/5">{task.jobId}</span>
            <GripVertical size={14} className="text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Title & Subtitle */}
        <div onDoubleClick={() => onEditTask(task)} className={`cursor-pointer ${isCompact ? 'mb-1' : 'mb-3'}`}>
          <h3 className={`${isCompact ? 'text-sm' : 'text-lg'} font-bold text-slate-100 leading-tight mb-1 line-clamp-2`}>
            <InlineEditable value={task.title} onSave={(nt) => onUpdateTask({ ...task, title: nt })} placeholder="Untitled task" />
          </h3>
          {!isCompact && (
            <p className="text-xs text-slate-400 font-semibold uppercase">
              <InlineEditable value={task.subtitle} onSave={(ns) => onUpdateTask({ ...task, subtitle: ns })} placeholder="Add subtitle..." />
            </p>
          )}
        </div>

        {/* Compact Indicators */}
        {isCompact && (
          <div className="flex items-center gap-3 mt-2 text-slate-500">
            {task.assignee && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <div className="w-4 h-4 rounded-full bg-gradient-to-tr from-indigo-900 to-slate-800 flex items-center justify-center border border-white/10">
                  <span className="text-[9px] font-bold">{task.assignee.charAt(0).toUpperCase()}</span>
                </div>
              </div>
            )}
            {dueInfo && (
              <div className={`flex items-center gap-1 text-[10px] font-medium ${dueInfo.color}`}>
                <Clock size={10} />
                <span>{dueInfo.status === 'today' || dueInfo.status === 'overdue' ? dueInfo.label : ''}</span>
              </div>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {task.attachments?.length ? <span className="flex items-center gap-0.5 text-[10px]"><Paperclip size={10} />{task.attachments.length}</span> : null}
              {subtasks.length > 0 && <span className="flex items-center gap-0.5 text-[10px]"><CheckSquare size={10} />{completedSubtasks}/{subtasks.length}</span>}
            </div>
          </div>
        )}

        {/* Expanded Content */}
        {!isCompact && (
          <>
            {task.summary && (
              <div className="bg-[#050000]/40 rounded-xl p-3 border border-white/5 mb-3 max-h-32 overflow-y-auto custom-scrollbar group/markdown">
                <div className="flex items-start gap-2 h-full">
                  <AlignLeft size={14} className="text-slate-600 mt-1 shrink-0" />
                  <div className="text-sm text-slate-300 leading-relaxed font-medium w-full markdown-content">
                    <Suspense fallback={<p className="whitespace-pre-wrap">{task.summary}</p>}>
                      <MarkdownRenderer content={task.summary} />
                    </Suspense>
                  </div>
                </div>
              </div>
            )}

            {/* Custom Fields & Attachments (Simplified for brevity) */}
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(task.customFieldValues || {}).map(([key, val]) => val && (
                <div key={key} className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-[10px] text-slate-300 border border-white/5">
                  <Info size={10} className="text-slate-500" />
                  {(() => {
                    const safeUrl = typeof val === 'string' ? getSafeExternalUrl(val) : null;
                    return safeUrl
                      ? <a href={safeUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Link</a>
                      : <span>{val as string}</span>;
                  })()}
                </div>
              ))}
            </div>

            {/* Progress */}
            {subtasks.length > 0 && (
              <div className="mt-3 mb-4 group/progress" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center text-[10px] text-slate-500 mb-1.5 font-medium uppercase cursor-pointer" onClick={() => setIsSubtasksExpanded(!isSubtasksExpanded)}>
                  <div className="flex items-center gap-1.5"><CheckSquare size={12} /><span>Progress</span>{isSubtasksExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}</div>
                  <div className="flex items-center gap-2"><span>{completedSubtasks}/{subtasks.length}</span><span className={progress === 100 ? 'text-emerald-400' : ''}>{Math.round(progress)}%</span></div>
                </div>
                <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/5 p-[1px] cursor-pointer" onClick={() => setIsSubtasksExpanded(!isSubtasksExpanded)}>
                  <div className={`h-full rounded-full transition-all duration-700 ${getProgressStyles(progress)}`} style={{ width: `${progress}%` }}></div>
                </div>
                {isSubtasksExpanded && (
                  <div className="mt-3 space-y-1 pl-1">
                    {subtasks.map(s => (
                      <div key={s.id} className="flex items-center gap-2">
                        <button onClick={(e) => handleSubtaskToggle(e, s.id)} className={`w-4 h-4 rounded border flex items-center justify-center ${s.completed ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500' : 'border-slate-700 bg-black/20 text-transparent'}`}><Check size={10} /></button>
                        <input type="text" value={s.title} onChange={(e) => handleSubtaskTitleChange(s.id, e.target.value)} className={`bg-transparent border-none outline-none text-xs w-full p-0.5 rounded ${s.completed ? 'text-slate-600 line-through' : 'text-slate-300'}`} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5">
              <div className="flex items-center gap-2 text-xs">
                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-900 to-slate-800 flex items-center justify-center border border-white/10">
                  <span className="text-[10px] font-bold">{task.assignee ? task.assignee.charAt(0).toUpperCase() : 'U'}</span>
                </div>
                <InlineEditable value={task.assignee || ''} onSave={(na) => onUpdateTask({ ...task, assignee: na })} placeholder="Unassigned" />
              </div>
              <div className={`flex items-center gap-1.5 text-xs font-semibold ${dueInfo?.color || 'text-slate-400'}`}>
                <Calendar size={14} />
                <InlineDatePicker value={task.dueDate || null} onSave={(nd) => onUpdateTask({ ...task, dueDate: nd || undefined })} />
              </div>
            </div>
            {isCompletedColumn && (
              <button onClick={(e) => { e.stopPropagation(); onMoveTask(task.id, 'Delivered'); }} className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-900/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 p-2.5 rounded-xl transition-all">
                <CheckCircle size={16} /><span className="text-xs font-bold uppercase">Mark Verified & Close</span>
              </button>
            )}
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenuVisible && (
        <div
          className="fixed z-[100] bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl py-2 min-w-[200px]"
          style={{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px`, transform: 'translate(-10px, -10px)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {projects.length > 0 && onMoveToWorkspace && (
            <div className="relative" onMouseEnter={handleWorkspaceSubmenuEnter} onMouseLeave={handleWorkspaceSubmenuLeave}>
              <button className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2"><Folder size={14} className="text-red-400" /><span>Move to Workspace</span></div>
                <ChevronRight size={14} className="text-slate-500" />
              </button>
              {showWorkspaceSubmenu && (
                <div className="absolute left-full top-0 ml-1 bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl py-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  {projects.filter(p => p.id !== task.projectId).map(p => (
                    <button key={p.id} onClick={() => handleMoveToWorkspace(p.id)} className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2"><Folder size={14} className="text-red-400" /><span className="truncate">{p.name}</span></button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={handleCopyAsJson} className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2"><Copy size={14} className="text-red-400" /><span>Copy as JSON</span></button>
          <button onClick={async () => {
              const { templateService } = await import('../src/services/templateService');
              templateService.saveAsTemplate(task, `Template: ${task.title}`);
              onCopyTask?.('Task saved as template');
              setContextMenuVisible(false);
          }} className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2"><FileText size={14} className="text-red-400" /><span>Save as Template</span></button>
        </div>
      )}
    </>
  );
};

export const MemoizedTaskCard = memo(TaskCard, (prev, next) => {
  return prev.task.id === next.task.id && prev.task.updatedAt === next.task.updatedAt && prev.isFocused === next.isFocused && prev.isCompact === next.isCompact;
});

