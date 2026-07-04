import {
  Archive,
  Calendar,
  CheckSquare,
  Copy,
  Flag,
  Folder,
  MoveRight,
  Square,
  Tag,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { BoardColumn, PriorityDefinition, Project } from "../../types";

type BulkMenuId =
  | "move"
  | "priority"
  | "tags"
  | "workspace"
  | "assign"
  | null;

interface BulkActionsBarProps {
  selectedCount: number;
  columns: BoardColumn[];
  assignees: string[];
  priorities: PriorityDefinition[];
  availableTags: string[];
  projects?: Project[];
  onMove: (columnId: string) => void;
  onAssign: (assignee: string) => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  isAllSelected: boolean;
  onSetPriority: (priorityId: string) => void;
  onSetDueDate: (date: Date | null) => void;
  onAddTag: (tag: string) => void;
  onDuplicate?: () => void;
  onArchive?: () => void;
  onRemoveTag?: (tag: string) => void;
  onMoveToWorkspace?: (workspaceId: string) => void;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  columns,
  assignees,
  priorities,
  availableTags,
  projects = [],
  onMove,
  onAssign,
  onDelete,
  onSelectAll,
  onSelectNone,
  isAllSelected,
  onSetPriority,
  onSetDueDate,
  onAddTag,
  onDuplicate,
  onArchive,
  onRemoveTag,
  onMoveToWorkspace,
}) => {
  const [openMenu, setOpenMenu] = useState<BulkMenuId>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [newTag, setNewTag] = useState("");
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
        setShowDatePicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setOpenMenu(null);
    setShowDatePicker(false);
  }, [selectedCount]);

  if (selectedCount === 0) return null;

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) {
      onSetDueDate(null);
      setShowDatePicker(false);
      return;
    }
    const [year, month, day] = e.target.value.split("-").map(Number);
    onSetDueDate(new Date(year, month - 1, day));
    setShowDatePicker(false);
  };

  const handleAddTag = (tag: string) => {
    if (tag.trim()) {
      onAddTag(tag.trim());
      setNewTag("");
    }
  };

  const toggleMenu = (menu: BulkMenuId) => {
    setShowDatePicker(false);
    setOpenMenu((prev) => (prev === menu ? null : menu));
  };

  const menuButtonClass =
    "flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50";

  const dropdownClass =
    "absolute bottom-full left-0 mb-2 bg-[#1a0a0a] border border-white/10 rounded-xl p-1 shadow-xl z-10";

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200 max-w-[calc(100vw-2rem)]">
      <div
        ref={barRef}
        className="flex items-center gap-2 px-4 py-3 bg-[#1a0a0a]/95 backdrop-blur-xl border border-red-500/20 rounded-2xl shadow-2xl shadow-black/50 overflow-x-auto custom-scrollbar"
        role="toolbar"
        aria-label="Bulk actions"
      >
        <div className="flex items-center gap-3 pr-3 border-r border-white/10 shrink-0">
          <button
            type="button"
            onClick={isAllSelected ? onSelectNone : onSelectAll}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            title={isAllSelected ? "Deselect all" : "Select all"}
            aria-label={isAllSelected ? "Deselect all" : "Select all"}
          >
            {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          </button>
          <span className="text-sm font-bold text-white whitespace-nowrap">
            {selectedCount} selected
          </span>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => toggleMenu("move")}
            aria-expanded={openMenu === "move"}
            aria-haspopup="menu"
            className={`${menuButtonClass} ${openMenu === "move" ? "bg-white/10 text-white" : ""}`}
          >
            <MoveRight size={16} />
            <span className="hidden sm:inline">Move to</span>
          </button>
          {openMenu === "move" && (
            <div className={`${dropdownClass} min-w-[150px]`} role="menu">
              {columns.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => {
                    onMove(col.id);
                    setOpenMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                  role="menuitem"
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: col.color }}
                  />
                  {col.title}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => toggleMenu("priority")}
            aria-expanded={openMenu === "priority"}
            aria-haspopup="menu"
            className={`${menuButtonClass} ${openMenu === "priority" ? "bg-white/10 text-white" : ""}`}
          >
            <Flag size={16} />
            <span className="hidden sm:inline">Priority</span>
          </button>
          {openMenu === "priority" && (
            <div className={`${dropdownClass} min-w-[120px]`} role="menu">
              {priorities.map((priority) => (
                <button
                  key={priority.id}
                  type="button"
                  onClick={() => {
                    onSetPriority(priority.id);
                    setOpenMenu(null);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-white/10 rounded-lg transition-colors text-left"
                  style={{ color: priority.color }}
                  role="menuitem"
                >
                  <Flag size={12} />
                  {priority.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setOpenMenu(null);
              setShowDatePicker((v) => !v);
            }}
            aria-expanded={showDatePicker}
            className={`${menuButtonClass} ${showDatePicker ? "bg-white/10 text-white" : ""}`}
          >
            <Calendar size={16} />
            <span className="hidden sm:inline">Due</span>
          </button>
          {showDatePicker && (
            <div className="absolute bottom-full left-0 mb-2 bg-[#1a0a0a] border border-white/10 rounded-xl p-3 shadow-xl z-10">
              <label htmlFor="bulk-due-date-input" className="sr-only">
                Set due date for selected tasks
              </label>
              <input
                id="bulk-due-date-input"
                type="date"
                onChange={handleDateChange}
                aria-label="Set due date for selected tasks"
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 [color-scheme:dark] focus:border-red-500/50 outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  onSetDueDate(null);
                  setShowDatePicker(false);
                }}
                className="w-full mt-2 px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                Clear due date
              </button>
            </div>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => toggleMenu("tags")}
            aria-expanded={openMenu === "tags"}
            aria-haspopup="menu"
            className={`${menuButtonClass} ${openMenu === "tags" ? "bg-white/10 text-white" : ""}`}
          >
            <Tag size={16} />
            <span className="hidden sm:inline">Tags</span>
          </button>
          {openMenu === "tags" && (
            <div className={`${dropdownClass} min-w-[180px] p-2`} role="menu">
              <div className="mb-2 pb-2 border-b border-white/5">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 px-2">
                  Add tag
                </div>
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag(newTag)}
                  placeholder="New tag…"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-slate-300 placeholder-slate-500 focus:border-red-500/50 outline-none mb-2"
                />
                {availableTags.length > 0 && (
                  <div className="max-h-[100px] overflow-y-auto">
                    {availableTags.slice(0, 8).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          onAddTag(tag);
                          setOpenMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                        role="menuitem"
                      >
                        <Tag size={10} />
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {onRemoveTag && availableTags.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 px-2">
                    Remove tag
                  </div>
                  <div className="max-h-[100px] overflow-y-auto">
                    {availableTags.slice(0, 8).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          onRemoveTag(tag);
                          setOpenMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-300 hover:text-red-200 hover:bg-red-500/10 rounded-lg transition-colors text-left"
                        role="menuitem"
                      >
                        <X size={10} />
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {onDuplicate && (
          <button
            type="button"
            onClick={onDuplicate}
            className={`${menuButtonClass} shrink-0`}
            title="Duplicate selected tasks"
          >
            <Copy size={16} />
            <span className="hidden sm:inline">Duplicate</span>
          </button>
        )}

        {onArchive && (
          <button
            type="button"
            onClick={onArchive}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
            title="Archive selected tasks"
          >
            <Archive size={16} />
            <span className="hidden sm:inline">Archive</span>
          </button>
        )}

        {onMoveToWorkspace && projects.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => toggleMenu("workspace")}
              aria-expanded={openMenu === "workspace"}
              aria-haspopup="menu"
              className={`${menuButtonClass} ${openMenu === "workspace" ? "bg-white/10 text-white" : ""}`}
            >
              <Folder size={16} />
              <span className="hidden sm:inline">Workspace</span>
            </button>
            {openMenu === "workspace" && (
              <div className={`${dropdownClass} min-w-[180px] max-h-[200px] overflow-y-auto`} role="menu">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      onMoveToWorkspace(project.id);
                      setOpenMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                    role="menuitem"
                  >
                    <Folder size={12} />
                    {project.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {assignees.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => toggleMenu("assign")}
              aria-expanded={openMenu === "assign"}
              aria-haspopup="menu"
              className={`${menuButtonClass} ${openMenu === "assign" ? "bg-white/10 text-white" : ""}`}
            >
              <UserPlus size={16} />
              <span className="hidden sm:inline">Assign</span>
            </button>
            {openMenu === "assign" && (
              <div className={`${dropdownClass} min-w-[150px] max-h-[200px] overflow-y-auto`} role="menu">
                <button
                  type="button"
                  onClick={() => {
                    onAssign("");
                    setOpenMenu(null);
                  }}
                  className="w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left italic"
                  role="menuitem"
                >
                  Unassign
                </button>
                {assignees.map((assignee) => (
                  <button
                    key={assignee}
                    type="button"
                    onClick={() => {
                      onAssign(assignee);
                      setOpenMenu(null);
                    }}
                    className="w-full px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-left"
                    role="menuitem"
                  >
                    {assignee}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="w-px h-6 bg-white/10 shrink-0" />

        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
        >
          <Trash2 size={16} />
          <span className="hidden sm:inline">Delete</span>
        </button>

        <button
          type="button"
          onClick={onSelectNone}
          className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default BulkActionsBar;
