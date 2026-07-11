import { ShieldAlert } from "lucide-react";
import type React from "react";

import agentMcpService, {
  type AgentPermissionRequest,
  type PermissionResponseDecision,
} from "../../services/agents/agentMcpService";
import { PermissionActionButtons } from "../agents/PermissionActionButtons";

/**
 * Inline permission gate: when a run stalls waiting for a tool approval, the
 * card itself offers Allow / Deny / Always allow so the user never has to hunt
 * for the runs dock to unblock an agent.
 */
export const TaskCardPermissionBar: React.FC<{ request: AgentPermissionRequest }> = ({
  request,
}) => {
  const respond = (decision: PermissionResponseDecision) => {
    agentMcpService.respondToPermission(request.requestId, decision);
  };

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="mt-3 space-y-2 rounded-xl border border-red-500/30 bg-red-500/10 px-2.5 py-2"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="shrink-0 text-red-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">
          Agent wants <span className="font-mono text-red-300">{request.toolName}</span>
        </span>
      </div>
      <PermissionActionButtons onRespond={respond} size="compact" />
    </div>
  );
};

export default TaskCardPermissionBar;
