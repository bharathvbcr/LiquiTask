import { Brain, CheckCircle2, Globe, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AIContext, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";
import { ModalWrapper } from "./ModalWrapper";

interface AIProjectAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  projects: Project[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface AssignmentSuggestion {
  taskId: string;
  suggestedProjectId: string;
  confidence: number;
  reasoning: string;
  approved: boolean;
}

export const AIProjectAssignmentModal: React.FC<AIProjectAssignmentModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  projects,
  onUpdateTask,
  addToast,
}) => {
  const [suggestions, setSuggestions] = useState<AssignmentSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

      const context: AIContext = {
        activeProjectId,
        projects: projects || [],
        priorities: priorities || [],
      };

      const assignmentSuggestions = await aiService.suggestProjectReassignment(allTasks, context);

      const formattedSuggestions: AssignmentSuggestion[] = assignmentSuggestions.map(
        (suggestion) => ({
          taskId: suggestion.taskId,
          suggestedProjectId: suggestion.suggestedProjectId,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          approved: false,
        }),
      );

      setSuggestions(formattedSuggestions);
    } catch (error) {
      console.error("Failed to generate project assignment suggestions:", error);
      addToast("Failed to generate project suggestions", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [allTasks, projects, addToast, onClose]);

  useEffect(() => {
    if (isOpen) {
      loadSuggestions();
    } else {
      setSuggestions([]);
    }
  }, [isOpen, loadSuggestions]);

  const toggleApproval = (taskId: string) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.taskId === taskId ? { ...s, approved: !s.approved } : s)),
    );
  };

  const applyApprovedAssignments = async () => {
    const approvedSuggestions = suggestions.filter((s) => s.approved);

    if (approvedSuggestions.length === 0) {
      addToast("No project assignments approved", "warning");
      return;
    }

    setApplying(true);
    try {
      let successCount = 0;

      for (const suggestion of approvedSuggestions) {
        try {
          onUpdateTask(suggestion.taskId, { projectId: suggestion.suggestedProjectId });
          successCount++;
        } catch (error) {
          console.error("Failed to update task project:", error);
        }
      }

      if (successCount > 0) {
        addToast(
          `Successfully reassigned ${successCount} task${successCount > 1 ? "s" : ""} to new projects`,
          "success",
        );
        loadSuggestions(); // Refresh to show remaining suggestions
      }
    } catch (error) {
      console.error("Failed to apply assignments:", error);
      addToast("Failed to apply some assignments", "error");
    } finally {
      setApplying(false);
    }
  };

  const approveAll = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: s.confidence >= 0.7 })));
  };

  const approveNone = () => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, approved: false })));
  };

  if (loading) {
    return (
      <ModalWrapper isOpen={isOpen} onClose={onClose} title="Analyzing Project Assignments">
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-cyan-400 mr-3" />
          <span className="text-slate-400">
            AI is analyzing tasks and suggesting optimal project placements...
          </span>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="Smart Project Assignment" size="xl">
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
            <Globe size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">AI-Powered Project Assignment</h3>
            <p className="text-sm text-slate-400 mt-1">
              AI has analyzed your tasks and suggested the most appropriate projects for each task
              based on content, tags, and context.
            </p>
          </div>
        </div>

        {suggestions.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Globe size={48} className="mx-auto mb-4 opacity-50" />
            <p>No project assignment suggestions found</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">
                Found {suggestions.length} project assignment suggestion
                {suggestions.length > 1 ? "s" : ""}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={approveAll}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors"
                >
                  Approve All (Confidence ≥ 70%)
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
                <AssignmentSuggestionCard
                  key={suggestion.taskId}
                  suggestion={suggestion}
                  projects={projects}
                  onToggleApproval={() => toggleApproval(suggestion.taskId)}
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
                  onClick={applyApprovedAssignments}
                  disabled={applying || !suggestions.some((s) => s.approved)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-slate-950 rounded-lg text-sm font-bold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {applying ? "Applying Assignments..." : "Apply Assignments"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  );
};

interface AssignmentSuggestionCardProps {
  suggestion: AssignmentSuggestion;
  projects: Project[];
  onToggleApproval: () => void;
}

const AssignmentSuggestionCard: React.FC<AssignmentSuggestionCardProps> = ({
  suggestion,
  projects,
  onToggleApproval,
}) => {
  const task = projects.find((p) => p.id === suggestion.taskId);
  const suggestedProject = projects.find((p) => p.id === suggestion.suggestedProjectId);

  if (!task || !suggestedProject) return null;

  return (
    <div
      className={`relative bg-white/5 border rounded-xl p-4 transition-all ${
        suggestion.approved ? "border-blue-500/50 bg-blue-500/5" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-blue-500" />
          <span className="text-sm font-medium text-white">Reassign Task</span>
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
            {Math.round(suggestion.confidence * 100)}% confidence
          </span>
        </div>
        <button
          onClick={onToggleApproval}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
            suggestion.approved
              ? "bg-blue-500 text-slate-950"
              : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        >
          {suggestion.approved ? "Approved" : "Approve"}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="flex-1">
            <p className="text-sm text-white font-medium">{task.title}</p>
            <p className="text-xs text-slate-400">Current project</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ArrowRight size={16} className="text-blue-500" />
          <span className="text-xs text-slate-400">should be moved to</span>
        </div>

        <div className="flex items-center gap-3 p-2 bg-slate-800/50 rounded-lg">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <div className="flex-1">
            <p className="text-sm text-white font-medium">{suggestedProject.title}</p>
            <p className="text-xs text-slate-400">Suggested project</p>
          </div>
        </div>
      </div>

      {suggestion.reasoning && (
        <div className="mt-3 p-3 bg-slate-800/30 border border-slate-700 rounded-lg">
          <div className="flex items-start gap-2">
            <Brain size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-blue-400 mb-1">AI Analysis</p>
              <p className="text-xs text-slate-300">{suggestion.reasoning}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
