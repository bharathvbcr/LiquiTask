import { describe, expect, it } from "vitest";

import type { BoardColumn, MigratableAppData, Task } from "../../../types";
import { migrateColumnsToAgenticBoard, migrateV1_0_to_V1_1_AgenticBoard } from "../agenticBoard";

const LEGACY_COLUMNS: BoardColumn[] = [
  { id: "Pending", title: "Pending", color: "#64748b" },
  { id: "InProgress", title: "In Progress", color: "#3b82f6" },
  { id: "Completed", title: "Completed", color: "#10b981", isCompleted: true },
  { id: "Review", title: "Review", color: "#f59e0b" },
  { id: "Delivered", title: "Delivered", color: "#a855f7" },
];

function makeTask(status: string, id = `t-${status}`): Task {
  return {
    id,
    jobId: "",
    projectId: "p1",
    title: `Task in ${status}`,
    summary: "",
    assignee: "",
    priority: "medium",
    status,
    createdAt: new Date("2026-01-01"),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
  } as Task;
}

describe("migrateColumnsToAgenticBoard", () => {
  it("replaces the legacy five-column layout with the agentic four", () => {
    const next = migrateColumnsToAgenticBoard(LEGACY_COLUMNS)!;
    expect(next.map((c) => c.id)).toEqual(["Task", "InProgress", "Completed", "Commit"]);
    expect(next.find((c) => c.id === "Commit")?.isCompleted).toBe(true);
    expect(next.filter((c) => c.isCompleted)).toHaveLength(1);
  });

  it("preserves custom columns after the canonical four", () => {
    const custom: BoardColumn = { id: "col-123", title: "Blocked", color: "#f00" };
    const next = migrateColumnsToAgenticBoard([...LEGACY_COLUMNS, custom])!;
    expect(next.map((c) => c.id)).toEqual([
      "Task",
      "InProgress",
      "Completed",
      "Commit",
      "col-123",
    ]);
    expect(next[4]).toEqual(custom);
  });

  it("passes through empty/undefined columns", () => {
    expect(migrateColumnsToAgenticBoard(undefined)).toBeUndefined();
    expect(migrateColumnsToAgenticBoard([])).toEqual([]);
  });
});

describe("migrateV1_0_to_V1_1_AgenticBoard", () => {
  it("remaps task statuses across the legacy → agentic mapping", () => {
    const data: MigratableAppData = {
      version: "1.0.0",
      columns: LEGACY_COLUMNS,
      tasks: [
        makeTask("Pending"),
        makeTask("InProgress"),
        makeTask("Review"),
        makeTask("Completed"),
        makeTask("Delivered"),
        makeTask("col-custom"),
      ],
    };
    const result = migrateV1_0_to_V1_1_AgenticBoard(data);
    const statusById = new Map(result.tasks!.map((t) => [t.id, t.status]));
    expect(statusById.get("t-Pending")).toBe("Task");
    expect(statusById.get("t-InProgress")).toBe("InProgress");
    expect(statusById.get("t-Review")).toBe("Completed");
    expect(statusById.get("t-Completed")).toBe("Commit");
    expect(statusById.get("t-Delivered")).toBe("Commit");
    expect(statusById.get("t-col-custom")).toBe("col-custom");
    expect(result.version).toBe("1.1.0");
  });

  it("remaps saved-view status filters", () => {
    const data: MigratableAppData = {
      version: "1.0.0",
      savedViews: [
        {
          id: "v1",
          name: "In review",
          filters: {
            assignee: "",
            dateRange: null,
            startDate: "",
            endDate: "",
            tags: "",
            status: "Review",
          },
          grouping: "none",
          createdAt: new Date("2026-01-01"),
        },
      ],
    };
    const result = migrateV1_0_to_V1_1_AgenticBoard(data);
    expect(result.savedViews?.[0].filters.status).toBe("Completed");
  });

  it("leaves fresh installs (no stored columns/tasks) untouched", () => {
    const result = migrateV1_0_to_V1_1_AgenticBoard({ version: "1.0.0" });
    expect(result.columns).toBeUndefined();
    expect(result.tasks).toBeUndefined();
    expect(result.version).toBe("1.1.0");
  });
});
