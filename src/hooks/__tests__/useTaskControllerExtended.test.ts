import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Task, BoardColumn } from "../../types";
import { useTaskController } from "../useTaskController";

describe("useTaskController Extended", () => {
  const mockAddToast = vi.fn();
  
  const mockColumns: BoardColumn[] = [
    { id: "c1", title: "Col 1", color: "red" },
    { id: "InProgress", title: "In Progress", color: "blue" },
  ];

  const mockProps = {
    initialTasks: [],
    columns: mockColumns,
    projects: [{ id: "p1", name: "P1", type: "default" as const }],
    priorities: [{ id: "h", label: "H", level: 1, color: "red" }],
    activeProjectId: "p1",
    addToast: mockAddToast,
    automationServiceRef: { current: null } as any,
    activityServiceRef: { current: null } as any,
    recurringTaskServiceRef: { current: null } as any,
    searchIndexServiceRef: { current: { updateTask: vi.fn(), augmentTaskSemantically: vi.fn() } } as any,
    aiServiceRef: { current: null } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle undo/redo correctly", async () => {
    const { result } = renderHook(() => useTaskController(mockProps));

    await act(async () => {
      result.current.handleCreateOrUpdateTask({ title: "Undo Me" }, null);
    });

    expect(result.current.tasks.length).toBe(1);
    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.tasks.length).toBe(0);
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("undone"), "info");
  });

  it("should calculate moveTask correctly with blockers", () => {
    const blockedTask: Task = {
      id: "t1",
      title: "Blocked",
      status: "c1",
      links: [{ targetTaskId: "t2", type: "blocked-by" }],
      projectId: "p1",
    } as any;
    
    const blockerTask: Task = {
      id: "t2",
      title: "Blocker",
      status: "c1", // Not completed
      projectId: "p1",
    } as any;

    const { result } = renderHook(() => useTaskController({
      ...mockProps,
      initialTasks: [blockedTask, blockerTask]
    }));

    act(() => {
      result.current.moveTask("t1", "InProgress");
    });
    
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Blocked by task"), "error");
  });
});
