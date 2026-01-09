import React, { useState, useEffect } from 'react';
import { ModalWrapper } from './ModalWrapper';
import { Project } from '../types';
import {
  FolderPlus, Code, Megaphone, Smartphone, Box, Briefcase, Globe, Cpu, Shield,
  Folder, Wrench, Zap, Truck, Database, Server, Layout, PenTool, Music, Video, Camera,
  Anchor, Coffee, Rocket, Heart, Star, Target, Flag, BookOpen, Lightbulb, Users,
  ShoppingCart, TrendingUp, MessageSquare, Settings, Home, Award, Gift, Calendar
} from 'lucide-react';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, icon: string, parentId?: string) => void;
  projects?: Project[];
  initialParentId?: string;
}

// All available icons for selection
const AVAILABLE_ICONS = [
  { key: 'folder', icon: Folder, label: 'Folder' },
  { key: 'briefcase', icon: Briefcase, label: 'Briefcase' },
  { key: 'code', icon: Code, label: 'Code' },
  { key: 'rocket', icon: Rocket, label: 'Rocket' },
  { key: 'globe', icon: Globe, label: 'Globe' },
  { key: 'cpu', icon: Cpu, label: 'CPU' },
  { key: 'database', icon: Database, label: 'Database' },
  { key: 'server', icon: Server, label: 'Server' },
  { key: 'shield', icon: Shield, label: 'Shield' },
  { key: 'zap', icon: Zap, label: 'Zap' },
  { key: 'target', icon: Target, label: 'Target' },
  { key: 'flag', icon: Flag, label: 'Flag' },
  { key: 'star', icon: Star, label: 'Star' },
  { key: 'heart', icon: Heart, label: 'Heart' },
  { key: 'lightbulb', icon: Lightbulb, label: 'Idea' },
  { key: 'users', icon: Users, label: 'Team' },
  { key: 'megaphone', icon: Megaphone, label: 'Marketing' },
  { key: 'smartphone', icon: Smartphone, label: 'Mobile' },
  { key: 'layout', icon: Layout, label: 'Design' },
  { key: 'pen-tool', icon: PenTool, label: 'Creative' },
  { key: 'wrench', icon: Wrench, label: 'Tools' },
  { key: 'truck', icon: Truck, label: 'Shipping' },
  { key: 'box', icon: Box, label: 'Product' },
  { key: 'shopping-cart', icon: ShoppingCart, label: 'Shop' },
  { key: 'trending-up', icon: TrendingUp, label: 'Growth' },
  { key: 'book-open', icon: BookOpen, label: 'Docs' },
  { key: 'message-square', icon: MessageSquare, label: 'Chat' },
  { key: 'settings', icon: Settings, label: 'Settings' },
  { key: 'home', icon: Home, label: 'Home' },
  { key: 'award', icon: Award, label: 'Award' },
  { key: 'gift', icon: Gift, label: 'Gift' },
  { key: 'calendar', icon: Calendar, label: 'Calendar' },
  { key: 'music', icon: Music, label: 'Music' },
  { key: 'video', icon: Video, label: 'Video' },
  { key: 'camera', icon: Camera, label: 'Camera' },
  { key: 'anchor', icon: Anchor, label: 'Anchor' },
  { key: 'coffee', icon: Coffee, label: 'Coffee' },
];

export const ProjectModal: React.FC<ProjectModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  projects = [],
  initialParentId
}) => {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>('folder');
  const [parentId, setParentId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setParentId(initialParentId || '');
      setSelectedIcon('folder');
      setName('');
    }
  }, [isOpen, initialParentId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim(), selectedIcon, parentId || undefined);
      setName('');
      setSelectedIcon('folder');
      setParentId('');
      onClose();
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
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Workspace Name</label>
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
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Parent Workspace (Optional)</label>
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
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Choose Icon</label>
          <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
            {AVAILABLE_ICONS.map(({ key, icon: IconComponent }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedIcon(key)}
                title={key}
                className={`
                   aspect-square flex items-center justify-center rounded-xl border transition-all duration-200
                   ${selectedIcon === key
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 scale-110 shadow-[0_0_12px_rgba(239,68,68,0.3)]'
                    : 'bg-[#05080f] border-white/5 text-slate-500 hover:border-white/20 hover:text-slate-300 hover:bg-white/5'}
                 `}
              >
                <IconComponent size={18} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="w-full bg-slate-100 hover:bg-white text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {(() => {
              const SelectedIconComponent = AVAILABLE_ICONS.find(i => i.key === selectedIcon)?.icon || Folder;
              return <SelectedIconComponent size={18} />;
            })()}
            Create Workspace
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
};