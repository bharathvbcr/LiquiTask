import type React from "react";

import { GlassPanel } from "./GlassPanel";

export interface ApprovalCardProps {
  title: string;
  description?: string;
  onApprove?: () => void;
  onDeny?: () => void;
  approveLabel?: string;
  denyLabel?: string;
  children?: React.ReactNode;
  className?: string;
}

/** Inline approval prompt card — title, description, optional diff/extra slot, approve/deny actions. */
export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  title,
  description,
  onApprove,
  onDeny,
  approveLabel = "Approve",
  denyLabel = "Deny",
  children,
  className = "",
}) => {
  return (
    <GlassPanel
      className={`rounded-xl bg-amber-500/5 border-amber-500/20 shadow-none p-3 space-y-2 ${className}`}
    >
      <div className="space-y-1">
        <p className="text-xs font-medium text-amber-200">{title}</p>
        {description && <p className="text-[11px] text-slate-300 break-words">{description}</p>}
      </div>

      {children}

      {(onApprove || onDeny) && (
        <div className="flex gap-1.5 pt-0.5">
          {onApprove && (
            <button
              type="button"
              onClick={onApprove}
              className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium hover:bg-emerald-500/20 transition-colors"
            >
              {approveLabel}
            </button>
          )}
          {onDeny && (
            <button
              type="button"
              onClick={onDeny}
              className="flex-1 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium hover:bg-red-500/20 transition-colors"
            >
              {denyLabel}
            </button>
          )}
        </div>
      )}
    </GlassPanel>
  );
};

export default ApprovalCard;
