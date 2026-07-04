import { Keyboard, RotateCcw } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { KeybindingMap } from "../../src/constants/keybindings";
import { Button } from "../../src/components/common/Button";
import type { ToastType } from "../../types";

const SHORTCUT_META: Record<string, { label: string; category: string }> = {
  "global:command-palette": { label: "Open command palette", category: "Global" },
  "global:toggle-assistant": { label: "Toggle AI assistant", category: "Global" },
  "global:toggle-sidebar": { label: "Toggle sidebar", category: "Global" },
  "global:create-task": { label: "Create new task", category: "Global" },
  "global:undo": { label: "Undo last action", category: "Global" },
  "global:export": { label: "Export data", category: "Global" },
  "global:search-focus": { label: "Focus search", category: "Global" },
  "nav:down": { label: "Move selection down", category: "Navigation" },
  "nav:up": { label: "Move selection up", category: "Navigation" },
  "nav:left": { label: "Move selection left", category: "Navigation" },
  "nav:right": { label: "Move selection right", category: "Navigation" },
  "nav:select": { label: "Select / open task", category: "Navigation" },
  "nav:back": { label: "Close / go back", category: "Navigation" },
  "nav:column-1": { label: "Jump to column 1", category: "Navigation" },
  "nav:column-2": { label: "Jump to column 2", category: "Navigation" },
  "nav:column-3": { label: "Jump to column 3", category: "Navigation" },
  "nav:column-4": { label: "Jump to column 4", category: "Navigation" },
  "nav:column-5": { label: "Jump to column 5", category: "Navigation" },
  "nav:column-6": { label: "Jump to column 6", category: "Navigation" },
  "nav:column-7": { label: "Jump to column 7", category: "Navigation" },
  "nav:column-8": { label: "Jump to column 8", category: "Navigation" },
  "nav:column-9": { label: "Jump to column 9", category: "Navigation" },
  "task:delete": { label: "Delete selected task", category: "Tasks" },
  "task:complete": { label: "Toggle task complete", category: "Tasks" },
  "task:edit": { label: "Edit selected task", category: "Tasks" },
  "task:move-next": { label: "Move task to next column", category: "Tasks" },
  "task:move-prev": { label: "Move task to previous column", category: "Tasks" },
};

const CATEGORY_ORDER = ["Global", "Navigation", "Tasks"];

function formatKeyCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "meta" || lower === "cmd" || lower === "command") return "⌘";
      if (lower === "ctrl" || lower === "control") return "Ctrl";
      if (lower === "shift") return "Shift";
      if (lower === "alt" || lower === "opt") return "Alt";
      if (lower === "arrowdown") return "↓";
      if (lower === "arrowup") return "↑";
      if (lower === "arrowleft") return "←";
      if (lower === "arrowright") return "→";
      if (lower === "enter") return "↵";
      if (lower === "escape") return "Esc";
      if (lower === "delete") return "Del";
      if (lower === "backspace") return "⌫";
      return part.length === 1 ? part.toUpperCase() : part;
    })
    .join(" ");
}

interface ShortcutSettingsProps {
  keybindings: KeybindingMap;
  updateKeybinding: (actionId: string, keys: string[]) => string | null;
  resetKeybindings: () => void;
  addToast: (msg: string, type: ToastType) => void;
}

export const ShortcutSettings: React.FC<ShortcutSettingsProps> = ({
  keybindings,
  updateKeybinding,
  resetKeybindings,
  addToast,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const grouped = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; label: string; keys: string[] }>>();
    for (const [id, keys] of Object.entries(keybindings)) {
      const meta = SHORTCUT_META[id];
      const category = meta?.category ?? "Other";
      const label = meta?.label ?? id.replace(/[-:]/g, " ");
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push({ id, label, keys: keys as string[] });
    }
    return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
      category,
      items: groups.get(category)!,
    }));
  }, [keybindings]);

  const handleReset = () => {
    resetKeybindings();
    setShowResetConfirm(false);
    addToast("Keyboard shortcuts reset to defaults", "info");
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
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
              Reset all
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowResetConfirm(true)}
            icon={<RotateCcw size={14} />}
          >
            Reset defaults
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
                    className="bg-black/20 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 w-40 sm:w-48 text-right font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus:border-blue-500/30"
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
