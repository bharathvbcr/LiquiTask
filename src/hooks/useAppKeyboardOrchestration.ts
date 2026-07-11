import { useEffect } from "react";

import type { Project, Task, ToastType } from "../../types";
import { useAiKeyboardShortcuts } from "./useAiKeyboardShortcuts";
import { useGlobalKeyboardShortcuts } from "./useGlobalKeyboardShortcuts";
import { shouldBlockAppShortcut } from "../utils/keyboardTarget";

interface GlobalShortcutArgs {
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

interface AiShortcutArgs {
  onAiPrioritize: () => void;
  onAiInsights: () => void;
  onBulkAIOperations: () => void;
  onAutoOrganize: () => void;
  onUndoAiChanges: () => void;
  isModalOpen: boolean;
}

interface AppKeyboardOrchestrationArgs {
  global: GlobalShortcutArgs;
  ai?: AiShortcutArgs;
  setIsKeyboardShortcutsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Bundles global + AI keyboard shortcut hooks and the supplemental listeners
 * for shortcut help (`?`) and terminal toggle (Ctrl+`).
 */
export function useAppKeyboardOrchestration({
  global,
  ai,
  setIsKeyboardShortcutsOpen,
  setIsTerminalOpen,
}: AppKeyboardOrchestrationArgs): void {
  useGlobalKeyboardShortcuts(global);
  useAiKeyboardShortcuts(ai);

  useEffect(() => {
    const handleShortcutHelp = (event: KeyboardEvent) => {
      if (shouldBlockAppShortcut(event)) return;

      if (event.key === "?") {
        event.preventDefault();
        setIsKeyboardShortcutsOpen(true);
      }

      if (event.key === "`" && event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setIsTerminalOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleShortcutHelp);
    return () => window.removeEventListener("keydown", handleShortcutHelp);
  }, [setIsKeyboardShortcutsOpen, setIsTerminalOpen]);
}
