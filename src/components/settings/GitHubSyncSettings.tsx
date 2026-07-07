import { Github, Loader2, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { isTauri } from "../../runtime/runtimeEnvironment";
import agentService from "../../services/agents/agentService";
import githubSyncService, {
  type GitHubSyncConfig,
} from "../../services/githubSyncService";
import type { Project, Task, ToastType } from "../../../types";
import { SettingsToggle } from "./SettingsToggle";

interface GitHubSyncSettingsProps {
  projects: Project[];
  activeProjectId: string;
  tasks: Task[];
  backlogStatus: string;
  onImportTasks: (tasks: Task[]) => void;
  addToast: (msg: string, type: ToastType) => void;
}

export const GitHubSyncSettings: React.FC<GitHubSyncSettingsProps> = ({
  projects,
  activeProjectId,
  tasks,
  backlogStatus,
  onImportTasks,
  addToast,
}) => {
  const [config, setConfig] = useState<GitHubSyncConfig>(() => githubSyncService.load());
  const [detecting, setDetecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const persist = useCallback(
    (next: GitHubSyncConfig) => {
      setConfig(next);
      githubSyncService.save(next);
    },
    [],
  );

  const detectFromAgent = async () => {
    const agent = agentService.getAgents()[0];
    if (!agent?.workingDir) {
      addToast("Add an agent with a working directory first", "warning");
      return;
    }
    setDetecting(true);
    try {
      const info = await githubSyncService.detectRepo(agent.workingDir);
      if (!info) {
        addToast("Could not detect GitHub repo from git remote", "error");
        return;
      }
      persist({
        ...config,
        owner: info.owner,
        repo: info.repo,
        workingDir: agent.workingDir,
      });
      addToast(`Detected ${info.owner}/${info.repo}`, "success");
    } finally {
      setDetecting(false);
    }
  };

  const importIssues = async () => {
    if (!config.enabled || !config.owner || !config.repo) {
      addToast("Enable sync and set owner/repo first", "warning");
      return;
    }
    setSyncing(true);
    try {
      githubSyncService.save(config);
      const issues = await githubSyncService.listIssues("open");
      const projectId = config.defaultProjectId || activeProjectId;
      const partials = githubSyncService.issuesToTasks(issues, projectId, backlogStatus, tasks);
      if (!partials.length) {
        addToast("No new issues to import", "info");
        return;
      }
      const created = githubSyncService.createTasksFromIssues(
        issues.filter((i) => partials.some((p) => p.githubIssue?.number === i.number)),
        projectId,
        backlogStatus,
      );
      onImportTasks(created);
      addToast(`Imported ${created.length} GitHub issue(s)`, "success");
    } catch (e) {
      addToast((e as Error).message || "Import failed", "error");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!config.defaultProjectId && activeProjectId) {
      persist({ ...config, defaultProjectId: activeProjectId });
    }
  }, [activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isTauri()) {
    return (
      <p className="text-sm text-slate-500">
        GitHub Issues sync requires the LiquiTask desktop app and the <code className="text-slate-400">gh</code> CLI.
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/5 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Github size={16} /> GitHub Issues sync
          </h4>
          <p className="text-xs text-slate-500 mt-1">
            Import open issues as tasks; close and comment on GitHub when tasks complete.
          </p>
        </div>
        <SettingsToggle
          checked={config.enabled}
          onChange={(enabled) => persist({ ...config, enabled })}
          aria-label="Enable GitHub Issues sync"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">
          Owner
          <input
            className="mt-1 w-full liquid-input rounded-lg px-3 py-2 text-sm"
            value={config.owner}
            onChange={(e) => persist({ ...config, owner: e.target.value.trim() })}
            placeholder="acme"
          />
        </label>
        <label className="text-xs text-slate-400">
          Repo
          <input
            className="mt-1 w-full liquid-input rounded-lg px-3 py-2 text-sm"
            value={config.repo}
            onChange={(e) => persist({ ...config, repo: e.target.value.trim() })}
            placeholder="widgets"
          />
        </label>
      </div>

      <label className="text-xs text-slate-400 block">
        Import into project
        <select
          className="mt-1 w-full liquid-input rounded-lg px-3 py-2 text-sm"
          value={config.defaultProjectId || activeProjectId}
          onChange={(e) => persist({ ...config, defaultProjectId: e.target.value })}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-4 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          <SettingsToggle
            checked={config.closeOnComplete}
            onChange={(closeOnComplete) => persist({ ...config, closeOnComplete })}
            aria-label="Close GitHub issue on task complete"
          />
          Close issue on complete
        </label>
        <label className="flex items-center gap-2">
          <SettingsToggle
            checked={config.commentOnStatusChange}
            onChange={(commentOnStatusChange) =>
              persist({ ...config, commentOnStatusChange })
            }
            aria-label="Comment on GitHub when status changes"
          />
          Comment on status change
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void detectFromAgent()}
          disabled={detecting}
          className="text-xs px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 flex items-center gap-1"
        >
          {detecting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Detect from agent repo
        </button>
        <button
          type="button"
          onClick={() => void importIssues()}
          disabled={syncing || !config.enabled}
          className="text-xs px-3 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 flex items-center gap-1 disabled:opacity-40"
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <Github size={12} />}
          Import open issues
        </button>
      </div>

      <p className="text-[11px] text-slate-600">
        Requires <code className="text-slate-500">gh auth login</code>. PAT scopes: repo (issues read/write).
      </p>
    </div>
  );
};

export default GitHubSyncSettings;
