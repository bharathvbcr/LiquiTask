import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { Task, PriorityDefinition, Subtask, Attachment, CustomFieldDefinition, TaskLink, BoardColumn } from '../types';
import { Layers, Calendar, User, AlignLeft, Tag, Flag, CheckSquare, Plus, X, Paperclip, Link as LinkIcon, Upload, Eye, Edit2, Link, ShieldAlert, Copy, ExternalLink, ArrowRightLeft, Lock, Trash2, Kanban, Check, Shield } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TaskFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (task: Partial<Task>) => void;
  initialData?: Task | null;
  projectId: string;
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
  availableTasks?: Task[]; // For linking
  columns?: BoardColumn[]; // For status selection
}

export const TaskFormModal: React.FC<TaskFormModalProps> = ({ 
  isOpen, 
  onClose, 
  onSubmit, 
  initialData,
  projectId,
  priorities = [],
  customFields = [],
  availableTasks = [],
  columns = []
}) => {
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    summary: '',
    assignee: '',
    priority: '',
    dueDate: '',
    status: '',
  });

  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkName, setNewLinkName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [viewMode, setViewMode] = useState<'write' | 'preview'>('write');

  // Custom Fields State
  const [customValues, setCustomValues] = useState<Record<string, string | number>>({});

  // Links State
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [newLinkTarget, setNewLinkTarget] = useState<string>('');
  const [newLinkType, setNewLinkType] = useState<string>('relates-to');

  useEffect(() => {
    // Determine default priority ID
    const defaultPrio = priorities.length > 0 ? priorities[0].id : '';
    const defaultStatus = columns.length > 0 ? columns[0].id : 'Pending';

    if (initialData) {
      let dateStr = '';
      if (initialData.dueDate) {
        const d = new Date(initialData.dueDate);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        dateStr = `${year}-${month}-${day}`;
      }

      setFormData({
        title: initialData.title,
        subtitle: initialData.subtitle,
        summary: initialData.summary,
        assignee: initialData.assignee,
        priority: initialData.priority || defaultPrio,
        dueDate: dateStr,
        status: initialData.status || defaultStatus,
      });
      setSubtasks(initialData.subtasks || []);
      setAttachments(initialData.attachments || []);
      setCustomValues(initialData.customFieldValues || {});
      setLinks(initialData.links || []);
    } else {
      setFormData({
        title: '',
        subtitle: 'General',
        summary: '',
        assignee: '',
        priority: defaultPrio,
        dueDate: '',
        status: defaultStatus,
      });
      setSubtasks([]);
      setAttachments([]);
      setCustomValues({});
      setLinks([]);
    }
  }, [initialData, isOpen, priorities, columns]);

  // Subtask Handlers
  const handleAddSubtask = () => {
    if (!newSubtask.trim()) return;
    const item: Subtask = {
      id: `st-${Date.now()}`,
      title: newSubtask,
      completed: false
    };
    setSubtasks([...subtasks, item]);
    setNewSubtask('');
  };

  const handleUpdateSubtask = (id: string, title: string) => {
    setSubtasks(subtasks.map(s => s.id === id ? { ...s, title } : s));
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks(subtasks.filter(s => s.id !== id));
  };

  const toggleSubtask = (id: string) => {
    setSubtasks(subtasks.map(s => s.id === id ? { ...s, completed: !s.completed } : s));
  };

  // Attachment Handlers
  const handleAddLink = () => {
    if (!newLinkUrl.trim()) return;
    const item: Attachment = {
      id: `att-${Date.now()}`,
      name: newLinkName.trim() || newLinkUrl,
      url: newLinkUrl,
      type: 'link'
    };
    setAttachments([...attachments, item]);
    setNewLinkUrl('');
    setNewLinkName('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const objectUrl = URL.createObjectURL(file);
      const item: Attachment = {
        id: `att-${Date.now()}`,
        name: file.name,
        url: objectUrl,
        type: 'file'
      };
      setAttachments([...attachments, item]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments(attachments.filter(a => a.id !== id));
  };

  // Task Link Handlers
  const handleAddTaskLink = () => {
      if(!newLinkTarget) return;
      if (links.some(l => l.targetTaskId === newLinkTarget)) return;

      const newLink: TaskLink = {
          targetTaskId: newLinkTarget,
          type: newLinkType as any
      };
      setLinks([...links, newLink]);
      setNewLinkTarget('');
  };

  const handleRemoveTaskLink = (targetId: string) => {
      setLinks(links.filter(l => l.targetTaskId !== targetId));
  };

  const submitTask = useCallback(() => {
    let parsedDate: Date | undefined = undefined;
    if (formData.dueDate) {
        const [y, m, d] = formData.dueDate.split('-').map(Number);
        parsedDate = new Date(y, m - 1, d);
    }

    onSubmit({
      ...initialData,
      ...formData,
      projectId,
      status: formData.status || 'Pending',
      createdAt: initialData ? initialData.createdAt : new Date(),
      dueDate: parsedDate,
      subtasks: subtasks,
      attachments: attachments,
      customFieldValues: customValues,
      links: links
    });
    onClose();
  }, [formData, initialData, projectId, subtasks, attachments, customValues, links, onSubmit, onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitTask();
  };

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        submitTask();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, submitTask]);

  const getLinkIcon = (type: string) => {
      switch (type) {
          case 'blocked-by': return <Lock size={12} />;
          case 'blocks': return <Shield size={12} />;
          case 'duplicates': return <Copy size={12} />;
          default: return <ArrowRightLeft size={12} />;
      }
  };

  return (
    <ModalWrapper 
      isOpen={isOpen} 
      onClose={onClose} 
      title={initialData ? "Edit Task" : "New Task"}
      icon={<Layers size={20} />}
      size="2xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        
        {/* Title */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Task Title</label>
          <input
            type="text"
            required
            autoFocus
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            placeholder="e.g., Update Q3 Financials"
            className="w-full liquid-input rounded-xl px-4 py-3.5 text-slate-100 placeholder-slate-500 font-medium text-lg"
          />
        </div>

        {/* Basic Meta Grid */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <Tag size={12} /> Category
            </label>
            <input type="text" value={formData.subtitle} onChange={(e) => setFormData({...formData, subtitle: e.target.value})} placeholder="e.g., Marketing" className="w-full liquid-input rounded-xl px-4 py-3 text-sm" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <Flag size={12} /> Priority
            </label>
            <div className="relative">
                <select value={formData.priority} onChange={(e) => setFormData({...formData, priority: e.target.value})} className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none cursor-pointer">
                {priorities.map(p => (
                    <option key={p.id} value={p.id} className="bg-navy-900 text-slate-200">{p.label}</option>
                ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
            </div>
          </div>

          {/* Status Selection */}
           <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <Kanban size={12} /> Status
            </label>
            <div className="relative">
                <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none cursor-pointer">
                {columns.map(col => (
                    <option key={col.id} value={col.id} className="bg-navy-900 text-slate-200">{col.title}</option>
                ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
            </div>
          </div>

           <div className="space-y-2">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <User size={12} /> Assignee
            </label>
            <input type="text" value={formData.assignee} onChange={(e) => setFormData({...formData, assignee: e.target.value})} placeholder="e.g., Sarah Smith" className="w-full liquid-input rounded-xl px-4 py-3 text-sm" />
          </div>

          <div className="space-y-2 col-span-2">
             <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <Calendar size={12} /> Due Date
            </label>
            <input type="date" value={formData.dueDate} onChange={(e) => setFormData({...formData, dueDate: e.target.value})} className="w-full liquid-input rounded-xl px-4 py-3 text-sm [color-scheme:dark]" />
          </div>
        </div>

        {/* Custom Fields Section */}
        {customFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-white/5">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1">Custom Fields</label>
                <div className="grid grid-cols-2 gap-6">
                    {customFields.map(field => (
                        <div key={field.id} className="space-y-2">
                            <label className="text-xs text-slate-500 font-semibold">{field.label}</label>
                            {field.type === 'dropdown' ? (
                                <select 
                                    value={customValues[field.id] || ''} 
                                    onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                                    className="w-full liquid-input rounded-xl px-4 py-3 text-sm appearance-none"
                                >
                                    <option value="">Select...</option>
                                    {field.options?.map(opt => <option key={opt} value={opt} className="bg-navy-900">{opt}</option>)}
                                </select>
                            ) : (
                                <input 
                                    type={field.type === 'number' ? 'number' : 'text'}
                                    value={customValues[field.id] || ''}
                                    onChange={(e) => setCustomValues({ ...customValues, [field.id]: e.target.value })}
                                    className="w-full liquid-input rounded-xl px-4 py-3 text-sm"
                                    placeholder={field.type === 'url' ? 'https://...' : ''}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* Description */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
              <AlignLeft size={12} /> Description
            </label>
            <div className="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
                <button type="button" onClick={() => setViewMode('write')} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${viewMode === 'write' ? 'bg-red-500/20 text-red-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><Edit2 size={10} /> Write</button>
                <button type="button" onClick={() => setViewMode('preview')} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${viewMode === 'preview' ? 'bg-red-500/20 text-red-300 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}><Eye size={10} /> Preview</button>
            </div>
          </div>
          {viewMode === 'write' ? (
            <textarea required value={formData.summary} onChange={(e) => setFormData({...formData, summary: e.target.value})} placeholder="Describe the task details. Supports Markdown (e.g., **bold**, - list)..." className="w-full h-32 liquid-input rounded-xl px-4 py-3 text-sm resize-none font-mono" />
          ) : (
             <div className="w-full h-32 liquid-input rounded-xl px-4 py-3 text-sm overflow-y-auto markdown-content bg-black/20">
               {formData.summary ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({node, ...props}) => (<a {...props} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline" />) }}>{formData.summary}</ReactMarkdown> : <span className="text-slate-600 italic">No description to preview.</span>}
             </div>
          )}
        </div>

        {/* Links & Dependencies */}
        <div className="space-y-3">
             <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
                <Link size={12} /> Linked Tasks & Dependencies
            </label>
            <div className="flex gap-2">
                 <select 
                    value={newLinkType} 
                    onChange={(e) => setNewLinkType(e.target.value)}
                    className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
                 >
                     <option value="relates-to" className="bg-navy-900">Relates to</option>
                     <option value="blocks" className="bg-navy-900">Blocks</option>
                     <option value="blocked-by" className="bg-navy-900">Blocked By</option>
                     <option value="duplicates" className="bg-navy-900">Duplicates</option>
                 </select>
                 <select 
                    value={newLinkTarget} 
                    onChange={(e) => setNewLinkTarget(e.target.value)}
                    className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
                 >
                     <option value="" className="bg-navy-900">Select Task...</option>
                     {availableTasks.filter(t => t.id !== initialData?.id).map(t => (
                         <option key={t.id} value={t.id} className="bg-navy-900">[{t.jobId}] {t.title}</option>
                     ))}
                 </select>
                 <button type="button" onClick={handleAddTaskLink} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"><Plus size={18} /></button>
            </div>
            <div className="space-y-2 mt-2">
                {links.map((link, idx) => {
                    const target = availableTasks.find(t => t.id === link.targetTaskId);
                    if (!target) return null;
                    return (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0a] border border-white/10 group hover:border-white/20 hover:bg-white/5 transition-all">
                             <div className="flex items-center gap-3">
                                 <span className={`px-2 py-1.5 rounded-lg uppercase font-bold text-[10px] tracking-wide border flex items-center gap-1.5
                                    ${link.type === 'blocked-by' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                                      link.type === 'blocks' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 
                                      link.type === 'duplicates' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                     {getLinkIcon(link.type)}
                                     {link.type.replace('-', ' ')}
                                 </span>
                                 <div className="flex flex-col">
                                    <span className="text-xs font-mono text-slate-500">{target.jobId}</span>
                                    <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">{target.title}</span>
                                 </div>
                             </div>
                             <button 
                                type="button" 
                                onClick={() => handleRemoveTaskLink(link.targetTaskId)} 
                                className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2"
                             >
                                <span className="text-xs font-medium">Unlink</span>
                                <Trash2 size={14} />
                            </button>
                        </div>
                    )
                })}
                {links.length === 0 && <div className="text-center py-4 text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">No linked tasks</div>}
            </div>
        </div>

        {/* Subtasks */}
        <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2"><CheckSquare size={12} /> Subtasks</label>
            <div className="flex gap-2">
                <input type="text" value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSubtask())} placeholder="Add a subtask..." className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm" />
                <button type="button" onClick={handleAddSubtask} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"><Plus size={18} /></button>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                {subtasks.map(subtask => (
                    <div key={subtask.id} className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors">
                        <button type="button" onClick={() => toggleSubtask(subtask.id)} className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${subtask.completed ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500' : 'border-slate-600 text-transparent hover:border-slate-400'}`}><Check size={12} /></button>
                        <input type="text" value={subtask.title} onChange={(e) => handleUpdateSubtask(subtask.id, e.target.value)} className={`flex-1 bg-transparent border-none outline-none text-sm font-medium focus:text-white transition-colors ${subtask.completed ? 'text-slate-500 line-through decoration-slate-600' : 'text-slate-300'}`} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                        <button type="button" onClick={() => handleRemoveSubtask(subtask.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"><X size={16} /></button>
                    </div>
                ))}
            </div>
        </div>

        {/* Attachments */}
        <div className="space-y-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2"><Paperclip size={12} /> Attachments</label>
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <input type="text" value={newLinkName} onChange={(e) => setNewLinkName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLink())} placeholder="Link Name (Optional)" className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-sm" />
                     <input type="text" value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLink())} placeholder="https://..." className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm" />
                    <button type="button" onClick={handleAddLink} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5" title="Add Link"><LinkIcon size={18} /></button>
                     <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5" title="Upload File"><Upload size={18} /></button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                </div>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                {attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors">
                        <div className="p-1.5 rounded-lg bg-white/5 text-slate-400">{att.type === 'file' ? <Paperclip size={14} /> : <LinkIcon size={14} />}</div>
                        <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex-1 text-sm font-medium text-blue-400 hover:text-blue-300 truncate underline decoration-blue-500/30 hover:decoration-blue-400">{att.name}</a>
                        <button type="button" onClick={() => handleRemoveAttachment(att.id)} className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"><X size={16} /></button>
                    </div>
                ))}
            </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 mt-2 border-t border-white/5">
          <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
          <button type="submit" className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-glow-red transition-all duration-300 transform hover:scale-105">{initialData ? 'Update Task' : 'Create Task'}</button>
        </div>
      </form>
    </ModalWrapper>
  );
};