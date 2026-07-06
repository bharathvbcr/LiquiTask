import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringConfig, Task } from "../../../types";
import { RecurringTaskService } from "../recurringTaskService";

// The scheduler now computes occurrences through the async native bridge
// (Rust on desktop, JS fallback on web/in tests). Generation therefore resolves
// on microtasks after start(); this drains them. Promises are not faked by
// vi.useFakeTimers(), so this works under fake timers.
const flushMicrotasks = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe("RecurringTaskService", () => {
  let service: RecurringTaskService;
  const mockOnCreate = vi.fn();
  const mockOnUpdate = vi.fn();
  const mockOnAgentRecurring = vi.fn();

  beforeEach(() => {
    service = new RecurringTaskService({
      onCreateTask: mockOnCreate,
      onUpdateTask: mockOnUpdate,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    service.stop();
  });

  describe("calculateNextOccurrence", () => {
    it("should calculate next daily occurrence correctly", () => {
      const config: RecurringConfig = {
        frequency: "daily",
        interval: 1,
        enabled: true,
      };
      const baseDate = new Date("2024-01-01T10:00:00");
      const next = service.calculateNextOccurrence(config, baseDate);

      expect(next.toISOString()).toContain("2024-01-02");
    });

    it("should calculate next weekly occurrence correctly", () => {
      const config: RecurringConfig = {
        frequency: "weekly",
        interval: 1,
        enabled: true,
      };
      const baseDate = new Date("2024-01-01T10:00:00"); // Monday
      const next = service.calculateNextOccurrence(config, baseDate);

      expect(next.toISOString()).toContain("2024-01-08"); // Next Monday
    });

    it("should calculate specific days of week correctly", () => {
      const config: RecurringConfig = {
        frequency: "weekly",
        interval: 1,
        enabled: true,
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      };
      // Monday
      let baseDate = new Date("2024-01-01T10:00:00"); // Mon
      let next = service.calculateNextOccurrence(config, baseDate);
      expect(next.getDay()).toBe(3); // Expect Wednesday

      // Wednesday
      baseDate = new Date("2024-01-03T10:00:00"); // Wed
      next = service.calculateNextOccurrence(config, baseDate);
      expect(next.getDay()).toBe(5); // Expect Friday

      // Friday
      baseDate = new Date("2024-01-05T10:00:00"); // Fri
      next = service.calculateNextOccurrence(config, baseDate);
      expect(next.getDay()).toBe(1); // Expect Monday next week
    });
  });

  describe("checkAndGenerate", () => {
    it("should generate new task when due", async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 10000); // 10s ago

      const task: Task = {
        id: "t1",
        jobId: "job-1",
        title: "Recurring Task",
        subtitle: "",
        summary: "",
        status: "todo",
        projectId: "p1",
        createdAt: now,
        updatedAt: now,
        priority: "medium",
        assignee: "",
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
        recurring: {
          enabled: true,
          frequency: "daily",
          interval: 1,
          nextOccurrence: pastDate,
        },
      };

      service.start(() => [task]);
      await flushMicrotasks();

      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnUpdate).toHaveBeenCalled();

      // Check created task
      const createdTask = mockOnCreate.mock.calls[0][0];
      expect(createdTask.title).toBe(task.title);
      expect(createdTask.id).not.toBe(task.id);
    });

    it("should reset status to the configured default for new instances", async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 10000);
      const customService = new RecurringTaskService({
        onCreateTask: mockOnCreate,
        onUpdateTask: mockOnUpdate,
        getDefaultStatus: () => "Pending",
      });

      const task: Task = {
        id: "t1",
        jobId: "job-1",
        title: "Recurring Task",
        subtitle: "",
        summary: "",
        status: "Completed",
        projectId: "p1",
        createdAt: now,
        updatedAt: now,
        priority: "medium",
        assignee: "",
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
        recurring: {
          enabled: true,
          frequency: "daily",
          interval: 1,
          nextOccurrence: pastDate,
        },
      };

      customService.start(() => [task]);
      await flushMicrotasks();
      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnCreate.mock.calls[0][0].status).toBe("Pending");
      customService.stop();
    });

    it("should not generate task if not due", async () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 10000); // 10s future

      const task: Task = {
        id: "t1",
        jobId: "job-1",
        title: "Future Task",
        subtitle: "",
        summary: "",
        status: "todo",
        projectId: "p1",
        createdAt: now,
        updatedAt: now,
        priority: "medium",
        assignee: "",
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
        recurring: {
          enabled: true,
          frequency: "daily",
          interval: 1,
          nextOccurrence: futureDate,
        },
      };

      service.start(() => [task]);
      await flushMicrotasks();
      expect(mockOnCreate).not.toHaveBeenCalled();
    });

    it("calls onAgentRecurringTask when a due instance has an agent assignee", async () => {
      const agentService = new RecurringTaskService({
        onCreateTask: mockOnCreate,
        onUpdateTask: mockOnUpdate,
        onAgentRecurringTask: mockOnAgentRecurring,
      });
      const now = new Date();
      const pastDate = new Date(now.getTime() - 10000);

      const task: Task = {
        id: "t1",
        jobId: "job-1",
        title: "Nightly sync",
        subtitle: "",
        summary: "",
        status: "Done",
        projectId: "p1",
        createdAt: now,
        updatedAt: now,
        priority: "medium",
        assignee: "Worker Bot",
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
        recurring: {
          enabled: true,
          frequency: "daily",
          interval: 1,
          nextOccurrence: pastDate,
        },
      };

      agentService.start(() => [task]);
      await flushMicrotasks();

      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnAgentRecurring).toHaveBeenCalledTimes(1);
      expect(mockOnAgentRecurring).toHaveBeenCalledWith(
        expect.objectContaining({
          assignee: "Worker Bot",
          title: "Nightly sync",
        }),
      );
      agentService.stop();
    });

    it("does not call onAgentRecurringTask when assignee is empty", async () => {
      const agentService = new RecurringTaskService({
        onCreateTask: mockOnCreate,
        onUpdateTask: mockOnUpdate,
        onAgentRecurringTask: mockOnAgentRecurring,
      });
      const now = new Date();
      const pastDate = new Date(now.getTime() - 10000);

      const task: Task = {
        id: "t1",
        jobId: "job-1",
        title: "Manual recurring",
        subtitle: "",
        summary: "",
        status: "todo",
        projectId: "p1",
        createdAt: now,
        updatedAt: now,
        priority: "medium",
        assignee: "",
        subtasks: [],
        attachments: [],
        tags: [],
        timeEstimate: 0,
        timeSpent: 0,
        recurring: {
          enabled: true,
          frequency: "daily",
          interval: 1,
          nextOccurrence: pastDate,
        },
      };

      agentService.start(() => [task]);
      await flushMicrotasks();

      expect(mockOnCreate).toHaveBeenCalled();
      expect(mockOnAgentRecurring).not.toHaveBeenCalled();
      agentService.stop();
    });
  });
});
