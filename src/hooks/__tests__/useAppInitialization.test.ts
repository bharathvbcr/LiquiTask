import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../types";
import { useAppInitialization } from "../useAppInitialization";

const {
  mockStorageService,
  mockIndexedDbService,
  mockNotificationService,
  mockAutomationService,
  mockTemplateService,
  mockActivityService,
  mockArchiveService,
  mockRecurringService,
} = vi.hoisted(() => ({
  mockStorageService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getAllData: vi.fn().mockReturnValue({}),
    get: vi.fn((_key: string, fallback: unknown) => fallback),
  },
  mockIndexedDbService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockReturnValue(false),
    saveColumns: vi.fn(),
    savePriorities: vi.fn(),
    saveCustomFields: vi.fn(),
    saveProject: vi.fn(),
    saveTasks: vi.fn(),
  },
  mockNotificationService: {
    startPeriodicCheck: vi.fn(),
    stopPeriodicCheck: vi.fn(),
  },
  mockAutomationService: { loadRules: vi.fn() },
  mockTemplateService: { loadTemplates: vi.fn() },
  mockActivityService: {},
  mockArchiveService: { initialize: vi.fn().mockResolvedValue(undefined) },
  mockRecurringService: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

let recurringOptions: {
  onCreateTask: (task: Task) => void;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void;
} | null = null;

let mockServiceInstance: any = null;

vi.mock("../../services/storageService", () => ({
  default: mockStorageService,
  storageService: mockStorageService,
}));

vi.mock("../../services/indexedDBService", () => ({
  indexedDBService: mockIndexedDbService,
}));

vi.mock("../../services/archiveService", () => ({
  archiveService: mockArchiveService,
}));

vi.mock("../../services/notificationService", () => ({
  notificationService: mockNotificationService,
}));

vi.mock("../../services/automationService", () => ({
  automationService: mockAutomationService,
}));

vi.mock("../../services/templateService", () => ({
  templateService: mockTemplateService,
}));

vi.mock("../../services/activityService", () => ({
  activityService: mockActivityService,
}));

vi.mock("../../utils/queryEngine", () => ({
  executeAdvancedFilter: vi.fn(),
}));

vi.mock("../../services/recurringTaskService", () => ({
  initializeRecurringTaskService: vi.fn((options) => {
    recurringOptions = options;
    mockServiceInstance = {
      ...mockRecurringService,
      start: vi.fn(),
      stop: vi.fn(),
    };
    return mockServiceInstance;
  }),
  getRecurringTaskService: vi.fn(() => mockServiceInstance),
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  jobId: "job-1",
  projectId: "project-1",
  title: "Task",
  subtitle: "",
  summary: "",
  assignee: "",
  priority: "medium",
  status: "Pending",
  createdAt: new Date("2026-03-06T10:00:00Z"),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
  ...overrides,
});

describe("useAppInitialization", () => {
  beforeEach(() => {
    recurringOptions = null;
    vi.clearAllMocks();
    mockStorageService.getAllData.mockReturnValue({});
    mockStorageService.get.mockImplementation((key: string, fallback: unknown) => {
      if (key.includes("aiConfig")) return { provider: "gemini" };
      return fallback;
    });
    mockIndexedDbService.isAvailable.mockReturnValue(false);
  });

  it("registers recurring callbacks with functional task updates", async () => {
    const setTasks = vi.fn();
    const pushUndo = vi.fn();
    const addToast = vi.fn();

    renderHook(() =>
      useAppInitialization({
        setIsLoaded: vi.fn(),
        setColumns: vi.fn(),
        setProjectTypes: vi.fn(),
        setPriorities: vi.fn(),
        setCustomFields: vi.fn(),
        setProjects: vi.fn(),
        setTasks,
        setActiveProjectId: vi.fn(),
        setIsSidebarCollapsed: vi.fn(),
        setBoardGrouping: vi.fn(),
        setIsCompactView: vi.fn(),
        setShowSubWorkspaceTasks: vi.fn(),
        setViewMode: vi.fn(),
        setCurrentView: vi.fn(),
        searchIndexServiceRef: { current: null } as any,
        automationServiceRef: { current: null } as any,
        templateServiceRef: { current: null } as any,
        activityServiceRef: { current: null } as any,
        advancedFilterExecutorRef: { current: null } as any,
        notificationServiceRef: { current: null } as any,
        recurringTaskServiceRef: { current: null } as any,
        tasks: [makeTask({ id: "existing-task" })],
        addToast,
        pushUndo,
      }),
    );

    await waitFor(() => expect(recurringOptions).not.toBeNull(), { timeout: 5000 });

    const newTask = makeTask({
      id: "new-task",
      title: "Generated recurring task",
    });

    await act(async () => {
      recurringOptions?.onCreateTask(newTask);
      recurringOptions?.onUpdateTask("existing-task", {
        title: "Updated title",
      });
    });

    expect(setTasks).toHaveBeenCalled();

    const createUpdater = setTasks.mock.calls.find((c) => {
      const result = c[0]([]);
      return Array.isArray(result) && result.some((t: any) => t.id === "new-task");
    })?.[0];

    const updateUpdater = setTasks.mock.calls.find((c) => {
      const result = c[0]([makeTask({ id: "existing-task", title: "Old" })]);
      return (
        Array.isArray(result) &&
        result.find((t: any) => t.id === "existing-task")?.title === "Updated title"
      );
    })?.[0];

    expect(createUpdater).toBeDefined();
    expect(updateUpdater).toBeDefined();

    const withNewerState = createUpdater([
      makeTask({ id: "existing-task" }),
      makeTask({
        id: "later-task",
        title: "Created after effect registration",
      }),
    ]);
    expect(withNewerState.map((task: any) => task.id)).toEqual([
      "existing-task",
      "later-task",
      "new-task",
    ]);

    expect(pushUndo).toHaveBeenCalledWith({
      type: "task-create",
      taskId: "new-task",
    });
    expect(addToast).toHaveBeenCalledWith(
      'Recurring task "Generated recurring task" created',
      "info",
    );
  });
});
