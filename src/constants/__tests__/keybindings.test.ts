import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "../index";
import {
  DEFAULT_KEYBINDINGS,
  buildShortcutDisplayList,
  buildShortcutGroups,
  formatKeyCombo,
  getHiddenShortcutIds,
  matchesKeybinding,
  matchesKeybindingAction,
} from "../keybindings";

describe("keybindings catalog", () => {
  it("formats key combos for display", () => {
    expect(formatKeyCombo("Meta+Shift+p")).toBe("⌘ShiftP");
    expect(formatKeyCombo("/")).toBe("/");
  });

  it("documents search on / and command palette on Meta+k", () => {
    const list = buildShortcutDisplayList(DEFAULT_KEYBINDINGS);
    const search = list.find((item) => item.description === "Focus search");
    const palette = list.find((item) => item.description === "Open command palette");
    expect(search?.key).toBe("/");
    expect(palette?.key).toContain("⌘");
    expect(palette?.key.toLowerCase()).toContain("k");
  });

  it("includes AI shortcuts when AI features are enabled", () => {
    const groups = buildShortcutGroups(DEFAULT_KEYBINDINGS, { aiFeaturesEnabled: true });
    const ai = groups.find((group) => group.category === "AI");
    expect(ai?.items.map((item) => item.id)).toEqual([
      "ai:prioritize",
      "ai:insights",
      "ai:bulk-operations",
      "ai:auto-organize",
      "ai:undo-changes",
    ]);
  });

  it("hides assistant toggle when sidebar flag is off", () => {
    const hidden = getHiddenShortcutIds({
      aiFeaturesEnabled: true,
      assistantSidebarEnabled: false,
    });
    expect(hidden.has("global:toggle-assistant")).toBe(true);
    expect(hidden.has("ai:prioritize")).toBe(false);
  });

  it("hides AI and agent shortcuts when AI features are disabled", () => {
    const hidden = getHiddenShortcutIds({ aiFeaturesEnabled: false });
    expect(hidden.has("global:toggle-assistant")).toBe(true);
    expect(hidden.has("task:send-agent")).toBe(true);
    expect(hidden.has("ai:prioritize")).toBe(true);

    const list = buildShortcutDisplayList(DEFAULT_KEYBINDINGS, { aiFeaturesEnabled: false });
    expect(list.some((item) => item.description.includes("AI"))).toBe(false);
  });

  it("respects the live assistant sidebar feature flag", () => {
    const hidden = getHiddenShortcutIds({
      aiFeaturesEnabled: true,
      assistantSidebarEnabled: FEATURE_FLAGS.AI_ASSISTANT_SIDEBAR_ENABLED,
    });
    if (!FEATURE_FLAGS.AI_ASSISTANT_SIDEBAR_ENABLED) {
      expect(hidden.has("global:toggle-assistant")).toBe(true);
    }
  });

  it("registers inbox permission triage shortcuts", () => {
    const groups = buildShortcutGroups(DEFAULT_KEYBINDINGS, { aiFeaturesEnabled: true });
    const inbox = groups.find((group) => group.category === "Inbox");
    expect(inbox?.items.map((item) => item.id)).toEqual([
      "inbox:permission-allow",
      "inbox:permission-deny",
      "inbox:permission-allow-all",
      "inbox:permission-deny-all",
    ]);
  });

  it("registers dock batch approval shortcuts", () => {
    const groups = buildShortcutGroups(DEFAULT_KEYBINDINGS, { aiFeaturesEnabled: true });
    const agents = groups.find((group) => group.category === "Agents");
    expect(agents?.items.map((item) => item.id)).toEqual([
      "dock:approve-all-pending",
      "dock:deny-all-pending",
    ]);
  });

  it("matches inbox permission key combos", () => {
    const allowEvent = {
      key: "a",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent;
    expect(matchesKeybindingAction(allowEvent, DEFAULT_KEYBINDINGS, "inbox:permission-allow")).toBe(
      true,
    );
    expect(
      matchesKeybinding(
        { key: "A", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent,
        "Shift+a",
      ),
    ).toBe(true);
  });

  it("hides inbox shortcuts when AI features are disabled", () => {
    const hidden = getHiddenShortcutIds({ aiFeaturesEnabled: false });
    expect(hidden.has("inbox:permission-allow")).toBe(true);
    expect(hidden.has("dock:approve-all-pending")).toBe(true);
  });
});
