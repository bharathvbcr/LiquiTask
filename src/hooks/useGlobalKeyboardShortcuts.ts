import { useEffect } from "react";
import type { Project, Task, ToastType } from "../../types";
import { useKeybinding } from "../context/KeybindingContext";

interface KeyboardShortcutsProps {
  handleUndo: () => void;
  setIsCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  setIsAssistantOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingTask: React.Dispatch<React.SetStateAction<Task | null>>;
  searchInputRef: React.RefObject<HTMLInputElement>;
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
  searchInputRef,
  tasks,
  projects,
  addToast,
  isCommandPaletteOpen,
}: KeyboardShortcutsProps) => {
  const { matches } = useKeybinding();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);

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
      if (matches("global:undo", e) && !isInput) {
        e.preventDefault();
        handleUndo();
      }
      if (matches("global:export", e) && !isInput) {
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
      if (matches("global:create-task", e) && !isInput) {
        e.preventDefault();
        setEditingTask(null);
        setIsTaskModalOpen(true);
      }
      if (matches("global:search-focus", e) && !isInput) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
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
    searchInputRef,
  ]);
};
