import { Archive, Calendar, CheckSquare, RotateCcw, Search, Square, Trash2, X } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task } from "../../../types";
import { useConfirmation } from "../../contexts/ConfirmationContext";
import { archiveService } from "../../services/archiveService";

interface ArchiveViewProps {
  onUnarchive: (tasks: Task[]) => void;
  onDelete: (taskIds: string[]) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({ onUnarchive, onDelete }) => {
  const { confirm } = useConfirmation();
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({
    total: 0,
    oldestDate: null as Date | null,
    newestDate: null as Date | null,
  });

  const loadArchivedTasks = useCallback(async () => {
    const tasks = await archiveService.getAllArchived();
    setArchivedTasks(tasks);
    setStats(archiveService.getArchiveStats());
  }, []);

  useEffect(() => {
    void loadArchivedTasks();
  }, [loadArchivedTasks]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return archivedTasks;
    const query = searchQuery.toLowerCase();
    return archivedTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        task.jobId.toLowerCase().includes(query) ||
        task.assignee?.toLowerCase().includes(query) ||
        task.summary?.toLowerCase().includes(query),
    );
  }, [archivedTasks, searchQuery]);

  const allVisibleSelected =
    filteredTasks.length > 0 && filteredTasks.every((t) => selectedTasks.has(t.id));

  const handleUnarchive = async () => {
    if (selectedTasks.size === 0) return;
    const taskIds = Array.from(selectedTasks);
    const tasks = await archiveService.unarchive(taskIds);
    onUnarchive(tasks);
    setSelectedTasks(new Set());
    await loadArchivedTasks();
  };

  const handleDelete = async () => {
    if (selectedTasks.size === 0) return;

    const confirmed = await confirm({
      title: "Delete archived tasks",
      message: `Permanently delete ${selectedTasks.size} archived task${selectedTasks.size === 1 ? "" : "s"}? This cannot be undone.`,
      confirmText: "Delete permanently",
      variant: "danger",
    });

    if (!confirmed) return;

    const taskIds = Array.from(selectedTasks);
    await archiveService.deleteArchived(taskIds);
    onDelete(taskIds);
    setSelectedTasks(new Set());
    await loadArchivedTasks();
  };

  const toggleSelection = (taskId: string) => {
    setSelectedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedTasks((prev) => {
        const next = new Set(prev);
        for (const task of filteredTasks) next.delete(task.id);
        return next;
      });
    } else {
      setSelectedTasks((prev) => {
        const next = new Set(prev);
        for (const task of filteredTasks) next.add(task.id);
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedTasks(new Set());

  return (
    <div className="h-full overflow-auto p-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
              <Archive size={20} />
            </div>
            <h2 className="text-2xl font-bold text-white">Archived Tasks</h2>
          </div>
          <p className="text-slate-400 text-sm">
            {stats.total} archived task{stats.total === 1 ? "" : "s"}
            {stats.oldestDate && stats.newestDate && (
              <span className="ml-2 text-slate-500">
                · {stats.oldestDate.toLocaleDateString()} –{" "}
                {stats.newestDate.toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mb-4 relative max-w-xl">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title, ID, assignee…"
          aria-label="Search archived tasks"
          className="w-full liquid-input rounded-xl pl-10 pr-10 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 rounded-lg transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {filteredTasks.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-1"
          >
            {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allVisibleSelected ? "Deselect all" : "Select all"}
            {searchQuery && ` (${filteredTasks.length} shown)`}
          </button>
        </div>
      )}

      {selectedTasks.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center gap-3 px-4 py-3 bg-[#1a0a0a]/95 backdrop-blur-xl border border-amber-500/20 rounded-2xl shadow-2xl shadow-black/50">
            <span className="text-sm font-bold text-amber-200 pr-3 border-r border-white/10">
              {selectedTasks.size} selected
            </span>
            <button
              type="button"
              onClick={handleUnarchive}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            >
              <RotateCcw size={14} />
              Unarchive
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 pb-24">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
              <Archive size={28} className="text-red-400/70" />
            </div>
            {archivedTasks.length === 0 ? (
              <>
                <h3 className="text-lg font-semibold text-slate-300 mb-2">No archived tasks</h3>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">
                  Completed tasks moved to the archive will appear here. Enable auto-archive in
                  Settings → Data to automate this.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-slate-300 mb-2">No matches</h3>
                <p className="text-sm text-slate-500">
                  No archived tasks match &ldquo;{searchQuery}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="mt-4 text-xs text-red-400 hover:text-red-300 underline"
                >
                  Clear search
                </button>
              </>
            )}
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isSelected = selectedTasks.has(task.id);
            return (
              <div
                key={task.id}
                role="button"
                tabIndex={0}
                onClick={() => toggleSelection(task.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleSelection(task.id);
                  }
                }}
                className={`liquid-card p-4 rounded-xl transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 ${
                  isSelected
                    ? "border-red-500/50 bg-red-500/10"
                    : "hover:border-white/15"
                }`}
                aria-pressed={isSelected}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${task.title}`}
                    className="mt-1 rounded accent-red-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-white font-medium truncate">{task.title}</h3>
                      <span className="text-[10px] text-slate-500 bg-white/5 px-2 py-0.5 rounded font-mono shrink-0">
                        {task.jobId}
                      </span>
                    </div>
                    {task.summary && (
                      <p className="text-sm text-slate-400 mb-2 line-clamp-2">{task.summary}</p>
                    )}
                    <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
                      {task.assignee && <span>{task.assignee}</span>}
                      {task.completedAt && (
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />
                          Completed {new Date(task.completedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
