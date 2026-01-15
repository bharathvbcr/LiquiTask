import React, { useState, useEffect } from 'react';
import { Task } from '../../types';
import { archiveService } from '../services/archiveService';
import { Search, Archive, RotateCcw, Trash2, Calendar } from 'lucide-react';
import { useConfirmation } from '../contexts/ConfirmationContext';

interface ArchiveViewProps {
    onUnarchive: (tasks: Task[]) => void;
    onDelete: (taskIds: string[]) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
    onUnarchive,
    onDelete,
}) => {
    const { confirm } = useConfirmation();
    const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
    const [stats, setStats] = useState({ total: 0, oldestDate: null as Date | null, newestDate: null as Date | null });

    useEffect(() => {
        loadArchivedTasks();
    }, []);

    const loadArchivedTasks = async () => {
        const tasks = await archiveService.getAllArchived();
        setArchivedTasks(tasks);
        const archiveStats = archiveService.getArchiveStats();
        setStats(archiveStats);
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            loadArchivedTasks();
            return;
        }
        const results = await archiveService.searchArchive(searchQuery);
        setArchivedTasks(results);
    };

    const handleUnarchive = async () => {
        if (selectedTasks.size === 0) return;
        const taskIds = Array.from(selectedTasks) as string[];
        const tasks = await archiveService.unarchive(taskIds);
        onUnarchive(tasks);
        setSelectedTasks(new Set());
        loadArchivedTasks();
    };

    const handleDelete = async () => {
        if (selectedTasks.size === 0) return;

        const confirmed = await confirm({
            title: 'Delete Archived Tasks',
            message: `Permanently delete ${selectedTasks.size} archived task(s)? This cannot be undone.`,
            confirmText: 'Delete Permanently',
            variant: 'danger'
        });

        if (!confirmed) return;

        const taskIds = Array.from(selectedTasks) as string[];
        await archiveService.deleteArchived(taskIds);
        onDelete(taskIds);
        setSelectedTasks(new Set());
        loadArchivedTasks();
    };

    const toggleSelection = (taskId: string) => {
        const newSelection = new Set(selectedTasks);
        if (newSelection.has(taskId)) {
            newSelection.delete(taskId);
        } else {
            newSelection.add(taskId);
        }
        setSelectedTasks(newSelection);
    };

    const filteredTasks = archivedTasks.filter(task => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase();
        return (
            task.title.toLowerCase().includes(query) ||
            task.jobId.toLowerCase().includes(query) ||
            task.assignee?.toLowerCase().includes(query) ||
            task.summary?.toLowerCase().includes(query)
        );
    });

    return (
        <div className="h-full overflow-auto p-6">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-white mb-2">Archived Tasks</h2>
                <p className="text-slate-400 text-sm">
                    {stats.total} archived tasks
                    {stats.oldestDate && stats.newestDate && (
                        <span className="ml-2">
                            • From {stats.oldestDate.toLocaleDateString()} to {stats.newestDate.toLocaleDateString()}
                        </span>
                    )}
                </p>
            </div>

            {/* Search and Actions */}
            <div className="mb-6 flex items-center gap-4">
                <div className="flex-1 relative">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Search archived tasks..."
                        className="w-full bg-black/20 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-white focus:border-red-500/50 outline-none"
                    />
                </div>
                <button
                    onClick={handleSearch}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 transition-all"
                >
                    Search
                </button>
            </div>

            {/* Bulk Actions */}
            {selectedTasks.size > 0 && (
                <div className="mb-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center justify-between">
                    <span className="text-amber-400 text-sm font-medium">
                        {selectedTasks.size} task(s) selected
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleUnarchive}
                            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm transition-all flex items-center gap-2"
                        >
                            <RotateCcw size={14} />
                            Unarchive
                        </button>
                        <button
                            onClick={handleDelete}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 text-sm transition-all flex items-center gap-2"
                        >
                            <Trash2 size={14} />
                            Delete Permanently
                        </button>
                    </div>
                </div>
            )}

            {/* Task List */}
            <div className="space-y-2">
                {filteredTasks.length === 0 ? (
                    <div className="text-center py-12 text-slate-500">
                        <Archive size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No archived tasks found</p>
                    </div>
                ) : (
                    filteredTasks.map(task => (
                        <div
                            key={task.id}
                            className={`p-4 bg-white/5 border rounded-lg transition-all cursor-pointer hover:bg-white/10 ${selectedTasks.has(task.id) ? 'border-red-500/50 bg-red-500/10' : 'border-white/10'
                                }`}
                            onClick={() => toggleSelection(task.id)}
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedTasks.has(task.id)}
                                            onChange={() => toggleSelection(task.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label={`Select task ${task.jobId || task.id}`}
                                            title={`Select task ${task.jobId || task.id}`}
                                            className="rounded"
                                        />
                                        <h3 className="text-white font-medium">{task.title}</h3>
                                        <span className="text-xs text-slate-500 bg-white/5 px-2 py-0.5 rounded">
                                            {task.jobId}
                                        </span>
                                    </div>
                                    {task.summary && (
                                        <p className="text-sm text-slate-400 ml-7 mb-2">{task.summary}</p>
                                    )}
                                    <div className="flex items-center gap-4 ml-7 text-xs text-slate-500">
                                        {task.assignee && (
                                            <span>Assignee: {task.assignee}</span>
                                        )}
                                        {task.completedAt && (
                                            <span className="flex items-center gap-1">
                                                <Calendar size={12} />
                                                Completed: {new Date(task.completedAt).toLocaleDateString()}
                                            </span>
                                        )}
                                        {task.createdAt && (
                                            <span>
                                                Created: {new Date(task.createdAt).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
