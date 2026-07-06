import { AlertTriangle, CheckCircle2, Coffee, DollarSign, ShieldAlert } from "lucide-react";
import type React from "react";

import type { AgentStandupDigest } from "../../services/agents/agentStandupDigestService";

interface AgentStandupCardProps {
  digest: AgentStandupDigest;
  onDismiss?: () => void;
}

export const AgentStandupCard: React.FC<AgentStandupCardProps> = ({ digest, onDismiss }) => {
  const hasContent =
    digest.completed.length > 0 ||
    digest.failed.length > 0 ||
    digest.blocked.length > 0 ||
    digest.pendingPermissions > 0 ||
    digest.activeRuns > 0;

  if (!hasContent) return null;

  const sinceLabel = digest.since.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="mx-4 mb-3 rounded-xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-black/40 p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Coffee size={16} className="text-amber-300" />
          Agent standup
          <span className="text-xs font-normal text-slate-500">since {sinceLabel}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Dismiss
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
          <CheckCircle2 size={12} /> {digest.completed.length} done
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-red-300">
          <AlertTriangle size={12} /> {digest.failed.length} failed
        </span>
        {digest.blocked.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">
            <ShieldAlert size={12} /> {digest.blocked.length} blocked
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-1 text-slate-300">
          <DollarSign size={12} /> ${digest.totalCostUsd.toFixed(2)}
        </span>
        {digest.pendingPermissions > 0 && (
          <span className="rounded-full bg-purple-500/10 px-2 py-1 text-purple-300">
            {digest.pendingPermissions} permission{digest.pendingPermissions === 1 ? "" : "s"} pending
          </span>
        )}
        {digest.activeRuns > 0 && (
          <span className="rounded-full bg-blue-500/10 px-2 py-1 text-blue-300">
            {digest.activeRuns} active
          </span>
        )}
      </div>

      {(digest.completed.length > 0 || digest.failed.length > 0 || digest.blocked.length > 0) && (
        <ul className="mt-3 space-y-1 text-xs text-slate-400 max-h-28 overflow-y-auto custom-scrollbar">
          {digest.completed.slice(0, 4).map((e) => (
            <li key={e.runId}>✓ {e.taskTitle}</li>
          ))}
          {[...digest.blocked, ...digest.failed].slice(0, 3).map((e) => (
            <li key={e.runId} className="text-amber-300/90">
              ! {e.taskTitle}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AgentStandupCard;
