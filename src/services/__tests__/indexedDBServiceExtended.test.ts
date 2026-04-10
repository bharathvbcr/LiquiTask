import { beforeEach, describe, expect, it } from "vitest";
import { IndexedDBService } from "../indexedDBService";
import "fake-indexeddb/auto";

describe("IndexedDBService", () => {
  let service: IndexedDBService;

  beforeEach(async () => {
    // Fresh instance and clear database for each test
    service = new IndexedDBService();
    await service.initialize();
    await service.clearAll();
  });

  it("should initialize and be available", () => {
    expect(service.isAvailable()).toBe(true);
  });

  it("should save and retrieve a task", async () => {
    const task = {
      id: "t1",
      jobId: "J1",
      title: "Test Task",
      projectId: "p1",
      status: "Todo",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      subtasks: [],
      tags: [],
    } as any;

    await service.saveTask(task);
    const allTasks = await service.getAllTasks();

    expect(allTasks).toHaveLength(1);
    expect(allTasks[0].id).toBe("t1");
    expect(allTasks[0].createdAt).toBeInstanceOf(Date);
  });

  it("should get tasks by project", async () => {
    const tasks = [
      { id: "t1", projectId: "p1", title: "T1", jobId: "J1", status: "Todo" },
      { id: "t2", projectId: "p2", title: "T2", jobId: "J2", status: "Todo" },
    ] as any;

    await service.saveTasks(tasks);
    const p1Tasks = await service.getTasksByProject("p1");

    expect(p1Tasks).toHaveLength(1);
    expect(p1Tasks[0].id).toBe("t1");
  });

  it("should get tasks by status", async () => {
    const tasks = [
      { id: "t1", status: "Todo", title: "T1", jobId: "J1", projectId: "p1" },
      { id: "t2", status: "Done", title: "T2", jobId: "J2", projectId: "p1" },
    ] as any;

    await service.saveTasks(tasks);
    const todoTasks = await service.getTasksByStatus("Todo");

    expect(todoTasks).toHaveLength(1);
    expect(todoTasks[0].id).toBe("t1");
  });

  it("should delete a task", async () => {
    await service.saveTask({
      id: "t1",
      title: "T1",
      jobId: "J1",
      projectId: "p1",
      status: "Todo",
    } as any);
    await service.deleteTask("t1");
    const all = await service.getAllTasks();
    expect(all).toHaveLength(0);
  });

  it("should save and get projects", async () => {
    const project = { id: "p1", name: "P1", type: "custom" } as any;
    await service.saveProject(project);
    const all = await service.getAllProjects();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("p1");
  });

  it("should save and get columns", async () => {
    const columns = [{ id: "c1", title: "C1" }] as any;
    await service.saveColumns(columns);
    const all = await service.getAllColumns();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("c1");
  });

  it("should handle date deserialization for nested objects", async () => {
    const task = {
      id: "t1",
      title: "T1",
      jobId: "J1",
      projectId: "p1",
      status: "Todo",
      recurring: {
        nextOccurrence: new Date("2026-05-01T10:00:00Z"),
      },
    } as any;

    await service.saveTask(task);
    const retrieved = await service.getAllTasks();
    expect(retrieved[0].recurring.nextOccurrence).toBeInstanceOf(Date);
  });
});
