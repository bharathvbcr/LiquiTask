import { Calendar, CheckSquare, Clock, ExternalLink, Paperclip, User, X } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PriorityDefinition, Task } from "../../types";
import { formatMinutes } from "../hooks/useTimer";
import { IconButton } from "./common/IconButton";
import { PriorityBadge } from "./PriorityBadge";

interface TaskQuickViewProps {
  task: Task;
  priorities: PriorityDefinition[];
  position: { x: number; y: number };
  onClose: () => void;
  onOpenFull: (task: Task) => void;
}

export const TaskQuickView: React.FC<TaskQuickViewProps> = ({
  task,
  priorities,
  position,
  onClose,
  onOpenFull,
}) => {
  const priorityDef = priorities.find((p) => p.id === task.priority) || {
    label: "Unknown",
    color: "#64748b",
  };
  const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;
  const totalSubtasks = task.subtasks?.length || 0;
  const progress = totalSubtasks > 0 ? (completedSubtasks / totalSubtasks) * 100 : 0;

  // Close on Escape for keyboard users
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Measure the rendered panel and clamp it to the viewport. Rendered in a
  // portal on document.body so column transforms/backdrop-filters can't
  // reposition or stack it under sibling cards.
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const margin = 8;
    setStyle({
      position: "fixed",
      left: Math.max(margin, Math.min(position.x, window.innerWidth - el.offsetWidth - margin)),
      top: Math.max(margin, Math.min(position.y, window.innerHeight - el.offsetHeight - margin)),
      visibility: "visible",
    });
  }, [position]);

  if (typeof document === "undefined") return null;

  const stopDragPropagation = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9990]">
      {/* Invisible backdrop to close on click outside */}
      <div
        className="absolute inset-0"
        onClick={onClose}
        onPointerDown={stopDragPropagation}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Quick view: ${task.title}`}
        style={style}
        onPointerDown={stopDragPropagation}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 w-[300px] liquid-surface overflow-hidden animate-in zoom-in-95 fade-in duration-100 liquid-topline"
      >
        {/* Header */}
        <div className="p-3 border-b border-white/5 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <PriorityBadge
                label={priorityDef.label}
                color={priorityDef.color}
                icon={"icon" in priorityDef ? priorityDef.icon : undefined}
              />
              <span className="text-[10px] font-mono text-slate-500">{task.jobId}</span>
            </div>
            <h4 className="font-bold text-white text-sm leading-tight truncate">{task.title}</h4>
            {task.subtitle && (
              <p className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">
                {task.subtitle}
              </p>
            )}
          </div>
          <IconButton onClick={onClose} className="shrink-0" aria-label="Close quick view">
            <X size={14} />
          </IconButton>
        </div>

        {/* Content */}
        <div className="p-3 space-y-3">
          {/* Summary */}
          {task.summary && <p className="text-xs text-slate-400 line-clamp-2">{task.summary}</p>}

          {/* Meta Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {/* Assignee */}
            <div className="flex items-center gap-1.5 text-slate-400">
              <User size={12} />
              <span>{task.assignee || "Unassigned"}</span>
            </div>

            {/* Due Date */}
            {task.dueDate && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Calendar size={12} />
                <span>{new Date(task.dueDate).toLocaleDateString()}</span>
              </div>
            )}

            {/* Time */}
            {(task.timeEstimate > 0 || task.timeSpent > 0) && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock size={12} />
                <span>
                  {task.timeSpent > 0 ? formatMinutes(task.timeSpent) : "0m"}
                  {task.timeEstimate > 0 && ` / ${formatMinutes(task.timeEstimate)}`}
                </span>
              </div>
            )}

            {/* Attachments */}
            {task.attachments?.length > 0 && (
              <div className="flex items-center gap-1.5 text-slate-400">
                <Paperclip size={12} />
                <span>
                  {task.attachments.length} attachment{task.attachments.length === 1 ? "" : "s"}
                </span>
              </div>
            )}
          </div>

          {/* Subtasks Progress */}
          {totalSubtasks > 0 && (
            <div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                <span className="flex items-center gap-1">
                  <CheckSquare size={10} />
                  Subtasks
                </span>
                <span>
                  {completedSubtasks}/{totalSubtasks}
                </span>
              </div>
              <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    progress === 100 ? "bg-emerald-500" : "bg-red-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Tags */}
          {task.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span
                  key={`${task.id}-${tag}`}
                  className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-slate-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-white/5">
          <button
            onClick={() => onOpenFull(task)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-bold text-slate-300 hover:text-white hover:bg-red-500/10 rounded-xl transition-all hover:border-red-500/20 border border-transparent group"
          >
            <ExternalLink size={12} className="group-hover:text-red-400 transition-colors" />
            Open Full View
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TaskQuickView;
