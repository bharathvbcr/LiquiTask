import { useEffect } from "react";
import type { Project, Task, ToastType } from "../../types";
import { useKeybinding } from "../context/KeybindingContext";
import { shouldBlockAppShortcut } from "../utils/keyboardTarget";

interface KeyboardShortcutsProps {
  handleUndo: () => void;
  setIsCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssistantOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingTask: React.Dispatch<React.SetStateAction<Task | null>>;
  openQuickAdd?: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  tasks: Task[];
  projects: Project[];
  addToast: (message: string, type?: ToastType) => void;
  isCommandPaletteOpen: boolean;
}

export const useGlobalKeyboardShortcuts = ({
  handleUndo,
  setIsCommandPaletteOpen,
  setIsSidebarCollapsed,
  setIsAssistantOpen,
  setIsTaskModalOpen,
  setEditingTask,
  openQuickAdd,
  searchInputRef,
  tasks,
  projects,
  addToast,
  isCommandPaletteOpen,
}: KeyboardShortcutsProps) => {
  const { matches } = useKeybinding();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (shouldBlockAppShortcut(e)) return;

      if (matches("global:command-palette", e)) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
      if (matches("global:toggle-assistant", e)) {
        e.preventDefault();
        setIsAssistantOpen((prev) => !prev);
      }
      if (matches("global:toggle-sidebar", e)) {
        e.preventDefault();
        setIsSidebarCollapsed((prev) => !prev);
      }
      if (matches("global:undo", e)) {
        e.preventDefault();
        handleUndo();
      }
      if (matches("global:export", e)) {
        e.preventDefault();
        import("../services/exportService").then(({ exportService }) => {
          const projectMap = new Map<string, string>(projects.map((p) => [p.id, p.name]));
          exportService.downloadCSV(tasks, "liquitask-export.csv", projectMap);
          addToast("Exported tasks to CSV", "success");
        });
      }
      if (matches("nav:back", e) && isCommandPaletteOpen) {
        e.preventDefault();
        setIsCommandPaletteOpen(false);
      }
      if (matches("global:create-task", e)) {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      }
      if (matches("global:quick-add", e)) {
        e.preventDefault();
        if (openQuickAdd) {
          openQuickAdd();
        } else {
          setEditingTask(null);
          setIsTaskModalOpen(true);
        }
      }
      if (matches("global:search-focus", e)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [
    handleUndo,
    isCommandPaletteOpen,
    tasks,
    projects,
    addToast,
    matches,
    setIsCommandPaletteOpen,
    setIsAssistantOpen,
    setIsSidebarCollapsed,
    setIsTaskModalOpen,
    setEditingTask,
    openQuickAdd,
    searchInputRef,
  ]);
};
