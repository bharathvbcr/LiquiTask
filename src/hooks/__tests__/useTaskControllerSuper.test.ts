import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, Task } from "../../types";
import { useTaskController } from "../useTaskController";

describe("useTaskController Super Features", () => {
  const mockAddToast = vi.fn();
  const mockAiService = {
    generateSemanticKeywords: vi.fn().mockResolvedValue([]),
    generateSubtasks: vi.fn().mockResolvedValue(["Step 1", "Step 2", "Step 3"]),
  };

  const mockColumns: BoardColumn[] = [
    { id: "Pending", title: "Pending", color: "gray" },
    { id: "InProgress", title: "In Progress", color: "blue" },
  ];

  const initialTasks: Task[] = [
    {
      id: "t1",
      title: "New Task",
      summary: "Description",
      status: "Pending",
      subtasks: [],
      projectId: "p1",
      tags: [],
      createdAt: new Date(),
    } as any,
  ];

  const baseProps = {
    initialTasks,
    columns: mockColumns,
    projects: [{ id: "p1", name: "P1", type: "default" as const }],
    priorities: [],
    activeProjectId: "p1",
    addToast: mockAddToast,
    automationServiceRef: { current: null } as any,
    activityServiceRef: { current: null } as any,
    recurringTaskServiceRef: { current: null } as any,
    searchIndexServiceRef: { current: null } as any,
    aiServiceRef: { current: mockAiService } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should trigger Auto-Pilot Subtask Engine when task moves to In Progress", async () => {
    const { result } = renderHook(() => useTaskController(baseProps));

    await act(async () => {
      result.current.moveTask("t1", "InProgress");
    });

    // Check if AI was called
    expect(mockAiService.generateSubtasks).toHaveBeenCalledWith("New Task", "Description");
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Auto-pilot"), "info");

    // Wait for subtasks to be added to state
    await waitFor(() => {
      const updatedTask = result.current.tasks.find((t) => t.id === "t1");
      return updatedTask && updatedTask.subtasks.length === 3;
    });

    const finalTask = result.current.tasks.find((t) => t.id === "t1");
    expect(finalTask?.subtasks[0].title).toBe("Step 1");
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("added 3 subtasks"),
      "success",
    );
  });

  it("should NOT trigger Auto-Pilot if subtasks already exist", async () => {
    const tasksWithSubtasks = [
      { ...initialTasks[0], subtasks: [{ id: "s1", title: "Existing", completed: false }] },
    ];

    const { result } = renderHook(() =>
      useTaskController({
        ...baseProps,
        initialTasks: tasksWithSubtasks,
      }),
    );

    await act(async () => {
      result.current.moveTask("t1", "InProgress");
    });

    expect(mockAiService.generateSubtasks).not.toHaveBeenCalled();
  });
});
