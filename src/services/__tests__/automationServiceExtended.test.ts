import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRule, Task } from "../../types";
import { AutomationService } from "../automationService";

describe("AutomationService Extended", () => {
  let service: AutomationService;
  const mockTask: Task = {
    id: "t1",
    title: "Task",
    status: "Todo",
    priority: "medium",
    tags: ["old"],
  } as any;

  beforeEach(() => {
    service = new AutomationService();
  });

  it("handles rule management", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "R1",
      enabled: true,
      trigger: "onCreate",
      actions: [{ type: "setPriority", value: "high" }],
    };
    service.addRule(rule);
    expect(service.getRules()).toHaveLength(1);
    
    service.updateRule("r1", { name: "Updated" });
    expect(service.getRules()[0].name).toBe("Updated");
    
    service.deleteRule("r1");
    expect(service.getRules()).toHaveLength(0);
  });

  it("processes actions correctly: setField, addTag, removeTag, moveToColumn", () => {
    const rule: AutomationRule = {
      id: "r1",
      name: "R1",
      enabled: true,
      trigger: "onCreate",
      actions: [
        { type: "setField", field: "assignee", value: "Bob" },
        { type: "addTag", value: "new" },
        { type: "removeTag", value: "old" },
        { type: "moveToColumn", value: "InProgress" },
        { type: "setPriority", value: "high" },
      ],
    };
    service.loadRules([rule]);
    
    const updates = service.processTaskEvent("onCreate", { newTask: mockTask }, [mockTask]);
    expect(updates?.assignee).toBe("Bob");
    expect(updates?.tags).toContain("new");
    expect(updates?.tags).not.toContain("old");
    expect(updates?.status).toBe("InProgress");
    expect(updates?.priority).toBe("high");
  });

  it("handles notifications", () => {
    const mockNotify = vi.fn();
    const rule: AutomationRule = {
      id: "r1",
      name: "R1",
      enabled: true,
      trigger: "onCreate",
      actions: [{ type: "notify", value: "Hello" }],
    };
    service.loadRules([rule]);
    
    service.processTaskEvent("onCreate", { newTask: mockTask }, [mockTask], { onNotify: mockNotify });
    expect(mockNotify).toHaveBeenCalledWith("Hello");
  });

  describe("scheduled automation", () => {
    it("isRuleDue identifies due rules correctly", () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      const rule: AutomationRule = {
        id: "r1",
        trigger: "onSchedule",
        schedule: { frequency: "daily", time: "10:00" },
      } as any;

      // Access private method
      const isDue = (service as any).isRuleDue(rule, now);
      expect(isDue).toBe(true);
      
      const wrongTime = new Date();
      wrongTime.setHours(10, 1, 0, 0);
      expect((service as any).isRuleDue(rule, wrongTime)).toBe(false);
    });

    it("scheduler triggers updates", () => {
      vi.useFakeTimers();
      const mockApply = vi.fn();
      const rule: AutomationRule = {
        id: "r1",
        enabled: true,
        trigger: "onSchedule",
        schedule: { frequency: "daily", time: "10:00" },
        actions: [{ type: "setPriority", value: "high" }],
      } as any;
      
      service.loadRules([rule]);
      service.configureSchedulerContext({
        getAllTasks: () => [mockTask],
        applyTaskUpdates: mockApply,
      });

      // Set time to 09:59:59
      const startTime = new Date();
      startTime.setHours(9, 59, 59, 0);
      vi.setSystemTime(startTime);

      // Advance by 2 seconds to reach 10:00:01
      // The interval check runs every 60s. We need to make sure the interval callback sees 10:00.
      
      vi.advanceTimersByTime(60000); 
      
      // Since interval runs every 60s, if it started at 09:59:59, 
      // the first call is at 10:00:59. At that time, isRuleDue(10:00) should be true (if only HH:mm checked).
      expect(mockApply).toHaveBeenCalledWith("t1", { priority: "high" });
      
      service.stop();
      vi.useRealTimers();
    });
  });
});
