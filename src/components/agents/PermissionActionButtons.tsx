import { Check, ShieldCheck, X } from "lucide-react";
import type React from "react";

import type { PermissionResponseDecision } from "../../services/agents/agentMcpService";

export interface PermissionActionButtonsProps {
  onRespond: (decision: PermissionResponseDecision) => void;
  /** When false, omit the always-allow affordance (e.g. read-only previews). */
  showAlways?: boolean;
  size?: "compact" | "default";
}

/**
 * Shared Allow / Deny / Always-allow controls for permission prompts across
 * Inbox, task cards, runs dock, and Run surface.
 */
export const PermissionActionButtons: React.FC<PermissionActionButtonsProps> = ({
  onRespond,
  showAlways = true,
  size = "default",
}) => {
  const textClass = size === "compact" ? "text-[10px]" : "text-[11px]";
  const padClass = size === "compact" ? "py-0.5" : "py-1";

  return (
    <div className={`flex flex-wrap gap-1.5 ${size === "default" ? "pt-0.5" : ""}`}>
      <button
        type="button"
        onClick={() => onRespond("allow")}
        className={`flex-1 min-w-[4.5rem] rounded-lg border border-emerald-500/20 bg-emerald-500/10 ${padClass} ${textClass} font-medium text-emerald-300`}
      >
        <span className="inline-flex items-center justify-center gap-1">
          <Check size={size === "compact" ? 10 : 11} />
          Allow
        </span>
      </button>
      {showAlways && (
        <button
          type="button"
          onClick={() => onRespond("always")}
          className={`flex-1 min-w-[5.5rem] rounded-lg border border-sky-500/20 bg-sky-500/10 ${padClass} ${textClass} font-medium text-sky-300`}
          title="Allow now and add this tool to the agent's allow policy"
        >
          <span className="inline-flex items-center justify-center gap-1">
            <ShieldCheck size={size === "compact" ? 10 : 11} />
            Always Allow
          </span>
        </button>
      )}
      <button
        type="button"
        onClick={() => onRespond("deny")}
        className={`flex-1 min-w-[4.5rem] rounded-lg border border-red-500/20 bg-red-500/10 ${padClass} ${textClass} font-medium text-red-300`}
      >
        <span className="inline-flex items-center justify-center gap-1">
          <X size={size === "compact" ? 10 : 11} />
          Deny
        </span>
      </button>
    </div>
  );
};

export default PermissionActionButtons;
