import { ArrowRight, Brain, CheckCircle2, GitBranch, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { RedundancyAnalysis, Task } from "../../types";
import { taskCleanupService } from "../services/taskCleanupService";
import { ModalWrapper } from "./ModalWrapper";

interface AISubtaskSuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onArchiveTask: (taskId: string) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface SubtaskSuggestion {
  analysis: RedundancyAnalysis;
  approved: boolean;
}

export const AISubtaskSuggestionsModal: React.FC<AISubtaskSuggestionsModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  onUpdateTask,
  onArchiveTask,
  addToast,
}) => {
  const [suggestions, setSuggestions] = useState<SubtaskSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const analyses = await taskCleanupService.analyzeRedundancy(allTasks);

      // Filter for subtask conversion suggestions
      const subtaskSuggestions = analyses
        .filter(
          (analysis) => analysis.type === "subset" || analysis.type === "converted-to-subtask",
        )
        .filter((analysis) => analysis.confidence >= 0.7)
        .map((analysis) => ({
          analysis,
          approved: false,
        }));

      setSuggestions(subtaskSuggestions);
    } catch (error) {
      console.error("Failed to analyze subtask suggestions:", error);
      addToast("Failed to analyze subtask suggestions", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [allTasks, addToast, onClose]);

  useEffect(() => {
    if (isOpen) {
      loadSuggestions();
    } else {
      setSuggestions([]);
    }
  }, [isOpen, loadSuggestions]);

  const toggleApproval = (taskId: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.analysis.taskId === taskId ? { ...s, approved: !s.approved } : s)),
    );
  };

  const applyApprovedConversions = async () => {
    const approvedSuggestions = suggestions.filter((s) => s.approved);

    if (approvedSuggestions.length === 0) {
      addToast("No subtask conversions approved", "warning");
      return;
    }

    setApplying(true);
    try {
      let successCount = 0;

      for (const { analysis } of approvedSuggestions) {
        try {
          // Find the parent task
          const parentTask = allTasks.find((t) => t.id === analysis.relatedTaskId);
          const childTask = allTasks.find((t) => t.id === analysis.taskId);

          if (!parentTask || !childTask) continue;

          // Add the child task as a subtask to the parent
          const newSubtask = {
            id: `st-ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: childTask.title,
            completed: false,
          };

          const updatedSubtasks = [...parentTask.subtasks, newSubtask];
          onUpdateTask(parentTask.id, { subtasks: updatedSubtasks });

          // Archive the original child task
          onArchiveTask(childTask.id);

          successCount++;
        } catch (error) {
          console.error("Failed to convert task to subtask:", error);
        }
      }

      if (successCount > 0) {
        addToast(
          `Successfully converted ${successCount} task${successCount > 1 ? "s" : ""} to subtasks`,
          "success",
        );
        loadSuggestions(); // Refresh to show remaining suggestions
      }
    } catch (error) {
      console.error("Failed to apply subtask conversions:", error);
      addToast("Failed to apply some conversions", "error");
    } finally {
      setApplying(false);
    }
  };

  const approveAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: true })));
  };

  const approveNone = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: false })));
  };

  if (loading) {
    return (
      <ModalWrapper isOpen={isOpen} onClose={onClose} title="Analyzing Subtask Suggestions">
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-cyan-400 mr-3" />
          <span className="text-slate-400">
            AI is analyzing tasks that could be converted to subtasks...
          </span>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="Convert to Subtasks" size="xl">
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-500/20 text-green-400">
            <GitBranch size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">AI-Powered Subtask Conversion</h3>
            <p className="text-sm text-slate-400 mt-1">
              AI has identified tasks that appear to be subtasks of other tasks. Convert them to
              keep your workflow organized.
            </p>
          </div>
        </div>

        {suggestions.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <GitBranch size={48} className="mx-auto mb-4 opacity-50" />
            <p>No subtask conversion suggestions found</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">
                Found {suggestions.length} subtask conversion suggestion
                {suggestions.length > 1 ? "s" : ""}
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
              {suggestions.map((suggestion) => (
                <SubtaskSuggestionCard
                  key={suggestion.analysis.taskId}
                  suggestion={suggestion}
                  allTasks={allTasks}
                  onToggleApproval={() => toggleApproval(suggestion.analysis.taskId)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <div className="text-xs text-slate-500">
                {suggestions.filter((s) => s.approved).length} of {suggestions.length} approved
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyApprovedConversions}
                  disabled={applying || !suggestions.some((s) => s.approved)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-slate-950 rounded-lg text-sm font-bold shadow-lg shadow-green-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {applying ? "Converting..." : "Convert to Subtasks"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  );
};

interface SubtaskSuggestionCardProps {
  suggestion: SubtaskSuggestion;
  allTasks: Task[];
  onToggleApproval: () => void;
}

const SubtaskSuggestionCard: React.FC<SubtaskSuggestionCardProps> = ({
  suggestion,
  allTasks,
  onToggleApproval,
}) => {
  const { analysis, approved } = suggestion;

  const childTask = allTasks.find((t) => t.id === analysis.taskId);
  const parentTask = allTasks.find((t) => t.id === analysis.relatedTaskId);

  if (!childTask || !parentTask) return null;

  return (
    <div
      className={`relative bg-white/5 border rounded-xl p-4 transition-all ${
        approved ? "border-green-500/50 bg-green-500/5" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-green-500" />
          <span className="text-sm font-medium text-white">Convert to Subtask</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
            {Math.round(analysis.confidence * 100)}% confidence
          </span>
        </div>
        <button
          onClick={onToggleApproval}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
            approved
              ? "bg-green-500 text-slate-950"
              : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        >
          {approved ? "Approved" : "Approve"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="flex-1">
            <p className="text-sm text-white font-medium">{childTask.title}</p>
            <p className="text-xs text-slate-400">Will be converted to subtask</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ArrowRight size={16} className="text-green-500" />
          <span className="text-xs text-slate-400">becomes subtask of</span>
        </div>

        <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <div className="flex-1">
            <p className="text-sm text-white font-medium">{parentTask.title}</p>
            <p className="text-xs text-slate-400">Parent task</p>
          </div>
        </div>
      </div>

      {analysis.reasoning && (
        <div className="mt-3 p-3 bg-slate-800/30 border border-slate-700 rounded-lg">
          <div className="flex items-start gap-2">
            <Brain size={14} className="text-green-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-green-400 mb-1">AI Analysis</p>
              <p className="text-xs text-slate-300">{analysis.reasoning}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
