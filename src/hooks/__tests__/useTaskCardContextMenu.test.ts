import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { useTaskCardContextMenu } from "../useTaskCardContextMenu";

describe("useTaskCardContextMenu", () => {
  const mockTask: Task = {
    id: "task-1",
    title: "Test Task",
    projectId: "p1",
  } as any;

  const mockOnCopyTask = vi.fn();
  const mockOnMoveToWorkspace = vi.fn();

  const defaultProps = {
    task: mockTask,
    projectName: "Test Project",
    onCopyTask: mockOnCopyTask,
    onMoveToWorkspace: mockOnMoveToWorkspace,
  };

  it("should show context menu on handleContextMenu", () => {
    const { result } = renderHook(() => useTaskCardContextMenu(defaultProps));
    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 100,
      clientY: 200,
    } as any;

    act(() => {
      result.current.handleContextMenu(mockEvent);
    });

    expect(result.current.contextMenuVisible).toBe(true);
    expect(result.current.contextMenuPosition).toEqual({ x: 100, y: 200 });
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it("should hide context menu on document click", () => {
    const { result } = renderHook(() => useTaskCardContextMenu(defaultProps));
    act(() => {
      result.current.setContextMenuVisible(true);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("click"));
    });

    expect(result.current.contextMenuVisible).toBe(false);
  });

  it("should handle handleMoveToWorkspace", () => {
    const { result } = renderHook(() => useTaskCardContextMenu(defaultProps));
    act(() => {
      result.current.handleMoveToWorkspace("p2");
    });

    expect(mockOnMoveToWorkspace).toHaveBeenCalledWith("task-1", "p2");
    expect(result.current.contextMenuVisible).toBe(false);
  });

  it("should handle handleWorkspaceSubmenuEnter/Leave", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTaskCardContextMenu(defaultProps));
    
    act(() => {
      result.current.handleWorkspaceSubmenuEnter();
    });
    expect(result.current.showWorkspaceSubmenu).toBe(true);

    act(() => {
      result.current.handleWorkspaceSubmenuLeave();
    });
    // Should still be true due to timeout
    expect(result.current.showWorkspaceSubmenu).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.showWorkspaceSubmenu).toBe(false);
    
    vi.useRealTimers();
  });
});
