import { CheckSquare, GripVertical, Info, Lock, Pencil, Square, Trash2 } from "lucide-react";
import type React from "react";
import { InlineSelect } from "../../src/components/InlineEditable";
import { getPriorityIcon } from "../../src/utils/taskCardUtils";
import type { PriorityDefinition, Task } from "../../types";
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
  priorities: PriorityDefinition[];
  isBlocked: boolean;
  blockerIds: string;
  isSelected: boolean;
  onToggleSelect?: (taskId: string, shiftKey?: boolean) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (taskId: string) => void;
  onUpdateTask: (task: Task) => void;
  onQuickView: (position: { x: number; y: number }) => void;
}

export const TaskCardHeader: React.FC<TaskCardHeaderProps> = ({
  task,
  isCompact,
  priorityDef,
  priorities,
  isBlocked,
  blockerIds,
  isSelected,
  onToggleSelect,
  onEditTask,
  onDeleteTask,
  onUpdateTask,
  onQuickView,
}) => (
  <div className={`min-w-0 ${isCompact ? "mb-2" : "mb-3"}`}>
    <div className="flex items-center justify-between gap-2 min-w-0">
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        {onToggleSelect && (
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
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${
                isSelected
                  ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-200"
                  : "border-white/10 bg-black/30 text-slate-400 hover:text-white"
              }`}
            >
              {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            </button>
          </Tooltip>
        )}
        <div
          className="flex shrink-0 items-center gap-1.5 px-3 py-1 rounded-lg border border-transparent"
          style={{
            backgroundColor: `${priorityDef.color}25`,
            color: priorityDef.color,
            borderColor: `${priorityDef.color}30`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {priorityDef.icon ? (
            <span className="opacity-90">{getPriorityIcon(priorityDef.icon)}</span>
          ) : (
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: priorityDef.color }}
            />
          )}
          <InlineSelect
            value={task.priority}
            options={priorities.map((p) => ({
              id: p.id,
              label: p.label,
              color: p.color,
            }))}
            onSave={(np) => onUpdateTask({ ...task, priority: np })}
          />
        </div>
        {isBlocked && (
          <Tooltip content={`Blocked by: ${blockerIds}`} position="top">
            <div className="flex shrink-0 items-center gap-1 px-2 py-1 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 text-[10px] font-bold uppercase cursor-help">
              <Lock size={10} /> Blocked
            </div>
          </Tooltip>
        )}
        <span className="inline-flex shrink-0 text-[10px] font-mono text-slate-400 bg-black/30 px-2 py-0.5 rounded border border-white/5 whitespace-nowrap">
          {task.jobId}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-black/40 rounded-lg p-0.5 border border-white/5 backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Tooltip content="Edit task" position="top">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onEditTask(task)}
              aria-label="Edit task"
              className="p-2 text-slate-400 hover:text-white rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Pencil size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Quick view" position="top">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onQuickView({ x: e.clientX + 12, y: e.clientY + 12 });
              }}
              aria-label="Open task quick view"
              className="p-2 text-slate-400 hover:text-white rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Info size={12} />
            </button>
          </Tooltip>
          <Tooltip content="Delete task" position="top">
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDeleteTask(task.id)}
              aria-label="Delete task"
              className="p-2 text-slate-400 hover:text-red-400 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            >
              <Trash2 size={12} />
            </button>
          </Tooltip>
        </div>
        <GripVertical
          size={14}
          className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        />
      </div>
    </div>
  </div>
);
