import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../types";
import { useAutoArchive } from "../useAutoArchive";

const mockArchiveTasks = vi.fn();
const mockLoadArchiveSettings = vi.fn();
const mockBuildArchiveConfig = vi.fn();

vi.mock("../../services/archiveService", () => ({
  archiveService: {
    archiveTasks: (...args: unknown[]) => mockArchiveTasks(...args),
  },
  loadArchiveSettings: () => mockLoadArchiveSettings(),
  buildArchiveConfig: (...args: unknown[]) => mockBuildArchiveConfig(...args),
}));

vi.mock("../../services/indexedDBService", () => ({
  indexedDBService: {
    isAvailable: vi.fn().mockReturnValue(false),
    deleteTask: vi.fn(),
  },
}));

const makeTask = (id: string): Task =>
  ({
    id,
    jobId: id,
    projectId: "p1",
    title: `Task ${id}`,
    subtitle: "",
    summary: "",
    assignee: "",
    priority: "medium",
    status: "Completed",
    createdAt: new Date(),
    completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
  }) as Task;

describe("useAutoArchive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadArchiveSettings.mockReturnValue({
      enabled: true,
      autoArchiveAfterDays: 30,
      retentionDays: 90,
    });
    mockBuildArchiveConfig.mockReturnValue({
      autoArchiveAfterDays: 30,
      archiveCompleted: true,
      archiveStorage: "localStorage",
      completedColumnIds: new Set(["Completed"]),
    });
  });

  it("archives eligible tasks and updates state", async () => {
    const tasks = [makeTask("1"), makeTask("2")];
    const remaining = [makeTask("2")];
    mockArchiveTasks.mockResolvedValue(remaining);

    const setTasks = vi.fn();
    const addToast = vi.fn();
    const searchIndexServiceRef = { current: { removeTask: vi.fn() } };

    const { result } = renderHook(() =>
      useAutoArchive({
        isLoaded: true,
        tasks,
        columns: [],
        setTasks,
        searchIndexServiceRef,
        addToast,
      }),
    );

    let count = 0;
    await act(async () => {
      count = await result.current.runAutoArchive();
    });

    expect(count).toBe(1);
    expect(setTasks).toHaveBeenCalledWith(remaining);
    expect(searchIndexServiceRef.current.removeTask).toHaveBeenCalledWith(tasks[0]);
    expect(addToast).toHaveBeenCalledWith("Auto-archived 1 completed task(s)", "success");
  });

  it("allows forced manual runs while disabled", async () => {
    mockLoadArchiveSettings.mockReturnValue({
      enabled: false,
      autoArchiveAfterDays: 30,
      retentionDays: 90,
    });
    mockArchiveTasks.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useAutoArchive({
        isLoaded: false,
        tasks: [],
        columns: [],
        setTasks: vi.fn(),
        searchIndexServiceRef: { current: null },
        addToast: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.runAutoArchive({ force: true });
    });

    expect(mockArchiveTasks).toHaveBeenCalled();
  });

  it("runs silently on startup when enabled", async () => {
    mockArchiveTasks.mockResolvedValue([]);

    renderHook(() =>
      useAutoArchive({
        isLoaded: true,
        tasks: [],
        columns: [],
        setTasks: vi.fn(),
        searchIndexServiceRef: { current: null },
        addToast: vi.fn(),
      }),
    );

    await waitFor(() => expect(mockArchiveTasks).toHaveBeenCalled());
  });
});
