import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn, Project, Task } from "../../../types";

const { mockInvoke, mockIsTauri } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockIsTauri: vi.fn().mockReturnValue(true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({
  isTauri: mockIsTauri,
}));

import {
  commitSqliteTaskMutation,
  isSqliteTaskStoreActive,
  readSqliteSnapshot,
  writeSqliteSnapshot,
} from "../sqliteTaskStore";

function makeTask(id: string): Task {
  return {
    id,
    jobId: `JOB-${id}`,
    projectId: "p1",
    title: `Task ${id}`,
    summary: "",
    assignee: "user",
    priority: "medium",
    status: "Task" as Task["status"],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
  };
}

describe("sqliteTaskStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    mockIsTauri.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("is active only under Tauri with the flag on", () => {
    expect(isSqliteTaskStoreActive()).toBe(true);
    mockIsTauri.mockReturnValue(false);
    expect(isSqliteTaskStoreActive()).toBe(false);
  });

  it("preserves fractional column order for Rust f64 wire type", async () => {
    const task = makeTask("1");
    task.order = 0.5;
    await writeSqliteSnapshot({ tasks: [task] });

    const [, args] = mockInvoke.mock.calls[0];
    expect(args.tasks[0].order).toBe(0.5);
  });

  it("coerces object-shaped subtask titles before invoke", async () => {
    const task = makeTask("1");
    task.subtasks = [
      { id: "s1", title: { title: "Locate component" } as unknown as string, completed: false },
    ];
    await writeSqliteSnapshot({ tasks: [task] });

    const [, args] = mockInvoke.mock.calls[0];
    expect(typeof args.tasks[0].subtasks[0].title).toBe("string");
    expect(args.tasks[0].subtasks[0].title).toBe("Locate component");
  });

  it("only sends the changed entity list and serializes dates to strings", async () => {
    await writeSqliteSnapshot({ tasks: [makeTask("1")] });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [command, args] = mockInvoke.mock.calls[0];
    expect(command).toBe("task_store_write_snapshot");
    expect(args.projects).toBeUndefined();
    expect(args.columns).toBeUndefined();
    expect(args.tasks).toHaveLength(1);
    // Date fields must round-trip as ISO strings over the wire.
    expect(typeof args.tasks[0].createdAt).toBe("string");
  });

  it("writes projects and columns independently", async () => {
    const projects: Project[] = [{ id: "p1", name: "P1", type: "folder" }];
    const columns: BoardColumn[] = [{ id: "Task", title: "Task", color: "#000" }];
    await writeSqliteSnapshot({ projects, columns });

    const [, args] = mockInvoke.mock.calls[0];
    expect(args.tasks).toBeUndefined();
    expect(args.projects).toEqual(projects);
    expect(args.columns).toEqual(columns);
  });

  it("is a no-op when SQLite is not the active store", async () => {
    mockIsTauri.mockReturnValue(false);
    await writeSqliteSnapshot({ tasks: [makeTask("1")] });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(await readSqliteSnapshot()).toBeNull();
  });

  it("hydrates task date fields when reading back", async () => {
    mockInvoke.mockResolvedValue({
      tasks: [
        {
          id: "1",
          jobId: "JOB-1",
          projectId: "p1",
          title: "Task 1",
          summary: "",
          assignee: "user",
          priority: "medium",
          status: "Task",
          createdAt: "2026-01-01T00:00:00.000Z",
          subtasks: [],
          attachments: [],
          tags: [],
          timeEstimate: 0,
          timeSpent: 0,
        },
      ],
      projects: [{ id: "p1", name: "P1", type: "folder" }],
      columns: [{ id: "Task", title: "Task", color: "#000" }],
    });

    const snapshot = await readSqliteSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tasks[0].createdAt).toBeInstanceOf(Date);
    expect(snapshot!.projects).toHaveLength(1);
    expect(snapshot!.columns).toHaveLength(1);
  });

  it("commitSqliteTaskMutation invokes task_store_commit", async () => {
    mockInvoke.mockResolvedValue({ seqs: [1], tasksWritten: 1, tasksDeleted: 0 });
    const task = makeTask("1");
    const result = await commitSqliteTaskMutation({
      events: [
        {
          id: "evt-1",
          streamId: "1",
          eventType: "task.created",
          payload: "{}",
          actor: "user",
          ts: "2026-01-01T00:00:00.000Z",
          v: 1,
        },
      ],
      upsertTasks: [task],
      deleteTaskIds: [],
    });
    expect(mockInvoke).toHaveBeenCalledWith("task_store_commit", expect.any(Object));
    expect(result?.seqs).toEqual([1]);
  });
});
