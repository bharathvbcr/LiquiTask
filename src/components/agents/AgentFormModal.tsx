import { Bot, CheckCircle2, Loader2 } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import { getDesktopApi } from '../../runtime/runtimeEnvironment';
import agentService from '../../services/agents/agentService';
import { ensureWorkspaceGitignore } from '../../services/agents/workspaceGitignoreInjector';
import type { AgentProfile, Project, ToastType } from '../../../types';
import { ModalWrapper } from '../ModalWrapper';
import { AgentForm } from './AgentForm';

export interface AgentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The agent to edit, or `null`/`undefined` to create a new one. */
  agent?: AgentProfile | null;
  /** Workspace folders linked to the active project — the default working dir. */
  workspacePaths: string[];
  projects?: Project[];
  addToast: (msg: string, type: ToastType) => void;
  /** Called after a successful save so the roster can refresh. */
  onAgentsChanged?: () => void;
}

/**
 * Create/edit shell for an agent, wrapping the shared `AgentForm` in a glass
 * modal. Save validation and workspace-path authorization mirror
 * `AgentSettings.handleSave`, so both surfaces persist agents identically.
 */
export const AgentFormModal: React.FC<AgentFormModalProps> = ({
  isOpen,
  onClose,
  agent,
  workspacePaths,
  projects = [],
  addToast,
  onAgentsChanged,
}) => {
  const isEditing = Boolean(agent);
  const workspaceDefaultDir = workspacePaths[0] ?? '';
  const [draft, setDraft] = useState<AgentProfile>(() =>
    agent
      ? {
          ...agent,
          workingDir: agentService.resolveWorkingDir(agent.workingDir, workspaceDefaultDir),
        }
      : agentService.createDraft({ workingDir: workspaceDefaultDir }),
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!draft.name.trim()) {
      addToast('Give the agent a name — it doubles as the assignee label.', 'warning');
      return;
    }
    // Empty working dir resolves to the workspace folder — no manual pick needed.
    const workingDir = draft.workingDir.trim() || workspaceDefaultDir;
    if (!workingDir) {
      addToast('No workspace folder found — Browse to pick a working directory once.', 'warning');
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
      await agentService.saveAgent({ ...draft, name: draft.name.trim(), workingDir });
      void ensureWorkspaceGitignore(workingDir);
      addToast(`Agent "${draft.name.trim()}" saved`, 'success');
      onAgentsChanged?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalWrapper
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Agent' : 'New Agent'}
      size="3xl"
      icon={<Bot size={20} />}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 hover:bg-red-500/20 transition-all text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {isEditing ? 'Save Agent' : 'Create Agent'}
          </button>
        </div>
      }
    >
      <AgentForm
        draft={draft}
        onChange={setDraft}
        workspacePaths={workspacePaths}
        projects={projects}
        addToast={addToast}
      />
    </ModalWrapper>
  );
};

export default AgentFormModal;
