import {
  Bot,
  CheckCircle2,
  Hammer,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { FEATURE_FLAGS } from '../../constants';
import { localApi } from '../../core/api/localApi';
import { getDesktopApi, isTauri } from '../../runtime/runtimeEnvironment';
import agentMcpService from '../../services/agents/agentMcpService';
import agentRunService from '../../services/agents/agentRunService';
import agentService from '../../services/agents/agentService';
import { ensureWorkspaceGitignore } from '../../services/agents/workspaceGitignoreInjector';
import type {
  AgentProfile,
  BoardColumn,
  Project,
  Task,
  ToastType,
} from '../../../types';
import { AgentForm } from '../agents/AgentForm';
import { SettingsToggle } from './SettingsToggle';
import { DevToolsSettings } from './DevToolsSettings';
import { AgentAnalyticsPanel } from './AgentAnalyticsPanel';
import { AgentSkillsLibrary } from './AgentSkillsLibrary';
import { GitHubSyncSettings } from './GitHubSyncSettings';
import { McpServerSettings } from './McpServerSettings';

interface AgentSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
  onAgentsChanged?: () => void;
  projects?: Project[];
  activeProjectId?: string;
  tasks?: Task[];
  columns?: BoardColumn[];
  onImportGitHubTasks?: (tasks: Task[]) => void;
}

export const AgentSettings: React.FC<AgentSettingsProps> = ({
  addToast,
  onAgentsChanged,
  projects = [],
  activeProjectId = '',
  tasks = [],
  columns = [],
  onImportGitHubTasks,
}) => {
  const [agents, setAgents] = useState<AgentProfile[]>(() => agentService.getAgents());
  const [clis, setClis] = useState<
    import('../../services/agents/agentRunService').AgentCliStatus[] | null
  >(null);
  const [checkingClis, setCheckingClis] = useState(false);
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [containerRunning, setContainerRunning] = useState(false);
  const [containerSystemOk, setContainerSystemOk] = useState<boolean | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);
  const [agentRuns, setAgentRuns] = useState(() => agentRunService.getRuns());
  const [autoApprovePermissions, setAutoApprovePermissions] = useState(() =>
    agentMcpService.isAutoApproveEnabled()
  );
  /**
   * Seamless default for the working directory: the active workspace's linked
   * folder wins, else the first authorised workspace path. New agents start
   * with it prefilled; an empty field resolves to it on save.
   */
  const [workspaceDefaultDir, setWorkspaceDefaultDir] = useState('');

  useEffect(() => {
    return agentRunService.subscribe(setAgentRuns);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const projectPath = projects.find(p => p.id === activeProjectId)?.workspacePaths?.[0];
    if (projectPath) {
      setWorkspaceDefaultDir(projectPath);
      return;
    }
    let cancelled = false;
    void getDesktopApi()
      ?.workspace.getPaths()
      .then(paths => {
        if (!cancelled && paths?.[0]) setWorkspaceDefaultDir(paths[0]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projects, activeProjectId]);

  const detectClis = useCallback(async (force = false) => {
    setCheckingClis(true);
    try {
      setClis(await agentRunService.detectClis(force ? { force: true } : undefined));
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
      const { invoke } = await import('@tauri-apps/api/core');
      setContainerSystemOk(await invoke<boolean>('agent_container_system_status'));
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
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      const runId = await invoke<string>('agent_container_build', {
        image: 'liquitask-agent:latest',
        dockerfileDir: null,
      });
      const unlisten = await listen<{
        runId: string;
        line?: string;
        stream: string;
        code?: number;
      }>('agent-run-event', event => {
        if (event.payload.runId !== runId) return;
        const line = event.payload.line;
        if (line) {
          setBuildLog(prev => [...prev.slice(-200), line]);
        }
        if (event.payload.stream === 'exit') {
          unlisten();
          setContainerRunning(false);
          addToast(
            event.payload.code === 0 ? 'Sandbox image built' : 'Sandbox build failed',
            event.payload.code === 0 ? 'success' : 'error'
          );
        }
      });
    } catch (err) {
      setContainerRunning(false);
      addToast(err instanceof Error ? err.message : 'Build failed', 'error');
    }
  };

  const cliAvailable = (name: string) => clis?.find(c => c.name === name)?.available ?? false;

  const persist = async (next: AgentProfile[]) => {
    setAgents(next);
    onAgentsChanged?.();
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      addToast('Give the agent a name — it doubles as the assignee label.', 'warning');
      return;
    }
    // Empty working dir resolves to the workspace folder — no manual pick needed.
    const workingDir = draft.workingDir.trim() || workspaceDefaultDir;
    if (!workingDir) {
      addToast(
        'No workspace folder found — Browse to pick a working directory once.',
        'warning',
      );
      return;
    }
    setSaving(true);
    try {
      // The runner only accepts authorised workspace paths — ensure it's listed.
      const api = getDesktopApi();
      const paths = (await api?.workspace.getPaths()) ?? [];
      if (!paths.includes(workingDir)) {
        await api?.workspace.setPaths([...paths, workingDir]);
      }
      await persist(
        await agentService.saveAgent({ ...draft, name: draft.name.trim(), workingDir }),
      );
      void ensureWorkspaceGitignore(workingDir);
      setDraft(null);
      addToast(`Agent "${draft.name.trim()}" saved`, 'success');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: AgentProfile) => {
    await persist(await agentService.deleteAgent(agent.id));
    addToast(`Agent "${agent.name}" removed`, 'info');
  };

  /** Provider ids agentd can actually start (mirrors the AgentProvider union). */
  const STARTABLE_PROVIDERS: AgentProfile['provider'][] = [
    'claude-code',
    'codex',
    'cursor',
    'grok',
    'copilot',
    'opencode',
    'openclaw',
    'hermes',
    'pi',
    'kimi',
    'kiro',
    'antigravity',
    'qoder',
    'codebuddy',
    'traecli',
  ];

  /**
   * First-run shortcut: create a ready-to-use agent in one click — first
   * detected runtime (Claude Code preferred), workspace folder, safe defaults.
   */
  const handleCreateDefaultAgent = async () => {
    if (!workspaceDefaultDir) {
      addToast('No workspace folder found — use New Agent and Browse instead.', 'warning');
      return;
    }
    setSaving(true);
    try {
      let provider: AgentProfile['provider'] = 'claude-code';
      try {
        const detected = await agentRunService.detectClis();
        const claudeReady = detected.find(c => c.name === 'claude')?.available ?? false;
        if (!claudeReady && FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
          const runtimes = await localApi.detectRuntimesCached();
          const ready = runtimes?.find(
            (
              rt
            ): rt is {
              id: string;
              name: string;
              binary: string;
              path?: string;
              version?: string;
              ready: boolean;
            } =>
              'id' in rt &&
              rt.ready &&
              STARTABLE_PROVIDERS.includes(
                (rt.id === 'claude' ? 'claude-code' : rt.id) as AgentProfile['provider']
              )
          );
          if (ready) {
            provider = (ready.id === 'claude'
              ? 'claude-code'
              : ready.id) as AgentProfile['provider'];
          }
        }
      } catch {
        // Detection is best-effort; Claude Code remains the default.
      }
      // The runner only accepts authorised workspace paths — ensure it's listed.
      const api = getDesktopApi();
      const paths = (await api?.workspace.getPaths()) ?? [];
      if (!paths.includes(workspaceDefaultDir)) {
        await api?.workspace.setPaths([...paths, workspaceDefaultDir]);
      }
      const agent = agentService.createDraft({
        name: 'Dev',
        provider,
        workingDir: workspaceDefaultDir,
      });
      await persist(await agentService.saveAgent(agent));
      addToast(
        'Agent "Dev" is ready — hover any card and click the bot button, or drag a card onto it.',
        'success'
      );
    } finally {
      setSaving(false);
    }
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
          onChange={checked => {
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
            onClick={() => void detectClis(true)}
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
            { name: 'claude', label: 'Claude Code', required: true },
            { name: 'dev', label: 'DevCouncil', required: false },
            { name: 'container', label: 'apple/container', required: false },
          ].map(cli => (
            <div
              key={cli.name}
              className={`flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/5 ${
                clis === null ? 'animate-pulse' : ''
              }`}
            >
              {clis === null ? (
                <Loader2 size={14} className="text-slate-600 shrink-0 animate-spin" />
              ) : cliAvailable(cli.name) ? (
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={14} className="text-slate-600 shrink-0" />
              )}
              <span className={cliAvailable(cli.name) ? 'text-slate-300' : 'text-slate-500'}>
                {cli.label}
                {cli.required ? ' (required)' : ' (optional)'}
              </span>
            </div>
          ))}
        </div>
        {clis && !cliAvailable('claude') && (
          <p className="text-xs text-amber-400">
            Claude Code CLI not found. Install it (npm install -g @anthropic-ai/claude-code) and
            re-check.
          </p>
        )}
      </div>

      {/* Installed developer tools (agent CLIs + IDEs) */}
      <DevToolsSettings addToast={addToast} />

      {/* Container sandbox build */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-white">Sandbox image</h4>
          <span className="text-[10px] text-slate-500">
            system: {containerSystemOk === null ? '…' : containerSystemOk ? 'running' : 'stopped'}
          </span>
        </div>
        <button
          type="button"
          disabled={containerRunning || !cliAvailable('container')}
          onClick={() => void buildSandboxImage()}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs hover:bg-purple-500/20 disabled:opacity-40"
        >
          {containerRunning ? <Loader2 size={14} className="animate-spin" /> : <Hammer size={14} />}
          Build sandbox image
        </button>
        {buildLog.length > 0 && (
          <pre className="max-h-32 overflow-y-auto text-[10px] text-slate-500 font-mono bg-black/30 rounded-lg p-2">
            {buildLog.slice(-30).join('\n')}
          </pre>
        )}
      </div>

      <AgentSkillsLibrary addToast={addToast} />

      <McpServerSettings addToast={addToast} />

      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-2">
        <h4 className="text-sm font-medium text-white">Agent analytics</h4>
        <AgentAnalyticsPanel agents={agents} runs={agentRuns} />
      </div>

      {onImportGitHubTasks && (
        <GitHubSyncSettings
          projects={projects}
          activeProjectId={activeProjectId}
          tasks={tasks}
          backlogStatus={columns.find(c => c.id === 'Pending')?.id ?? columns[0]?.id ?? 'Pending'}
          onImportTasks={onImportGitHubTasks}
          addToast={addToast}
        />
      )}

      {/* Agent list */}
      <div className="space-y-2">
        {agents.map(agent => (
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
                {(agent.role ?? 'default') === 'planner' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    planner
                  </span>
                )}
                {(agent.runMode ?? 'direct') === 'council' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    council
                  </span>
                )}
                {agent.devCouncilVerify && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    DevCouncil gate
                  </span>
                )}
                {agent.sandbox === 'container' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    sandboxed
                  </span>
                )}
                {(agent.host ?? 'local') === 'ssh' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    remote ssh
                  </span>
                )}
                {(agent.modelRouting ?? 'fixed') === 'auto' && (
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
                onClick={() =>
                  setDraft({
                    ...agent,
                    workingDir: agentService.resolveWorkingDir(
                      agent.workingDir,
                      workspaceDefaultDir,
                    ),
                  })
                }
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
          <div className="p-5 rounded-xl bg-white/5 border border-white/5 text-center space-y-3">
            <p className="text-sm text-slate-400">
              No agents yet. Create one and every task card gains a one-click handoff.
            </p>
            {workspaceDefaultDir && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleCreateDefaultAgent()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-sm font-medium text-red-300 hover:bg-red-500/25 transition-all disabled:opacity-50"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
                  Create Default Agent
                </button>
                <p className="text-xs text-slate-500">
                  One click: first detected runtime, working in {workspaceDefaultDir}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Editor */}
      {draft ? (
        <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
          <AgentForm
            draft={draft}
            onChange={setDraft}
            workspacePaths={projects.find(p => p.id === activeProjectId)?.workspacePaths ?? []}
            projects={projects}
            addToast={addToast}
          />

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
          onClick={() => setDraft(agentService.createDraft({ workingDir: workspaceDefaultDir }))}
          className="flex items-center justify-center gap-2 w-full p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 hover:bg-red-500/20 transition-all"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">New agent</span>
        </button>
      )}
    </div>
  );
};
