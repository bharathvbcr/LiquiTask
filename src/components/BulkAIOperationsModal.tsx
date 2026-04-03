import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Download,
  Loader2,
  Merge,
  Sparkles,
  Tags,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { AIContext, PriorityDefinition, Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";
import { taskCleanupService } from "../services/taskCleanupService";

interface BulkAIOperationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onArchiveTask: (taskId: string) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface AIOperation {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  run: () => Promise<{ success: number; skipped: number; message: string }>;
}

export const BulkAIOperationsModal: React.FC<BulkAIOperationsModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  onUpdateTask,
  onArchiveTask,
  addToast,
}) => {
  const [runningOperation, setRunningOperation] = useState<string | null>(null);
  const [operationResults, setOperationResults] = useState<
    Record<string, { success: number; skipped: number; message: string } | null>
  >({});
  const [_selectedTasks, _setSelectedTasks] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const getContext = (): AIContext => {
    const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
    const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);
    const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
    return { activeProjectId, projects, priorities };
  };

  const operations: AIOperation[] = [
    {
      id: "detect-duplicates",
      name: "Detect Duplicates",
      description: "Scan all tasks for duplicates and suggest merges",
      icon: <Merge size={20} />,
      color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
      run: async () => {
        const duplicates = await taskCleanupService.detectDuplicates(allTasks);
        let success = 0;
        for (const group of duplicates) {
          if (group.tasks.length >= 2) {
            const suggestion = await taskCleanupService.suggestMerge(group);
            for (const id of suggestion.archiveTaskIds) {
              onArchiveTask(id);
              success++;
            }
          }
        }
        return {
          success,
          skipped: allTasks.length - success,
          message: `Found and merged ${success} duplicate(s)`,
        };
      },
    },
    {
      id: "suggest-priorities",
      name: "AI Reprioritize",
      description: "Analyze all tasks and suggest optimal priorities",
      icon: <Zap size={20} />,
      color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      run: async () => {
        const suggestions = await aiService.suggestPriorities(allTasks, getContext());
        let success = 0;
        for (const s of suggestions) {
          if (s.confidence >= 0.7 && s.suggestedValue !== s.currentValue) {
            onUpdateTask(s.taskId, { priority: s.suggestedValue as string });
            success++;
          }
        }
        return {
          success,
          skipped: suggestions.length - success,
          message: `Updated ${success} priority/ies`,
        };
      },
    },
    {
      id: "categorize-tasks",
      name: "Auto-Categorize",
      description: "AI suggests relevant tags and projects for all tasks",
      icon: <Tags size={20} />,
      color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
      run: async () => {
        const suggestions = await aiService.categorizeTasks(allTasks, getContext());
        let success = 0;
        for (const s of suggestions) {
          if (s.confidence >= 0.6 && s.suggestedTags.length > 0) {
            const task = allTasks.find((t) => t.id === s.taskId);
            if (task) {
              const newTags = Array.from(new Set([...task.tags, ...s.suggestedTags]));
              onUpdateTask(s.taskId, { tags: newTags });
              success++;
            }
          }
        }
        return {
          success,
          skipped: suggestions.length - success,
          message: `Categorized ${success} task(s)`,
        };
      },
    },
    {
      id: "clean-redundant",
      name: "Clean Redundant Tasks",
      description: "Find and archive stale, subset, or completed-overlap tasks",
      icon: <Trash2 size={20} />,
      color: "text-red-400 bg-red-500/10 border-red-500/20",
      run: async () => {
        const analyses = await taskCleanupService.analyzeRedundancy(allTasks);
        let success = 0;
        for (const a of analyses) {
          if (a.confidence >= 0.75 && a.suggestedAction === "archive") {
            onArchiveTask(a.taskId);
            success++;
          }
        }
        return {
          success,
          skipped: analyses.length - success,
          message: `Archived ${success} redundant task(s)`,
        };
      },
    },
    {
      id: "generate-insights",
      name: "Generate Insights",
      description: "AI analyzes productivity, bottlenecks, and patterns",
      icon: <Brain size={20} />,
      color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
      run: async () => {
        const insights = await aiService.generateInsights(allTasks, getContext());
        return {
          success: insights.length,
          skipped: 0,
          message: `Generated ${insights.length} insight(s)`,
        };
      },
    },
    {
      id: "suggest-schedule",
      name: "Smart Schedule",
      description: "AI suggests due dates for tasks without deadlines",
      icon: <ArrowRight size={20} />,
      color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      run: async () => {
        const tasksWithoutDueDate = allTasks.filter((t) => !t.dueDate && !t.completedAt);
        let success = 0;
        for (const task of tasksWithoutDueDate.slice(0, 15)) {
          const result = await aiService.suggestSchedule(task, allTasks, getContext());
          if (result.suggestedDueDate) {
            onUpdateTask(task.id, { dueDate: result.suggestedDueDate });
            success++;
          }
        }
        return {
          success,
          skipped: tasksWithoutDueDate.length - success,
          message: `Scheduled ${success} task(s)`,
        };
      },
    },
  ];

  const runOperation = async (op: AIOperation) => {
    if (runningOperation) return;
    setRunningOperation(op.id);
    try {
      const result = await op.run();
      setOperationResults((prev) => ({ ...prev, [op.id]: result }));
      addToast(result.message, "success");
    } catch (e: any) {
      addToast(e.message || `${op.name} failed`, "error");
      setOperationResults((prev) => ({
        ...prev,
        [op.id]: { success: 0, skipped: 0, message: `Failed: ${e.message}` },
      }));
    } finally {
      setRunningOperation(null);
    }
  };

  const exportReport = () => {
    const report = `# LiquiTask AI Operations Report\nGenerated: ${new Date().toISOString()}\n\n## Task Summary\n- Total Tasks: ${allTasks.length}\n- Completed: ${allTasks.filter((t) => t.completedAt).length}\n- Active: ${allTasks.filter((t) => !t.completedAt).length}\n- Overdue: ${allTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && !t.completedAt).length}\n\n## Operation Results\n${Object.entries(
      operationResults,
    )
      .map(
        ([id, result]) =>
          `- **${operations.find((o) => o.id === id)?.name}**: ${result?.message || "Not run"}`,
      )
      .join("\n")}\n`;
    const blob = new Blob([report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `liquitask-ai-report-${new Date().toISOString().split("T")[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Report exported as Markdown", "success");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Bulk AI Operations</h2>
              <p className="text-xs text-slate-400">
                Run batch AI operations on all {allTasks.length} tasks
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {Object.keys(operationResults).length > 0 && (
              <button
                onClick={exportReport}
                className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
                title="Export AI report as Markdown"
              >
                <Download size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Operations Grid */}
        <div className="overflow-y-auto max-h-[calc(85vh-80px)] p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {operations.map((op) => {
              const result = operationResults[op.id];
              const isRunning = runningOperation === op.id;
              return (
                <button
                  key={op.id}
                  onClick={() => runOperation(op)}
                  disabled={isRunning}
                  className={`relative p-4 rounded-xl border text-left transition-all hover:scale-[1.02] disabled:opacity-70 disabled:cursor-wait ${op.color} ${result ? "ring-1 ring-white/10" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg bg-white/5 mt-0.5">
                      {isRunning ? <Loader2 size={16} className="animate-spin" /> : op.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">{op.name}</h3>
                        {result && <CheckCircle2 size={12} className="text-emerald-400" />}
                      </div>
                      <p className="text-[10px] text-white/60 mt-0.5 leading-relaxed">
                        {op.description}
                      </p>
                      {result && (
                        <div className="mt-2 text-[10px] font-medium text-white/80">
                          {result.message}
                        </div>
                      )}
                    </div>
                  </div>
                  {isRunning && (
                    <div className="absolute inset-0 bg-black/20 rounded-xl flex items-center justify-center">
                      <div className="flex items-center gap-2 text-xs font-medium text-white">
                        <Loader2 size={14} className="animate-spin" />
                        Running...
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Warning */}
          <div className="mt-6 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-amber-300">Important</p>
                <p className="text-[10px] text-amber-400/80 mt-0.5">
                  AI operations modify your tasks. Use the undo feature (Ctrl+Z) to revert changes.
                  Results depend on AI provider quality and task data.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
