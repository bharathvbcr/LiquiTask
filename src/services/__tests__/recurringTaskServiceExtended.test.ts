import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringConfig, Task } from "../../types";
import { RecurringTaskService } from "../recurringTaskService";

describe("RecurringTaskService Extended", () => {
  let service: RecurringTaskService;
  const mockOnCreateTask = vi.fn();
  const mockOnUpdateTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RecurringTaskService({
      onCreateTask: mockOnCreateTask,
      onUpdateTask: mockOnUpdateTask,
    });
  });

  describe("calculateNextOccurrence", () => {
    it("handles daily recurrence", () => {
      const config: RecurringConfig = {
        enabled: true,
        frequency: "daily",
        interval: 2,
      };
      const fromDate = new Date(2026, 3, 1); // April 1
      const next = service.calculateNextOccurrence(config, fromDate);
      expect(next.getDate()).toBe(3); // 1 + 2
    });

    it("handles weekly recurrence with specific days", () => {
      const config: RecurringConfig = {
        enabled: true,
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1, 3, 5], // Mon, Wed, Fri
      };
      const fromDate = new Date(2026, 3, 1); // Wed (3)
      const next = service.calculateNextOccurrence(config, fromDate);
      expect(next.getDay()).toBe(5); // Fri
    });

    it("handles weekly recurrence skipping to next week", () => {
      const config: RecurringConfig = {
        enabled: true,
        frequency: "weekly",
        interval: 1,
        daysOfWeek: [1], // Mon
      };
      const fromDate = new Date(2026, 3, 1); // Wed (3)
      const next = service.calculateNextOccurrence(config, fromDate);
      expect(next.getDay()).toBe(1);
      expect(next.getDate()).toBe(6); // Next Mon
    });

    it("handles monthly recurrence with specific day", () => {
      const config: RecurringConfig = {
        enabled: true,
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 15,
      };
      const fromDate = new Date(2026, 3, 1);
      const next = service.calculateNextOccurrence(config, fromDate);
      expect(next.getMonth()).toBe(4); // May
      expect(next.getDate()).toBe(15);
    });

    it("handles monthly recurrence with non-existent day (Feb 30)", () => {
      const config: RecurringConfig = {
        enabled: true,
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 30,
      };
      const fromDate = new Date(2026, 0, 30); // Jan 30
      const next = service.calculateNextOccurrence(config, fromDate);
      expect(next.getMonth()).toBe(1); // Feb
      expect(next.getDate()).toBe(28); // Last day of Feb
    });
  });

  describe("checkAndGenerate", () => {
    it("should generate task if nextOccurrence has passed", () => {
      const tasks: Task[] = [
        {
          id: "t1",
          jobId: "TSK-1",
          title: "Recurring",
          status: "Pending",
          recurring: {
            enabled: true,
            frequency: "daily",
            interval: 1,
            nextOccurrence: new Date(Date.now() - 1000), // In past
          },
        } as any,
      ];

      // Access private method via cast
      (service as any).checkAndGenerate(tasks);

      expect(mockOnCreateTask).toHaveBeenCalled();
      expect(mockOnUpdateTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({
          recurring: expect.objectContaining({
            nextOccurrence: expect.any(Date),
          }),
        }),
      );
    });
  });
});
