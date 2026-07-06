import { describe, expect, it } from "vitest";

import type { AgentRun, Task } from "../../../../types";
import {
  computeEstimateCalibration,
  suggestCalibratedEstimate,
} from "../agentEstimateLearningService";

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "t1",
    title: "Fix bug",
    priority: "medium",
    tags: ["backend"],
    assignee: "Claude",
    timeEstimate: 60,
    ...overrides,
  }) as Task;

const run = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: "r1",
  taskId: "t1",
  agentId: "a1",
  status: "completed",
  createdAt: new Date("2026-07-01T10:00:00"),
  startedAt: new Date("2026-07-01T10:00:00"),
  finishedAt: new Date("2026-07-01T11:30:00"),
  events: [],
  ...overrides,
});

describe("agentEstimateLearningService", () => {
  it("computes calibration from estimate vs actual pairs", () => {
    const tasks = [
      task({ id: "t1", timeEstimate: 60 }),
      task({ id: "t2", timeEstimate: 30 }),
    ];
    const runs = [
      run({ taskId: "t1", finishedAt: new Date("2026-07-01T11:00:00") }), // 60m actual
      run({
        id: "r2",
        taskId: "t2",
        startedAt: new Date("2026-07-01T10:00:00"),
        finishedAt: new Date("2026-07-01T10:45:00"),
      }), // 45m actual vs 30m est
    ];

    const cal = computeEstimateCalibration(tasks, runs);
    expect(cal.sampleCount).toBe(2);
    expect(cal.avgEstimatedMinutes).toBe(45);
    expect(cal.avgActualMinutes).toBeGreaterThan(0);
    expect(cal.ratio).toBeGreaterThan(1);
  });

  it("suggests estimate from similar priority runs", () => {
    const tasks = [
      task({ id: "t1", priority: "high", timeEstimate: 30 }),
      task({ id: "t2", priority: "high", timeEstimate: 40 }),
      task({ id: "t3", priority: "low", timeEstimate: 10 }),
    ];
    const runs = [
      run({ taskId: "t1", finishedAt: new Date("2026-07-01T11:00:00") }), // 60m
      run({
        id: "r2",
        taskId: "t2",
        startedAt: new Date("2026-07-01T10:00:00"),
        finishedAt: new Date("2026-07-01T12:00:00"),
      }), // 120m
    ];

    const suggestion = suggestCalibratedEstimate(
      { title: "New feature", priority: "high", tags: [], assignee: "", timeEstimate: 0 },
      tasks,
      runs,
    );

    expect(suggestion).not.toBeNull();
    expect(suggestion!.minutes).toBeGreaterThan(0);
    expect(["medium", "high"]).toContain(suggestion!.confidence);
  });

  it("returns null when insufficient history", () => {
    expect(
      suggestCalibratedEstimate(
        { title: "New", priority: "low", tags: [], assignee: "", timeEstimate: 0 },
        [],
        [],
      ),
    ).toBeNull();
  });
});
