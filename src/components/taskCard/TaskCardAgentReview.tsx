import { MessageSquare } from "lucide-react";
import type React from "react";
import type { AgentRun, Task } from "../../../types";

interface TaskCardAgentReviewProps {
  task: Task;
  completedRun: AgentRun;
  isCompact: boolean;
  rejectFeedback: string;
  onRejectFeedbackChange: (value: string) => void;
  onApproveAgentWork: (task: Task, run: AgentRun) => void;
  onRejectAgentWork: (task: Task, run: AgentRun, feedback: string) => void;
}

export const TaskCardAgentReview: React.FC<TaskCardAgentReviewProps> = ({
  task,
  completedRun,
  isCompact,
  rejectFeedback,
  onRejectFeedbackChange,
  onApproveAgentWork,
  onRejectAgentWork,
}) => (
  <div
    className={`space-y-1.5 border-t border-white/5 ${isCompact ? "mt-2 pt-2" : "mt-3 pt-3"}`}
    onPointerDown={(e) => e.stopPropagation()}
    onClick={(e) => e.stopPropagation()}
  >
    <input
      type="text"
      value={rejectFeedback}
      onChange={(e) => onRejectFeedbackChange(e.target.value)}
      placeholder="Rejection feedback (required to reject)…"
      className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
    />
    <div className="flex gap-1.5">
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onApproveAgentWork(task, completedRun)}
        className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium"
      >
        Approve
      </button>
      <button
        type="button"
        disabled={!rejectFeedback.trim()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onRejectAgentWork(task, completedRun, rejectFeedback.trim())}
        className="flex-1 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <MessageSquare size={10} /> Reject
      </button>
    </div>
  </div>
);
