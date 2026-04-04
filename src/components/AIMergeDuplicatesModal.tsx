import { AlertTriangle, Brain, CheckCircle2, Loader2, Merge } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ModalWrapper } from "../../components/ModalWrapper";
import type { DuplicateGroup, MergeSuggestion, Task } from "../../types";
import { taskCleanupService } from "../services/taskCleanupService";

interface AIMergeDuplicatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onArchiveTask: (taskId: string) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface MergeGroup {
  group: DuplicateGroup;
  suggestion: MergeSuggestion | null;
  loading: boolean;
  approved: boolean;
}

export const AIMergeDuplicatesModal: React.FC<AIMergeDuplicatesModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  onUpdateTask,
  onArchiveTask,
  addToast,
}) => {
  const [groups, setGroups] = useState<MergeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, total: 0 });

  const loadDuplicates = useCallback(async () => {
    setLoading(true);
    setProgress({ processed: 0, total: 0 });
    try {
      const duplicateGroups = await taskCleanupService.detectDuplicates(
        allTasks,
        0.75,
        (processed, total) => {
          setProgress({ processed, total });
        },
      );

      if (duplicateGroups.length === 0) {
        addToast("No duplicate tasks found", "info");
        onClose();
        return;
      }

      // Load merge suggestions for each group
      setProgress({ processed: 0, total: duplicateGroups.length });
      const mergeGroups: MergeGroup[] = await Promise.all(
        duplicateGroups.map(async (group, index) => {
          try {
            const suggestion = await taskCleanupService.suggestMerge(group);
            setProgress((prev) => ({ ...prev, processed: index + 1 }));
            return { group, suggestion, loading: false, approved: false };
          } catch (error) {
            console.error("Failed to get merge suggestion:", error);
            setProgress((prev) => ({ ...prev, processed: index + 1 }));
            return { group, suggestion: null, loading: false, approved: false };
          }
        }),
      );

      setGroups(mergeGroups);
    } catch (error) {
      console.error("Failed to detect duplicates:", error);
      addToast("Failed to detect duplicates", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [allTasks, addToast, onClose]);

  useEffect(() => {
    if (isOpen) {
      loadDuplicates();
    } else {
      setGroups([]);
    }
  }, [isOpen, loadDuplicates]);

  const toggleApproval = (groupId: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.group.id === groupId ? { ...g, approved: !g.approved } : g)),
    );
  };

  const applyApprovedMerges = async () => {
    const approvedGroups = groups.filter((g) => g.approved && g.suggestion);

    if (approvedGroups.length === 0) {
      addToast("No merges approved", "warning");
      return;
    }

    setApplying(true);
    try {
      let successCount = 0;

      for (const { suggestion } of approvedGroups) {
        if (!suggestion) continue;

        try {
          await taskCleanupService.executeMerge(suggestion, onArchiveTask);

          // Update the kept task with merged fields
          onUpdateTask(suggestion.keepTaskId, suggestion.mergedFields);

          successCount++;
        } catch (error) {
          console.error("Failed to execute merge:", error);
        }
      }

      if (successCount > 0) {
        addToast(
          `Successfully merged ${successCount} duplicate group${successCount > 1 ? "s" : ""}`,
          "success",
        );
        loadDuplicates(); // Refresh to show remaining duplicates
      }
    } catch (error) {
      console.error("Failed to apply merges:", error);
      addToast("Failed to apply some merges", "error");
    } finally {
      setApplying(false);
    }
  };

  const approveAll = () => {
    setGroups((prev) => prev.map((g) => ({ ...g, approved: g.suggestion !== null })));
  };

  const approveNone = () => {
    setGroups((prev) => prev.map((g) => ({ ...g, approved: false })));
  };

  if (loading) {
    const percent =
      progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

    return (
      <ModalWrapper isOpen={isOpen} onClose={onClose} title="Analyzing Duplicates">
        <div className="flex flex-col items-center justify-center py-12 space-y-6">
          <div className="relative flex items-center justify-center">
            <Loader2 size={48} className="animate-spin text-cyan-400" />
            <span className="absolute text-[10px] font-bold text-white">
              {percent}%
            </span>
          </div>
          <div className="text-center space-y-2">
            <p className="text-white font-medium">AI is analyzing your tasks</p>
            <p className="text-sm text-slate-400">
              {progress.total > 0
                ? `Checking ${progress.processed} of ${progress.total} task pairs...`
                : "Scanning for potential matches..."}
            </p>
          </div>
          
          <div className="w-full max-w-xs bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-cyan-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="Smart Merge Duplicates" size="xl">
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
            <Merge size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">AI-Powered Duplicate Detection</h3>
            <p className="text-sm text-slate-400 mt-1">
              Review and merge duplicate tasks found by AI analysis. Each merge combines the best
              elements from similar tasks.
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Merge size={48} className="mx-auto mb-4 opacity-50" />
            <p>No duplicate tasks detected</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">
                Found {groups.length} duplicate group{groups.length > 1 ? "s" : ""}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={approveAll}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors"
                >
                  Approve All
                </button>
                <button
                  onClick={approveNone}
                  className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                >
                  Approve None
                </button>
              </div>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {groups.map((mergeGroup) => (
                <DuplicateGroupCard
                  key={mergeGroup.group.id}
                  mergeGroup={mergeGroup}
                  onToggleApproval={() => toggleApproval(mergeGroup.group.id)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <div className="text-xs text-slate-500">
                {groups.filter((g) => g.approved).length} of {groups.length} approved
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyApprovedMerges}
                  disabled={applying || !groups.some((g) => g.approved)}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-lg text-sm font-bold shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {applying ? "Applying..." : "Apply Merges"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  );
};

interface DuplicateGroupCardProps {
  mergeGroup: MergeGroup;
  onToggleApproval: () => void;
}

const DuplicateGroupCard: React.FC<DuplicateGroupCardProps> = ({
  mergeGroup,
  onToggleApproval,
}) => {
  const { group, suggestion, approved } = mergeGroup;

  return (
    <div
      className={`relative bg-white/5 border rounded-xl p-4 transition-all ${
        approved ? "border-cyan-500/50 bg-cyan-500/5" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          <span className="text-sm font-medium text-white">
            {group.tasks.length} duplicate tasks
          </span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
            {Math.round(group.confidence * 100)}% confidence
          </span>
        </div>
        <button
          onClick={onToggleApproval}
          disabled={!suggestion}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
            approved
              ? "bg-cyan-500 text-slate-950"
              : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {approved ? "Approved" : "Approve"}
        </button>
      </div>

      {group.reasons.length > 0 && (
        <div className="mb-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <p className="text-xs text-amber-400">
            <strong>Why duplicates:</strong> {group.reasons.join(", ")}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {group.tasks.map((task, _index) => (
          <div key={task.id} className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
            <div
              className={`w-2 h-2 rounded-full ${
                suggestion?.keepTaskId === task.id ? "bg-green-500" : "bg-slate-600"
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{task.title}</p>
              <p className="text-xs text-slate-400 truncate">{task.summary}</p>
            </div>
            {suggestion?.keepTaskId === task.id && (
              <span className="text-xs text-green-400 font-medium">Keep</span>
            )}
            {suggestion?.archiveTaskIds.includes(task.id) && (
              <span className="text-xs text-red-400 font-medium">Archive</span>
            )}
          </div>
        ))}
      </div>

      {suggestion && (
        <div className="mt-3 p-3 bg-slate-800/30 border border-slate-700 rounded-lg">
          <div className="flex items-start gap-2">
            <Brain size={14} className="text-cyan-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-cyan-400 mb-1">AI Merge Plan</p>
              <p className="text-xs text-slate-300">{suggestion.reasoning}</p>
            </div>
          </div>
        </div>
      )}

      {!suggestion && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-xs text-red-400">Could not generate merge suggestion</p>
        </div>
      )}
    </div>
  );
};
