import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, Task } from "../../types";
import { useBoardDnDController } from "../useBoardDnDController";

interface DragEventPayload {
  active: {
    id: string;
    data: { current: { type: string; task?: Task; column?: BoardColumn } };
  };
  over?: { id: string };
}

describe("useBoardDnDController", () => {
  const mockOnUpdateColumns = vi.fn();
  const mockOnMoveTask = vi.fn();
  const mockGetTasksByContext = vi.fn();
  const mockShowToast = vi.fn();

  const columns: BoardColumn[] = [
    { id: "Pending", title: "Pending", color: "gray", wipLimit: 0 },
    { id: "InProgress", title: "In Progress", color: "blue", wipLimit: 10 },
  ];

  const tasks: Task[] = [
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
      order: 1,
    },
  ];

  const props = {
    columns,
    tasks,
    boardGrouping: "none" as const,
    onUpdateColumns: mockOnUpdateColumns,
    onMoveTask: mockOnMoveTask,
    getTasksByContext: mockGetTasksByContext,
    showToast: mockShowToast,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with null activeDrag", () => {
    const { result } = renderHook(() => useBoardDnDController(props));
    expect(result.current.activeDrag).toBeNull();
    expect(result.current.highlightedZone).toBeNull();
  });

  it("should handle drag start for a task", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "task-1",
          data: { current: { type: "task", task: tasks[0] } },
        },
      } as unknown as DragEventPayload);
    });

    expect(result.current.activeDrag).toEqual({
      type: "task",
      id: "task-1",
      data: tasks[0],
    });
  });

  it("should handle drag start for a column", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "Pending",
          data: { current: { type: "column", column: columns[0] } },
        },
      } as unknown as DragEventPayload);
    });

    expect(result.current.activeDrag).toEqual({
      type: "task",
      id: "task-1",
      data: tasks[0],
    });
  });

  it("should handle drag start for a column", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "Pending",
          data: { current: { type: "column", column: columns[0] } },
        },
      } as unknown);
    });

    expect(result.current.activeDrag).toEqual({
      type: "column",
      id: "Pending",
      data: columns[0],
    });
  });

  it("should handle task drop on another column", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    // Start drag
    act(() => {
      result.current.handleDragStart({
        active: {
          id: "task-1",
          data: { current: { type: "task", task: tasks[0] } },
        },
      } as unknown);
    });

    // End drag over a column
    act(() => {
      result.current.handleDragEnd({
        over: { id: "InProgress" },
      } as unknown);
    });

    expect(mockOnMoveTask).toHaveBeenCalledWith("task-1", "InProgress", undefined, undefined);
    expect(result.current.activeDrag).toBeNull();
  });

  it("should handle column reordering", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "Pending",
          data: { current: { type: "column", column: columns[0] } },
        },
      } as unknown);
    });

    act(() => {
      result.current.handleDragEnd({
        over: { id: "InProgress" },
      } as unknown);
    });

    expect(mockOnUpdateColumns).toHaveBeenCalled();
    const updatedCols = mockOnUpdateColumns.mock.calls[0][0];
    expect(updatedCols[0].id).toBe("InProgress");
    expect(updatedCols[1].id).toBe("Pending");
  });

  it("should handle drag cancel", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "task-1",
          data: { current: { type: "task", task: tasks[0] } },
        },
      } as unknown);
    });
  });

  it("should handle task drop on another column", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    // Start drag
    act(() => {
      result.current.handleDragStart({
        active: {
          id: "task-1",
          data: { current: { type: "task", task: tasks[0] } },
        },
      } as any); // biome-ignore lint/suspicious/noExplicitAny: test mock
    });

    // End drag over a column
    act(() => {
      result.current.handleDragEnd({
        over: { id: "InProgress" },
      } as any); // biome-ignore lint/suspicious/noExplicitAny: test mock
    });

    expect(mockOnMoveTask).toHaveBeenCalledWith("task-1", "InProgress", undefined, undefined);
    expect(result.current.activeDrag).toBeNull();
  });

  it("should handle column reordering", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "Pending",
          data: { current: { type: "column", column: columns[0] } },
        },
      } as any); // biome-ignore lint/suspicious/noExplicitAny: test mock
    });

    act(() => {
      result.current.handleDragEnd({
        over: { id: "InProgress" },
      } as any); // biome-ignore lint/suspicious/noExplicitAny: test mock
    });

    expect(mockOnUpdateColumns).toHaveBeenCalled();
    const updatedCols = mockOnUpdateColumns.mock.calls[0][0];
    expect(updatedCols[0].id).toBe("InProgress");
    expect(updatedCols[1].id).toBe("Pending");
  });

  it("should handle drag cancel", () => {
    const { result } = renderHook(() => useBoardDnDController(props));

    act(() => {
      result.current.handleDragStart({
        active: {
          id: "task-1",
          data: { current: { type: "task", task: tasks[0] } },
        },
      } as any); // biome-ignore lint/suspicious/noExplicitAny: test mock
    });

    act(() => {
      result.current.handleDragCancel();
    });

    expect(result.current.activeDrag).toBeNull();
  });
});
