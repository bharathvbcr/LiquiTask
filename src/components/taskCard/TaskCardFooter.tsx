import { Archive, Bot, Calendar, CheckCircle, Square } from "lucide-react";
import type React from "react";
import type { Task } from "../../../types";

interface TaskCardFooterProps {
  task: Task;
  /** Show the Completed → Commit action (hidden when agent Approve/Reject is shown). */
  showMarkCommittedButton?: boolean;
  /** Show the Commit → Archive action once work is committed. */
  showArchiveButton?: boolean;
  onArchiveTask?: (taskId: string) => void;
  isAgentTask: boolean;
  agentWorking: boolean;
  runStatus: string | null;
  /** A dispatch is in flight — show instant acknowledgment. */
  sending?: boolean;
  /** 1-based wait-line position while the run is queued. */
  queuePosition?: number | null;
  /** The run is stalled awaiting a permission decision. */
  pendingPermission?: boolean;
  /** Cancel the active run without opening the dock (hover-revealed). */
  onCancelRun?: () => void;
  dueInfo: { status: string; label: string; color: string } | null;
  onMoveTask: (taskId: string, newStatus: string) => void;
}

export const TaskCardFooter: React.FC<TaskCardFooterProps> = ({
  task,
  showMarkCommittedButton = false,
  showArchiveButton = false,
  onArchiveTask,
  isAgentTask,
  agentWorking,
  runStatus,
  sending = false,
  queuePosition,
  pendingPermission = false,
  onCancelRun,
  dueInfo,
  onMoveTask,
}) => {
  const hasDue = Boolean(task.dueDate && dueInfo);
  const showFooter = task.assignee || isAgentTask || hasDue || sending;

  return (
    <>
      {showFooter && (
        <div className="flex items-center justify-between gap-2 mt-auto min-w-0 pt-3 border-t border-white/5">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {(task.assignee || isAgentTask) && (
              <div
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border ${
                  agentWorking
                    ? "border-blue-400/60 animate-pulse bg-gradient-to-tr from-slate-700 to-slate-900"
                    : isAgentTask
                      ? "border-white/10 bg-gradient-to-tr from-slate-700 to-slate-900"
                      : "border-white/15 bg-gradient-to-br from-red-700 to-red-900"
                }`}
              >
                {isAgentTask ? (
                  <Bot size={12} className={agentWorking ? "text-blue-300" : "text-red-400"} />
                ) : (
                  <span className="text-[10px] font-bold text-white">
                    {task.assignee?.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
            )}
            {task.assignee && (
              <span className="min-w-0 flex-1 truncate text-xs text-slate-400">{task.assignee}</span>
            )}
            {sending && !runStatus && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20 animate-pulse">
                sending to agent
              </span>
            )}
            {agentWorking && !pendingPermission && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20 animate-pulse">
                {runStatus === "verifying" ? "verifying" : "working"}
              </span>
            )}
            {pendingPermission && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30 animate-pulse">
                needs approval
              </span>
            )}
            {runStatus === "queued" && (
              <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-slate-300 border border-white/10">
                {queuePosition ? `queued #${queuePosition}` : "queued"}
              </span>
            )}
            {onCancelRun && (agentWorking || runStatus === "queued") && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelRun();
                }}
                title="Cancel agent run"
                aria-label="Cancel agent run"
                className="hidden group-hover:flex group-focus-within:flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/10 bg-black/30 text-slate-400 transition-colors hover:bg-red-500/25 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              >
                <Square size={9} fill="currentColor" />
              </button>
            )}
          </div>
          {hasDue && dueInfo && (
            <div
              className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${dueInfo.color}`}
            >
              <Calendar size={14} className="shrink-0" />
              <span>{dueInfo.label}</span>
            </div>
          )}
        </div>
      )}
      {showMarkCommittedButton && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onMoveTask(task.id, "Commit");
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-900/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 p-2.5 rounded-xl transition-all"
        >
          <CheckCircle size={16} />
          <span className="text-xs font-bold uppercase">Mark Committed &amp; Close</span>
        </button>
      )}
      {showArchiveButton && onArchiveTask && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onArchiveTask(task.id);
          }}
          className="mt-3 hidden w-full group-hover:flex group-focus-within:flex items-center justify-center gap-2 bg-amber-900/15 hover:bg-amber-600/80 text-amber-300 hover:text-white border border-amber-500/25 p-2.5 rounded-xl transition-all"
        >
          <Archive size={16} />
          <span className="text-xs font-bold uppercase">Archive Task</span>
        </button>
      )}
    </>
  );
};
