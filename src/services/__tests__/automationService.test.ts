import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { type AutomationRule, AutomationService } from "../automationService";

describe("AutomationService", () => {
  let service: AutomationService;

  const mockTask: Task = {
    id: "1",
    title: "Test Task",
    status: "Todo",
    priority: "Medium",
    tags: ["tag1"],
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Task;

  beforeEach(() => {
    service = new AutomationService();
    vi.useFakeTimers();
  });

  it("should load and get rules", () => {
    const rules: AutomationRule[] = [
      {
        id: "r1",
        name: "Rule 1",
        enabled: true,
        trigger: "onCreate",
        actions: [{ type: "addTag", value: "auto" }],
      },
    ];
    service.loadRules(rules);
    expect(service.getRules()).toEqual(rules);
  });

  it("should add, update, and delete rules", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onCreate",
      actions: [{ type: "addTag", value: "auto" }],
    };
    service.addRule(rule);
    expect(service.getRules()).toHaveLength(1);

    service.updateRule("r1", { name: "Updated Rule" });
    expect(service.getRules()[0].name).toBe("Updated Rule");

    service.deleteRule("r1");
    expect(service.getRules()).toHaveLength(0);
  });

  it("should process task event and return updates", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onCreate",
      actions: [
        { type: "addTag", value: "auto" },
        { type: "setPriority", value: "High" },
      ],
    };
    service.addRule(rule);

    const updates = service.processTaskEvent("onCreate", { newTask: mockTask }, [mockTask]);
    expect(updates).toEqual({
      tags: ["tag1", "auto"],
      priority: "High",
    });
  });

  it("should not process disabled rules", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: false,
      trigger: "onCreate",
      actions: [{ type: "addTag", value: "auto" }],
    };
    service.addRule(rule);

    const updates = service.processTaskEvent("onCreate", { newTask: mockTask }, [mockTask]);
    expect(updates).toBeNull();
  });

  it("should evaluate conditions correctly", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onUpdate",
      conditions: {
        id: "g1",
        operator: "AND",
        rules: [{ id: "c1", field: "status", operator: "equals", value: "Todo" }],
      },
      actions: [{ type: "setPriority", value: "High" }],
    };
    service.addRule(rule);

    // Matches condition
    const updates = service.processTaskEvent("onUpdate", { newTask: mockTask }, [mockTask]);
    expect(updates).toEqual({ priority: "High" });

    // Does not match condition
    const nonMatchingTask = { ...mockTask, status: "Done" } as Task;
    const updates2 = service.processTaskEvent("onUpdate", { newTask: nonMatchingTask }, [
      nonMatchingTask,
    ]);
    expect(updates2).toBeNull();
  });

  it("should handle removeTag action", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onUpdate",
      actions: [{ type: "removeTag", value: "tag1" }],
    };
    service.addRule(rule);

    const updates = service.processTaskEvent("onUpdate", { newTask: mockTask }, [mockTask]);
    expect(updates?.tags).toEqual([]);
  });

  it("should handle moveToColumn action", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onUpdate",
      actions: [{ type: "moveToColumn", value: "Done" }],
    };
    service.addRule(rule);

    const updates = service.processTaskEvent("onUpdate", { newTask: mockTask }, [mockTask]);
    expect(updates?.status).toBe("Done");
  });

  it("should handle setField action", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onUpdate",
      actions: [{ type: "setField", field: "assignee", value: "Bob" }],
    };
    service.addRule(rule);

    const updates = service.processTaskEvent("onUpdate", { newTask: mockTask }, [mockTask]);
    expect((updates as Record<string, unknown>).assignee).toBe("Bob");
  });

  it("should handle notify action", () => {
    const onNotify = vi.fn();
    const rule: AutomationRule = {
      id: "r1",
      name: "Rule 1",
      enabled: true,
      trigger: "onUpdate",
      actions: [{ type: "notify", value: "Hello World" }],
    };
    service.addRule(rule);

    service.processTaskEvent("onUpdate", { newTask: mockTask }, [mockTask], {
      onNotify,
    });
    expect(onNotify).toHaveBeenCalledWith("Hello World");
  });

  it("should handle scheduled rules", async () => {
    const applyTaskUpdates = vi.fn();
    const getAllTasks = vi.fn().mockReturnValue([mockTask]);

    // Fix the date to a specific point (12:00:00)
    const now = new Date(2024, 0, 1, 12, 0, 0);
    vi.setSystemTime(now);

    const timeStr = "12:01"; // Rule is scheduled for 12:01

    const rule: AutomationRule = {
      id: "r1",
      name: "Daily Rule",
      enabled: true,
      trigger: "onSchedule",
      schedule: {
        frequency: "daily",
        time: timeStr,
      },
      actions: [{ type: "addTag", value: "scheduled" }],
    };
    service.addRule(rule);
    service.configureSchedulerContext({
      getAllTasks,
      applyTaskUpdates,
    });

    // Advance 1 minute to 12:01:00
    vi.advanceTimersByTime(60000);

    expect(applyTaskUpdates).toHaveBeenCalledWith(
      mockTask.id,
      expect.objectContaining({
        tags: expect.arrayContaining(["scheduled"]),
      }),
    );
  });
});
