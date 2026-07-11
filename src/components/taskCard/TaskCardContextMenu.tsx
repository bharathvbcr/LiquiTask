import { Archive, Bot, ChevronRight, Copy, FileText, Folder, Sparkles, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentProfile, Project, Task } from "../../../types";

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
  onDuplicateAsQuickAdd?: () => void;
  onMoveToWorkspaceSelect: (projectId: string) => void;
  onDeleteTask?: () => void;
  onArchiveTask?: () => void;
  /** Agents available for a one-action handoff; empty hides the entry. */
  dispatchAgents?: AgentProfile[];
  showAgentSubmenu?: boolean;
  onAgentSubmenuEnter?: () => void;
  onAgentSubmenuLeave?: () => void;
  /** Called with an agent id, or undefined to smart-match. */
  onSendToAgent?: (agentId?: string) => void;
  /** No agents exist yet — offer guided setup instead of the send entry. */
  offerAgentSetup?: boolean;
  onAgentSetup?: () => void;
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
  onDuplicateAsQuickAdd,
  onMoveToWorkspaceSelect,
  onDeleteTask,
  onArchiveTask,
  dispatchAgents = [],
  showAgentSubmenu = false,
  onAgentSubmenuEnter,
  onAgentSubmenuLeave,
  onSendToAgent,
  offerAgentSetup = false,
  onAgentSetup,
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
      {offerAgentSetup && onAgentSetup && dispatchAgents.length === 0 && (
        <button
          role="menuitem"
          onClick={onAgentSetup}
          className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
        >
          <Bot size={14} className="text-red-400" />
          <div className="min-w-0">
            <span className="block">Send to Agent</span>
            <span className="block text-[10px] text-slate-500">
              Set up your first agent to hand off work
            </span>
          </div>
        </button>
      )}
      {dispatchAgents.length > 0 && onSendToAgent && (
        <div
          className="relative"
          onMouseEnter={onAgentSubmenuEnter}
          onMouseLeave={onAgentSubmenuLeave}
        >
          <button
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={showAgentSubmenu}
            onClick={() => onSendToAgent()}
            className="w-full px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-red-500/20 flex items-center justify-between focus:outline-none focus-visible:bg-red-500/20"
          >
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-red-400" />
              <span>Send to Agent</span>
            </div>
            <ChevronRight size={14} className="text-slate-300" />
          </button>
          {showAgentSubmenu && (
            <div
              className={`absolute bg-[#1a0a0a] border border-red-500/30 rounded-xl shadow-2xl py-2 min-w-[200px] max-h-[300px] overflow-y-auto ${
                submenuSide === "right" ? "left-full ml-1" : "right-full mr-1"
              } top-0`}
            >
              <button
                role="menuitem"
                onClick={() => onSendToAgent()}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
              >
                <Bot size={14} className="text-red-400" />
                <span>Best Match</span>
              </button>
              {dispatchAgents.map((agent) => (
                <button
                  key={agent.id}
                  role="menuitem"
                  onClick={() => onSendToAgent(agent.id)}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
                >
                  <Bot size={14} className="text-red-400" />
                  <span className="truncate">{agent.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
      {onDuplicateAsQuickAdd && (
        <button
          role="menuitem"
          onClick={onDuplicateAsQuickAdd}
          className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
        >
          <Sparkles size={14} className="text-red-400" />
          <span>Duplicate as Quick-Add</span>
        </button>
      )}
      <button
        role="menuitem"
        onClick={async () => {
          try {
            const { templateService } = await import("../../services/templateService");
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
      {onArchiveTask && (
        <button
          role="menuitem"
          onClick={onArchiveTask}
          className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
        >
          <Archive size={14} className="text-amber-400" />
          <span>Archive Task</span>
        </button>
      )}
      {onDeleteTask && (
        <>
          <div className="my-1 border-t border-white/10" aria-hidden="true" />
          <button
            role="menuitem"
            onClick={onDeleteTask}
            className="w-full px-4 py-2.5 text-left text-sm text-red-300 hover:bg-red-500/20 flex items-center gap-2 focus:outline-none focus-visible:bg-red-500/20"
          >
            <Trash2 size={14} className="text-red-400" />
            <span>Delete Task</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  );
};
