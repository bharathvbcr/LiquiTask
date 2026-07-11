import { GitFork, History, RotateCcw } from "lucide-react";
import type React from "react";

import type { RunTraceStep } from "../../../types";
import { GlassPanel } from "../GlassPanel";

export interface RunTraceTimelineProps {
  steps: RunTraceStep[];
  onRevert?: (stepId: string) => void;
  onFork?: (stepId: string) => void;
  disabled?: boolean;
}

const KIND_LABEL: Record<string, string> = {
  tool: "Tool",
  file_write: "Write",
  permission: "Permission",
  session: "Session",
  git_checkpoint: "Git",
  devcouncil: "Council",
};

/**
 * Minimal reversible trace timeline for the Run view (Refactor 4 MVP).
 */
export const RunTraceTimeline: React.FC<RunTraceTimelineProps> = ({
  steps,
  onRevert,
  onFork,
  disabled,
}) => {
  if (steps.length === 0) return null;

  return (
    <GlassPanel className="rounded-xl bg-black/30 border-white/5 shadow-none p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
        <History size={12} />
        Run Trace
      </div>
      <ul className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start justify-between gap-2 text-[11px] font-mono border-b border-white/5 pb-1 last:border-0"
          >
            <div className="min-w-0 flex-1">
              <span className="text-slate-500 mr-1.5">{step.index}.</span>
              <span className="text-amber-400/90 mr-1.5">
                {KIND_LABEL[step.kind] ?? step.kind}
              </span>
              <span className="text-slate-300 break-words">{step.label}</span>
              {step.gitCommitSha && (
                <span className="text-slate-600 ml-1">@{step.gitCommitSha.slice(0, 7)}</span>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              {onRevert && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRevert(step.id)}
                  className="p-1 rounded-md text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  title="Revert to this step"
                >
                  <RotateCcw size={12} />
                </button>
              )}
              {onFork && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onFork(step.id)}
                  className="p-1 rounded-md text-slate-400 hover:text-sky-300 hover:bg-sky-500/10 transition-colors disabled:opacity-40"
                  title="Fork from this step"
                >
                  <GitFork size={12} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </GlassPanel>
  );
};

export default RunTraceTimeline;
