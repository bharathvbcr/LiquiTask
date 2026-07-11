import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import type { Task } from "../../../types";
import { diffProjection, replayTaskEvents } from "../taskEventReducer";
import { draftEvent, serializeTask } from "../taskEvents";

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: () => false,
}));

vi.mock("../../services/sqliteTaskStore", () => ({
  isSqliteTaskStoreActive: () => false,
  commitSqliteTaskMutation: vi.fn(),
}));

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    jobId: `TSK-${id}`,
    projectId: "proj-1",
    title: `Task ${id}`,
    summary: "",
    assignee: "",
    priority: "medium",
    status: "Task",
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...overrides,
  };
}

describe("taskEventStore", () => {
  it("imports legacy tasks into an empty log on genesis boot", async () => {
    const { taskEventStore } = await import("../taskEventStore");
    const legacy = [makeTask("a")];
    const boot = await taskEventStore.initialize(legacy);
    expect(boot.source).toBe("genesis");
    expect(boot.tasks).toEqual(legacy);
    expect(await taskEventStore.readAll()).toHaveLength(1);
  });

  it("rejects appends after entering degraded mode", async () => {
    vi.resetModules();
    const { taskEventStore } = await import("../taskEventStore");
    const original = indexedDB.open;
    indexedDB.open = () => {
      const req = {
        onerror: null as (() => void) | null,
        result: null,
        error: new Error("IndexedDB unavailable"),
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.call(req, new Event("error")));
      return req;
    };
    const boot = await taskEventStore.initialize([makeTask("a")]);
    indexedDB.open = original;
    expect(boot.source).toBe("legacy-fallback");
    expect(taskEventStore.isDegraded()).toBe(true);
    await expect(
      taskEventStore.append([
        draftEvent({
          streamId: "a",
          type: "task.updated",
          payload: { task: serializeTask(makeTask("a", { title: "Nope" })) },
          actor: "user",
        }),
      ]),
    ).rejects.toThrow(/degraded/i);
  });

  it("folds mutation events into a projection (rollback replay contract)", () => {
    const events = [
      draftEvent({
        streamId: "a",
        type: "task.created",
        payload: { task: serializeTask(makeTask("a")) },
        actor: "user",
      }),
      draftEvent({
        streamId: "a",
        type: "task.updated",
        payload: { task: serializeTask(makeTask("a", { title: "Renamed" })) },
        actor: "user",
      }),
    ];
    const projected = replayTaskEvents(
      events.map((e, i) => ({ ...e, seq: i + 1, v: 1 as const })),
      [],
    );
    expect(projected).toHaveLength(1);
    expect(projected[0].title).toBe("Renamed");
  });

  it("projectionDeltaFromEvents extracts upserts and deletes", async () => {
    const { projectionDeltaFromEvents } = await import("../taskEventStore");
    const created = makeTask("a");
    const delta = projectionDeltaFromEvents([
      {
        streamId: "a",
        type: "task.created",
        payload: { task: serializeTask(created) },
        actor: "user",
      },
      {
        streamId: "b",
        type: "task.deleted",
        payload: { changed: ["*"] },
        actor: "user",
      },
    ]);
    expect(delta.upsertTasks).toHaveLength(1);
    expect(delta.upsertTasks[0].id).toBe("a");
    expect(delta.deleteTaskIds).toEqual(["b"]);
  });

  it("repairs snapshot drift at boot by re-importing missing tasks", async () => {
    vi.resetModules();
    const { taskEventStore } = await import("../taskEventStore");
    const legacy = [makeTask("a"), makeTask("b")];
    await taskEventStore.initialize([makeTask("a")]);
    const boot = await taskEventStore.initialize(legacy);
    expect(boot.source).toBe("events");
    expect(boot.tasks.map((t) => t.id).sort()).toEqual(["a", "b"]);
    const events = await taskEventStore.readAll();
    expect(events.some((e) => e.type === "task.imported" && e.streamId === "b")).toBe(true);
  });

  it("diffProjection detects ids only present in snapshot", () => {
    const drift = diffProjection([makeTask("a")], [makeTask("a"), makeTask("b")]);
    expect(drift.onlyInSnapshot).toEqual(["b"]);
    expect(drift.onlyInLog).toEqual([]);
  });
});
