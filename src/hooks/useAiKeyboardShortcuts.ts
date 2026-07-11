import { useEffect } from "react";
import { useKeybinding } from "../context/KeybindingContext";
import { shouldBlockAppShortcut } from "../utils/keyboardTarget";

interface UseAiKeyboardShortcutsProps {
  onAiPrioritize?: () => void;
  onAiInsights?: () => void;
  onBulkAIOperations?: () => void;
  onAutoOrganize?: () => void;
  onUndoAiChanges?: () => void;
  isModalOpen: boolean;
}

export const useAiKeyboardShortcuts = (props?: UseAiKeyboardShortcutsProps) => {
  const { matches } = useKeybinding();

  useEffect(() => {
    if (!props) return;

    const {
      onAiPrioritize,
      onAiInsights,
      onBulkAIOperations,
      onAutoOrganize,
      onUndoAiChanges,
      isModalOpen,
    } = props;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen || shouldBlockAppShortcut(e)) return;

      if (matches("ai:prioritize", e)) {
        e.preventDefault();
        onAiPrioritize?.();
      } else if (matches("ai:insights", e)) {
        e.preventDefault();
        onAiInsights?.();
      } else if (matches("ai:bulk-operations", e)) {
        e.preventDefault();
        onBulkAIOperations?.();
      } else if (matches("ai:auto-organize", e)) {
        e.preventDefault();
        onAutoOrganize?.();
      } else if (matches("ai:undo-changes", e)) {
        e.preventDefault();
        onUndoAiChanges?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matches, props]);
};
