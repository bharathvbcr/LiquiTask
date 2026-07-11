import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../types";

vi.mock("../storageService", () => {
  const data = new Map<string, unknown>();
  return {
    default: {
      get: (key: string, fallback: unknown) => data.get(key) ?? fallback,
      set: async (key: string, value: unknown) => {
        data.set(key, JSON.parse(JSON.stringify(value)));
      },
    },
  };
});

vi.mock("../../core/events/taskEventStore", () => ({
  default: { appendSafe: vi.fn(async () => true) },
}));

import deadLetterService from "../deadLetterService";
import { automationService } from "../automationService";

describe("automation DLQ retry handler", () => {
  beforeEach(() => {
    for (const letter of deadLetterService.getOpen()) {
      deadLetterService.discard(letter.id);
    }
  });

  it("re-applies stored updates from the letter payload", async () => {
    const applyTaskUpdates = vi.fn();
    automationService.configureSchedulerContext({
      getAllTasks: () => [{ id: "task-1", title: "T" } as Task],
      applyTaskUpdates,
    });
    const letter = deadLetterService.record({
      kind: "automation",
      title: "Rule failed",
      detail: "transient",
      taskId: "task-1",
      payload: { taskId: "task-1", updates: { priority: "high" } },
    });
    const outcome = await deadLetterService.retry(letter.id);
    expect(outcome.ok).toBe(true);
    expect(applyTaskUpdates).toHaveBeenCalledWith("task-1", { priority: "high" });
  });
});
