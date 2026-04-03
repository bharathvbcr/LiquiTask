import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderInput,
  GitBranch,
  Loader2,
  Merge,
  Settings,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { AutoOrganizeChange, AutoOrganizeConfig, AutoOrganizeResult, Task } from "../../types";
import { aiService } from "../services/aiService";
import { autoOrganizeService } from "../services/autoOrganizeService";

interface AutoOrganizePanelProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
  onArchiveTask: (taskId: string) => void;
  onMoveTask: (taskId: string, newProjectId: string) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

type TabId = "configure" | "preview" | "history";

const OPERATION_META: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; description: string }
> = {
  deduplication: {
    label: "Deduplicate",
    icon: <Merge size={14} />,
    color: "text-blue-400",
    description: "Detect and merge duplicate tasks",
  },
  clustering: {
    label: "Cluster",
    icon: <Brain size={14} />,
    color: "text-purple-400",
    description: "Group tasks by theme and add tags",
  },
  autoTagging: {
    label: "Auto-Tag",
    icon: <Tags size={14} />,
    color: "text-emerald-400",
    description: "AI-suggested tags for all tasks",
  },
  hierarchyDetection: {
    label: "Hierarchy",
    icon: <GitBranch size={14} />,
    color: "text-amber-400",
    description: "Detect parent-child relationships",
  },
  projectAssignment: {
    label: "Project Move",
    icon: <FolderInput size={14} />,
    color: "text-cyan-400",
    description: "Suggest better project assignments",
  },
  tagConsolidation: {
    label: "Tag Cleanup",
    icon: <Trash2 size={14} />,
    color: "text-red-400",
    description: "Merge similar/duplicate tags",
  },
};

const CHANGE_TYPE_META: Record<string, { label: string; color: string }> = {
  merge: { label: "Merge", color: "text-blue-400" },
  tag: { label: "Tag", color: "text-emerald-400" },
  cluster: { label: "Cluster", color: "text-purple-400" },
  hierarchy: { label: "Hierarchy", color: "text-amber-400" },
  "project-move": { label: "Move", color: "text-cyan-400" },
  "tag-consolidate": { label: "Tag Merge", color: "text-red-400" },
};

export const AutoOrganizePanel: React.FC<AutoOrganizePanelProps> = ({
  isOpen,
  onClose,
  allTasks,
  onUpdateTask,
  onArchiveTask,
  onMoveTask,
  addToast,
}) => {
  const [activeTab, setActiveTab] = useState<TabId>("configure");
  const [config, setConfig] = useState<AutoOrganizeConfig>(aiService.getAutoOrganizeConfig());
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<AutoOrganizeResult | null>(null);
  const [expandedChanges, setExpandedChanges] = useState<Set<string>>(new Set());

  const loadConfig = useCallback(() => {
    setConfig(aiService.getAutoOrganizeConfig());
  }, []);

  const loadHistory = useCallback(() => {
    const history = aiService.getOrganizeHistory();
    if (history.length > 0) {
      setLastResult(history[0]);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadConfig();
      loadHistory();
    }
  }, [isOpen, loadConfig, loadHistory]);

  if (!isOpen) return null;

  const saveConfig = (updated: AutoOrganizeConfig) => {
    setConfig(updated);
    aiService.saveAutoOrganizeConfig(updated);
  };

  const toggleOperation = (key: keyof AutoOrganizeConfig["operations"]) => {
    saveConfig({
      ...config,
      operations: { ...config.operations, [key]: !config.operations[key] },
    });
  };

  const runOrganize = async () => {
    setIsRunning(true);
    setProgress("Starting analysis...");
    setActiveTab("preview");
    try {
      const result = await autoOrganizeService.runAutoOrganize(allTasks, (phase, pct) => {
        const meta = OPERATION_META[phase];
        setProgress(`Running ${meta?.label || phase}... (${Math.round(pct)}%)`);
      });
      setLastResult(result);
      setProgress(null);
      addToast(
        `Auto-organize complete: ${result.autoApplied} applied, ${result.pendingReview} pending review`,
        "success",
      );
    } catch (e: any) {
      setProgress(null);
      addToast(e.message || "Auto-organize failed", "error");
    } finally {
      setIsRunning(false);
    }
  };

  const applyPendingChanges = async () => {
    if (!lastResult) return;
    const pending = lastResult.changes.filter((c) => c.status === "pending-review");
    const toApply = pending.filter((c) => expandedChanges.has(c.id));

    if (toApply.length === 0) {
      addToast("No changes selected to apply", "info");
      return;
    }

    const { applied } = await autoOrganizeService.applyChanges(toApply, {
      onUpdateTask,
      onArchiveTask,
      onMoveTask,
    });

    const updatedChanges = lastResult.changes.map((c) =>
      toApply.find((tc) => tc.id === c.id) ? { ...c, status: "auto-applied" as const } : c,
    );
    setLastResult({
      ...lastResult,
      changes: updatedChanges,
      autoApplied: lastResult.autoApplied + applied,
    });
    addToast(`Applied ${applied} change(s)`, "success");
  };

  const rejectPendingChanges = () => {
    if (!lastResult) return;
    const pending = lastResult.changes.filter((c) => c.status === "pending-review");
    const toReject = pending.filter((c) => expandedChanges.has(c.id));

    const updatedChanges = lastResult.changes.map((c) =>
      toReject.find((tc) => tc.id === c.id) ? { ...c, status: "rejected" as const } : c,
    );
    setLastResult({ ...lastResult, changes: updatedChanges });
    addToast(`Rejected ${toReject.length} change(s)`, "info");
  };

  const toggleExpand = (id: string) => {
    setExpandedChanges((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendingCount = lastResult?.changes.filter((c) => c.status === "pending-review").length ?? 0;
  const appliedCount = lastResult?.changes.filter((c) => c.status === "auto-applied").length ?? 0;

  const renderConfigureTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Operations</h3>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(OPERATION_META).map(([key, meta]) => {
            const enabled = config.operations[key as keyof typeof config.operations];
            return (
              <button
                key={key}
                onClick={() => toggleOperation(key as keyof AutoOrganizeConfig["operations"])}
                className={`p-3 rounded-lg border text-left transition-all ${
                  enabled
                    ? "bg-white/5 border-white/10"
                    : "bg-transparent border-white/5 opacity-50"
                }`}
              >
                <div className={`flex items-center gap-2 ${meta.color}`}>
                  {meta.icon}
                  <span className="text-xs font-medium text-white">{meta.label}</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">{meta.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Thresholds</h3>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Auto-apply threshold</span>
              <span className="text-xs font-mono text-cyan-400">
                {Math.round(config.autoApplyThreshold * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={99}
              value={Math.round(config.autoApplyThreshold * 100)}
              onChange={(e) =>
                saveConfig({ ...config, autoApplyThreshold: Number(e.target.value) / 100 })
              }
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500"
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Changes above this confidence are applied automatically
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400">Suggest threshold</span>
              <span className="text-xs font-mono text-amber-400">
                {Math.round(config.suggestThreshold * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={99}
              value={Math.round(config.suggestThreshold * 100)}
              onChange={(e) =>
                saveConfig({ ...config, suggestThreshold: Number(e.target.value) / 100 })
              }
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-amber-500"
            />
            <p className="text-[10px] text-slate-600 mt-1">
              Changes above this threshold are shown for review
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Schedule</h3>
        <div className="flex gap-2">
          {(["manual", "onCreate", "hourly", "daily", "weekly"] as const).map((s) => (
            <button
              key={s}
              onClick={() => saveConfig({ ...config, schedule: s })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                config.schedule === s
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "bg-white/5 text-slate-400 border border-white/5 hover:text-white"
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={runOrganize}
          disabled={isRunning || allTasks.length === 0}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-semibold hover:from-cyan-400 hover:to-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {isRunning ? "Analyzing..." : "Run Auto-Organize"}
        </button>
      </div>
    </div>
  );

  const renderPreviewTab = () => {
    if (isRunning) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 size={32} className="text-cyan-400 animate-spin mb-4" />
          <p className="text-sm text-white font-medium">{progress || "Analyzing tasks..."}</p>
          <p className="text-xs text-slate-500 mt-1">{allTasks.length} tasks being analyzed</p>
        </div>
      );
    }

    if (!lastResult || lastResult.changes.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Sparkles size={48} className="mb-4 opacity-30" />
          <p className="text-sm">No results yet. Configure and run auto-organize first.</p>
          <button
            onClick={() => setActiveTab("configure")}
            className="mt-3 text-xs text-cyan-400 hover:text-cyan-300"
          >
            Go to Configuration →
          </button>
        </div>
      );
    }

    const changesByStatus = {
      "auto-applied": lastResult.changes.filter((c) => c.status === "auto-applied"),
      "pending-review": lastResult.changes.filter((c) => c.status === "pending-review"),
      rejected: lastResult.changes.filter((c) => c.status === "rejected"),
    };

    return (
      <div className="space-y-4">
        {lastResult && (
          <div className="p-3 rounded-lg bg-white/5 border border-white/5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                {lastResult.tasksAnalyzed} tasks analyzed · {Math.round(lastResult.duration / 1000)}
                s
              </span>
              <div className="flex gap-3">
                <span className="text-emerald-400">{appliedCount} applied</span>
                <span className="text-amber-400">{pendingCount} pending</span>
              </div>
            </div>
          </div>
        )}

        {pendingCount > 0 && (
          <div className="flex gap-2">
            <button
              onClick={applyPendingChanges}
              className="flex-1 px-3 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-medium hover:bg-emerald-500/30 transition-all"
            >
              Apply Selected ({expandedChanges.size})
            </button>
            <button
              onClick={rejectPendingChanges}
              className="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-all"
            >
              Reject Selected
            </button>
          </div>
        )}

        {Object.entries(changesByStatus).map(([status, changes]) => {
          if (changes.length === 0) return null;
          return (
            <div key={status}>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                {status.replace("-", " ")} ({changes.length})
              </h4>
              <div className="space-y-1">
                {changes.map((change) => {
                  const typeMeta = CHANGE_TYPE_META[change.type] || {
                    label: change.type,
                    color: "text-slate-400",
                  };
                  const isExpanded = expandedChanges.has(change.id);
                  return (
                    <div
                      key={change.id}
                      className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden"
                    >
                      <button
                        onClick={() => toggleExpand(change.id)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/5 transition-all"
                      >
                        <span className={`text-xs font-medium ${typeMeta.color}`}>
                          {typeMeta.label}
                        </span>
                        <span className="text-xs text-slate-300 flex-1 truncate">
                          {change.reasoning.substring(0, 80)}
                          {change.reasoning.length > 80 ? "..." : ""}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {Math.round(change.confidence * 100)}%
                        </span>
                        {isExpanded ? (
                          <ChevronDown size={12} className="text-slate-500" />
                        ) : (
                          <ChevronRight size={12} className="text-slate-500" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 text-xs text-slate-400 space-y-2 border-t border-white/5 pt-2">
                          <p>{change.reasoning}</p>
                          {change.clusterTheme && (
                            <p className="text-purple-400">Cluster: {change.clusterTheme}</p>
                          )}
                          <div className="flex gap-4">
                            <div>
                              <span className="text-slate-600">Before:</span>
                              <pre className="text-[10px] mt-1 text-slate-500 overflow-auto max-h-20">
                                {JSON.stringify(change.before, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <span className="text-slate-600">After:</span>
                              <pre className="text-[10px] mt-1 text-emerald-500/70 overflow-auto max-h-20">
                                {JSON.stringify(change.after, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderHistoryTab = () => {
    const history = aiService.getOrganizeHistory();
    if (history.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Settings size={48} className="mb-4 opacity-30" />
          <p className="text-sm">No auto-organize history yet.</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {history.map((run) => (
          <div key={run.id} className="p-3 rounded-lg border border-white/5 bg-white/[0.02]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">
                {new Date(run.timestamp).toLocaleString()}
              </span>
              <span className="text-[10px] text-slate-600">
                {Math.round(run.duration / 1000)}s · {run.tasksAnalyzed} tasks
              </span>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="text-emerald-400">{run.autoApplied} applied</span>
              <span className="text-amber-400">{run.pendingReview} reviewed</span>
              <span className="text-slate-500">{run.changes.length} total</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden shadow-2xl animate-in zoom-in-95 flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">AI Auto-Organize</h2>
              <p className="text-xs text-slate-400">
                Smart task grouping, merging, and categorization
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-white/10 shrink-0">
          {[
            { id: "configure" as TabId, label: "Configure", icon: <Settings size={12} /> },
            {
              id: "preview" as TabId,
              label: `Preview${pendingCount > 0 ? ` (${pendingCount})` : ""}`,
              icon: <CheckCircle2 size={12} />,
            },
            { id: "history" as TabId, label: "History", icon: <ArrowRight size={12} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-all border-b-2 ${
                activeTab === tab.id
                  ? "text-cyan-400 border-cyan-400 bg-cyan-500/5"
                  : "text-slate-500 border-transparent hover:text-slate-300"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {activeTab === "configure" && renderConfigureTab()}
          {activeTab === "preview" && renderPreviewTab()}
          {activeTab === "history" && renderHistoryTab()}
        </div>
      </div>
    </div>
  );
};
