import { describe, expect, it } from "vitest";
import type { Task } from "../../../types";
import { buildTaskContextIndex, getTasksFromContextIndex } from "../taskContextIndex";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  jobId: "job-1",
  projectId: "project-1",
  title: "Draft proposal",
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

describe("task context index", () => {
  it("groups tasks by status and priority while preserving board order", () => {
    const tasks = [
      makeTask({ id: "task-1", status: "Pending", priority: "high", order: 30 }),
      makeTask({ id: "task-2", status: "Pending", priority: "medium", order: 10 }),
      makeTask({ id: "task-3", status: "Pending", priority: "high", order: 20 }),
      makeTask({ id: "task-4", status: "Delivered", priority: "high", order: 5 }),
    ];

    const index = buildTaskContextIndex(tasks);

    expect(getTasksFromContextIndex(index, "Pending").map((task) => task.id)).toEqual([
      "task-2",
      "task-3",
      "task-1",
    ]);
    expect(getTasksFromContextIndex(index, "Pending", "high").map((task) => task.id)).toEqual([
      "task-3",
      "task-1",
    ]);
  });

  it("falls back to createdAt ordering when explicit order is absent", () => {
    const tasks = [
      makeTask({
        id: "task-late",
        order: undefined,
        createdAt: new Date("2026-03-06T12:00:00Z"),
      }),
      makeTask({
        id: "task-early",
        order: undefined,
        createdAt: new Date("2026-03-06T08:00:00Z"),
      }),
    ];

    const index = buildTaskContextIndex(tasks);

    expect(getTasksFromContextIndex(index, "Pending").map((task) => task.id)).toEqual([
      "task-early",
      "task-late",
    ]);
  });

  it("returns an empty list for missing contexts", () => {
    const index = buildTaskContextIndex([makeTask()]);

    expect(getTasksFromContextIndex(index, "InProgress")).toEqual([]);
    expect(getTasksFromContextIndex(index, "Pending", "high")).toEqual([]);
  });
});
