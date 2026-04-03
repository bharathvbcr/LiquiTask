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

let mockServiceInstance: unknown = null;

vi.mock("../../services/storageService", () => ({
  default: mockStorageService,
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
    mockServiceInstance = mockRecurringService;
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
    mockStorageService.get.mockImplementation((_key: string, fallback: unknown) => fallback);
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
        searchIndexServiceRef: { current: null },
        automationServiceRef: { current: null },
        templateServiceRef: { current: null },
        activityServiceRef: { current: null },
        advancedFilterExecutorRef: { current: null },
        notificationServiceRef: { current: null },
        recurringTaskServiceRef: { current: null },
        tasks: [makeTask({ id: "existing-task" })],
        addToast,
        pushUndo,
      }),
    );

    await waitFor(() => expect(recurringOptions).not.toBeNull());

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

    expect(setTasks).toHaveBeenCalledTimes(2);

    const createUpdater = setTasks.mock.calls[0][0] as (tasks: Task[]) => Task[];
    const updateUpdater = setTasks.mock.calls[1][0] as (tasks: Task[]) => Task[];

    const withNewerState = createUpdater([
      makeTask({ id: "existing-task" }),
      makeTask({
        id: "later-task",
        title: "Created after effect registration",
      }),
    ]);
    expect(withNewerState.map((task) => task.id)).toEqual([
      "existing-task",
      "later-task",
      "new-task",
    ]);

    const updatedState = updateUpdater([
      makeTask({ id: "existing-task", title: "Old title" }),
      makeTask({ id: "later-task", title: "Preserved task" }),
    ]);
    expect(updatedState.find((task) => task.id === "existing-task")?.title).toBe("Updated title");
    expect(updatedState.find((task) => task.id === "later-task")?.title).toBe("Preserved task");

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
