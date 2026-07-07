/**
 * Inline quick-create for agent teammates — one click when a workspace folder
 * is already linked to the active project.
 *
 * The working folder defaults to the project's linked workspace path and the
 * name derives from the folder when left blank; everything else gets the safe
 * defaults from `agentService.createDraft`. The full editor stays in
 * Settings → Agents for fine-tuning.
 */

import { CheckCircle2, FolderOpen, Loader2, Plus, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';

import { getDesktopApi } from '../../runtime/runtimeEnvironment';
import agentService from '../../services/agents/agentService';
import type { ToastType } from '../../../types';

interface AgentQuickCreateProps {
  /** Called after a successful save so the host can refresh its roster. */
  onAgentsChanged?: () => void;
  addToast?: (message: string, type: ToastType) => void;
  /** Render the form expanded immediately (e.g. empty roster). */
  defaultOpen?: boolean;
  /** The active project's linked workspace folders — first one is the default. */
  workspacePaths?: string[];
}

/** Last path segment, e.g. "/Users/me/Code/LiquiTask" → "LiquiTask". */
const folderBasename = (dir: string) =>
  dir
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() ?? '';

/** Derive a unique agent name from the working folder ("LiquiTask", "LiquiTask 2", …). */
const deriveAgentName = (dir: string) => {
  const base = folderBasename(dir) || 'Agent';
  let candidate = base;
  let n = 2;
  while (agentService.getAgentByAssignee(candidate)) {
    candidate = `${base} ${n}`;
    n += 1;
  }
  return candidate;
};

export const AgentQuickCreate: React.FC<AgentQuickCreateProps> = ({
  onAgentsChanged,
  addToast,
  defaultOpen = false,
  workspacePaths = [],
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState('');
  const [workingDir, setWorkingDir] = useState('');
  const [saving, setSaving] = useState(false);

  const defaultDir = workspacePaths[0] ?? '';

  // Prefill from the active project's linked workspace whenever the form opens.
  useEffect(() => {
    if (open && !workingDir && defaultDir) setWorkingDir(defaultDir);
  }, [open, workingDir, defaultDir]);

  const reset = () => {
    setName('');
    setWorkingDir('');
  };

  const pickWorkingDir = async () => {
    const api = getDesktopApi();
    const dir = await api?.workspace.selectDirectory();
    if (dir) setWorkingDir(dir);
  };

  const save = async () => {
    const dir = (workingDir || defaultDir).trim();
    if (!dir) {
      addToast?.('Pick a working folder, or link one to this project first.', 'warning');
      return;
    }
    // Name is optional — derive it from the folder so one click is enough.
    const trimmed = name.trim() || deriveAgentName(dir);
    if (agentService.getAgentByAssignee(trimmed)) {
      addToast?.(`An agent named "${trimmed}" already exists.`, 'warning');
      return;
    }
    setSaving(true);
    try {
      // The runner only accepts authorised workspace paths — add it to the allowlist.
      const api = getDesktopApi();
      const paths = (await api?.workspace.getPaths()) ?? [];
      if (!paths.includes(dir)) {
        await api?.workspace.setPaths([...paths, dir]);
      }
      await agentService.saveAgent(agentService.createDraft({ name: trimmed, workingDir: dir }));
      onAgentsChanged?.();
      addToast?.(`Agent "${trimmed}" ready — assign any task to it by name.`, 'success');
      reset();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-all text-[11px] font-medium"
      >
        <Plus size={12} /> New Agent
        {defaultDir && <span className="text-slate-500">in {folderBasename(defaultDir)}</span>}
      </button>
    );
  }

  const knownPaths = Array.from(new Set([...workspacePaths, workingDir].filter(Boolean)));

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
          New Agent
        </span>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all"
          aria-label="Close quick create"
        >
          <X size={12} />
        </button>
      </div>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder={
          workingDir || defaultDir
            ? `Name — defaults to "${deriveAgentName((workingDir || defaultDir).trim())}"`
            : 'Name (assignee label), e.g. Claude'
        }
        className="liquid-input w-full rounded-lg px-2 py-1.5 text-[11px]"
        onKeyDown={e => {
          if (e.key === 'Enter') void save();
        }}
      />
      <div className="flex gap-1.5">
        {knownPaths.length > 0 ? (
          <select
            value={workingDir}
            onChange={e => setWorkingDir(e.target.value)}
            className="liquid-input flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[11px]"
            aria-label="Working folder"
          >
            {knownPaths.map(path => (
              <option key={path} value={path}>
                {folderBasename(path)} — {path}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={workingDir}
            onChange={e => setWorkingDir(e.target.value)}
            placeholder="Working folder, e.g. /path/to/repo"
            className="liquid-input flex-1 min-w-0 rounded-lg px-2 py-1.5 text-[11px]"
          />
        )}
        <button
          type="button"
          onClick={() => void pickWorkingDir()}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300 hover:bg-white/10 transition-all shrink-0"
        >
          <FolderOpen size={12} /> Browse
        </button>
      </div>
      <p className="text-[10px] text-slate-500">
        {defaultDir
          ? 'Works in this project’s workspace folder by default, with safe Claude Code defaults. Fine-tune in Settings → Agents.'
          : 'Uses Claude Code with safe defaults (accept edits, git worktree per task). Fine-tune in Settings → Agents.'}
      </p>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="liquid-button w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium disabled:opacity-50"
      >
        {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
        Create Agent
      </button>
    </div>
  );
};

export default AgentQuickCreate;
