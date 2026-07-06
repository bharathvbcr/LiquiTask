import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "../../types";
import { taskToJson } from "../utils/taskToJson";

interface UseTaskCardContextMenuProps {
  task: Task;
  projectName?: string;
  onCopyTask?: (message: string) => void;
  onMoveToWorkspace?: (taskId: string, projectId: string) => void;
}

export const useTaskCardContextMenu = ({
  task,
  projectName,
  onCopyTask,
  onMoveToWorkspace,
}: UseTaskCardContextMenuProps) => {
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [showWorkspaceSubmenu, setShowWorkspaceSubmenu] = useState(false);
  const submenuTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Raw cursor coords — TaskCard measures the rendered menu and clamps
    // it to the viewport, so no size guessing is needed here.
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
    setContextMenuVisible(true);
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
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenuVisible(false);
        setShowWorkspaceSubmenu(false);
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
    };
  }, []);

  return {
    contextMenuVisible,
    setContextMenuVisible,
    contextMenuPosition,
    showWorkspaceSubmenu,
    handleContextMenu,
    handleCopyAsJson,
    handleMoveToWorkspace,
    handleWorkspaceSubmenuEnter,
    handleWorkspaceSubmenuLeave,
  };
};
