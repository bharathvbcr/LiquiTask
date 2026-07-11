import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, PriorityDefinition, Task } from "../../types";

const mockTaskEventStore = vi.hoisted(() => ({
  append: vi.fn(async (drafts: Array<{ streamId: string; type: string; payload: unknown }>) =>
    drafts.map((draft, index) => ({
      ...draft,
      id: `evt-${index}`,
      seq: index + 1,
      v: 1 as const,
      actor: "user" as const,
      ts: new Date().toISOString(),
    })),
  ),
  commitMutation: vi.fn(async (drafts: Array<{ streamId: string; type: string; payload: unknown }>) =>
    drafts.map((draft, index) => ({
      ...draft,
      id: `evt-${index}`,
      seq: index + 1,
      v: 1 as const,
      actor: "user" as const,
      ts: new Date().toISOString(),
    })),
  ),
  isDegraded: vi.fn(() => false),
}));

const mockDeadLetterService = vi.hoisted(() => ({
  registerRetryHandler: vi.fn(),
  record: vi.fn(),
}));

vi.mock("../../core/events/taskEventStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../core/events/taskEventStore")>();
  return {
    ...actual,
    default: mockTaskEventStore,
  };
});
vi.mock("../../services/deadLetterService", () => ({ default: mockDeadLetterService }));
vi.mock("../../services/indexedDBService", () => ({
  indexedDBService: { isAvailable: () => false, saveTask: vi.fn(), saveTasks: vi.fn() },
}));
vi.mock("../../services/nativeBridge", () => ({
  isNativeBackend: () => false,
  nativeMutateTasks: vi.fn(),
  nativeSerializeTasks: vi.fn(),
}));
vi.mock("../../services/sqliteTaskStore", () => ({
  isSqliteTaskStoreActive: () => false,
}));
vi.mock("../../runtime/runtimeEnvironment", () => ({
  getNativeStorageApi: () => null,
}));

import { useTaskController } from "../useTaskController";

describe("useTaskController", () => {
  const mockAddToast = vi.fn();
  const mockAutomationService = { processTaskEvent: vi.fn() };
  const mockActivityService = { logChange: vi.fn(), createActivity: vi.fn() };
  const mockRecurringTaskService = {
    calculateNextOccurrence: vi.fn(),
    updateNextOccurrence: vi.fn(),
  };
  const mockSearchIndexService = {
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    augmentTaskSemantically: vi.fn(),
  };

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
      { id: "p1", name: "Project 1", type: "default" as const },
      { id: "p2", name: "Project 2", type: "default" as const },
    ],
    priorities,
    activeProjectId: "p1",
    addToast: mockAddToast,
    automationServiceRef: { current: mockAutomationService } as any,
    activityServiceRef: { current: mockActivityService } as any,
    recurringTaskServiceRef: { current: mockRecurringTaskService } as any,
    searchIndexServiceRef: { current: mockSearchIndexService } as any,
    aiServiceRef: { current: null } as any,
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

  it("rolls back optimistic updates and dead-letters when the event log rejects a write", async () => {
    mockTaskEventStore.commitMutation.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useTaskController(props));

    act(() => {
      result.current.handleCreateOrUpdateTask({ title: "Should rollback" }, null);
    });

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
      expect(result.current.tasks[0].title).toBe("Task 1");
    });
    expect(mockDeadLetterService.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "event-log", title: expect.stringContaining("could not be recorded") }),
    );
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.stringContaining("rolled back"),
      "error",
    );
  });

  it("registers an event-log DLQ retry handler on mount", () => {
    renderHook(() => useTaskController(props));
    expect(mockDeadLetterService.registerRetryHandler).toHaveBeenCalledWith(
      "event-log",
      expect.any(Function),
    );
  });
});
