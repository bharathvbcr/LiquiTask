import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "../../../types";

// Control the runtime bridge: default to the web/sync path, and flip these per
// test to exercise the Tauri native branch and the both-throw failure surface.
const runtime = vi.hoisted(() => ({ tauri: false, nativeThrows: false }));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: () => runtime.tauri,
  callNative: async <T>(_command: string, _args: unknown, fallback: () => T | Promise<T>) => {
    // A thrown native command normally degrades to the JS fallback; simulate the
    // pathological case where the fallback also throws so `callNative` rejects.
    if (runtime.nativeThrows) {
      throw new Error("native command and JS fallback both failed");
    }
    return await fallback();
  },
}));

// The DLQ persists via storageService and mirrors audit facts into the task
// event log — both are stubbed so the tests exercise queue semantics only.
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
import { type AutomationRule, AutomationService } from "../automationService";

const makeTask = (id: string, title = id): Task =>
  ({
    id,
    title,
    status: "Todo",
    priority: "Medium",
    tags: [],
    projectId: "p1",
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as Task;

const scheduledRule: AutomationRule = {
  id: "r1",
  name: "Daily Priority Bump",
  enabled: true,
  trigger: "onSchedule",
  schedule: { frequency: "daily", time: "12:01" },
  actions: [{ type: "setPriority", value: "High" }],
};

const openAutomationLetters = () =>
  deadLetterService.getOpen().filter((l) => l.kind === "automation");

describe("automation dead-letter wiring", () => {
  beforeEach(() => {
    runtime.tauri = false;
    runtime.nativeThrows = false;
    for (const letter of deadLetterService.getOpen()) {
      deadLetterService.discard(letter.id);
    }
    vi.useFakeTimers();
    // 12:00:00 — one minute before the scheduled rule fires at 12:01.
    vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("dead-letters a failing scheduled task without aborting the sweep", async () => {
    const service = new AutomationService();
    const applyTaskUpdates = vi.fn((id: string) => {
      if (id === "task-1") throw new Error("write failed for task-1");
    });
    service.loadRules([scheduledRule]);
    service.configureSchedulerContext({
      getAllTasks: () => [makeTask("task-1"), makeTask("task-2")],
      applyTaskUpdates,
    });

    await vi.advanceTimersByTimeAsync(60000);
    service.stop();

    // Both tasks were processed even though the first one threw.
    expect(applyTaskUpdates).toHaveBeenCalledTimes(2);
    expect(applyTaskUpdates).toHaveBeenCalledWith("task-2", { priority: "High" });

    const letters = openAutomationLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0].taskId).toBe("task-1");
    expect(letters[0].payload).toMatchObject({ taskId: "task-1", trigger: "onSchedule" });
  });

  it("lets the registered retry handler replay a recorded automation letter", async () => {
    const service = new AutomationService();
    let failing = true;
    const applyTaskUpdates = vi.fn((id: string) => {
      if (failing && id === "task-1") throw new Error("transient write failure");
    });
    service.loadRules([scheduledRule]);
    service.configureSchedulerContext({
      getAllTasks: () => [makeTask("task-1")],
      applyTaskUpdates,
    });

    await vi.advanceTimersByTimeAsync(60000);
    service.stop();

    const letter = openAutomationLetters()[0];
    expect(letter).toBeDefined();

    // The transient failure clears; retry recomputes the automation and re-applies.
    failing = false;
    const outcome = await deadLetterService.retry(letter.id);
    expect(outcome.ok).toBe(true);
    expect(deadLetterService.getById(letter.id)?.status).toBe("resolved");
    expect(applyTaskUpdates).toHaveBeenLastCalledWith("task-1", { priority: "High" });
  });

  it("records a letter when the native command and its JS fallback both throw", async () => {
    runtime.tauri = true;
    runtime.nativeThrows = true;
    const service = new AutomationService();
    service.loadRules([{ ...scheduledRule, trigger: "onUpdate" }]);

    const task = makeTask("task-9");
    await expect(
      service.processTaskEventNative("onUpdate", { newTask: task }, [task]),
    ).rejects.toThrow(/both failed/);

    const letters = openAutomationLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0].payload).toMatchObject({ taskId: "task-9", trigger: "onUpdate" });
  });

  it("does not record a duplicate letter when the retry handler re-runs the native path", async () => {
    runtime.tauri = true;
    runtime.nativeThrows = true;
    const service = new AutomationService();
    service.loadRules([{ ...scheduledRule, trigger: "onUpdate" }]);

    const task = makeTask("task-x");
    await expect(
      service.processTaskEventNative("onUpdate", { newTask: task }, [task], {
        recordFailures: false,
      }),
    ).rejects.toThrow();

    expect(openAutomationLetters()).toHaveLength(0);
  });
});
