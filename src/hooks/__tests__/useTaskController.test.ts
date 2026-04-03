import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, PriorityDefinition, Task } from "../../types";
import { useTaskController } from "../useTaskController";

describe("useTaskController", () => {
  const mockAddToast = vi.fn();
  const mockAutomationService = { processTaskEvent: vi.fn() };
  const mockActivityService = { logChange: vi.fn(), createActivity: vi.fn() };
  const mockRecurringTaskService = {
    calculateNextOccurrence: vi.fn(),
    updateNextOccurrence: vi.fn(),
  };
  const mockSearchIndexService = { updateTask: vi.fn(), removeTask: vi.fn() };

  const initialTasks: Task[] = [
    {
      id: "task-1",
      title: "Task 1",
      status: "Pending",
      projectId: "p1",
      priority: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
      jobId: "TSK-1",
      subtasks: [],
      attachments: [],
      tags: [],
    },
  ];

  const columns: BoardColumn[] = [
    { id: "Pending", title: "Pending", color: "gray", wipLimit: 0 },
    { id: "InProgress", title: "In Progress", color: "blue", wipLimit: 1 },
  ];

  const priorities: PriorityDefinition[] = [
    { id: "high", label: "High", color: "red", level: 1 },
    { id: "medium", label: "Medium", color: "yellow", level: 2 },
  ];

  const props = {
    initialTasks,
    columns,
    projects: [
      { id: "p1", name: "Project 1" },
      { id: "p2", name: "Project 2" },
    ],
    priorities,
    activeProjectId: "p1",
    addToast: mockAddToast,
    automationServiceRef: { current: mockAutomationService },
    activityServiceRef: { current: mockActivityService },
    recurringTaskServiceRef: { current: mockRecurringTaskService },
    searchIndexServiceRef: { current: mockSearchIndexService },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with provided tasks", () => {
    const { result } = renderHook(() => useTaskController(props));
    expect(result.current.tasks).toEqual(initialTasks);
  });

  it("should handle task creation", () => {
    const { result } = renderHook(() => useTaskController(props));

    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "New Task" }, null);
    });

    expect(result.current.tasks.length).toBe(2);
    expect(result.current.tasks[1].title).toBe("New Task");
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("created"), "success");
  });

  it("should handle task update", () => {
    const { result } = renderHook(() => useTaskController(props));
    const taskToUpdate = result.current.tasks[0];

    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Updated Title" }, taskToUpdate);
    });

    expect(result.current.tasks[0].title).toBe("Updated Title");
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("updated"), "success");
  });

  it("should handle task deletion", () => {
    const { result } = renderHook(() => useTaskController(props));

    act(() => {
      result.current.handleDeleteTaskInternal("task-1");
    });

    expect(result.current.tasks.length).toBe(0);
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("deleted"), "info");
  });

  it("should handle undo deletion", () => {
    const { result } = renderHook(() => useTaskController(props));

    act(() => {
      result.current.handleDeleteTaskInternal("task-1");
    });
    expect(result.current.tasks.length).toBe(0);

    act(() => {
      result.current.handleUndo();
    });

    expect(result.current.tasks.length).toBe(1);
    expect(result.current.tasks[0].id).toBe("task-1");
  });

  it("should validate WIP limit when moving tasks", () => {
    const { result } = renderHook(() => useTaskController(props));

    // Create another task in p1
    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Task 2", status: "InProgress" }, null);
    });

    // Try to move task-1 to InProgress (WIP limit is 1)
    act(() => {
      result.current.moveTask("task-1", "InProgress");
    });

    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("WIP limit"), "error");
    expect(result.current.tasks.find((t) => t.id === "task-1")?.status).toBe("Pending");
  });

  it("should check if task can be moved", () => {
    const { result } = renderHook(() => useTaskController(props));

    const canMove = result.current.canMoveTask("task-1", "InProgress");
    expect(canMove.allowed).toBe(true);

    // Fill WIP limit
    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Task 2", status: "InProgress" }, null);
    });

    const canMoveAfterWIP = result.current.canMoveTask("task-1", "InProgress");
    expect(canMoveAfterWIP.allowed).toBe(false);
    expect(canMoveAfterWIP.reason).toContain("WIP limit");
  });

  it("should handle updating task due date", () => {
    const { result } = renderHook(() => useTaskController(props));
    const newDate = new Date();

    act(() => {
      result.current.handleUpdateTaskDueDate("task-1", newDate);
    });

    const updatedTask = result.current.tasks.find((t) => t.id === "task-1");
    expect(updatedTask?.dueDate).toBeDefined();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("Due date updated"),
      "success",
    );
  });

  it("should handle moving task to another workspace", () => {
    const { result } = renderHook(() => useTaskController(props));

    act(() => {
      result.current.handleMoveTaskToWorkspace("task-1", "p2");
    });

    const updatedTask = result.current.tasks.find((t) => t.id === "task-1");
    expect(updatedTask?.projectId).toBe("p2");
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Task moved"), "success");
  });

  it("should handle bulk creating tasks", () => {
    const { result } = renderHook(() => useTaskController(props));
    const newTasks = [{ title: "Bulk 1" }, { title: "Bulk 2" }];

    act(() => {
      result.current.handleBulkCreateTasks(newTasks);
    });

    expect(result.current.tasks.length).toBe(3);
    expect(result.current.tasks.some((t) => t.title === "Bulk 1")).toBe(true);
    expect(result.current.tasks.some((t) => t.title === "Bulk 2")).toBe(true);
  });

  it("should handle undo for task update", () => {
    const { result } = renderHook(() => useTaskController(props));
    const originalTitle = result.current.tasks[0].title;

    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Updated" }, result.current.tasks[0]);
    });
    expect(result.current.tasks[0].title).toBe("Updated");

    act(() => {
      result.current.handleUndo();
    });
    expect(result.current.tasks[0].title).toBe(originalTitle);
  });
});
