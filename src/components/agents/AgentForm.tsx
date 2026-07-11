import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Loader2,
  Search,
  Shield,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FEATURE_FLAGS } from '../../constants';
import { localApi } from '../../core/api/localApi';
import { mergeSkillCatalog } from '../../core/skills/mergeSkillCatalog';
import type { SkillCatalogEntry } from '../../core/skills/mergeSkillCatalog';
import { getDesktopApi, isTauri } from '../../runtime/runtimeEnvironment';
import agentRunService from '../../services/agents/agentRunService';
import agentSkillsService from '../../services/agents/agentSkillsService';
import type {
  AgentPermissionMode,
  AgentProfile,
  AgentRole,
  AgentRunMode,
  AgentToolPolicyAction,
  Project,
  ToastType,
} from '../../../types';
import { DevCouncilPanel } from '../settings/DevCouncilPanel';
import { SettingsToggle } from '../settings/SettingsToggle';
import { AgentSkillsLibrary } from '../settings/AgentSkillsLibrary';

const PERMISSION_MODES: { value: AgentPermissionMode; label: string; hint: string }[] = [
  { value: 'plan', label: 'Plan only', hint: 'Read-only; proposes a plan without editing files' },
  { value: 'default', label: 'Default', hint: 'Asks before edits (headless runs may stall)' },
  { value: 'acceptEdits', label: 'Accept edits', hint: 'Edits files, asks for risky commands' },
  {
    value: 'bypassPermissions',
    label: 'Bypass permissions',
    hint: 'Full autonomy — use with trusted repos only',
  },
];

const TOOL_POLICY_ACTIONS: { value: AgentToolPolicyAction; label: string }[] = [
  { value: 'allow', label: 'Allow — auto-approve without prompting' },
  { value: 'ask', label: 'Ask — prompt before each use' },
  { value: 'deny', label: 'Deny — block the tool entirely' },
];

const COMMON_TOOL_POLICY_NAMES = ['Bash', 'Write', 'Edit', 'Read', '*'];

export interface AgentFormProps {
  draft: AgentProfile;
  onChange: (next: AgentProfile) => void;
  /** Workspace folders linked to the active project — the default working dir. */
  workspacePaths: string[];
  projects?: Project[];
  addToast: (msg: string, type: ToastType) => void;
}

/**
 * The shared agent editor — all `AgentProfile` fields, toggles, the DevCouncil
 * panel, and a per-agent skill picker. Used by both Settings → Agents (advanced
 * surface) and the Agents nav manager's create/edit modal, so the two never
 * drift apart. Follows the Liquid Glass system (`.liquid-input`, uppercase
 * eyebrows, red accent only).
 */
export const AgentForm: React.FC<AgentFormProps> = ({
  draft,
  onChange,
  workspacePaths,
  projects: _projects = [],
  addToast,
}) => {
  const set = useCallback(
    (patch: Partial<AgentProfile>) => onChange({ ...draft, ...patch }),
    [draft, onChange],
  );

  // Working-directory default: the active project's first linked folder, else
  // the first authorised workspace path.
  const [workspaceDefaultDir, setWorkspaceDefaultDir] = useState(workspacePaths[0] ?? '');
  useEffect(() => {
    if (workspacePaths[0]) {
      setWorkspaceDefaultDir(workspacePaths[0]);
      return;
    }
    if (!isTauri()) return;
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
  }, [workspacePaths]);

  const autoFilledWorkingDirFor = useRef<string | null>(null);
  useEffect(() => {
    autoFilledWorkingDirFor.current = null;
  }, [draft.id]);
  useEffect(() => {
    if (!workspaceDefaultDir || draft.workingDir.trim()) return;
    if (autoFilledWorkingDirFor.current === draft.id) return;
    autoFilledWorkingDirFor.current = draft.id;
    set({ workingDir: workspaceDefaultDir });
  }, [workspaceDefaultDir, draft.workingDir, draft.id, set]);

  // agentd runtime catalog for the provider picker (Codex, Cursor, …).
  const [runtimeOptions, setRuntimeOptions] = useState<
    { id: string; name: string; version?: string; ready: boolean }[]
  >([]);
  const [containerSystemOk, setContainerSystemOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<boolean>('agent_container_system_status'))
      .then(ok => {
        if (!cancelled) setContainerSystemOk(ok);
      })
      .catch(() => {
        if (!cancelled) setContainerSystemOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED || runtimeOptions.length > 0) return;
    let cancelled = false;
    void localApi
      .detectRuntimesCached()
      .then(runtimes => {
        if (cancelled || !runtimes) return;
        const options = runtimes
          .filter(
            (
              rt
            ): rt is {
              id: string;
              name: string;
              binary: string;
              version?: string;
              ready: boolean;
            } => 'id' in rt && 'ready' in rt
          )
          .filter(rt => rt.id !== 'claude' && rt.id !== 'gemini' && rt.id !== 'aider')
          .filter(rt => rt.ready)
          .map(rt => ({ id: rt.id, name: rt.name, version: rt.version, ready: rt.ready }));
        setRuntimeOptions(options);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runtimeOptions.length]);

  // CLI availability for planner/council warnings (DevCouncil `dev`).
  const [clis, setClis] = useState<
    import('../../services/agents/agentRunService').AgentCliStatus[] | null
  >(null);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void agentRunService
      .detectClis()
      .then(result => {
        if (!cancelled) setClis(result);
      })
      .catch(() => {
        if (!cancelled) setClis([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const cliAvailable = (name: string) => clis?.find(c => c.name === name)?.available ?? false;

  // DevCouncil preflight: does the working dir hold .devcouncil/config.yaml?
  const [devcouncilStatus, setDevcouncilStatus] = useState<
    'unknown' | 'checking' | 'ok' | 'missing' | 'unauthorized'
  >('unknown');
  const draftWorkingDir = draft.workingDir?.trim() ?? '';
  useEffect(() => {
    if (!draftWorkingDir || !isTauri()) {
      setDevcouncilStatus('unknown');
      return;
    }
    let cancelled = false;
    setDevcouncilStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const api = getDesktopApi();
        if (!api) {
          if (!cancelled) setDevcouncilStatus('unknown');
          return;
        }
        await api.workspace.readFile(`${draftWorkingDir}/.devcouncil/config.yaml`, [
          draftWorkingDir,
        ]);
        if (!cancelled) setDevcouncilStatus('ok');
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setDevcouncilStatus(message.includes('Unauthorized') ? 'unauthorized' : 'missing');
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draftWorkingDir]);

  const pickWorkingDir = async () => {
    const api = getDesktopApi();
    const dir = await api?.workspace.selectDirectory();
    if (!dir) return;
    const paths = (await api?.workspace.getPaths()) ?? [];
    if (!paths.includes(dir)) {
      await api?.workspace.setPaths([...paths, dir]);
    }
    set({ workingDir: dir });
  };

  // -- Skills: per-agent pinned skills + embedded library browser --
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [toolPolicyExpanded, setToolPolicyExpanded] = useState(false);
  const [newToolPolicyName, setNewToolPolicyName] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const captured = agentSkillsService.getSkills();
      let installed: Awaited<ReturnType<typeof localApi.listSkills>>;
      try {
        installed = await localApi.listSkills();
      } catch {
        installed = undefined;
      }
      setCatalog(mergeSkillCatalog(captured, installed));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (skillsExpanded && catalog.length === 0) void loadCatalog();
  }, [skillsExpanded, catalog.length, loadCatalog]);

  const pinnedIds = useMemo(() => new Set(draft.skills ?? []), [draft.skills]);
  const pinnedCount = draft.skills?.length ?? 0;

  const filteredCatalog = useMemo(() => {
    const needle = skillSearch.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(entry =>
      [entry.title, entry.summary, entry.origin, entry.provider ?? '', entry.workingDir ?? ''].some(
        field => field.toLowerCase().includes(needle),
      ),
    );
  }, [catalog, skillSearch]);

  const toggleSkill = (id: string) => {
    const next = new Set(pinnedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    set({ skills: ids.length > 0 ? ids : undefined });
  };

  const toolPolicyEntries = useMemo(
    () => Object.entries(draft.toolPolicy ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [draft.toolPolicy],
  );

  const setToolPolicyAction = (toolName: string, action: AgentToolPolicyAction) => {
    const next = { ...(draft.toolPolicy ?? {}), [toolName]: action };
    set({ toolPolicy: next });
  };

  const removeToolPolicyEntry = (toolName: string) => {
    const next = { ...(draft.toolPolicy ?? {}) };
    delete next[toolName];
    set({ toolPolicy: Object.keys(next).length > 0 ? next : undefined });
  };

  const addToolPolicyEntry = (toolName: string) => {
    const trimmed = toolName.trim();
    if (!trimmed || draft.toolPolicy?.[trimmed]) return;
    setToolPolicyAction(trimmed, 'ask');
    setNewToolPolicyName('');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Name (assignee label)</span>
          <input
            value={draft.name}
            onChange={e => set({ name: e.target.value })}
            placeholder="e.g. Claude"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Runtime</span>
          <select
            value={draft.provider}
            onChange={e => set({ provider: e.target.value as AgentProfile['provider'] })}
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
          >
            <option value="claude-code">Claude Code (native runner)</option>
            {runtimeOptions.map(rt => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
                {rt.version ? ` — ${rt.version}` : ''}
              </option>
            ))}
            {draft.provider !== 'claude-code' &&
              !runtimeOptions.some(rt => rt.id === draft.provider) && (
                <option value={draft.provider}>{draft.provider} (not detected)</option>
              )}
          </select>
          {draft.provider !== 'claude-code' && (
            <span className="block text-[11px] text-slate-500">
              Runs via the agentd sidecar. Container sandbox, council mode and MCP board actions
              currently apply to Claude Code only.
            </span>
          )}
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Model (optional)</span>
          <input
            value={draft.model ?? ''}
            onChange={e => set({ model: e.target.value || undefined })}
            placeholder="default"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Model routing</span>
          <select
            value={draft.modelRouting ?? 'fixed'}
            onChange={e => set({ modelRouting: e.target.value as AgentProfile['modelRouting'] })}
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
            value={draft.dailyCostCapUsd ?? ''}
            onChange={e => {
              const raw = e.target.value.trim();
              set({ dailyCostCapUsd: raw === '' ? undefined : Math.max(0, Number(raw)) });
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
            value={draft.maxRunsPerDay ?? ''}
            onChange={e => {
              const raw = e.target.value.trim();
              set({ maxRunsPerDay: raw === '' ? undefined : Math.max(0, Math.floor(Number(raw))) });
            }}
            placeholder="Unlimited"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Run timeout (min)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.runTimeoutMinutes ?? ''}
            onChange={e => {
              const raw = e.target.value.trim();
              set({
                runTimeoutMinutes: raw === '' ? undefined : Math.max(0, Math.floor(Number(raw))),
              });
            }}
            placeholder="No limit"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-[11px] text-slate-500">Stops a run that overruns. 0 = off.</span>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">No-output timeout (min)</span>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.stallTimeoutMinutes ?? ''}
            onChange={e => {
              const raw = e.target.value.trim();
              set({
                stallTimeoutMinutes: raw === '' ? undefined : Math.max(0, Math.floor(Number(raw))),
              });
            }}
            placeholder="25 (default)"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-[11px] text-slate-500">Silent = stalled. Empty = 25; 0 = off.</span>
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-slate-300">Per-run cost cap (USD)</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={draft.perRunCostCapUsd ?? ''}
            onChange={e => {
              const raw = e.target.value.trim();
              set({ perRunCostCapUsd: raw === '' ? undefined : Math.max(0, Number(raw)) });
            }}
            placeholder="No cap"
            className="w-full liquid-input rounded-lg px-3 py-2 text-sm"
          />
          <span className="text-[11px] text-slate-500">Flags overspend (known at run end).</span>
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-slate-300">Working directory</span>
        <div className="flex gap-2">
          <input
            value={draft.workingDir}
            onChange={e => set({ workingDir: e.target.value })}
            placeholder={workspaceDefaultDir || '/path/to/repo'}
            className="flex-1 liquid-input rounded-lg px-3 py-2 text-sm"
          />
          {workspaceDefaultDir && draft.workingDir !== workspaceDefaultDir && (
            <button
              type="button"
              onClick={() => set({ workingDir: workspaceDefaultDir })}
              title={workspaceDefaultDir}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300 hover:bg-red-500/20 transition-all"
            >
              Use Workspace
            </button>
          )}
          <button
            type="button"
            onClick={() => void pickWorkingDir()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 transition-all"
          >
            <FolderOpen size={14} /> Browse
          </button>
        </div>
        {workspaceDefaultDir && !draft.workingDir.trim() && (
          <span className="text-xs text-slate-500">
            Left empty, this defaults to your workspace folder: {workspaceDefaultDir}
          </span>
        )}
        {(() => {
          // Guard: the folder isn't one of the active project's linked workspace
          // paths. Non-blocking — runs redirect to the task's project workspace
          // anyway — but flag the likely mistake.
          const dir = draft.workingDir.trim();
          const outside = workspacePaths.length > 0 && !!dir && !workspacePaths.includes(dir);
          return outside ? (
            <span className="text-xs text-amber-300/90 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>
                This folder isn’t linked to the current project. This project’s tasks will run in
                the project’s workspace, not here — link it under the project’s settings if the
                agent should work in this folder.
              </span>
            </span>
          ) : null;
        })()}
        {devcouncilStatus === 'checking' && (
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Checking for DevCouncil project…
          </span>
        )}
        {devcouncilStatus === 'ok' && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> DevCouncil project detected — planning &amp; verification
            gates available.
          </span>
        )}
        {devcouncilStatus === 'missing' && (
          <span className="text-xs text-amber-400 flex items-center gap-1.5">
            <XCircle size={12} /> No .devcouncil/config.yaml here — plan/verify will fall back to
            plain runs. Run `dev init` in this repo to enable them.
          </span>
        )}
        {devcouncilStatus === 'unauthorized' && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <XCircle size={12} /> Folder isn&apos;t an authorised workspace yet — use Browse to add
            it, then the DevCouncil check can run.
          </span>
        )}
        {devcouncilStatus !== 'unauthorized' && (
          <DevCouncilPanel workingDir={draftWorkingDir} addToast={addToast} />
        )}
      </div>

      <label className="space-y-1.5 block">
        <span className="text-xs font-medium text-slate-300">Agent role</span>
        <select
          value={draft.role ?? 'default'}
          onChange={e => set({ role: e.target.value as AgentRole })}
          className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
        >
          <option value="default">Worker — executes tasks via Claude Code / council</option>
          <option value="coder">Coder — implementation agent (same as worker)</option>
          <option value="planner">Planner — decomposes epics via DevCouncil `dev plan` on drop</option>
          <option value="reviewer">Reviewer — read-only diff review gate (In Review stage)</option>
        </select>
        {(draft.role ?? 'default') === 'planner' && !cliAvailable('dev') && (
          <span className="text-xs text-amber-400 block">
            DevCouncil CLI (`dev`) not detected — planner runs will fail until installed.
          </span>
        )}
      </label>

      <label className="space-y-1.5 block">
        <span className="text-xs font-medium text-slate-300">Run mode</span>
        <select
          value={draft.runMode ?? 'direct'}
          onChange={e => set({ runMode: e.target.value as AgentRunMode })}
          className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
        >
          <option value="direct">Direct — Claude Code works the task immediately</option>
          <option value="council">
            Council — full DevCouncil pipeline (debate planning, hooks, evidence gates)
          </option>
        </select>
        {(draft.runMode ?? 'direct') === 'council' && !cliAvailable('dev') && (
          <span className="text-xs text-amber-400 block">
            DevCouncil CLI (`dev`) not detected — council runs will fail until it's installed.
          </span>
        )}
      </label>

      <label className="space-y-1.5 block">
        <span className="text-xs font-medium text-slate-300">Permission mode</span>
        <select
          value={draft.permissionMode}
          onChange={e => set({ permissionMode: e.target.value as AgentPermissionMode })}
          className="w-full liquid-input rounded-lg px-3 py-2 text-sm bg-black/20"
        >
          {PERMISSION_MODES.map(m => (
            <option key={m.value} value={m.value}>
              {m.label} — {m.hint}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-lg bg-black/20 border border-white/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setToolPolicyExpanded(v => !v)}
          className="flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-white/5"
          aria-expanded={toolPolicyExpanded}
        >
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-red-400 shrink-0" />
            <span className="text-sm text-white">Tool policy</span>
            {toolPolicyEntries.length > 0 && (
              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                {toolPolicyEntries.length} rule{toolPolicyEntries.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {toolPolicyExpanded ? (
            <ChevronDown size={16} className="text-slate-500 shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-500 shrink-0" />
          )}
        </button>

        {toolPolicyExpanded && (
          <div className="space-y-3 border-t border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Per-tool rules</p>
            <p className="text-xs text-slate-500">
              Forwarded to agentd on run start. Unlisted tools default to Ask. Use{' '}
              <span className="font-mono text-slate-400">*</span> as a wildcard fallback.
            </p>

            {toolPolicyEntries.length === 0 ? (
              <p className="py-2 text-center text-xs text-slate-600">
                No tool rules yet — add one below or choose Always Allow on a permission prompt.
              </p>
            ) : (
              <div className="space-y-2">
                {toolPolicyEntries.map(([toolName, action]) => (
                  <div
                    key={toolName}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-black/20 p-2"
                  >
                    <span className="min-w-[5rem] flex-1 font-mono text-xs text-white">{toolName}</span>
                    <select
                      value={action}
                      onChange={e =>
                        setToolPolicyAction(toolName, e.target.value as AgentToolPolicyAction)
                      }
                      className="liquid-input rounded-lg px-2 py-1.5 text-xs bg-black/20"
                      aria-label={`Policy for ${toolName}`}
                    >
                      {TOOL_POLICY_ACTIONS.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeToolPolicyEntry(toolName)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {COMMON_TOOL_POLICY_NAMES.filter(name => !draft.toolPolicy?.[name]).map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => addToolPolicyEntry(name)}
                  className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400 hover:border-red-500/20 hover:text-red-300"
                >
                  + {name}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={newToolPolicyName}
                onChange={e => setNewToolPolicyName(e.target.value)}
                placeholder="Tool name (e.g. Bash, mcp__fs__write)"
                className="flex-1 liquid-input rounded-lg px-3 py-2 text-sm"
                aria-label="New tool policy name"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addToolPolicyEntry(newToolPolicyName);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => addToolPolicyEntry(newToolPolicyName)}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20"
              >
                Add Rule
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Auto-pickup</span>
          <p className="text-xs text-slate-500">Start working the moment a task is assigned</p>
        </div>
        <SettingsToggle
          checked={draft.autoPickup}
          onChange={autoPickup => set({ autoPickup })}
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
          onChange={runsOnRecurrence => set({ runsOnRecurrence })}
          color="violet"
          aria-label="Toggle runs on recurrence"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Auto-recover</span>
          <p className="text-xs text-slate-500">
            Return the task to the board if a run crashes or a guardrail stops it
          </p>
        </div>
        <SettingsToggle
          checked={draft.autoRecover !== false}
          onChange={autoRecover => set({ autoRecover })}
          color="violet"
          aria-label="Toggle auto-recover"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Auto-retry once</span>
          <p className="text-xs text-slate-500">
            Retry a crashed or stalled run one time before returning it to the board
          </p>
        </div>
        <SettingsToggle
          checked={draft.autoRetryOnCrash ?? false}
          onChange={autoRetryOnCrash => set({ autoRetryOnCrash })}
          color="violet"
          aria-label="Toggle auto-retry once"
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
          onChange={devCouncilVerify => set({ devCouncilVerify })}
          color="violet"
          aria-label="Toggle DevCouncil verification"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">LLM review merge gate</span>
          <p className="text-xs text-slate-500">
            Review the worktree diff with AI before the transactional merge (alternative to DevCouncil verify)
          </p>
        </div>
        <SettingsToggle
          checked={draft.llmReviewGate ?? false}
          onChange={llmReviewGate => set({ llmReviewGate })}
          color="violet"
          aria-label="Toggle LLM review merge gate"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Reviewer agent merge gate</span>
          <p className="text-xs text-slate-500">
            Run a dedicated read-only reviewer agent on the diff before Commit (agent-orchestrator pattern)
          </p>
        </div>
        <SettingsToggle
          checked={draft.reviewerAgentGate ?? false}
          onChange={reviewerAgentGate => set({ reviewerAgentGate })}
          color="violet"
          aria-label="Toggle reviewer agent merge gate"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Commit stage: Push + Open PR</span>
          <p className="text-xs text-slate-500">
            After gates pass, push the branch and open a PR instead of merging locally (activates CI/review loops)
          </p>
        </div>
        <SettingsToggle
          checked={draft.commitStage === 'pushPr'}
          onChange={on => set({ commitStage: on ? 'pushPr' : 'merge' })}
          color="violet"
          aria-label="Toggle push and open PR commit stage"
        />
      </div>

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">Git worktree per assignment</span>
          <p className="text-xs text-slate-500">
            Every assigned task gets its own branch + worktree — parallel agents never collide, and
            the Commit stage merges each one back. (Recommended: on)
          </p>
        </div>
        <SettingsToggle
          checked={draft.gitWorktree ?? true}
          onChange={gitWorktree => set({ gitWorktree })}
          color="violet"
          aria-label="Toggle git worktree"
        />
      </div>

      <RemoteExecutionPanel draft={draft} onChange={onChange} addToast={addToast} />

      <div className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
        <div>
          <span className="text-sm text-white">OS sandbox</span>
          <p className="text-xs text-slate-500">
            Wrap agent spawns in sandbox-exec (macOS) or bwrap (Linux). Limits writes outside the
            worktree, MCP bridge dir, and agent config homes.
          </p>
        </div>
        <SettingsToggle
          checked={draft.sandboxMode === 'os'}
          disabled={draft.sandbox === 'container' || draft.host === 'ssh'}
          onChange={on =>
            set({
              sandbox: 'host',
              sandboxMode: (on ? 'os' : 'none') as 'none' | 'os',
            })
          }
          color="violet"
          aria-label="Toggle OS sandbox"
        />
      </div>

      <div
        className={`flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5 ${containerSystemOk === false ? 'opacity-60' : ''}`}
      >
        <div>
          <span className="text-sm text-white">Sandbox in apple/container</span>
          <p className="text-xs text-slate-500">
            Run agents inside a Linux VM (macOS 26+, Apple silicon). Image:{' '}
            {draft.containerImage ?? 'liquitask-agent:latest'}. Build it in Settings → Agents.
            {containerSystemOk === false && ' Container system is not running.'}
          </p>
        </div>
        <SettingsToggle
          checked={draft.sandbox === 'container'}
          disabled={containerSystemOk !== true || draft.host === 'ssh'}
          onChange={on =>
            set({
              sandbox: on ? 'container' : 'host',
              containerImage: on
                ? (draft.containerImage?.trim() || 'liquitask-agent:latest')
                : draft.containerImage,
              sandboxMode: 'none',
            })
          }
          color="violet"
          aria-label="Toggle container sandbox"
        />
      </div>

      {/* Skills — pinned skills always injected + embedded library browser */}
      <div className="rounded-lg bg-black/20 border border-white/5 overflow-hidden">
        <button
          type="button"
          onClick={() => setSkillsExpanded(v => !v)}
          className="flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-white/5"
          aria-expanded={skillsExpanded}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-red-400 shrink-0" />
            <span className="text-sm text-white">Skills</span>
            {pinnedCount > 0 && (
              <span className="rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                {pinnedCount} pinned
              </span>
            )}
          </div>
          {skillsExpanded ? (
            <ChevronDown size={16} className="text-slate-500 shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-500 shrink-0" />
          )}
        </button>

        {skillsExpanded && (
          <div className="space-y-3 border-t border-white/5 p-3">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Pinned Skills</p>
            <p className="text-xs text-slate-500">
              Pinned skills are always injected into this agent&apos;s run prompts. Unpinned skills
              are still selected automatically by task relevance.
            </p>

            {catalogLoading ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" /> Loading skill catalog…
              </div>
            ) : catalog.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-600">
                No skills yet — complete agent runs or install skill packs to build the catalog.
              </p>
            ) : (
              <>
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                    aria-hidden
                  />
                  <input
                    value={skillSearch}
                    onChange={e => setSkillSearch(e.target.value)}
                    placeholder="Search skills by name, summary, or origin"
                    className="w-full liquid-input rounded-lg py-2 pl-9 pr-3 text-sm"
                    aria-label="Search skills"
                  />
                </div>
                {filteredCatalog.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-600">
                    No skills match &ldquo;{skillSearch}&rdquo;
                  </p>
                ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto custom-scrollbar">
                {filteredCatalog.map(entry => {
                  const checked = pinnedIds.has(entry.id);
                  return (
                    <label
                      key={entry.id}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                        checked
                          ? 'border-red-500/30 bg-red-500/10'
                          : 'border-white/5 bg-black/20 hover:bg-white/5'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(entry.id)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-red-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium text-white">
                            {entry.title}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                              entry.origin === 'captured'
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : 'border-sky-500/20 bg-sky-500/10 text-sky-300'
                            }`}
                          >
                            {entry.origin}
                          </span>
                        </div>
                        {entry.summary && (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
                            {entry.summary}
                          </p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
                )}
              </>
            )}

            <div className="flex items-center gap-2 pt-1 text-[10px] uppercase tracking-widest text-slate-500">
              <BookOpen size={12} className="text-slate-500" />
              Library
            </div>
            <AgentSkillsLibrary addToast={addToast} />
          </div>
        )}
      </div>
    </div>
  );
};

const RemoteExecutionPanel: React.FC<{
  draft: AgentProfile;
  onChange: (next: AgentProfile) => void;
  addToast: (msg: string, type: ToastType) => void;
}> = ({ draft, onChange, addToast }) => {
  const [checking, setChecking] = useState(false);
  const sshEnabled = (draft.host ?? 'local') === 'ssh';
  const ssh = draft.ssh ?? { target: '', fallbackToLocal: true };

  const patchSsh = (patch: Partial<NonNullable<AgentProfile['ssh']>>) => {
    onChange({
      ...draft,
      ssh: { ...ssh, ...patch },
    });
  };

  const handleHealthCheck = async () => {
    if (!ssh.target.trim()) {
      addToast('Enter an SSH target first (user@host).', 'warning');
      return;
    }
    setChecking(true);
    try {
      const ok = await localApi.sshHealthCheck({
        ...ssh,
        target: ssh.target.trim(),
      });
      addToast(ok ? 'SSH connection OK' : 'SSH health check failed', ok ? 'success' : 'error');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'SSH health check failed', 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-lg bg-black/20 border border-white/5 overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-white/5">
        <div>
          <span className="text-sm text-white">Remote execution (SSH)</span>
          <p className="text-xs text-slate-500 mt-0.5">
            Run the agent CLI on a remote unix host via OpenSSH. Mutagen sync is used when detected;
            otherwise set the remote repo path. Container and OS sandbox are disabled for remote runs.
          </p>
        </div>
        <SettingsToggle
          checked={sshEnabled}
          onChange={on => {
            if (on) {
              onChange({
                ...draft,
                host: 'ssh',
                sandbox: 'host',
                sandboxMode: 'none',
                ssh: draft.ssh ?? { target: '', fallbackToLocal: true },
              });
            } else {
              onChange({ ...draft, host: 'local' });
            }
          }}
          color="violet"
          aria-label="Toggle remote SSH execution"
        />
      </div>
      {sshEnabled && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">SSH target</span>
              <input
                type="text"
                value={ssh.target}
                onChange={e => patchSsh({ target: e.target.value })}
                placeholder="user@devbox"
                className="liquid-input w-full text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">Port</span>
              <input
                type="number"
                value={ssh.port ?? ''}
                onChange={e =>
                  patchSsh({
                    port: e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                  })
                }
                placeholder="22"
                className="liquid-input w-full text-sm"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                Identity file (optional)
              </span>
              <input
                type="text"
                value={ssh.identityFile ?? ''}
                onChange={e => patchSsh({ identityFile: e.target.value || undefined })}
                placeholder="~/.ssh/id_ed25519"
                className="liquid-input w-full text-sm"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500">
                Remote repo path
              </span>
              <input
                type="text"
                value={ssh.remotePath ?? ''}
                onChange={e => patchSsh({ remotePath: e.target.value || undefined })}
                placeholder="/home/user/project (required without Mutagen)"
                className="liquid-input w-full text-sm"
              />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm text-white">Fallback to local</span>
              <p className="text-xs text-slate-500">
                When SSH is unreachable, run locally and post an Inbox notice.
              </p>
            </div>
            <SettingsToggle
              checked={ssh.fallbackToLocal !== false}
              onChange={fallbackToLocal => patchSsh({ fallbackToLocal })}
              color="amber"
              aria-label="Toggle SSH fallback to local"
            />
          </div>
          <button
            type="button"
            disabled={checking || !FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED}
            onClick={() => void handleHealthCheck()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:text-white hover:bg-white/10 disabled:opacity-40"
          >
            {checking ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />}
            Test SSH connection
          </button>
        </div>
      )}
    </div>
  );
};

export default AgentForm;
