import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { useTaskController } from "../useTaskController";

describe("useTaskController Extended", () => {
  const mockTasks: Task[] = [
    { id: "t1", title: "Task 1", status: "Pending", projectId: "p1", jobId: "TSK-1", links: [], subtasks: [], tags: [] } as any,
    { id: "t2", title: "Task 2", status: "InProgress", projectId: "p1", jobId: "TSK-2", links: [], subtasks: [], tags: [] } as any,
  ];
  const mockColumns = [
    { id: "Pending", title: "Pending", wipLimit: 0 },
    { id: "InProgress", title: "In Progress", wipLimit: 1 },
    { id: "Completed", title: "Completed", isCompleted: true },
  ] as any;
  const mockProjects = [{ id: "p1", name: "Project 1" }, { id: "p2", name: "Project 2" }] as any;
  const mockAddToast = vi.fn();
  
  const automationServiceRef = { current: { processTaskEvent: vi.fn() } };
  const activityServiceRef = { current: { createActivity: vi.fn(), logChange: vi.fn((t, u) => ({ ...t, ...u })) } };
  const recurringTaskServiceRef = { current: { calculateNextOccurrence: vi.fn(() => new Date()), updateNextOccurrence: vi.fn() } };
  const searchIndexServiceRef = { current: { updateTask: vi.fn(), removeTask: vi.fn() } };

  const props = {
    initialTasks: mockTasks,
    columns: mockColumns,
    projects: mockProjects,
    priorities: [],
    activeProjectId: "p1",
    addToast: mockAddToast,
    automationServiceRef: automationServiceRef as any,
    activityServiceRef: activityServiceRef as any,
    recurringTaskServiceRef: recurringTaskServiceRef as any,
    searchIndexServiceRef: searchIndexServiceRef as any,
  };

  it("should handle handleUpdateTaskDueDate", () => {
    const { result } = renderHook(() => useTaskController(props));
    const newDate = new Date();
    act(() => {
      result.current.handleUpdateTaskDueDate("t1", newDate);
    });
    expect(result.current.tasks.find(t => t.id === "t1")?.dueDate).toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Due date updated"), "success");
  });

  it("should handle handleMoveTaskToWorkspace", () => {
    const { result } = renderHook(() => useTaskController(props));
    act(() => {
      result.current.handleMoveTaskToWorkspace("t1", "p2");
    });
    expect(result.current.tasks.find(t => t.id === "t1")?.projectId).toBe("p2");
    expect(mockAddToast).toHaveBeenCalledWith('Task moved to "Project 2"', "success");
  });

  it("should handle handleCreateOrUpdateTask - Create", () => {
    const { result } = renderHook(() => useTaskController(props));
    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "New" }, null);
    });
    expect(result.current.tasks).toHaveLength(3);
    expect(result.current.tasks.some(t => t.title === "New")).toBe(true);
  });

  it("should handle handleCreateOrUpdateTask - Update", () => {
    const { result } = renderHook(() => useTaskController(props));
    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Updated" }, mockTasks[0]);
    });
    expect(result.current.tasks.find(t => t.id === "t1")?.title).toBe("Updated");
  });

  it("should handle handleBulkCreateTasks", () => {
    const { result } = renderHook(() => useTaskController(props));
    act(() => {
      result.current.handleBulkCreateTasks([{ title: "B1" }, { title: "B2" }]);
    });
    expect(result.current.tasks).toHaveLength(4);
  });

  it("should handle moveTask with WIP limit", () => {
    const { result } = renderHook(() => useTaskController(props));
    // InProgress has WIP limit of 1, and t2 is already there
    act(() => {
      result.current.moveTask("t1", "InProgress");
    });
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("WIP limit"), "error");
    expect(result.current.tasks.find(t => t.id === "t1")?.status).toBe("Pending");
  });

  it("should handle moveTask - success", () => {
    const { result } = renderHook(() => useTaskController(props));
    act(() => {
      result.current.moveTask("t1", "Completed");
    });
    expect(result.current.tasks.find(t => t.id === "t1")?.status).toBe("Completed");
  });

  it("should block move if task is blocked", () => {
    const blockedTask = { ...mockTasks[0], links: [{ type: "blocked-by", targetTaskId: "t2" }] };
    const { result } = renderHook(() => useTaskController({ ...props, initialTasks: [blockedTask, mockTasks[1]] }));
    
    act(() => {
      result.current.moveTask("t1", "Completed");
    });
    
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Blocked by task"), "error");
  });

  it("should handle undo/redo logic", () => {
    const { result } = renderHook(() => useTaskController(props));
    
    // Create
    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "To Undo" }, null);
    });
    expect(result.current.tasks).toHaveLength(3);
    
    act(() => {
      result.current.handleUndo();
    });
    expect(result.current.tasks).toHaveLength(2);
    expect(mockAddToast).toHaveBeenCalledWith("Task creation undone", "info");
  });
});
