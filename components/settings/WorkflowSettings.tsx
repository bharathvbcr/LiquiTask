import { CheckSquare, Plus, Trash2 } from "lucide-react";
import type React from "react";
import type { BoardColumn } from "../../types";

interface WorkflowSettingsProps {
  localColumns: BoardColumn[];
  updateItem: <T extends Record<string, unknown>>(
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
      <div>
        <div className="flex justify-between items-center mb-3">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Board Columns
          </h4>
          <button onClick={addColumn} className="text-xs flex items-center gap-1 text-red-400">
            <Plus size={14} /> Add Column
          </button>
        </div>
        <div className="space-y-2">
          {localColumns.map((col, idx) => (
            <div
              key={col.id}
              className="flex items-center gap-2 p-2 bg-white/5 rounded-xl border border-white/5"
            >
              <input
                type="color"
                value={col.color.startsWith("#") ? col.color : "#64748b"}
                onChange={(e) =>
                  updateItem(localColumns, idx, "color", e.target.value, setLocalColumns)
                }
                className="w-6 h-6 rounded bg-transparent cursor-pointer"
              />
              <div className="flex-1 flex flex-col gap-1">
                <input
                  type="text"
                  value={col.title}
                  onChange={(e) =>
                    updateItem(localColumns, idx, "title", e.target.value, setLocalColumns)
                  }
                  className="bg-transparent border-none text-sm text-slate-200 focus:outline-none w-full font-bold"
                  placeholder="Name"
                />
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 uppercase">WIP Limit:</span>
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
                    className="bg-[#0a0e17] border border-white/10 rounded-md text-xs text-slate-400 p-0.5 w-12 text-center"
                    placeholder="∞"
                  />
                </div>
              </div>
              <button
                onClick={() =>
                  updateItem(localColumns, idx, "isCompleted", !col.isCompleted, setLocalColumns)
                }
                className={`p-1.5 rounded-md ${col.isCompleted ? "bg-emerald-500/20 text-emerald-400" : "text-slate-600"}`}
              >
                <CheckSquare size={14} />
              </button>
              <button
                onClick={() => deleteItem(localColumns, idx, setLocalColumns, 1)}
                className="text-slate-600 hover:text-red-400 p-1.5"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <button
        onClick={saveAll}
        className="w-full mt-4 bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl"
      >
        Save Changes
      </button>
    </div>
  );
};
