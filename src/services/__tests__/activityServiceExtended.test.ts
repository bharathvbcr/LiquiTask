import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { activityService } from "../activityService";

describe("activityService Extended", () => {
  const mockTask: Task = {
    id: "t1",
    title: "Old Title",
    summary: "Old Summary",
    status: "Pending",
    priority: "low",
    assignee: "Alice",
    dueDate: new Date("2026-04-01"),
    activity: [],
  } as any;

  it("logs status change", () => {
    const updated = activityService.logChange(mockTask, { status: "InProgress" });
    expect(updated.activity).toHaveLength(1);
    expect(updated.activity[0].field).toBe("status");
    expect(updated.activity[0].oldValue).toBe("Pending");
    expect(updated.activity[0].newValue).toBe("InProgress");
  });

  it("logs priority change", () => {
    const updated = activityService.logChange(mockTask, { priority: "high" });
    expect(updated.activity[0].field).toBe("priority");
    expect(updated.activity[0].newValue).toBe("high");
  });

  it("logs assignee change", () => {
    const updated = activityService.logChange(mockTask, { assignee: "Bob" });
    expect(updated.activity[0].field).toBe("assignee");
    expect(updated.activity[0].newValue).toBe("Bob");
  });

  it("logs title and summary changes", () => {
    const updated = activityService.logChange(mockTask, { title: "New", summary: "New" });
    expect(updated.activity).toHaveLength(2);
  });

  it("logs due date change", () => {
    const newDate = new Date("2026-04-02");
    const updated = activityService.logChange(mockTask, { dueDate: newDate });
    expect(updated.activity[0].field).toBe("dueDate");
  });

  it("logs creation if requested", () => {
    const updated = activityService.logChange(mockTask, {}, "create");
    expect(updated.activity[0].type).toBe("create");
  });
});
