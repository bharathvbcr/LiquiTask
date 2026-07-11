/** True when the event target is a text-editing surface shortcuts should not hijack. */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

/** True when any modal dialog (`data-modal`) is mounted. */
export function isModalOpen(): boolean {
  return document.querySelector("[data-modal]") !== null;
}

/** Global/board shortcuts should not fire while typing or when a modal is open. */
export function shouldBlockAppShortcut(event: KeyboardEvent): boolean {
  if (isEditableShortcutTarget(event.target)) return true;
  if (isModalOpen()) return true;
  return false;
}
