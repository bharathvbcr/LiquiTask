import React, { useState, memo, useEffect, useRef } from 'react';
import { Calendar, CheckCircle, AlertTriangle, GripVertical, Pencil, Trash2, Flag, CheckSquare, Paperclip, Link as LinkIcon, Flame, ArrowDown, ArrowUp, Minus, Star, Zap, Shield, AlertCircle, Clock, ChevronDown, ChevronUp, Check, AlignLeft, Lock, ArrowRightLeft, ExternalLink, Info, Copy, Folder, ChevronRight, FileText } from 'lucide-react';
import { Task, PriorityDefinition, Project } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { taskToJson } from '../src/utils/taskToJson';
import { InlineEditable, InlineSelect, InlineDatePicker } from '../src/components/InlineEditable';
import { templateService } from '../src/services/templateService';
import storageService from '../src/services/storageService';

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
  onCopyTask?: (message: string) => void; // Optional callback for showing toast/notification
  projectName?: string; // Optional project name for JSON export
  projects?: Project[]; // Available workspaces/projects
  onMoveToWorkspace?: (taskId: string, projectId: string) => void; // Callback to move task to workspace
  isFocused?: boolean; // Keyboard navigation focus state
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

export const TaskCard: React.FC<TaskCardProps> = ({ task, isCompletedColumn, onMoveTask, onEditTask, onUpdateTask, onDeleteTask, priorities = [], allTasks = [], isCompact = false, onCopyTask, projectName, projects = [], onMoveToWorkspace, isFocused = false }) => {
  const [isSubtasksExpanded, setIsSubtasksExpanded] = useState(false);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showWorkspaceSubmenu, setShowWorkspaceSubmenu] = useState(false);
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleDeliver = (e: React.MouseEvent) => {
    e.stopPropagation();
    onMoveTask(task.id, 'Delivered');
  };

  // Native drag handlers removed - @dnd-kit handles dragging via SortableTask wrapper

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Calculate position with bounds checking to prevent off-screen menu
    const menuWidth = 200;
    const menuHeight = 50;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenuPosition({ x, y });
    setContextMenuVisible(true);
  };

  const handleCopyAsJson = async () => {
    try {
      const jsonString = taskToJson(task, projectName);
      await navigator.clipboard.writeText(jsonString);
      setContextMenuVisible(false);
      if (onCopyTask) {
        onCopyTask('Task details copied to clipboard as JSON');
      }
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      if (onCopyTask) {
        onCopyTask('Failed to copy task details');
      }
    }
  };

  const handleMoveToWorkspace = (projectId: string) => {
    if (onMoveToWorkspace) {
      onMoveToWorkspace(task.id, projectId);
      setContextMenuVisible(false);
      setShowWorkspaceSubmenu(false);
    }
  };

  const handleWorkspaceSubmenuEnter = () => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
    }
    setShowWorkspaceSubmenu(true);
  };

  const handleWorkspaceSubmenuLeave = () => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowWorkspaceSubmenu(false);
    }, 150);
  };

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuVisible(false);
      setShowWorkspaceSubmenu(false);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenuVisible(false);
        setShowWorkspaceSubmenu(false);
      }
    };

    if (contextMenuVisible) {
      document.addEventListener('click', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('click', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [contextMenuVisible]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (submenuTimeoutRef.current) {
        clearTimeout(submenuTimeoutRef.current);
      }
    };
  }, []);

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
    <>
      <div
        onContextMenu={handleContextMenu}
        className={`
          liquid-card group relative w-full rounded-2xl ${isCompact ? 'p-3.5' : 'p-5'} cursor-grab active:cursor-grabbing
          transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]
          border border-white/10 hover:border-white/20
          ${isBlocked ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]' : ''}
          ${dueInfo?.status === 'overdue' && !isBlocked ? 'border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.15)]' : ''}
          ${isFocused ? 'ring-2 ring-red-500/70 shadow-[0_0_20px_rgba(239,68,68,0.4)] scale-[1.02]' : ''}
          hover:shadow-lg hover:scale-[1.01]
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
              <InlineSelect
                value={task.priority}
                options={priorities.map(p => ({
                  id: p.id,
                  label: p.label,
                  color: p.color,
                }))}
                onSave={(newPriority) => onUpdateTask({ ...task, priority: newPriority })}
                className="inline-block"
              />
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
          <h3 className={`${isCompact ? 'text-sm' : 'text-lg'} font-bold text-slate-100 leading-tight mb-1 drop-shadow-sm line-clamp-2`}>
            <InlineEditable
              value={task.title}
              onSave={(newTitle) => onUpdateTask({ ...task, title: newTitle })}
              className="inline-block"
              placeholder="Untitled task"
            />
          </h3>
          {!isCompact && (
            <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase">
              <InlineEditable
                value={task.subtitle}
                onSave={(newSubtitle) => onUpdateTask({ ...task, subtitle: newSubtitle })}
                className="inline-block"
                placeholder="Add subtitle..."
              />
            </p>
          )}
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => (<a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />) }}>{task.summary}</ReactMarkdown>
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
                  <React.Fragment key={att.id}>
                    {(() => {
                      const isSafe = !att.url.trim().toLowerCase().startsWith('javascript:');
                      return (
                        <a
                          href={isSafe ? att.url : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isSafe) e.preventDefault();
                          }}
                          className={`group/att flex items-center gap-2 px-2.5 py-1.5 bg-black/40 hover:bg-white/5 border border-white/10 hover:border-white/20 rounded-lg text-[10px] font-medium transition-all duration-200 hover:scale-105 hover:shadow-sm ${isSafe ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 cursor-not-allowed decoration-slate-500/30'}`}
                          title={isSafe ? att.name : 'Unsafe URL blocked'}
                        >
                          {att.type === 'file' ? <Paperclip size={11} className="text-slate-500 group-hover/att:text-red-400 transition-colors" /> : <LinkIcon size={11} className="text-slate-500 group-hover/att:text-blue-400 transition-colors" />}
                          <span className="truncate max-w-[120px] decoration-slate-600/50 group-hover/att:underline">{att.name}</span>
                        </a>
                      );
                    })()}
                  </React.Fragment>
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
                        <button
                          onClick={(e) => handleSubtaskToggle(e, subtask.id)}
                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${subtask.completed ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500' : 'border-slate-700 hover:border-slate-500 bg-black/20 text-transparent'}`}
                          aria-label={subtask.completed ? 'Mark subtask incomplete' : 'Mark subtask complete'}
                          title={subtask.completed ? 'Mark incomplete' : 'Mark complete'}
                        >
                          <Check size={10} strokeWidth={3} />
                        </button>
                        <input
                          type="text"
                          value={subtask.title}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => handleSubtaskTitleChange(subtask.id, e.target.value)}
                          className={`bg-transparent border-none outline-none text-xs w-full transition-colors p-0.5 rounded hover:bg-white/5 focus:bg-white/5 ${subtask.completed ? 'text-slate-600 line-through decoration-slate-700' : 'text-slate-300 focus:text-white'}`}
                          aria-label="Subtask title"
                          placeholder="Subtask title"
                        />
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
                <InlineEditable
                  value={task.assignee || ''}
                  onSave={(newAssignee) => onUpdateTask({ ...task, assignee: newAssignee })}
                  className="font-medium text-slate-300"
                  placeholder="Unassigned"
                />
              </div>

              <div className={`flex items-center gap-1.5 text-xs font-semibold ${dueInfo?.color || 'text-slate-400'}`}>
                <Calendar size={14} />
                <InlineDatePicker
                  value={task.dueDate || null}
                  onSave={(newDate) => onUpdateTask({ ...task, dueDate: newDate || undefined })}
                />
              </div>
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

      {/* Context Menu */}
      {contextMenuVisible && (
        <div
          className="fixed z-[100] bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl backdrop-blur-md min-w-[200px] py-2"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
            transform: 'translate(-10px, -10px)'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {projects.length > 0 && onMoveToWorkspace && (
            <div
              className="relative"
              onMouseEnter={handleWorkspaceSubmenuEnter}
              onMouseLeave={handleWorkspaceSubmenuLeave}
            >
              <button
                className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 hover:text-white transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Folder size={14} className="text-red-400" />
                  <span>Move to Workspace</span>
                </div>
                <ChevronRight size={14} className="text-slate-500" />
              </button>

              {/* Workspace Submenu */}
              {showWorkspaceSubmenu && (
                <div
                  className="absolute left-full top-0 ml-1 bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl backdrop-blur-md min-w-[200px] py-2 max-h-[300px] overflow-y-auto z-[101]"
                  style={{
                    // Adjust position if submenu would go off-screen
                    left: contextMenuPosition.x + 200 + 10 > window.innerWidth ? 'auto' : '100%',
                    right: contextMenuPosition.x + 200 + 10 > window.innerWidth ? '100%' : 'auto',
                  }}
                  onMouseEnter={handleWorkspaceSubmenuEnter}
                  onMouseLeave={handleWorkspaceSubmenuLeave}
                >
                  {projects
                    .filter(p => p.id !== task.projectId)
                    .map(project => (
                      <button
                        key={project.id}
                        onClick={() => handleMoveToWorkspace(project.id)}
                        className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <Folder size={14} className="text-red-400" />
                        <span className="truncate">{project.name}</span>
                      </button>
                    ))}
                  {projects.filter(p => p.id !== task.projectId).length === 0 && (
                    <div className="px-4 py-2.5 text-sm text-slate-500">
                      No other workspaces
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleCopyAsJson}
            className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 hover:text-white transition-colors flex items-center gap-2"
          >
            <Copy size={14} className="text-red-400" />
            <span>Copy as JSON</span>
          </button>
          <button
            onClick={() => {
              templateService.saveAsTemplate(task, `Template: ${task.title}`);
              storageService.set('liquitask-templates', templateService.getAllTemplates());
              setContextMenuVisible(false);
              if (onCopyTask) {
                onCopyTask('Task saved as template');
              }
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 hover:text-white transition-colors flex items-center gap-2"
          >
            <FileText size={14} className="text-red-400" />
            <span>Save as Template</span>
          </button>
        </div>
      )}
    </>
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
    prevTask.projectId === nextTask.projectId &&
    prevTask.subtasks?.length === nextTask.subtasks?.length &&
    prevTask.subtasks?.filter(s => s.completed).length ===
    nextTask.subtasks?.filter(s => s.completed).length &&
    prevTask.attachments?.length === nextTask.attachments?.length &&
    prevTask.links?.length === nextTask.links?.length &&
    prevTask.tags?.length === nextTask.tags?.length &&
    prevTask.timeSpent === nextTask.timeSpent &&
    prevProps.isCompletedColumn === nextProps.isCompletedColumn &&
    prevProps.priorities === nextProps.priorities &&
    prevProps.projects === nextProps.projects
  );
});