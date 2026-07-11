import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../../types";
import { type AutomationRule, AutomationService } from "../automationService";

/**
 * Regression: when one onSchedule rule is due, the scheduler must apply ONLY
 * that rule — not rematch every enabled onSchedule rule via processTaskEvent.
 */
describe("automation schedule amplification", () => {
  let service: AutomationService;

  const mockTask: Task = {
    id: "t1",
    title: "Task",
    status: "Todo",
    priority: "Medium",
    tags: [],
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Task;

  beforeEach(() => {
    service = new AutomationService();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 8, 59, 0));
  });

  afterEach(() => {
    service.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("fires only the due scheduled rule, not every onSchedule rule", async () => {
    const applyTaskUpdates = vi.fn();

    const dueRule: AutomationRule = {
      id: "due",
      name: "Due at 09:00",
      enabled: true,
      trigger: "onSchedule",
      schedule: { frequency: "daily", time: "09:00" },
      actions: [{ type: "addTag", value: "due-fired" }],
    };

    const notDueRule: AutomationRule = {
      id: "not-due",
      name: "Due at 10:00",
      enabled: true,
      trigger: "onSchedule",
      schedule: { frequency: "daily", time: "10:00" },
      actions: [{ type: "addTag", value: "not-due-fired" }],
    };

    service.loadRules([dueRule, notDueRule]);
    service.configureSchedulerContext({
      getAllTasks: () => [mockTask],
      applyTaskUpdates,
    });

    await vi.advanceTimersByTimeAsync(60000);

    expect(applyTaskUpdates).toHaveBeenCalledTimes(1);
    expect(applyTaskUpdates).toHaveBeenCalledWith(
      mockTask.id,
      expect.objectContaining({ tags: expect.arrayContaining(["due-fired"]) }),
    );
    expect(applyTaskUpdates).not.toHaveBeenCalledWith(
      mockTask.id,
      expect.objectContaining({ tags: expect.arrayContaining(["not-due-fired"]) }),
    );
  });
});
