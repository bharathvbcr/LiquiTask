import { FolderPlus, Lightbulb, Plus, Rocket, Sparkles, Zap } from "lucide-react";
import type React from "react";
import { LiquidButton } from "../../components/LiquidButton";

interface EmptyStateProps {
  type: "tasks" | "projects" | "search";
  projectName?: string;
  onCreateTask?: () => void;
  onCreateProject?: () => void;
  onOpenAI?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  type,
  projectName,
  onCreateTask,
  onCreateProject,
  onOpenAI,
}) => {
  if (type === "search") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mb-4 border border-white/5">
          <Lightbulb size={28} className="text-slate-500" />
        </div>
        <h3 className="text-lg font-bold text-slate-300 mb-2">No results found</h3>
        <p className="text-sm text-slate-500 max-w-xs">
          Try adjusting your search terms or filters to find what you&apos;re looking for.
        </p>
      </div>
    );
  }

  if (type === "projects") {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-900/30 to-blue-900/30 flex items-center justify-center mb-6 border border-purple-500/20 shadow-lg shadow-purple-500/10">
          <FolderPlus size={36} className="text-purple-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-200 mb-2">Create Your First Workspace</h3>
        <p className="text-sm text-slate-400 max-w-sm mb-6">
          Workspaces help you organize related tasks. Get started by creating one!
        </p>
        {onCreateProject && (
          <LiquidButton label="Create Workspace" onClick={onCreateProject} icon={<Plus size={18} className="text-purple-100" />} />
        )}
      </div>
    );
  }

  // Tasks empty state
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-8">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-red-900/30 to-orange-900/30 flex items-center justify-center border border-red-500/20 shadow-xl shadow-red-500/10">
          <Rocket size={40} className="text-red-400" />
        </div>
        <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30 animate-bounce">
          <Zap size={16} className="text-amber-400" />
        </div>
      </div>

      <h3 className="text-2xl font-bold text-slate-100 mb-3">
        {projectName ? `${projectName} is empty` : "No tasks yet"}
      </h3>
      <p className="text-sm text-slate-400 max-w-md mb-8 leading-relaxed">
        Get started by creating your first task, or let AI help you break down your goals into
        actionable items.
      </p>

      <div className="flex items-center gap-4">
        {onCreateTask && (
          <LiquidButton label="Create Task" onClick={onCreateTask} icon={<Plus size={18} className="text-red-100" />} />
        )}
        {onOpenAI && (
          <button
            onClick={onOpenAI}
            className="flex items-center gap-2 px-6 py-3 liquid-glass hover:bg-white/10 text-slate-200 rounded-2xl font-bold transition-all group active:scale-95"
          >
            <Sparkles size={18} className="text-amber-400 group-hover:animate-pulse" />
            Generate with AI
          </button>
        )}
      </div>

      {/* Tips Section */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl w-full">
        <Tip
          icon="⌨️"
          title="Quick Create"
          description="Press 'C' anywhere to create a new task instantly"
        />
        <Tip
          icon="🎯"
          title="Drag & Drop"
          description="Drag tasks between columns to update status"
        />
        <Tip
          icon="🔗"
          title="Link Tasks"
          description="Set dependencies with blocking relationships"
        />
      </div>
    </div>
  );
};

const Tip: React.FC<{ icon: string; title: string; description: string }> = ({
  icon,
  title,
  description,
}) => (
  <div className="p-5 rounded-2xl liquid-card text-left transition-all">
    <div className="text-3xl mb-3 drop-shadow-md">{icon}</div>
    <h4 className="text-sm font-bold text-slate-200 mb-1">{title}</h4>
    <p className="text-xs text-slate-400">{description}</p>
  </div>
);

export default EmptyState;
