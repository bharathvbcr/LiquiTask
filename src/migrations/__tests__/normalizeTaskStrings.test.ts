import { describe, expect, it } from "vitest";
import type { MigratableAppData, Task } from "../../../types";
import {
  migrateV1_1_to_V1_2_NormalizeTaskStrings,
  normalizeTaskStrings,
} from "../normalizeTaskStrings";

const task = (over: Partial<Task>): Task =>
  ({
    id: "t1",
    title: "Clean title",
    summary: "Clean summary",
    tags: ["a", "b"],
    subtasks: [{ id: "s1", title: "Do it", completed: false }],
    ...over,
  }) as Task;

describe("normalizeTaskStrings", () => {
  it("coerces malformed title/summary/subtitle/tags/subtask titles", () => {
    const dirty = task({
      title: { title: "Redesign the pill" } as unknown as string,
      summary: { text: "make it modern" } as unknown as string,
      subtitle: { title: "UI" } as unknown as string,
      tags: ["ui", { name: "design" } as unknown as string, ""],
      subtasks: [
        { id: "s1", title: { title: "Locate component" } as unknown as string, completed: false },
        { id: "s2", title: "Rework styles", completed: true },
      ],
    });

    const clean = normalizeTaskStrings(dirty);
    expect(clean.title).toBe("Redesign the pill");
    expect(clean.summary).toBe("make it modern");
    expect(clean.subtitle).toBe("UI");
    expect(clean.tags).toEqual(["ui", "design"]);
    expect(clean.subtasks[0].title).toBe("Locate component");
    expect(clean.subtasks[0].completed).toBe(false);
    expect(clean.subtasks[1].title).toBe("Rework styles");
  });

  it("returns the same reference for an already-clean task (no churn)", () => {
    const clean = task({});
    expect(normalizeTaskStrings(clean)).toBe(clean);
  });

  it("leaves clean subtasks untouched but fixes malformed siblings", () => {
    const t = task({
      subtasks: [
        { id: "s1", title: "keep me", completed: false },
        { id: "s2", title: undefined as unknown as string, completed: false },
      ],
    });
    const clean = normalizeTaskStrings(t);
    expect(clean.subtasks[0]).toBe(t.subtasks[0]); // untouched reference
    expect(clean.subtasks[1].title).toBe("");
  });
});

describe("migrateV1_1_to_V1_2_NormalizeTaskStrings", () => {
  it("normalizes tasks, bumps the version, and preserves other data", () => {
    const data: MigratableAppData = {
      version: "1.1.0",
      projects: [{ id: "p1", name: "P", type: "folder" }],
      tasks: [task({ title: { title: "X" } as unknown as string })],
    };
    const result = migrateV1_1_to_V1_2_NormalizeTaskStrings(data);
    expect(result.version).toBe("1.2.0");
    expect(result.projects).toEqual(data.projects);
    expect(result.tasks?.[0].title).toBe("X");
  });

  it("is a no-op on data with no tasks", () => {
    const result = migrateV1_1_to_V1_2_NormalizeTaskStrings({ version: "1.1.0" });
    expect(result.version).toBe("1.2.0");
    expect(result.tasks).toBeUndefined();
  });
});
