import React from 'react';
import { Sparkles, Rocket, Lightbulb, Zap, Plus, FolderPlus } from 'lucide-react';

interface EmptyStateProps {
    type: 'tasks' | 'projects' | 'search';
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
    onOpenAI
}) => {
    if (type === 'search') {
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

    if (type === 'projects') {
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
                    <button
                        onClick={onCreateProject}
                        className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-all hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25"
                    >
                        <Plus size={18} />
                        Create Workspace
                    </button>
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
                {projectName ? `${projectName} is empty` : 'No tasks yet'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mb-8 leading-relaxed">
                Get started by creating your first task, or let AI help you break down your goals into actionable items.
            </p>

            <div className="flex items-center gap-4">
                {onCreateTask && (
                    <button
                        onClick={onCreateTask}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-all hover:scale-105 hover:shadow-lg hover:shadow-red-500/25"
                    >
                        <Plus size={18} />
                        Create Task
                    </button>
                )}
                {onOpenAI && (
                    <button
                        onClick={onOpenAI}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl font-medium border border-white/10 hover:border-white/20 transition-all group"
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

const Tip: React.FC<{ icon: string; title: string; description: string }> = ({ icon, title, description }) => (
    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-left hover:bg-white/[0.04] transition-colors">
        <div className="text-2xl mb-2">{icon}</div>
        <h4 className="text-sm font-semibold text-slate-300 mb-1">{title}</h4>
        <p className="text-xs text-slate-500">{description}</p>
    </div>
);

export default EmptyState;
