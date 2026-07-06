import { ChevronRight, Copy, FileText, Folder } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Project, Task } from "../../types";

interface TaskCardContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  showWorkspaceSubmenu: boolean;
  task: Task;
  projects: Project[];
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  onCopyTask?: (message: string) => void;
  onClose: () => void;
  onWorkspaceSubmenuEnter: () => void;
  onWorkspaceSubmenuLeave: () => void;
  onCopyAsJson: () => void;
  onMoveToWorkspaceSelect: (projectId: string) => void;
}

export const TaskCardContextMenu: React.FC<TaskCardContextMenuProps> = ({
  visible,
  position,
  showWorkspaceSubmenu,
  task,
  projects,
  onMoveToWorkspace,
  onCopyTask,
  onClose,
  onWorkspaceSubmenuEnter,
  onWorkspaceSubmenuLeave,
  onCopyAsJson,
  onMoveToWorkspaceSelect,
}) => {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  const [submenuVAlign, setSubmenuVAlign] = useState<"top" | "bottom">("top");

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  useLayoutEffect(() => {
    if (!visible) return;
    const el = contextMenuRef.current;
    if (!el) return;
    const margin = 8;
    const submenuWidth = 210;
    const submenuMaxHeight = 300;
    const { offsetWidth: w, offsetHeight: h } = el;
    const left = Math.min(
      Math.max(position.x, margin),
      window.innerWidth - w - margin,
    );
    const top = Math.min(
      Math.max(position.y, margin),
      window.innerHeight - h - margin,
    );
    setMenuStyle({ left, top, visibility: "visible" });
    setSubmenuSide(left + w + submenuWidth + margin > window.innerWidth ? "left" : "right");
    setSubmenuVAlign(top + submenuMaxHeight + margin > window.innerHeight ? "bottom" : "top");
  }, [visible, position]);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={contextMenuRef}
      role="menu"
      aria-label="Task actions"
      className="fixed z-[9100] bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl py-2 min-w-[200px]"
      style={{ visibility: "hidden", ...menuStyle }}
      onClick={(e) => e.stopPropagation()}
    >
      {projects.length > 0 && onMoveToWorkspace && (
        <div
          className="relative"
          onMouseEnter={onWorkspaceSubmenuEnter}
          onMouseLeave={onWorkspaceSubmenuLeave}
        >
          <button
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={showWorkspaceSubmenu}
            className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 flex items-center justify-between focus:outline-none focus-visible:bg-red-500/20"
          >
            <div className="flex items-center gap-2">
              <Folder size={14} className="text-red-400" />
              <span>Move to Workspace</span>
            </div>
            <ChevronRight size={14} className="text-slate-300" />
          </button>
          {showWorkspaceSubmenu && (
            <div
              className={`absolute bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl py-2 min-w-[200px] max-h-[300px] overflow-y-auto ${
                submenuSide === "right" ? "left-full ml-1" : "right-full mr-1"
              } ${submenuVAlign === "top" ? "top-0" : "bottom-0"}`}
            >
              {projects
                .filter((p) => p.id !== task.projectId)
                .map((p) => (
                  <button
                    key={p.id}
                    role="menuitem"
                    onClick={() => onMoveToWorkspaceSelect(p.id)}
                    className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
                  >
                    <Folder size={14} className="text-red-400" />
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      <button
        role="menuitem"
        onClick={onCopyAsJson}
        className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
      >
        <Copy size={14} className="text-red-400" />
        <span>Copy as JSON</span>
      </button>
      <button
        role="menuitem"
        onClick={async () => {
          try {
            const { templateService } = await import("../../src/services/templateService");
            templateService.saveAsTemplate(task, `Template: ${task.title}`);
            onCopyTask?.("Task saved as template");
          } catch {
            onCopyTask?.("Failed to save template");
          } finally {
            onClose();
          }
        }}
        className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
      >
        <FileText size={14} className="text-red-400" />
        <span>Save as Template</span>
      </button>
    </div>,
    document.body,
  );
};
