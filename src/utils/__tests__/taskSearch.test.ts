import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../../types";
import { filterTasksBySearch } from "../taskSearch";

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

describe("filterTasksBySearch", () => {
  it("falls back to linear search when the index is not ready", () => {
    const tasks = [
      makeTask({ id: "task-1", title: "Draft proposal" }),
      makeTask({ id: "task-2", title: "Review invoice" }),
    ];

    const results = filterTasksBySearch(tasks, "draft");

    expect(results.map((task) => task.id)).toEqual(["task-1"]);
  });

  it("uses the search index when available", () => {
    const search = vi.fn().mockReturnValue(["task-2"]);
    const tasks = [
      makeTask({ id: "task-1", title: "Draft proposal" }),
      makeTask({ id: "task-2", title: "Review invoice" }),
    ];

    const results = filterTasksBySearch(tasks, "invoice", { search });

    expect(search).toHaveBeenCalledWith("invoice");
    expect(results.map((task) => task.id)).toEqual(["task-2"]);
  });
});
