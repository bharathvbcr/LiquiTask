import { Bot, CheckSquare, GripVertical, Square } from "lucide-react";
import type React from "react";
import type { Task } from "../../../types";
import { Tooltip } from "../Tooltip";

interface PriorityDisplay {
  label: string;
  color: string;
  icon?: string;
}

interface TaskCardHeaderProps {
  task: Task;
  isCompact: boolean;
  priorityDef: PriorityDisplay;
  isBlocked: boolean;
  blockerIds: string;
  isSelected: boolean;
  onToggleSelect?: (taskId: string, shiftKey?: boolean) => void;
  /** One-click smart-matched agent handoff, revealed on hover. */
  onQuickSend?: () => void;
}

/**
 * Read-only card header: title (wraps up to two lines) + a priority badge.
 * Editing happens via double-tap (opens the editor) or right-click (context menu),
 * so nothing here is inline-editable.
 */
export const TaskCardHeader: React.FC<TaskCardHeaderProps> = ({
  task,
  isCompact,
  priorityDef,
  isBlocked,
  blockerIds,
  isSelected,
  onToggleSelect,
  onQuickSend,
}) => (
  <div className="min-w-0 mb-2">
    <div className="flex items-start justify-between gap-2 min-w-0">
      {/* Title — with an optional select checkbox and a blocked indicator dot */}
      <div className="flex items-start gap-1.5 min-w-0 flex-1">
        {onToggleSelect && (
          <div
            className={`mt-0.5 shrink-0 ${isSelected ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}
          >
            <Tooltip content={isSelected ? "Deselect task" : "Select task"} position="top">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleSelect(task.id, e.shiftKey);
                }}
                aria-label={isSelected ? "Deselect task" : "Select task"}
                aria-pressed={isSelected}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                  isSelected
                    ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-200"
                    : "border-white/10 bg-black/30 text-slate-400 hover:text-white"
                }`}
              >
                {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
              </button>
            </Tooltip>
          </div>
        )}
        {isBlocked && (
          <Tooltip content={`Blocked by: ${blockerIds}`} position="top">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)] cursor-help" />
          </Tooltip>
        )}
        <h3
          className={`${isCompact ? "text-sm" : "text-base"} min-w-0 flex-1 font-bold text-slate-100 leading-snug break-words line-clamp-2`}
        >
          {task.title || "Untitled task"}
        </h3>
      </div>

      {/* Priority badge (top-right) + drag handle */}
      <div className="flex shrink-0 items-center gap-1.5">
        {onQuickSend && (
          <div className="hidden group-hover:flex group-focus-within:flex">
            <Tooltip content="Send to Agent (A)" position="top">
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onQuickSend();
                }}
                aria-label="Send to agent"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/25 hover:text-red-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
              >
                <Bot size={12} />
              </button>
            </Tooltip>
          </div>
        )}
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide leading-none"
          style={{ backgroundColor: `${priorityDef.color}22`, color: priorityDef.color }}
        >
          {priorityDef.label}
        </span>
        <GripVertical
          size={14}
          className="text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      </div>
    </div>
    {task.jobId && (
      <span className="mt-1.5 hidden max-w-full truncate text-[10px] font-mono text-slate-500 group-hover:inline-flex group-focus-within:inline-flex">
        {task.jobId}
      </span>
    )}
  </div>
);
