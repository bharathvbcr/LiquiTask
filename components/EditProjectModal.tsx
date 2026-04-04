import {
  Anchor,
  Award,
  BookOpen,
  Box,
  Briefcase,
  Calendar,
  Camera,
  Code,
  Coffee,
  Cpu,
  Database,
  Edit2,
  Flag,
  Folder,
  FolderOpen,
  Gift,
  Globe,
  Heart,
  Home,
  Layout,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Music,
  PenTool,
  Plus,
  Rocket,
  Server,
  Settings,
  Shield,
  ShoppingCart,
  Smartphone,
  Star,
  Target,
  TrendingUp,
  Truck,
  Users,
  Video,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import type { Project } from "../types";
import { ModalWrapper } from "./ModalWrapper";
import { Tooltip } from "./Tooltip";

interface EditProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (projectId: string, name: string, icon: string, workspacePaths?: string[]) => void;
  project: Project | null;
}

// All available icons for selection (same as ProjectModal)
const AVAILABLE_ICONS = [
  { key: "folder", icon: Folder, label: "Folder" },
  { key: "briefcase", icon: Briefcase, label: "Briefcase" },
  { key: "code", icon: Code, label: "Code" },
  { key: "rocket", icon: Rocket, label: "Rocket" },
  { key: "globe", icon: Globe, label: "Globe" },
  { key: "cpu", icon: Cpu, label: "CPU" },
  { key: "database", icon: Database, label: "Database" },
  { key: "server", icon: Server, label: "Server" },
  { key: "shield", icon: Shield, label: "Shield" },
  { key: "zap", icon: Zap, label: "Zap" },
  { key: "target", icon: Target, label: "Target" },
  { key: "flag", icon: Flag, label: "Flag" },
  { key: "star", icon: Star, label: "Star" },
  { key: "heart", icon: Heart, label: "Heart" },
  { key: "lightbulb", icon: Lightbulb, label: "Idea" },
  { key: "users", icon: Users, label: "Team" },
  { key: "megaphone", icon: Megaphone, label: "Marketing" },
  { key: "smartphone", icon: Smartphone, label: "Mobile" },
  { key: "layout", icon: Layout, label: "Design" },
  { key: "pen-tool", icon: PenTool, label: "Creative" },
  { key: "wrench", icon: Wrench, label: "Tools" },
  { key: "truck", icon: Truck, label: "Shipping" },
  { key: "box", icon: Box, label: "Product" },
  { key: "shopping-cart", icon: ShoppingCart, label: "Shop" },
  { key: "trending-up", icon: TrendingUp, label: "Growth" },
  { key: "book-open", icon: BookOpen, label: "Docs" },
  { key: "message-square", icon: MessageSquare, label: "Chat" },
  { key: "settings", icon: Settings, label: "Settings" },
  { key: "home", icon: Home, label: "Home" },
  { key: "award", icon: Award, label: "Award" },
  { key: "gift", icon: Gift, label: "Gift" },
  { key: "calendar", icon: Calendar, label: "Calendar" },
  { key: "music", icon: Music, label: "Music" },
  { key: "video", icon: Video, label: "Video" },
  { key: "camera", icon: Camera, label: "Camera" },
  { key: "anchor", icon: Anchor, label: "Anchor" },
  { key: "coffee", icon: Coffee, label: "Coffee" },
];

export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  isOpen,
  onClose,
  onSave,
  project,
}) => {
  const [name, setName] = useState("");
  const [selectedIcon, setSelectedIcon] = useState<string>("folder");
  const [workspacePaths, setWorkspacePaths] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && project) {
      setName(project.name);
      setSelectedIcon(project.icon || "folder");
      setWorkspacePaths(project.workspacePaths ?? []);
    }
  }, [isOpen, project]);

  const handleAddFolder = async () => {
    const path = await (window as any).electronAPI?.workspace.selectDirectory();
    if (!path || workspacePaths.includes(path)) return;
    setWorkspacePaths(prev => [...prev, path]);
  };

  const handleRemovePath = (path: string) => {
    setWorkspacePaths(prev => prev.filter(p => p !== path));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && project) {
      onSave(project.id, name.trim(), selectedIcon, workspacePaths);
      onClose();
    }
  };

  if (!project) return null;

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Workspace"
      icon={<Edit2 size={20} />}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Workspace Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            className="w-full bg-[#05080f] border border-white/10 rounded-xl px-4 py-3 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Choose Icon
          </label>
          <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto custom-scrollbar p-1">
            {AVAILABLE_ICONS.map(({ key, icon: IconComponent, label }) => (
              <Tooltip key={key} content={label} position="top">
                <button
                  type="button"
                  onClick={() => setSelectedIcon(key)}
                  className={`
                     aspect-square flex items-center justify-center rounded-xl border transition-all duration-200
                     ${
                       selectedIcon === key
                         ? "bg-red-500/20 border-red-500/50 text-red-400 scale-110 shadow-[0_0_12px_rgba(239,68,68,0.3)]"
                         : "bg-[#05080f] border-white/5 text-slate-500 hover:border-white/20 hover:text-slate-300 hover:bg-white/5"
                     }
                   `}
                >
                  <IconComponent size={18} />
                </button>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Workspace Paths */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Linked Folders
            </label>
            <button
              type="button"
              onClick={handleAddFolder}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Plus size={11} />
              Add Folder
            </button>
          </div>
          {workspacePaths.length === 0 ? (
            <p className="text-[12px] text-slate-600 italic px-1">
              No folders linked. Add folders to give the AI context from your files.
            </p>
          ) : (
            <div className="space-y-1.5">
              {workspacePaths.map(p => (
                <div key={p} className="flex items-center gap-2 group px-3 py-2 bg-[#05080f] border border-white/5 rounded-xl">
                  <FolderOpen size={13} className="text-red-400/70 shrink-0" />
                  <span className="flex-1 text-[12px] text-slate-400 font-mono truncate" title={p}>
                    {p.split(/[\\/]/).pop()}
                    <span className="text-slate-600 ml-1 hidden group-hover:inline">— {p}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemovePath(p)}
                    className="p-0.5 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-white/5 hover:bg-white/10 text-slate-300 font-medium py-3 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 bg-slate-100 hover:bg-white text-black font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {(() => {
              const SelectedIconComponent =
                AVAILABLE_ICONS.find((i) => i.key === selectedIcon)?.icon || Folder;
              return <SelectedIconComponent size={18} />;
            })()}
            Save Changes
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
};
