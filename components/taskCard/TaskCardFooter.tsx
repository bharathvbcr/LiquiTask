import { Bot, Calendar, CheckCircle } from "lucide-react";
import type React from "react";
import { lazy, Suspense } from "react";
import { InlineDatePicker, InlineEditable } from "../../src/components/InlineEditable";
import type { Task } from "../../types";

const TimeTracker = lazy(() => import("../../src/components/TimeTracker"));

interface TaskCardFooterProps {
  task: Task;
  isCompletedColumn?: boolean;
  isAgentTask: boolean;
  agentWorking: boolean;
  runStatus: string | null;
  dueInfo: { status: string; label: string; color: string } | null;
  estimateHint: string | null;
  onMoveTask: (taskId: string, newStatus: string) => void;
  onUpdateTask: (task: Task) => void;
}

export const TaskCardFooter: React.FC<TaskCardFooterProps> = ({
  task,
  isCompletedColumn,
  isAgentTask,
  agentWorking,
  runStatus,
  dueInfo,
  estimateHint,
  onMoveTask,
  onUpdateTask,
}) => (
  <>
    <div className="mb-3" onPointerDown={(e) => e.stopPropagation()}>
      <Suspense fallback={null}>
        <TimeTracker
          task={task}
          isCompact={true}
          onSaveTime={(taskId, timeSpent) => {
            if (taskId === task.id) {
              onUpdateTask({ ...task, timeSpent, updatedAt: new Date() });
            }
          }}
        />
      </Suspense>
      {estimateHint && (
        <p className="text-[10px] text-sky-400/70 mt-1 pl-0.5" title={estimateHint}>
          {estimateHint}
        </p>
      )}
    </div>
    <div
      className="flex items-center justify-between gap-2 mt-auto min-w-0 pt-3 border-t border-white/5"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <div
          className={`w-6 h-6 shrink-0 rounded-full bg-gradient-to-tr from-slate-700 to-slate-900 flex items-center justify-center border ${agentWorking ? "border-blue-400/60 animate-pulse" : "border-white/10"}`}
        >
          {isAgentTask ? (
            <Bot size={12} className={agentWorking ? "text-blue-300" : "text-red-400"} />
          ) : (
            <span className="text-[10px] font-bold">
              {task.assignee ? task.assignee.charAt(0).toUpperCase() : "U"}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <InlineEditable
            value={task.assignee || ""}
            onSave={(na) => onUpdateTask({ ...task, assignee: na })}
            placeholder="Unassigned"
            className="text-xs"
          />
        </div>
        {agentWorking && (
          <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20 animate-pulse">
            {runStatus === "verifying" ? "verifying" : "working"}
          </span>
        )}
      </div>
      <div
        className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${dueInfo?.color || "text-slate-400"}`}
      >
        <Calendar size={14} className="shrink-0" />
        <InlineDatePicker
          value={task.dueDate || null}
          onSave={(nd) => onUpdateTask({ ...task, dueDate: nd || undefined })}
        />
      </div>
    </div>
    {isCompletedColumn && (
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onMoveTask(task.id, "Delivered");
        }}
        className="mt-3 w-full flex items-center justify-center gap-2 bg-emerald-900/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 p-2.5 rounded-xl transition-all"
      >
        <CheckCircle size={16} />
        <span className="text-xs font-bold uppercase">Mark Verified & Close</span>
      </button>
    )}
  </>
);
