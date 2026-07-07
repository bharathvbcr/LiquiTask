import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentProfile, Task } from "../../types";
import agentDispatchService from "../services/agents/agentDispatchService";
import agentService from "../services/agents/agentService";
import { taskToJson } from "../utils/taskToJson";

interface UseTaskCardContextMenuProps {
  task: Task;
  projectName?: string;
  onCopyTask?: (message: string) => void;
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
  onDeleteTask?: (taskId: string) => void;
}

export const useTaskCardContextMenu = ({
  task,
  projectName,
  onCopyTask,
  onMoveToWorkspace,
  onDeleteTask,
}: UseTaskCardContextMenuProps) => {
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [showWorkspaceSubmenu, setShowWorkspaceSubmenu] = useState(false);
  const [showAgentSubmenu, setShowAgentSubmenu] = useState(false);
  const [dispatchAgents, setDispatchAgents] = useState<AgentProfile[]>([]);
  const [offerAgentSetup, setOfferAgentSetup] = useState(false);
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const agentSubmenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Raw cursor coords — TaskCard measures the rendered menu and clamps
    // it to the viewport, so no size guessing is needed here.
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    // Snapshot dispatchable agents at open time (cheap storage read).
    setDispatchAgents(
      agentDispatchService.canDispatch()
        ? agentService.getAgents().filter((a) => Boolean(a.workingDir?.trim()))
        : [],
    );
    // First run: no agents yet — the menu offers guided setup instead.
    setOfferAgentSetup(agentDispatchService.canOfferSetup());
    setContextMenuVisible(true);
  }, []);

  const handleAgentSetup = useCallback(() => {
    setContextMenuVisible(false);
    agentDispatchService.requestSetup();
  }, []);

  /** One-action handoff: smart-match when no agent id is given. */
  const handleSendToAgent = useCallback(
    (agentId?: string) => {
      setContextMenuVisible(false);
      setShowAgentSubmenu(false);
      void agentDispatchService.dispatch(task, agentId);
    },
    [task],
  );

  const handleAgentSubmenuEnter = useCallback(() => {
    if (agentSubmenuTimeoutRef.current) clearTimeout(agentSubmenuTimeoutRef.current);
    setShowAgentSubmenu(true);
  }, []);

  const handleAgentSubmenuLeave = useCallback(() => {
    agentSubmenuTimeoutRef.current = setTimeout(() => {
      setShowAgentSubmenu(false);
    }, 150);
  }, []);

  const handleCopyAsJson = useCallback(async () => {
    try {
      const jsonString = taskToJson(task, projectName);
      await navigator.clipboard.writeText(jsonString);
      setContextMenuVisible(false);
      onCopyTask?.("Task details copied to clipboard as JSON");
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      onCopyTask?.("Failed to copy task details");
    }
  }, [task, projectName, onCopyTask]);

  const handleMoveToWorkspace = useCallback(
    (projectId: string) => {
      onMoveToWorkspace?.(task.id, projectId);
      setContextMenuVisible(false);
      setShowWorkspaceSubmenu(false);
    },
    [task.id, onMoveToWorkspace],
  );

  const handleDeleteTask = useCallback(() => {
    setContextMenuVisible(false);
    setShowWorkspaceSubmenu(false);
    setShowAgentSubmenu(false);
    onDeleteTask?.(task.id);
  }, [onDeleteTask, task.id]);

  const handleWorkspaceSubmenuEnter = useCallback(() => {
    if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
    setShowWorkspaceSubmenu(true);
  }, []);

  const handleWorkspaceSubmenuLeave = useCallback(() => {
    submenuTimeoutRef.current = setTimeout(() => {
      setShowWorkspaceSubmenu(false);
    }, 150);
  }, []);

  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuVisible(false);
      setShowWorkspaceSubmenu(false);
      setShowAgentSubmenu(false);
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenuVisible(false);
        setShowWorkspaceSubmenu(false);
        setShowAgentSubmenu(false);
      }
    };

    if (contextMenuVisible) {
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [contextMenuVisible]);

  useEffect(() => {
    return () => {
      if (submenuTimeoutRef.current) clearTimeout(submenuTimeoutRef.current);
      if (agentSubmenuTimeoutRef.current) clearTimeout(agentSubmenuTimeoutRef.current);
    };
  }, []);

  return {
    contextMenuVisible,
    setContextMenuVisible,
    contextMenuPosition,
    showWorkspaceSubmenu,
    showAgentSubmenu,
    dispatchAgents,
    offerAgentSetup,
    handleContextMenu,
    handleCopyAsJson,
    handleMoveToWorkspace,
    handleDeleteTask,
    handleSendToAgent,
    handleAgentSetup,
    handleWorkspaceSubmenuEnter,
    handleWorkspaceSubmenuLeave,
    handleAgentSubmenuEnter,
    handleAgentSubmenuLeave,
  };
};
