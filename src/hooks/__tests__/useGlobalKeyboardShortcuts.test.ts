import { renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingProvider } from "../../context/KeybindingContext";
import { useGlobalKeyboardShortcuts } from "../useGlobalKeyboardShortcuts";

describe("useGlobalKeyboardShortcuts", () => {
  const mockHandleUndo = vi.fn();
  const mockSetIsCommandPaletteOpen = vi.fn();
  const mockSetIsSidebarCollapsed = vi.fn();
  const mockSetIsTaskModalOpen = vi.fn();
  const mockSetEditingTask = vi.fn();
  const mockAddToast = vi.fn();
  const mockSearchInputRef = { current: { focus: vi.fn() } };

  const props = {
    handleUndo: mockHandleUndo,
    setIsCommandPaletteOpen: mockSetIsCommandPaletteOpen,
    setIsSidebarCollapsed: mockSetIsSidebarCollapsed,
    setIsTaskModalOpen: mockSetIsTaskModalOpen,
    setEditingTask: mockSetEditingTask,
    searchInputRef: mockSearchInputRef as unknown as React.RefObject<HTMLInputElement>,
    tasks: [],
    projects: [],
    addToast: mockAddToast,
    isCommandPaletteOpen: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(KeybindingProvider, null, children);

  it("should register and unregister event listener", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useGlobalKeyboardShortcuts(props), {
      wrapper,
    });

    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("should trigger command palette on shortcut", () => {
    renderHook(() => useGlobalKeyboardShortcuts(props), { wrapper });

    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    window.dispatchEvent(event);

    expect(mockSetIsCommandPaletteOpen).toHaveBeenCalled();
  });

  it("should trigger undo on shortcut", () => {
    renderHook(() => useGlobalKeyboardShortcuts(props), { wrapper });

    const event = new KeyboardEvent("keydown", { key: "z", metaKey: true });
    window.dispatchEvent(event);

    expect(mockHandleUndo).toHaveBeenCalled();
  });

  it("should trigger task creation on shortcut", () => {
    renderHook(() => useGlobalKeyboardShortcuts(props), { wrapper });

    const event = new KeyboardEvent("keydown", { key: "c" });
    window.dispatchEvent(event);

    expect(mockSetEditingTask).toHaveBeenCalledWith(null);
    expect(mockSetIsTaskModalOpen).toHaveBeenCalledWith(true);
  });

  it("should focus search input on shortcut", () => {
    renderHook(() => useGlobalKeyboardShortcuts(props), { wrapper });

    const event = new KeyboardEvent("keydown", { key: "/" });
    window.dispatchEvent(event);

    expect(mockSearchInputRef.current.focus).toHaveBeenCalled();
  });
});
