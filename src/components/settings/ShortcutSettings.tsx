import { Keyboard, RotateCcw } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { FEATURE_FLAGS } from "../../constants";
import {
  buildShortcutGroups,
  formatKeyCombo,
  type KeybindingMap,
} from "../../constants/keybindings";
import { Button } from "../common/Button";
import type { ToastType } from "../../../types";

interface ShortcutSettingsProps {
  keybindings: KeybindingMap;
  updateKeybinding: (actionId: string, keys: string[]) => string | null;
  resetKeybindings: () => void;
  addToast: (msg: string, type: ToastType) => void;
  aiFeaturesEnabled?: boolean;
  agentExecutionEnabled?: boolean;
}

export const ShortcutSettings: React.FC<ShortcutSettingsProps> = ({
  keybindings,
  updateKeybinding,
  resetKeybindings,
  addToast,
  aiFeaturesEnabled = true,
  agentExecutionEnabled = true,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const grouped = useMemo(
    () =>
      buildShortcutGroups(keybindings, {
        aiFeaturesEnabled,
        agentExecutionEnabled,
        assistantSidebarEnabled: FEATURE_FLAGS.AI_ASSISTANT_SIDEBAR_ENABLED,
      }),
    [keybindings, aiFeaturesEnabled, agentExecutionEnabled],
  );

  const handleReset = () => {
    resetKeybindings();
    setShowResetConfirm(false);
    addToast("Keyboard shortcuts reset to defaults", "info");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-500/20 text-red-400">
            <Keyboard size={20} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Keyboard Shortcuts</h3>
            <p className="text-sm text-slate-400">
              Customize shortcuts. Separate multiple bindings with commas.
            </p>
          </div>
        </div>
        {showResetConfirm ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowResetConfirm(false)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleReset} icon={<RotateCcw size={14} />}>
              Reset All
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResetConfirm(true)}
            icon={<RotateCcw size={14} />}
          >
            Reset Defaults
          </Button>
        )}
      </div>

      {grouped.map(({ category, items }) => (
        <div key={category} className="space-y-2">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1">
            {category}
          </h4>
          <div className="space-y-1.5">
            {items.map(({ id, label, keys }) => (
              <div
                key={id}
                className="flex items-center justify-between gap-4 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-white/10 transition-colors"
              >
                <span className="text-sm text-slate-200">{label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="hidden sm:flex gap-1">
                    {keys.map((combo) => (
                      <kbd
                        key={combo}
                        className="px-2 py-1 bg-black/30 border border-white/10 rounded-md text-[10px] font-mono text-slate-400"
                      >
                        {formatKeyCombo(combo)}
                      </kbd>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={keys.join(", ")}
                    onChange={(e) => {
                      const conflict = updateKeybinding(
                        id,
                        e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                      );
                      if (conflict) addToast(conflict, "error");
                    }}
                    aria-label={`Shortcut for ${label}`}
                    className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-40 sm:w-48 text-right font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus:border-red-500/30"
                    placeholder="e.g. Meta+k"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
