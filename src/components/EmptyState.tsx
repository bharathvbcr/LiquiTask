import {
  FolderPlus,
  GripVertical,
  Keyboard,
  Lightbulb,
  Link2,
  Plus,
  Rocket,
  Sparkles,
  Zap,
} from "lucide-react";
import type React from "react";
import { LiquidButton } from "./LiquidButton";

interface EmptyStateProps {
  type: "tasks" | "projects" | "search";
  projectName?: string;
  onCreateTask?: () => void;
  onCreateProject?: () => void;
  onOpenAI?: () => void;
  /** Compact layout for narrow surfaces (e.g. sidebar). */
  compact?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type,
  projectName,
  onCreateTask,
  onCreateProject,
  onOpenAI,
  compact = false,
}) => {
  if (type === "search") {
    return (
      <div
        className={`flex flex-col items-center justify-center text-center animate-in fade-in ${
          compact ? "py-8" : "py-20"
        }`}
      >
        <div
          className={`rounded-2xl bg-white/5 flex items-center justify-center mb-4 border border-white/10 ${
            compact ? "w-12 h-12" : "w-16 h-16"
          }`}
        >
          <Lightbulb size={compact ? 20 : 28} className="text-slate-500" />
        </div>
        <h3 className={`font-bold text-slate-300 mb-2 ${compact ? "text-sm" : "text-lg"}`}>
          No Results Found
        </h3>
        <p className={`text-slate-500 max-w-xs leading-relaxed ${compact ? "text-xs" : "text-sm"}`}>
          Try adjusting your search terms or filters to find what you&apos;re looking for.
        </p>
      </div>
    );
  }

  if (type === "projects") {
    return (
      <div
        className={`flex flex-col items-center justify-center text-center ${
          compact ? "py-6 px-2" : "py-20"
        }`}
      >
        <div
          className={`rounded-2xl bg-gradient-to-br from-red-900/30 to-red-800/30 flex items-center justify-center border border-red-500/20 shadow-lg shadow-red-500/10 ${
            compact ? "w-12 h-12 mb-3" : "w-20 h-20 mb-6"
          }`}
        >
          <FolderPlus size={compact ? 20 : 36} className="text-red-400" />
        </div>
        <h3 className={`font-bold text-slate-200 mb-2 ${compact ? "text-sm" : "text-xl"}`}>
          {compact ? "No Workspaces Yet" : "Create Your First Workspace"}
        </h3>
        {!compact && (
          <p className="text-sm text-slate-400 max-w-sm mb-6">
            Workspaces help you organize related tasks. Get started by creating one!
          </p>
        )}
        {onCreateProject && (
          <LiquidButton
            label={compact ? "New Workspace" : "Create Workspace"}
            onClick={onCreateProject}
            icon={<Plus size={compact ? 14 : 18} className="text-red-100" />}
          />
        )}
      </div>
    );
  }

  // Tasks empty state
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "py-8" : "py-16"
      }`}
    >
      <div className={`relative ${compact ? "mb-4" : "mb-8"}`}>
        <div
          className={`rounded-3xl bg-gradient-to-br from-red-900/30 to-orange-900/30 flex items-center justify-center border border-red-500/20 shadow-xl shadow-red-500/10 ${
            compact ? "w-16 h-16" : "w-24 h-24"
          }`}
        >
          <Rocket size={compact ? 28 : 40} className="text-red-400" />
        </div>
        {!compact && (
          <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30 animate-pulse-slow">
            <Zap size={16} className="text-amber-400" />
          </div>
        )}
      </div>

      <h3 className={`font-bold text-slate-100 mb-3 ${compact ? "text-lg" : "text-2xl"}`}>
        {projectName ? `${projectName} is empty` : "No tasks yet"}
      </h3>
      <p
        className={`text-slate-400 max-w-md leading-relaxed ${
          compact ? "text-xs mb-4" : "text-sm mb-8"
        }`}
      >
        Get started by creating your first task, or let AI help you break down your goals into
        actionable items.
      </p>

      <div className="flex items-center gap-4">
        {onCreateTask && (
          <LiquidButton
            label="Create Task"
            onClick={onCreateTask}
            icon={<Plus size={18} className="text-red-100" />}
          />
        )}
        {onOpenAI && (
          <button
            type="button"
            onClick={onOpenAI}
            className="flex items-center gap-2 px-6 py-3 liquid-glass hover:bg-white/10 text-slate-200 rounded-2xl font-bold transition-all group active:scale-95"
          >
            <Sparkles size={18} className="text-amber-400 group-hover:animate-pulse" />
            Generate with AI
          </button>
        )}
      </div>

      {!compact && (
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
          <Tip
            icon={<Keyboard size={20} className="text-red-400" />}
            title="Quick Create"
            description="Press 'C' anywhere to create a new task instantly"
          />
          <Tip
            icon={<GripVertical size={20} className="text-red-400" />}
            title="Drag & Drop"
            description="Drag tasks between columns to update status"
          />
          <Tip
            icon={<Link2 size={20} className="text-red-400" />}
            title="Link Tasks"
            description="Set dependencies with blocking relationships"
          />
        </div>
      )}
    </div>
  );
};

const Tip: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="p-5 rounded-2xl liquid-card text-left transition-all">
    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10">
      {icon}
    </div>
    <h4 className="text-sm font-bold text-slate-200 mb-1">{title}</h4>
    <p className="text-xs text-slate-400">{description}</p>
  </div>
);

export default EmptyState;
