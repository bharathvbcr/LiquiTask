import { CheckSquare, Kanban, Plus, Trash2 } from "lucide-react";
import type React from "react";
import { Tooltip } from "../Tooltip";
import type { BoardColumn } from "../../../types";

interface WorkflowSettingsProps {
  localColumns: BoardColumn[];
  updateItem: <T extends object>(
    list: T[],
    idx: number,
    field: keyof T,
    val: T[keyof T],
    setter: (val: T[]) => void,
  ) => void;
  setLocalColumns: (val: BoardColumn[]) => void;
  deleteItem: <T>(list: T[], idx: number, setter: (val: T[]) => void, min?: number) => void;
  saveAll: () => void;
}

export const WorkflowSettings: React.FC<WorkflowSettingsProps> = ({
  localColumns,
  updateItem,
  setLocalColumns,
  deleteItem,
  saveAll,
}) => {
  const addColumn = () =>
    setLocalColumns([
      ...localColumns,
      {
        id: `col-${Date.now()}`,
        title: "New Column",
        color: "#64748b",
        wipLimit: 0,
      },
    ]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
          <Kanban size={20} />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">Workflow Columns</h3>
          <p className="text-sm text-slate-400">
            Customize board columns, WIP limits, and completion status.
          </p>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Board Columns ({localColumns.length})
          </h4>
          <button
            type="button"
            onClick={addColumn}
            className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded px-1"
          >
            <Plus size={14} /> Add Column
          </button>
        </div>
        <div className="space-y-2">
          {localColumns.map((col, idx) => (
            <div
              key={col.id}
              className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors"
              style={{ borderLeftWidth: "3px", borderLeftColor: col.color }}
            >
              <input
                type="color"
                value={col.color.startsWith("#") ? col.color : "#64748b"}
                onChange={(e) =>
                  updateItem(localColumns, idx, "color", e.target.value, setLocalColumns)
                }
                aria-label={`Color for ${col.title}`}
                className="w-8 h-8 rounded-lg bg-transparent cursor-pointer border-0 shrink-0"
              />
              <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) =>
                    updateItem(localColumns, idx, "title", e.target.value, setLocalColumns)
                  }
                  className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full font-bold placeholder-slate-600"
                  placeholder="Column name"
                  aria-label="Column name"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0">
                    WIP limit
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={col.wipLimit || ""}
                    onChange={(e) =>
                      updateItem(
                        localColumns,
                        idx,
                        "wipLimit",
                        parseInt(e.target.value, 10) || 0,
                        setLocalColumns,
                      )
                    }
                    className="bg-black/30 border border-white/10 rounded-md text-xs text-slate-400 px-2 py-0.5 w-14 text-center focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500/50"
                    placeholder="∞"
                    aria-label={`WIP limit for ${col.title}`}
                  />
                  <span className="text-[10px] text-slate-600">0 = unlimited</span>
                </div>
              </div>
              <Tooltip content={col.isCompleted ? "Marked as completed column" : "Mark as completed column"} position="top">
                <button
                  type="button"
                  onClick={() =>
                    updateItem(localColumns, idx, "isCompleted", !col.isCompleted, setLocalColumns)
                  }
                  aria-pressed={col.isCompleted}
                  aria-label={`${col.isCompleted ? "Unmark" : "Mark"} ${col.title} as completed column`}
                  className={`p-2 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                    col.isCompleted
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-slate-600 hover:text-slate-400 hover:bg-white/5"
                  }`}
                >
                  <CheckSquare size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Delete column" position="top">
                <button
                  type="button"
                  onClick={() => deleteItem(localColumns, idx, setLocalColumns, 1)}
                  aria-label={`Delete ${col.title}`}
                  className="text-slate-600 hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                >
                  <Trash2 size={16} />
                </button>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={saveAll}
        className="w-full bg-red-600 hover:bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        Save Changes
      </button>
    </div>
  );
};
