export const DEFAULT_KEYBINDINGS: Record<string, string[]> = {
  "global:command-palette": ["Meta+k", "Ctrl+k"],
  "global:toggle-assistant": ["Meta+j", "Ctrl+j"],
  "global:toggle-sidebar": ["Meta+\\", "Ctrl+\\"],
  "global:create-task": ["c"],
  "global:quick-add": ["Meta+Shift+n", "Ctrl+Shift+n"],
  "global:undo": ["Meta+z", "Ctrl+z"],
  "global:export": ["Meta+Shift+e", "Ctrl+Shift+e"],
  "global:search-focus": ["/"],
  "global:show-shortcuts": ["?"],
  "nav:down": ["ArrowDown", "j"],
  "nav:up": ["ArrowUp", "k"],
  "nav:left": ["ArrowLeft", "h"],
  "nav:right": ["ArrowRight", "l"],
  "nav:select": ["Enter"],
  "nav:back": ["Escape"],
  "nav:column-1": ["1"],
  "nav:column-2": ["2"],
  "nav:column-3": ["3"],
  "nav:column-4": ["4"],
  "nav:column-5": ["5"],
  "nav:column-6": ["6"],
  "nav:column-7": ["7"],
  "nav:column-8": ["8"],
  "nav:column-9": ["9"],
  "task:delete": ["Delete", "Backspace"],
  "task:complete": ["x"],
  "task:edit": ["e"],
  "task:move-next": ["Shift+m"],
  "task:move-prev": ["Shift+,"],
  "task:send-agent": ["a"],
  "ai:prioritize": ["Meta+Shift+p", "Ctrl+Shift+p"],
  "ai:insights": ["Meta+Shift+i", "Ctrl+Shift+i"],
  "ai:bulk-operations": ["Meta+Shift+b", "Ctrl+Shift+b"],
  "ai:auto-organize": ["Meta+Shift+a", "Ctrl+Shift+a"],
  "ai:undo-changes": ["Meta+Shift+z", "Ctrl+Shift+z"],
  "inbox:permission-allow": ["a"],
  "inbox:permission-deny": ["d"],
  "inbox:permission-allow-all": ["Shift+a"],
  "inbox:permission-deny-all": ["Shift+d"],
  "dock:approve-all-pending": ["Shift+a"],
  "dock:deny-all-pending": ["Shift+d"],
};

export interface KeybindingMap {
  [actionId: string]: string[];
}

export interface ShortcutMeta {
  label: string;
  category: string;
}

/** Human-readable labels and categories for shortcut display (settings + help modal). */
export const SHORTCUT_META: Record<string, ShortcutMeta> = {
  "global:command-palette": { label: "Open command palette", category: "Global" },
  "global:toggle-assistant": { label: "Toggle AI assistant", category: "Global" },
  "global:toggle-sidebar": { label: "Toggle sidebar", category: "Global" },
  "global:create-task": { label: "Create new task", category: "Global" },
  "global:quick-add": { label: "Open quick-add form", category: "Global" },
  "global:undo": { label: "Undo last action", category: "Global" },
  "global:export": { label: "Export data", category: "Global" },
  "global:search-focus": { label: "Focus search", category: "Global" },
  "global:show-shortcuts": { label: "Show keyboard shortcuts", category: "Global" },
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
  "task:send-agent": { label: "Send task to best-matched agent", category: "Tasks" },
  "ai:prioritize": { label: "AI prioritize tasks", category: "AI" },
  "ai:insights": { label: "AI insights", category: "AI" },
  "ai:bulk-operations": { label: "AI bulk operations", category: "AI" },
  "ai:auto-organize": { label: "AI auto-organize", category: "AI" },
  "ai:undo-changes": { label: "Undo AI changes", category: "AI" },
  "inbox:permission-allow": { label: "Allow focused permission request", category: "Inbox" },
  "inbox:permission-deny": { label: "Deny focused permission request", category: "Inbox" },
  "inbox:permission-allow-all": { label: "Allow all permission requests", category: "Inbox" },
  "inbox:permission-deny-all": { label: "Deny all permission requests", category: "Inbox" },
  "dock:approve-all-pending": { label: "Approve all pending (dock focused)", category: "Agents" },
  "dock:deny-all-pending": { label: "Deny all pending (dock focused)", category: "Agents" },
};

export const SHORTCUT_CATEGORY_ORDER = ["Global", "Navigation", "Tasks", "Inbox", "Agents", "AI"];

export interface ShortcutDisplayOptions {
  aiFeaturesEnabled?: boolean;
  assistantSidebarEnabled?: boolean;
}

export function getHiddenShortcutIds(options: ShortcutDisplayOptions = {}): Set<string> {
  const { aiFeaturesEnabled = true, assistantSidebarEnabled = true } = options;
  const hidden = new Set<string>();

  if (!assistantSidebarEnabled || !aiFeaturesEnabled) {
    hidden.add("global:toggle-assistant");
  }
  if (!aiFeaturesEnabled) {
    hidden.add("task:send-agent");
    for (const id of Object.keys(SHORTCUT_META)) {
      if (id.startsWith("ai:") || id.startsWith("inbox:") || id.startsWith("dock:")) hidden.add(id);
    }
  }

  return hidden;
}

export function formatKeyCombo(combo: string): string {
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
    .join("");
}

export function formatKeybindingList(keys: string[]): string {
  return keys.map(formatKeyCombo).join(" / ");
}

export function buildShortcutGroups(
  keybindings: KeybindingMap,
  options: ShortcutDisplayOptions = {},
): Array<{ category: string; items: Array<{ id: string; label: string; keys: string[] }> }> {
  const hidden = getHiddenShortcutIds(options);
  const groups = new Map<string, Array<{ id: string; label: string; keys: string[] }>>();

  for (const [id, keys] of Object.entries(keybindings)) {
    if (hidden.has(id)) continue;
    const meta = SHORTCUT_META[id];
    const category = meta?.category ?? "Other";
    const label = meta?.label ?? id.replace(/[-:]/g, " ");
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push({ id, label, keys });
  }

  return SHORTCUT_CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    items: groups.get(category)!,
  }));
}

export function buildShortcutDisplayList(
  keybindings: KeybindingMap,
  options: ShortcutDisplayOptions = {},
): Array<{ key: string; description: string; category: string }> {
  return buildShortcutGroups(keybindings, options).flatMap(({ category, items }) =>
    items.map((item) => ({
      key: formatKeybindingList(item.keys),
      description: item.label,
      category,
    })),
  );
}

/** True when `event` matches a registered key combo (e.g. `Shift+a`, `Meta+k`). */
export function matchesKeybinding(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+").map((part) => part.trim().toLowerCase());
  const needsShift = parts.includes("shift");
  const needsMeta = parts.includes("meta") || parts.includes("cmd") || parts.includes("command");
  const needsCtrl = parts.includes("ctrl") || parts.includes("control");
  const needsAlt = parts.includes("alt") || parts.includes("opt");
  const keyPart = parts.find(
    (part) =>
      !["shift", "meta", "cmd", "command", "ctrl", "control", "alt", "opt"].includes(part),
  );
  if (!keyPart) return false;

  if (event.shiftKey !== needsShift) return false;
  if (event.metaKey !== needsMeta) return false;
  if (event.ctrlKey !== needsCtrl) return false;
  if (event.altKey !== needsAlt) return false;

  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  const normalizedKeyPart =
    keyPart.length === 1
      ? keyPart
      : keyPart === "arrowdown"
        ? "arrowdown"
        : keyPart === "arrowup"
          ? "arrowup"
          : keyPart;

  if (normalizedKeyPart.length === 1) {
    return eventKey === normalizedKeyPart;
  }
  return eventKey === normalizedKeyPart;
}

/** True when `event` matches any combo registered for `actionId`. */
export function matchesKeybindingAction(
  event: KeyboardEvent,
  keybindings: KeybindingMap,
  actionId: string,
): boolean {
  const combos = keybindings[actionId] ?? [];
  return combos.some((combo) => matchesKeybinding(event, combo));
}
