import { Brain, CheckCircle2, FolderOpen, Loader2, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { ModalWrapper } from "../../components/ModalWrapper";
import type { PriorityDefinition, Project, Task, TaskCluster } from "../../types";
import { STORAGE_KEYS } from "../constants";
import { aiService } from "../services/aiService";
import storageService from "../services/storageService";

interface AIReorganizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  allTasks: Task[];
  onCreateProject: (project: Partial<Project>) => void;
  onMoveTask: (taskId: string, projectId: string) => void;
  addToast: (msg: string, type: "success" | "error" | "info" | "warning") => void;
}

interface ClusterGroup {
  cluster: TaskCluster;
  approved: boolean;
  projectName?: string;
}

export const AIReorganizeModal: React.FC<AIReorganizeModalProps> = ({
  isOpen,
  onClose,
  allTasks,
  onCreateProject,
  onMoveTask,
  addToast,
}) => {
  const [clusters, setClusters] = useState<ClusterGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadClusters = useCallback(async () => {
    setLoading(true);
    try {
      const activeProjectId = storageService.get<string>(STORAGE_KEYS.ACTIVE_PROJECT, "");
      const projects = storageService.get<Project[]>(STORAGE_KEYS.PROJECTS, []);
      const priorities = storageService.get<PriorityDefinition[]>(STORAGE_KEYS.PRIORITIES, []);

      const context = {
        activeProjectId,
        projects,
        priorities,
      };

      const taskClusters = await aiService.clusterTasks(allTasks, context);

      if (taskClusters.length === 0) {
        addToast("No task clusters found for reorganization", "info");
        onClose();
        return;
      }

      setClusters(
        taskClusters.map((cluster) => ({
          cluster,
          approved: false,
          projectName: cluster.theme,
        })),
      );
    } catch (error) {
      console.error("Failed to cluster tasks:", error);
      addToast("Failed to analyze task clusters", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [allTasks, addToast, onClose]);

  useEffect(() => {
    if (isOpen) {
      loadClusters();
    } else {
      setClusters([]);
    }
  }, [isOpen, loadClusters]);

  const toggleApproval = (clusterId: string) => {
    setClusters((prev) =>
      prev.map((c) => (c.cluster.id === clusterId ? { ...c, approved: !c.approved } : c)),
    );
  };

  const updateProjectName = (clusterId: string, name: string) => {
    setClusters((prev) =>
      prev.map((c) => (c.cluster.id === clusterId ? { ...c, projectName: name } : c)),
    );
  };

  const applyApprovedClusters = async () => {
    const approvedClusters = clusters.filter((c) => c.approved);

    if (approvedClusters.length === 0) {
      addToast("No clusters approved for reorganization", "warning");
      return;
    }

    setApplying(true);
    try {
      let successCount = 0;

      for (const { cluster, projectName } of approvedClusters) {
        try {
          // Create new project for this cluster
          const newProject = {
            id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: projectName || cluster.theme,
            type: "default" as const,
            color: getRandomColor(),
          };

          onCreateProject(newProject);

          // Move tasks to new project
          for (const taskId of cluster.taskIds) {
            onMoveTask(taskId, newProject.id);
          }

          successCount++;
        } catch (error) {
          console.error("Failed to create project for cluster:", error);
        }
      }

      if (successCount > 0) {
        addToast(
          `Successfully reorganized ${successCount} cluster${successCount > 1 ? "s" : ""} into new projects`,
          "success",
        );
        loadClusters(); // Refresh to show remaining clusters
      }
    } catch (error) {
      console.error("Failed to apply reorganization:", error);
      addToast("Failed to apply some reorganizations", "error");
    } finally {
      setApplying(false);
    }
  };

  const approveAll = () => {
    setClusters((prev) => prev.map((c) => ({ ...c, approved: true })));
  };

  const approveNone = () => {
    setClusters((prev) => prev.map((c) => ({ ...c, approved: false })));
  };

  if (loading) {
    return (
      <ModalWrapper isOpen={isOpen} onClose={onClose} title="Analyzing Task Clusters">
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-cyan-400 mr-3" />
          <span className="text-slate-400">
            AI is analyzing your tasks and grouping them into themed clusters...
          </span>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="Smart Reorganize Tasks" size="xl">
      <div className="space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
            <Sparkles size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white">AI-Powered Task Clustering</h3>
            <p className="text-sm text-slate-400 mt-1">
              AI has analyzed your tasks and grouped them into themed clusters. Each cluster can
              become a new project to better organize your workflow.
            </p>
          </div>
        </div>

        {clusters.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Brain size={48} className="mx-auto mb-4 opacity-50" />
            <p>No task clusters found</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">
                Found {clusters.length} cluster{clusters.length > 1 ? "s" : ""} of related tasks
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
              {clusters.map((clusterGroup) => (
                <ClusterCard
                  key={clusterGroup.cluster.id}
                  clusterGroup={clusterGroup}
                  onToggleApproval={() => toggleApproval(clusterGroup.cluster.id)}
                  onUpdateProjectName={(name) => updateProjectName(clusterGroup.cluster.id, name)}
                />
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <div className="text-xs text-slate-500">
                {clusters.filter((c) => c.approved).length} of {clusters.length} clusters approved
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={applyApprovedClusters}
                  disabled={applying || !clusters.some((c) => c.approved)}
                  className="flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 rounded-lg text-sm font-bold shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {applying ? "Reorganizing..." : "Apply Reorganization"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalWrapper>
  );
};

interface ClusterCardProps {
  clusterGroup: ClusterGroup;
  onToggleApproval: () => void;
  onUpdateProjectName: (name: string) => void;
}

const ClusterCard: React.FC<ClusterCardProps> = ({
  clusterGroup,
  onToggleApproval,
  onUpdateProjectName,
}) => {
  const { cluster, approved, projectName } = clusterGroup;

  return (
    <div
      className={`relative bg-white/5 border rounded-xl p-4 transition-all ${
        approved ? "border-cyan-500/50 bg-cyan-500/5" : "border-white/10"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={16} className="text-cyan-500" />
          <span className="text-sm font-medium text-white">
            {cluster.taskIds.length} related tasks
          </span>
        </div>
        <button
          onClick={onToggleApproval}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
            approved
              ? "bg-cyan-500 text-slate-950"
              : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
          }`}
        >
          {approved ? "Approved" : "Approve"}
        </button>
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium text-slate-400 mb-1 block">Theme</label>
        <p className="text-sm text-white font-medium">{cluster.theme}</p>
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium text-slate-400 mb-1 block">New Project Name</label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onUpdateProjectName(e.target.value)}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
          placeholder="Enter project name"
        />
      </div>

      <div className="mb-3">
        <label className="text-xs font-medium text-slate-400 mb-2 block">Sample Tasks</label>
        <div className="space-y-1 max-h-20 overflow-y-auto">
          {cluster.taskIds.slice(0, 3).map((taskId) => (
            <div key={taskId} className="text-xs text-slate-400 truncate">
              • Task {taskId.slice(-8)}
            </div>
          ))}
          {cluster.taskIds.length > 3 && (
            <div className="text-xs text-slate-500">...and {cluster.taskIds.length - 3} more</div>
          )}
        </div>
      </div>

      {cluster.theme && (
        <div className="p-3 bg-slate-800/30 border border-slate-700 rounded-lg">
          <div className="flex items-start gap-2">
            <Brain size={14} className="text-cyan-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-cyan-400 mb-1">AI Analysis</p>
              <p className="text-xs text-slate-300">{cluster.theme}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function getRandomColor(): string {
  const colors = [
    "#ef4444",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#10b981",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#64748b",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}
