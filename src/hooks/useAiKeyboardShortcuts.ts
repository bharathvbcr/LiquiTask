import { useEffect } from "react";

interface UseAiKeyboardShortcutsProps {
  onAiPrioritize?: () => void;
  onAiInsights?: () => void;
  onBulkAIOperations?: () => void;
  onAutoOrganize?: () => void;
  onUndoAiChanges?: () => void;
  isModalOpen: boolean;
}

export const useAiKeyboardShortcuts = ({
  onAiPrioritize,
  onAiInsights,
  onBulkAIOperations,
  onAutoOrganize,
  onUndoAiChanges,
  isModalOpen,
}: UseAiKeyboardShortcutsProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen) return;

      const isCtrl = e.ctrlKey || e.metaKey;

      if (isCtrl && e.shiftKey && e.key === "P") {
        e.preventDefault();
        onAiPrioritize?.();
      } else if (isCtrl && e.shiftKey && e.key === "I") {
        e.preventDefault();
        onAiInsights?.();
      } else if (isCtrl && e.shiftKey && e.key === "B") {
        e.preventDefault();
        onBulkAIOperations?.();
      } else if (isCtrl && e.shiftKey && e.key === "A") {
        e.preventDefault();
        onAutoOrganize?.();
      } else if (isCtrl && e.shiftKey && e.key === "Z") {
        e.preventDefault();
        onUndoAiChanges?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onAiPrioritize,
    onAiInsights,
    onBulkAIOperations,
    onAutoOrganize,
    onUndoAiChanges,
    isModalOpen,
  ]);
};
