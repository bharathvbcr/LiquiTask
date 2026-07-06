import {
  Bot,
  CheckCircle2,
  FolderOpen,
  Hammer,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { getDesktopApi, isTauri } from "../../src/runtime/runtimeEnvironment";
import agentMcpService from "../../src/services/agents/agentMcpService";
import agentRunService from "../../src/services/agents/agentRunService";
import agentService from "../../src/services/agents/agentService";
import type {
  AgentPermissionMode,
  AgentProfile,
  AgentRole,
  AgentRunMode,
  AgentSandbox,
  BoardColumn,
  Project,
  Task,
  ToastType,
} from "../../types";
import { SettingsToggle } from "./SettingsToggle";
import { AgentAnalyticsPanel } from "./AgentAnalyticsPanel";
import { AgentSkillsLibrary } from "./AgentSkillsLibrary";
import { GitHubSyncSettings } from "./GitHubSyncSettings";

interface AgentSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
  onAgentsChanged?: () => void;
  projects?: Project[];
  activeProjectId?: string;
  tasks?: Task[];
  columns?: BoardColumn[];
  onImportGitHubTasks?: (tasks: Task[]) => void;
}

const PERMISSION_MODES: { value: AgentPermissionMode; label: string; hint: string }[] = [
  { value: "plan", label: "Plan only", hint: "Read-only; proposes a plan without editing files" },
  { value: "default", label: "Default", hint: "Asks before edits (headless runs may stall)" },
  { value: "acceptEdits", label: "Accept edits", hint: "Edits files, asks for risky commands" },
  {
    value: "bypassPermissions",
    label: "Bypass permissions",
    hint: "Full autonomy — use with trusted repos only",
  },
];

export const AgentSettings: React.FC<AgentSettingsProps> = ({
  addToast,
  onAgentsChanged,
  projects = [],
  activeProjectId = "",
  tasks = [],
  columns = [],
  onImportGitHubTasks,
}) => {
  const [agents, setAgents] = useState<AgentProfile[]>(() => agentService.getAgents());
  const [clis, setClis] = useState<import("../../src/services/agents/agentRunService").AgentCliStatus[] | null>(null);
  const [checkingClis, setCheckingClis] = useState(false);
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [containerRunning, setContainerRunning] = useState(false);
  const [containerSystemOk, setContainerSystemOk] = useState<boolean | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [agentRuns, setAgentRuns] = useState(() => agentRunService.getRuns());
  const [autoApprovePermissions, setAutoApprovePermissions] = useState(
    () => agentMcpService.isAutoApproveEnabled(),
  );

  useEffect(() => {
    return agentRunService.subscribe(setAgentRuns);
  }, []);

  const detectClis = useCallback(async () => {
    setCheckingClis(true);
    try {
      setClis(await agentRunService.detectClis());
    } catch {
      setClis([]);
    } finally {
      setCheckingClis(false);
    }
  }, []);

  useEffect(() => {
    if (isTauri()) void detectClis();
  }, [detectClis]);

  const checkContainerSystem = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setContainerSystemOk(await invoke<boolean>("agent_container_system_status"));
    } catch {
      setContainerSystemOk(false);
    }
  }, []);

  useEffect(() => {
    if (isTauri()) void checkContainerSystem();
  }, [checkContainerSystem]);

  const buildSandboxImage = async () => {
    if (!isTauri()) return;
    setContainerRunning(true);
    setBuildLog([]);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");
      const runId = await invoke<string>("agent_container_build", {
        image: "liquitask-agent:latest",
        dockerfileDir: null,
      });
      const unlisten = await listen<{ runId: string; line?: string; stream: string; code?: number }>(
        "agent-run-event",
        (event) => {
          if (event.payload.runId !== runId) return;
          if (event.payload.line) {
            setBuildLog((prev) => [...prev.slice(-200), event.payload.line!]);
          }
          if (event.payload.stream === "exit") {
            unlisten();
            setContainerRunning(false);
            addToast(
              event.payload.code === 0 ? "Sandbox image built" : "Sandbox build failed",
              event.payload.code === 0 ? "success" : "error",
            );
          }
        },
      );
    } catch (err) {
      setContainerRunning(false);
      addToast(err instanceof Error ? err.message : "Build failed", "error");
    }
  };

  const cliAvailable = (name: string) => clis?.find((c) => c.name === name)?.available ?? false;

  const persist = async (next: AgentProfile[]) => {
    setAgents(next);
    onAgentsChanged?.();
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      addToast("Give the agent a name — it doubles as the assignee label.", "warning");
      return;
    }
    if (!draft.workingDir.trim()) {
      addToast("Pick a working directory (an authorised workspace folder).", "warning");
      return;
    }
    setSaving(true);
    try {
      await persist(await agentService.saveAgent({ ...draft, name: draft.name.trim() }));
      setDraft(null);
      addToast(`Agent "${draft.name.trim()}" saved`, "success");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: AgentProfile) => {
    await persist(await agentService.deleteAgent(agent.id));
    addToast(`Agent "${agent.name}" removed`, "info");
  };

  const pickWorkingDir = async () => {
    const api = getDesktopApi();
    const dir = await api?.workspace.selectDirectory();
    if (!dir || !draft) return;
    // The runner only accepts authorised workspace paths — add it to the allowlist.
    const paths = (await api?.workspace.getPaths()) ?? [];
    if (!paths.includes(dir)) {
      await api?.workspace.setPaths([...paths, dir]);
    }
    setDraft({ ...draft, workingDir: dir });
  };

  if (!isTauri()) {
    return (
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-sm text-slate-400">
        Agent teammates need the desktop app — they spawn Claude Code on your machine.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
          <Bot size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Agent Teammates</h3>
          <p className="text-sm text-slate-400">
            Assign tasks to Claude Code like a colleague — it picks up the work, streams progress
            into the card, and reports back.
          </p>
        </div>
      </div>

      {/* Permission prompts */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium text-white">Auto-approve permissions</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            When off, risky commands pause until you allow or deny on the agent dock card.
          </p>
        </div>
        <SettingsToggle
          checked={autoApprovePermissions}
          onChange={(checked) => {
            setAutoApprovePermissions(checked);
            agentMcpService.setAutoApproveEnabled(checked);
          }}
          color="amber"
          aria-label="Auto-approve agent permission prompts"
        />
      </div>

      {/* CLI availability */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-white">Runtime detection</h4>
          <button
            type="button"
            onClick={() => void detectClis()}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
          >
            {checkingClis ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Re-check
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {[
            { name: "claude", label: "Claude Code", required: true },
            { name: "dev", label: "DevCouncil", required: false },
            { name: "container", label: "apple/container", required: false },
          ].map((cli) => (
            <div
              key={cli.name}
              className="flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/5"
            >
              {cliAvailable(cli.name) ? (
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={14} className="text-slate-600 shrink-0" />
              )}
              <span className={cliAvailable(cli.name) ? "text-slate-300" : "text-slate-500"}>
                {cli.label}
                {cli.required ? " (required)" : " (optional)"}
              </span>
            </div>
          ))}
        </div>
        {clis && !cliAvailable("claude") && (
          <p className="text-xs text-amber-400">
            Claude Code CLI not found. Install it (npm install -g @anthropic-ai/claude-code) and
            re-check.
          </p>
        )}
      </div>

      {/* Container sandbox build */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-white">Sandbox image</h4>
          <span className="text-[10px] text-slate-500">
            system: {containerSystemOk === null ? "…" : containerSystemOk ? "running" : "stopped"}
          </span>
        </div>
        <button
          type="button"
          disabled={containerRunning || !cliAvailable("container")}
          onClick={() => void buildSandboxImage()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs hover:bg-purple-500/20 disabled:opacity-40"
        >
          {containerRunning ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />}
          Build sandbox image
        </button>
        {buildLog.length > 0 && (
          <pre className="max-h-32 overflow-y-auto text-[10px] text-slate-500 font-mono bg-black/30 rounded-lg p-2">
            {buildLog.slice(-30).join("\n")}
          </pre>
        )}
      </div>

      <AgentSkillsLibrary addToast={addToast} />

      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
        <h4 className="text-sm font-medium text-white">Agent analytics</h4>
        <AgentAnalyticsPanel agents={agents} runs={agentRuns} />
      </div>

      {onImportGitHubTasks && (
        <GitHubSyncSettings
          projects={projects}
          activeProjectId={activeProjectId}
          tasks={tasks}
          backlogStatus={columns.find((c) => c.id === "Pending")?.id ?? columns[0]?.id ?? "Pending"}
          onImportTasks={onImportGitHubTasks}
          addToast={addToast}
        />
      )}

      {/* Agent list */}
      <div className="space-y-2">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-red-400 shrink-0" />
                <span className="text-sm font-medium text-white truncate">{agent.name}</span>
                {agent.autoPickup && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    auto-pickup
                  </span>
                )}
                {agent.runsOnRecurrence !== false && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    on recurrence
                  </span>
                )}
                {(agent.role ?? "default") === "planner" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    planner
                  </span>
                )}
                {(agent.runMode ?? "direct") === "council" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    council
                  </span>
                )}
                {agent.devCouncilVerify && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    DevCouncil gate
                  </span>
                )}
                {agent.sandbox === "container" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    sandboxed
                  </span>
                )}
                {(agent.modelRouting ?? "fixed") === "auto" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    auto-model
                  </span>
                )}
                {agent.dailyCostCapUsd != null && agent.dailyCostCapUsd > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    ${agent.dailyCostCapUsd}/day
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 truncate mt-1">{agent.workingDir}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setDraft({ ...agent })}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                aria-label={`Edit ${agent.name}`}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(agent)}
                className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                aria-label={`Delete ${agent.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {agents.length === 0 && !draft && (
          <p className="text-sm text-slate-500 text-center py-6">
            No agents yet. Create one, then assign any task to it by name.
          </p>
        )}
      </div>

      {/* Editor */}
      {draft ? (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Name (assignee label)</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Claude"
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Model (optional)</span>
              <input
                value={draft.model ?? ""}
                onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
                placeholder="default"
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Model routing</span>
              <select
                value={draft.modelRouting ?? "fixed"}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    modelRouting: e.target.value as AgentProfile["modelRouting"],
                  })
                }
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
              >
                <option value="fixed">Fixed — always use the model above</option>
                <option value="auto">
                  Auto — route by task priority / time estimate (haiku → sonnet → opus)
                </option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Daily cost cap (USD)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={draft.dailyCostCapUsd ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setDraft({
                    ...draft,
                    dailyCostCapUsd: raw === "" ? undefined : Math.max(0, Number(raw)),
                  });
                }}
                placeholder="No cap"
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-slate-300">Max runs per day</span>
              <input
                type="number"
                min={0}
                step={1}
                value={draft.maxRunsPerDay ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  setDraft({
                    ...draft,
                    maxRunsPerDay: raw === "" ? undefined : Math.max(0, Math.floor(Number(raw))),
                  });
                }}
                placeholder="Unlimited"
                className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Working directory</span>
            <div className="flex gap-2">
              <input
                value={draft.workingDir}
                onChange={(e) => setDraft({ ...draft, workingDir: e.target.value })}
                placeholder="/path/to/repo"
                className="flex-1 liquid-input rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void pickWorkingDir()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 transition-all"
              >
                <FolderOpen size={14} /> Browse
              </button>
            </div>
          </div>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-300">Agent role</span>
            <select
              value={draft.role ?? "default"}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as AgentRole })}
              className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
            >
              <option value="default">Worker — executes tasks via Claude Code / council</option>
              <option value="planner">
                Planner — decomposes epics via DevCouncil `dev plan` on drop
              </option>
            </select>
            {(draft.role ?? "default") === "planner" && !cliAvailable("dev") && (
              <span className="text-xs text-amber-400 block">
                DevCouncil CLI (`dev`) not detected — planner runs will fail until installed.
              </span>
            )}
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-300">Run mode</span>
            <select
              value={draft.runMode ?? "direct"}
              onChange={(e) => setDraft({ ...draft, runMode: e.target.value as AgentRunMode })}
              className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
            >
              <option value="direct">Direct — Claude Code works the task immediately</option>
              <option value="council">
                Council — full DevCouncil pipeline (debate planning, hooks, evidence gates)
              </option>
            </select>
            {(draft.runMode ?? "direct") === "council" && !cliAvailable("dev") && (
              <span className="text-xs text-amber-400 block">
                DevCouncil CLI (`dev`) not detected — council runs will fail until it's installed.
              </span>
            )}
          </label>

          <label className="space-y-1.5 block">
            <span className="text-xs font-medium text-slate-300">Permission mode</span>
            <select
              value={draft.permissionMode}
              onChange={(e) =>
                setDraft({ ...draft, permissionMode: e.target.value as AgentPermissionMode })
              }
              className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
            >
              {PERMISSION_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} — {m.hint}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
            <div>
              <span className="text-sm text-white">Auto-pickup</span>
              <p className="text-xs text-slate-500">Start working the moment a task is assigned</p>
            </div>
            <SettingsToggle
              checked={draft.autoPickup}
              onChange={(autoPickup) => setDraft({ ...draft, autoPickup })}
              color="violet"
              aria-label="Toggle auto-pickup"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
            <div>
              <span className="text-sm text-white">Runs on recurrence</span>
              <p className="text-xs text-slate-500">
                Start a run when a recurring instance is generated for this agent
              </p>
            </div>
            <SettingsToggle
              checked={draft.runsOnRecurrence ?? true}
              onChange={(runsOnRecurrence) => setDraft({ ...draft, runsOnRecurrence })}
              color="violet"
              aria-label="Toggle runs on recurrence"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
            <div>
              <span className="text-sm text-white">DevCouncil verification gate</span>
              <p className="text-xs text-slate-500">
                Run `dev check --verify` after each run and post gaps to the card
              </p>
            </div>
            <SettingsToggle
              checked={draft.devCouncilVerify}
              onChange={(devCouncilVerify) => setDraft({ ...draft, devCouncilVerify })}
              color="violet"
              aria-label="Toggle DevCouncil verification"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
            <div>
              <span className="text-sm text-white">Git worktree per run</span>
              <p className="text-xs text-slate-500">
                Isolated branch + worktree for parallel runs on the same repo
              </p>
            </div>
            <SettingsToggle
              checked={draft.gitWorktree ?? false}
              onChange={(gitWorktree) => setDraft({ ...draft, gitWorktree })}
              color="violet"
              aria-label="Toggle git worktree"
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
            <div>
              <span className="text-sm text-white">Sandbox in apple/container</span>
              <p className="text-xs text-slate-500">
                Run inside a Linux VM (macOS 26+, image: {draft.containerImage ?? "liquitask-agent:latest"})
              </p>
            </div>
            <SettingsToggle
              checked={draft.sandbox === "container"}
              onChange={(on) =>
                setDraft({ ...draft, sandbox: (on ? "container" : "host") as AgentSandbox })
              }
              color="violet"
              aria-label="Toggle container sandbox"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 hover:bg-red-500/20 transition-all text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Save agent
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="px-4 p-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setDraft(agentService.createDraft())}
          className="flex items-center justify-center gap-2 w-full p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 hover:bg-red-500/20 transition-all"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">New agent</span>
        </button>
      )}
    </div>
  );
};
