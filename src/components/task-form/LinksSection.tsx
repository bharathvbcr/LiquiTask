import { Link, Plus, Trash2 } from "lucide-react";
import type React from "react";
import type { Task, TaskLink } from "../../../types";
import { Tooltip } from "../Tooltip";

interface LinksSectionProps {
  links: TaskLink[];
  availableTasks: Task[];
  initialData?: Task | null;
  newLinkType: string;
  setNewLinkType: React.Dispatch<React.SetStateAction<string>>;
  newLinkTarget: string;
  setNewLinkTarget: React.Dispatch<React.SetStateAction<string>>;
  handleAddTaskLink: () => void;
  handleRemoveTaskLink: (targetId: string) => void;
  getLinkIcon: (type: string) => React.ReactNode;
}

export const LinksSection: React.FC<LinksSectionProps> = ({
  links,
  availableTasks,
  initialData,
  newLinkType,
  setNewLinkType,
  newLinkTarget,
  setNewLinkTarget,
  handleAddTaskLink,
  handleRemoveTaskLink,
  getLinkIcon,
}) => (
  <div className="space-y-3">
    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
      <Link size={12} /> Linked Tasks & Dependencies
    </label>
    <div className="flex gap-2">
      <Tooltip content="Select link type" position="top">
        <select
          value={newLinkType}
          onChange={(e) => setNewLinkType(e.target.value)}
          className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
          aria-label="Link type"
        >
          <option value="relates-to" className="bg-navy-900">
            Relates to
          </option>
          <option value="blocks" className="bg-navy-900">
            Blocks
          </option>
          <option value="blocked-by" className="bg-navy-900">
            Blocked By
          </option>
          <option value="duplicates" className="bg-navy-900">
            Duplicates
          </option>
        </select>
      </Tooltip>
      <Tooltip content="Select task to link" position="top">
        <select
          value={newLinkTarget}
          onChange={(e) => setNewLinkTarget(e.target.value)}
          className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-xs appearance-none"
          aria-label="Select task to link"
        >
          <option value="" className="bg-navy-900">
            Select Task...
          </option>
          {availableTasks
            .filter((t) => t.id !== initialData?.id)
            .map((t) => (
              <option key={t.id} value={t.id} className="bg-navy-900">
                [{t.jobId}] {t.title}
              </option>
            ))}
        </select>
      </Tooltip>
      <Tooltip content="Add task link" position="top">
        <button
          type="button"
          onClick={handleAddTaskLink}
          className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
          aria-label="Add task link"
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
    <div className="space-y-2 mt-2">
      {links.map((link) => {
        const target = availableTasks.find((t) => t.id === link.targetTaskId);
        if (!target) return null;
        return (
          <div
            key={`${link.type}-${link.targetTaskId}`}
            className="flex items-center justify-between p-3 rounded-xl bg-[#0a0a0a] border border-white/10 group hover:border-white/20 hover:bg-white/5 transition-all"
          >
            <div className="flex items-center gap-3">
              <span
                className={`px-2 py-1.5 rounded-lg uppercase font-bold text-[10px] tracking-wide border flex items-center gap-1.5
                                        ${
                                          link.type === "blocked-by"
                                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                                            : link.type === "blocks"
                                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                              : link.type === "duplicates"
                                                ? "bg-slate-500/10 text-slate-300 border-slate-500/20"
                                                : "bg-slate-500/10 text-slate-300 border-slate-500/20"
                                        }`}
              >
                {getLinkIcon(link.type)}
                {link.type.replace("-", " ")}
              </span>
              <div className="flex flex-col">
                <span className="text-xs font-mono text-slate-500">{target.jobId}</span>
                <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">
                  {target.title}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleRemoveTaskLink(link.targetTaskId)}
              className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors flex items-center gap-2"
            >
              <span className="text-xs font-medium">Unlink</span>
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
      {links.length === 0 && (
        <div className="text-center py-4 text-xs text-slate-600 italic border border-dashed border-white/5 rounded-xl">
          No linked tasks
        </div>
      )}
    </div>
  </div>
);
