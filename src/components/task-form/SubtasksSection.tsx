import { Check, CheckSquare, Loader2, Plus, Sparkles, X } from "lucide-react";
import type React from "react";
import type { Subtask } from "../../../types";
import { Tooltip } from "../Tooltip";

interface SubtasksSectionProps {
  subtasks: Subtask[];
  newSubtask: string;
  setNewSubtask: React.Dispatch<React.SetStateAction<string>>;
  handleAddSubtask: () => void;
  handleUpdateSubtask: (id: string, title: string) => void;
  handleRemoveSubtask: (id: string) => void;
  toggleSubtask: (id: string) => void;
  handleAiBreakdown: () => void;
  isBreakingDown: boolean;
  aiFeaturesEnabled: boolean;
  canBreakdown: boolean;
}

export const SubtasksSection: React.FC<SubtasksSectionProps> = ({
  subtasks,
  newSubtask,
  setNewSubtask,
  handleAddSubtask,
  handleUpdateSubtask,
  handleRemoveSubtask,
  toggleSubtask,
  handleAiBreakdown,
  isBreakingDown,
  aiFeaturesEnabled,
  canBreakdown,
}) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between pl-1">
      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <CheckSquare size={12} /> Subtasks
      </label>
      {aiFeaturesEnabled && (
        <Tooltip content="AI Breakdown - Generate subtasks" position="top">
          <button
            type="button"
            onClick={handleAiBreakdown}
            disabled={isBreakingDown || !canBreakdown}
            className="text-[10px] font-bold text-red-300 hover:text-red-200 flex items-center gap-1 transition-colors"
          >
            {isBreakingDown ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Sparkles size={10} />
            )}
            AI Breakdown
          </button>
        </Tooltip>
      )}
    </div>
    <div className="flex gap-2">
      <input
        type="text"
        value={newSubtask}
        onChange={(e) => setNewSubtask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAddSubtask();
          }
        }}
        placeholder="Add a subtask..."
        className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm"
        aria-label="New subtask title"
      />
      <Tooltip content="Add subtask" position="top">
        <button
          type="button"
          onClick={handleAddSubtask}
          className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
          aria-label="Add subtask"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
    <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
      {subtasks.map((subtask) => (
        <div
          key={subtask.id}
          className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors"
        >
          <Tooltip
            content={subtask.completed ? "Mark as incomplete" : "Mark as complete"}
            position="top"
          >
            <button
              type="button"
              onClick={() => toggleSubtask(subtask.id)}
              className={`flex-shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${subtask.completed ? "bg-emerald-500/20 border-emerald-500 text-emerald-500" : "border-slate-600 text-transparent hover:border-slate-400"}`}
              aria-label={
                subtask.completed
                  ? `Mark subtask "${subtask.title}" as incomplete`
                  : `Mark subtask "${subtask.title}" as complete`
              }
            >
              <Check size={12} aria-hidden="true" />
            </button>
          </Tooltip>
          <input
            type="text"
            value={subtask.title}
            onChange={(e) => handleUpdateSubtask(subtask.id, e.target.value)}
            className={`flex-1 bg-transparent border-none outline-none text-sm font-medium focus:text-white transition-colors ${subtask.completed ? "text-slate-500 line-through decoration-slate-600" : "text-slate-300"}`}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            aria-label={`Edit subtask ${subtask.id}`}
            placeholder="Subtask title"
          />
          <Tooltip content={`Remove subtask "${subtask.title}"`} position="top">
            <button
              type="button"
              onClick={() => handleRemoveSubtask(subtask.id)}
              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all"
              aria-label={`Remove subtask "${subtask.title}"`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  </div>
);
