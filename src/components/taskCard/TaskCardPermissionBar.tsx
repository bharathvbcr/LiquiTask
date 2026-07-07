import { Check, ShieldAlert, X } from "lucide-react";
import type React from "react";

import agentMcpService, {
  type AgentPermissionRequest,
} from "../../services/agents/agentMcpService";

/**
 * Inline permission gate: when a run stalls waiting for a tool approval, the
 * card itself offers Approve / Deny so the user never has to hunt for the
 * runs dock to unblock an agent.
 */
export const TaskCardPermissionBar: React.FC<{ request: AgentPermissionRequest }> = ({
  request,
}) => {
  const respond = (approved: boolean) => {
    agentMcpService.respondToPermission(request.requestId, approved);
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-2"
    >
      <ShieldAlert size={14} className="shrink-0 text-red-400" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
        Agent wants <span className="font-mono text-red-300">{request.toolName}</span>
      </span>
      <button
        type="button"
        onClick={() => respond(true)}
        className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-900/20 px-2 py-1 text-[10px] font-bold uppercase text-emerald-300 transition-colors hover:bg-emerald-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
      >
        <span className="flex items-center gap-1">
          <Check size={11} />
          Approve
        </span>
      </button>
      <button
        type="button"
        onClick={() => respond(false)}
        className="shrink-0 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-bold uppercase text-slate-300 transition-colors hover:bg-red-500/25 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
      >
        <span className="flex items-center gap-1">
          <X size={11} />
          Deny
        </span>
      </button>
    </div>
  );
};

export default TaskCardPermissionBar;
