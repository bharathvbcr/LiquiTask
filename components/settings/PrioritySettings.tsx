import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Flag,
  Flame,
  Minus,
  Plus,
  Shield,
  Star,
  Trash2,
  Zap,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { PriorityDefinition } from "../../types";

const AVAILABLE_ICONS = [
  { key: "flame", icon: Flame, label: "Flame" },
  { key: "clock", icon: Clock, label: "Clock" },
  { key: "arrow-up", icon: ArrowUp, label: "Arrow Up" },
  { key: "arrow-down", icon: ArrowDown, label: "Arrow Down" },
  { key: "zap", icon: Zap, label: "Zap" },
  { key: "star", icon: Star, label: "Star" },
  { key: "shield", icon: Shield, label: "Shield" },
  { key: "flag", icon: Flag, label: "Flag" },
  { key: "alert-triangle", icon: AlertTriangle, label: "Warning" },
  { key: "alert-circle", icon: AlertCircle, label: "Info" },
  { key: "minus", icon: Minus, label: "Minus" },
];

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#64748b",
];

interface PrioritySettingsProps {
  priorities: PriorityDefinition[];
  onUpdatePriorities: (priorities: PriorityDefinition[]) => void;
  addToast: (message: string, type: "success" | "error" | "info") => void;
}

export const PrioritySettings: React.FC<PrioritySettingsProps> = ({
  priorities,
  onUpdatePriorities,
  addToast,
}) => {
  const [localPriorities, setLocalPriorities] = useState<PriorityDefinition[]>(
    priorities.length > 0 ? priorities : getDefaultPriorities(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showIconPicker, setShowIconPicker] = useState<string | null>(null);

  const handleAddPriority = () => {
    const newPriority: PriorityDefinition = {
      id: `priority_${Date.now()}`,
      label: "New Priority",
      color: "#64748b",
      level: localPriorities.length + 1,
      icon: "flag",
    };
    setLocalPriorities([...localPriorities, newPriority]);
    setEditingId(newPriority.id);
  };

  const handleUpdatePriority = (id: string, updates: Partial<PriorityDefinition>) => {
    setLocalPriorities(localPriorities.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const handleDeletePriority = (id: string) => {
    if (localPriorities.length <= 1) {
      addToast("At least one priority is required", "error");
      return;
    }
    setLocalPriorities(localPriorities.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newList = [...localPriorities];
    [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
    setLocalPriorities(newList.map((p, i) => ({ ...p, level: i + 1 })));
  };

  const handleMoveDown = (index: number) => {
    if (index === localPriorities.length - 1) return;
    const newList = [...localPriorities];
    [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
    setLocalPriorities(newList.map((p, i) => ({ ...p, level: i + 1 })));
  };

  const handleSave = () => {
    const valid = localPriorities.filter(
      (p) => p.label.trim() && /^#[0-9A-Fa-f]{6}$/.test(p.color),
    );
    if (valid.length === 0) {
      addToast("At least one valid priority is required", "error");
      return;
    }
    onUpdatePriorities(valid.map((p, i) => ({ ...p, level: i + 1 })));
    addToast(`Saved ${valid.length} prioritie${valid.length > 1 ? "s" : ""}`, "success");
  };

  const handleReset = () => {
    setLocalPriorities(getDefaultPriorities());
    setEditingId(null);
    addToast("Reset to default priorities", "info");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Priority Definitions</h3>
          <p className="text-sm text-slate-400 mt-1">
            Define custom priority levels for your tasks. Order matters — top items are highest
            priority.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
          >
            Reset Defaults
          </button>
          <button
            onClick={handleAddPriority}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors border border-red-500/30 flex items-center gap-1.5"
          >
            <Plus size={14} />
            Add Priority
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {localPriorities.map((priority, index) => (
          <PriorityRow
            key={priority.id}
            priority={priority}
            index={index}
            isEditing={editingId === priority.id}
            isIconPickerOpen={showIconPicker === priority.id}
            isFirst={index === 0}
            isLast={index === localPriorities.length - 1}
            onEdit={() => setEditingId(editingId === priority.id ? null : priority.id)}
            onSave={() => setEditingId(null)}
            onUpdate={(updates) => handleUpdatePriority(priority.id, updates)}
            onDelete={() => handleDeletePriority(priority.id)}
            onMoveUp={() => handleMoveUp(index)}
            onMoveDown={() => handleMoveDown(index)}
            onToggleIconPicker={() =>
              setShowIconPicker(showIconPicker === priority.id ? null : priority.id)
            }
          />
        ))}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-white/10">
        <p className="text-xs text-slate-500">
          {localPriorities.length} priorit{localPriorities.length === 1 ? "y" : "ies"} defined
        </p>
        <button
          onClick={handleSave}
          className="px-6 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-400 rounded-lg transition-colors shadow-lg shadow-red-500/20"
        >
          Save Priorities
        </button>
      </div>
    </div>
  );
};

interface PriorityRowProps {
  priority: PriorityDefinition;
  index: number;
  isEditing: boolean;
  isIconPickerOpen: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onSave: () => void;
  onUpdate: (updates: Partial<PriorityDefinition>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleIconPicker: () => void;
}

const PriorityRow: React.FC<PriorityRowProps> = ({
  priority,
  index,
  isEditing,
  isIconPickerOpen,
  isFirst,
  isLast,
  onEdit,
  onSave,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleIconPicker,
}) => {
  const IconComponent = AVAILABLE_ICONS.find((i) => i.key === priority.icon)?.icon || Flag;

  return (
    <div
      className="group relative bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all"
      style={{ borderLeftWidth: "3px", borderLeftColor: priority.color }}
    >
      <div className="flex items-center gap-3 p-4">
        <div className="flex flex-col gap-0.5 text-slate-600">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-0.5 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-0.5 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
            title="Move down"
          >
            <ChevronDown size={14} />
          </button>
        </div>

        <div
          className="p-2 rounded-lg bg-white/5 border border-white/10"
          style={{ color: priority.color }}
        >
          <IconComponent size={18} />
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              Label
            </label>
            {isEditing ? (
              <input
                type="text"
                value={priority.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:border-red-500/50 focus:outline-none"
                placeholder="Priority name"
              />
            ) : (
              <span className="text-sm text-white font-medium">{priority.label}</span>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              Color
            </label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={priority.color}
                  onChange={(e) => onUpdate({ color: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                />
                <div className="flex gap-1 flex-wrap">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => onUpdate({ color })}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${
                        priority.color === color ? "border-white scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded-full border border-white/20"
                  style={{ backgroundColor: priority.color }}
                />
                <span className="text-xs text-slate-400 font-mono">{priority.color}</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 block">
              Icon
            </label>
            {isEditing ? (
              <div className="relative">
                <button
                  onClick={onToggleIconPicker}
                  className="flex items-center gap-2 px-3 py-1.5 bg-black/30 border border-white/10 rounded-lg text-sm text-white hover:border-white/20 transition-colors"
                >
                  <IconComponent size={14} />
                  <span className="text-xs text-slate-400">Change</span>
                </button>
                {isIconPickerOpen && (
                  <IconPicker
                    onSelect={(icon) => {
                      onUpdate({ icon });
                      onToggleIconPicker();
                    }}
                  />
                )}
              </div>
            ) : (
              <span className="text-xs text-slate-400">{priority.icon || "flag"}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isEditing ? (
            <button
              onClick={onSave}
              className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              title="Done editing"
            >
              <Check size={16} />
            </button>
          ) : (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
              title="Edit"
            >
              <Flag size={16} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

interface IconPickerProps {
  onSelect: (icon: string) => void;
}

const IconPicker: React.FC<IconPickerProps> = ({ onSelect }) => (
  <div className="absolute top-full left-0 mt-2 z-50 p-3 bg-slate-900 border border-white/10 rounded-xl shadow-2xl grid grid-cols-4 gap-2 min-w-[200px]">
    {AVAILABLE_ICONS.map(({ key, icon: Icon, label }) => (
      <button
        key={key}
        onClick={() => onSelect(key)}
        className="p-2 rounded-lg hover:bg-white/10 transition-colors flex flex-col items-center gap-1"
        title={label}
      >
        <Icon size={18} className="text-slate-300" />
        <span className="text-[9px] text-slate-500">{label}</span>
      </button>
    ))}
  </div>
);

function getDefaultPriorities(): PriorityDefinition[] {
  return [
    { id: "high", label: "High", color: "#ef4444", level: 1, icon: "flame" },
    { id: "medium", label: "Medium", color: "#eab308", level: 2, icon: "clock" },
    { id: "low", label: "Low", color: "#10b981", level: 3, icon: "arrow-down" },
  ];
}
