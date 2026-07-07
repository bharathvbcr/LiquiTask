import { describe, expect, it } from "vitest";

import type { Task } from "../../../../types";
import { diffProjection, replayTaskEvents } from "../taskEventReducer";
import { draftEvent, deserializeTask, serializeTask } from "../taskEvents";

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

const event = (
  type: "task.created" | "task.imported" | "task.updated" | "task.moved" | "task.deleted",
  task: Task | null,
  streamId?: string,
) =>
  draftEvent({
    streamId: streamId ?? task?.id ?? "board",
    type,
    payload: task ? { task: serializeTask(task) } : {},
    actor: "user",
  });

describe("taskEventReducer", () => {
  it("replays created → updated → moved into final state", () => {
    const t1 = makeTask("a");
    const events = [
      event("task.created", t1),
      event("task.updated", { ...t1, title: "Renamed" }),
      event("task.moved", { ...t1, title: "Renamed", status: "InProgress" }),
    ];
    const tasks = replayTaskEvents(events);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Renamed");
    expect(tasks[0].status).toBe("InProgress");
  });

  it("removes deleted tasks from the projection", () => {
    const t1 = makeTask("a");
    const t2 = makeTask("b");
    const events = [
      event("task.created", t1),
      event("task.created", t2),
      event("task.deleted", null, "a"),
    ];
    const tasks = replayTaskEvents(events);
    expect(tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("replays on top of a snapshot base (imported tasks win over base)", () => {
    const base = [makeTask("a", { title: "Old" })];
    const events = [event("task.imported", makeTask("a", { title: "New" }))];
    const tasks = replayTaskEvents(events, base);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("New");
  });

  it("round-trips Date fields through serialization", () => {
    const original = makeTask("a", {
      dueDate: new Date("2026-07-10T00:00:00.000Z"),
      completedAt: new Date("2026-07-05T12:30:00.000Z"),
      activity: [
        {
          id: "act-1",
          type: "create",
          timestamp: new Date("2026-07-01T10:00:00.000Z"),
          userId: "user",
          details: "created",
        },
      ],
    });
    const revived = deserializeTask(serializeTask(original));
    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived.dueDate?.toISOString()).toBe("2026-07-10T00:00:00.000Z");
    expect(revived.completedAt?.toISOString()).toBe("2026-07-05T12:30:00.000Z");
    expect(revived.activity?.[0].timestamp).toBeInstanceOf(Date);
  });

  it("ignores audit-only events in the projection", () => {
    const t1 = makeTask("a");
    const tasks = replayTaskEvents([
      event("task.created", t1),
      draftEvent({
        streamId: "a",
        type: "run.started",
        payload: { agentId: "agent-1" },
        actor: "system",
      }),
      draftEvent({
        streamId: "a",
        type: "worktree.merged",
        payload: { branch: "agent/x" },
        actor: "user",
      }),
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("Task");
  });

  it("diffProjection reports drift between log and snapshot", () => {
    const drift = diffProjection([makeTask("a"), makeTask("b")], [makeTask("b"), makeTask("c")]);
    expect(drift.onlyInLog).toEqual(["a"]);
    expect(drift.onlyInSnapshot).toEqual(["c"]);
  });
});
