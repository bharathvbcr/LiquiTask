import { Loader2, ShieldCheck } from "lucide-react";
import type React from "react";

import type { DevCouncilInitPrompt } from "../../hooks/useDevCouncilWorkspaceSync";

interface DevCouncilSyncPromptProps {
  pending: DevCouncilInitPrompt | null;
  busy?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * Floating prompt shown when DevCouncil is detected in the active workspace but
 * the repo isn't initialized. Confirming hands initialization to a coding agent
 * (a board task), matching LiquiTask's "let an agent do the work" model.
 *
 * Follows the Liquid Glass system: a `.liquid-surface` floating layer with a red
 * glow (action required), Lucide icons, Title Case actions, no emoji.
 */
export const DevCouncilSyncPrompt: React.FC<DevCouncilSyncPromptProps> = ({
  pending,
  busy = false,
  onConfirm,
  onDismiss,
}) => {
  if (!pending) return null;

  return (
    <div className="fixed bottom-6 left-6 z-50 w-80 max-w-[calc(100vw-3rem)] animate-in fade-in slide-in-from-bottom-2">
      <div className="liquid-surface liquid-glow-red rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-red-400 shrink-0" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500">DevCouncil</span>
        </div>

        <div className="space-y-1">
          <h4 className="text-sm font-medium text-white">Initialize DevCouncil</h4>
          <p className="text-xs text-slate-400">
            DevCouncil is installed here, but this repository isn&apos;t initialized yet.
          </p>
          <p className="text-xs text-slate-500">
            Hand setup to an agent — it creates a board task and runs{" "}
            <code className="text-slate-400">dev init</code> and{" "}
            <code className="text-slate-400">dev map</code> for you.
          </p>
          <p className="text-[10px] text-slate-600 truncate font-mono" title={pending.dir}>
            {pending.dir}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="liquid-button flex-1 flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
            Set Up With Agent
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400 hover:bg-white/10 hover:text-white transition-all"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default DevCouncilSyncPrompt;
