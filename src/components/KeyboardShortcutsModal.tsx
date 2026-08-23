import { Keyboard } from "lucide-react";
import type React from "react";
import { useMemo } from "react";
import { FEATURE_FLAGS } from "../constants";
import { buildShortcutGroups, formatKeyCombo } from "../constants/keybindings";
import { useKeybinding } from "../context/KeybindingContext";
import { Modal } from "./common/Modal";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiFeaturesEnabled?: boolean;
  agentExecutionEnabled?: boolean;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
  aiFeaturesEnabled = true,
  agentExecutionEnabled = true,
}) => {
  const { keybindings } = useKeybinding();

  const groups = useMemo(
    () =>
      buildShortcutGroups(keybindings, {
        aiFeaturesEnabled,
        agentExecutionEnabled,
        assistantSidebarEnabled: FEATURE_FLAGS.AI_ASSISTANT_SIDEBAR_ENABLED,
      }),
    [keybindings, aiFeaturesEnabled, agentExecutionEnabled],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Keyboard Shortcuts"
      icon={<Keyboard size={20} />}
      size="md"
    >
      <div className="space-y-5">
        {groups.map(({ category, items }) => (
          <div key={category}>
            <h4 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1 mb-2">
              {category}
            </h4>
            <div className="space-y-1">
              {items.map((shortcut) => (
                <div
                  key={shortcut.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                >
                  <span className="text-sm text-slate-300">{shortcut.label}</span>
                  <div className="flex gap-1 shrink-0">
                    {shortcut.keys.map((combo) => (
                      <kbd
                        key={combo}
                        className="px-2 py-1 bg-white/10 border border-white/10 rounded text-xs font-mono text-white/80"
                      >
                        {formatKeyCombo(combo)}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-white/5 text-center">
        <p className="text-xs text-slate-500">
          Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono">?</kbd> anytime to show
          this menu
        </p>
      </div>
    </Modal>
  );
};

export default KeyboardShortcutsModal;
