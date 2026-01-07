import React, { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { Project, ProjectType } from '../types';
import { FolderPlus, Check, Code, Megaphone, Smartphone, Box, Briefcase, Globe, Cpu, Shield, Folder, Wrench, Zap, Truck, Database, Server, Layout, PenTool, Music, Video, Camera, Anchor, Coffee } from 'lucide-react';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, type: string, parentId?: string) => void;
  projectTypes?: ProjectType[];
  projects?: Project[];
  initialParentId?: string;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ 
    isOpen, 
    onClose, 
    onSubmit,
    projectTypes = [],
    projects = [],
    initialParentId
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('folder');
  const [parentId, setParentId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setParentId(initialParentId || '');
    }
  }, [isOpen, initialParentId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name, type, parentId || undefined);
      setName('');
      setParentId('');
      onClose();
    }
  };

  const getIcon = (iconKey: string) => {
    switch (iconKey) {
      case 'code': return <Code size={16} />;
      case 'megaphone': return <Megaphone size={16} />;
      case 'smartphone': return <Smartphone size={16} />;
      case 'box': return <Box size={16} />;
      case 'folder': return <Folder size={16} />;
      case 'globe': return <Globe size={16} />;
      case 'cpu': return <Cpu size={16} />;
      case 'shield': return <Shield size={16} />;
      case 'wrench': return <Wrench size={16} />;
      case 'zap': return <Zap size={16} />;
      case 'truck': return <Truck size={16} />;
      case 'database': return <Database size={16} />;
      case 'server': return <Server size={16} />;
      case 'layout': return <Layout size={16} />;
      case 'pen-tool': return <PenTool size={16} />;
      case 'music': return <Music size={16} />;
      case 'video': return <Video size={16} />;
      case 'camera': return <Camera size={16} />;
      case 'anchor': return <Anchor size={16} />;
      case 'coffee': return <Coffee size={16} />;
      default: return <Briefcase size={16} />;
    }
  };

  return (
    <ModalWrapper 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Create Workspace"
      icon={<FolderPlus size={20} />}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project Name</label>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q4 Launch"
            className="w-full bg-[#05080f] border border-white/10 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
          />
        </div>

        <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Parent Project (Optional)</label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full bg-[#05080f] border border-white/10 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all appearance-none"
            >
              <option value="">No Parent (Top Level)</option>
              {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
        </div>

        <div className="space-y-2">
           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project Type</label>
           <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
             {projectTypes.map((t) => (
               <button
                 key={t.id}
                 type="button"
                 onClick={() => setType(t.id)}
                 className={`
                   flex items-center gap-3 px-3 py-2 rounded-lg text-sm border transition-all text-left
                   ${type === t.id 
                     ? 'bg-red-500/10 border-red-500/50 text-red-400' 
                     : 'bg-[#05080f] border-white/5 text-slate-400 hover:border-white/20 hover:text-slate-300'}
                 `}
               >
                 <span className="opacity-80">{getIcon(t.icon)}</span>
                 <span className="flex-1 truncate">{t.label}</span>
                 {type === t.id && <Check size={14} className="shrink-0" />}
               </button>
             ))}
           </div>
        </div>

        <div className="flex justify-end pt-2">
           <button
            type="submit"
            className="w-full bg-slate-100 hover:bg-white text-black font-bold py-3 rounded-xl transition-all"
          >
            Create Project
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
};