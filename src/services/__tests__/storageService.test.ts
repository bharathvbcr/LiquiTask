import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants";
import { storageService } from "../storageService";

describe("StorageService", () => {
  beforeEach(() => {
    localStorage.clear();
    // Clear private cache via cast
    (storageService as any).cache.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should get default value if key not found", () => {
    const val = storageService.get("missing", "default");
    expect(val).toBe("default");
  });

  it("should set and get values from localStorage", () => {
    storageService.set("test-key", { foo: "bar" });
    expect(localStorage.getItem("test-key")).toBe(JSON.stringify({ foo: "bar" }));

    const val = storageService.get("test-key", null);
    expect(val).toEqual({ foo: "bar" });
  });

  it("should use cache for subsequent gets", () => {
    storageService.set("key", "val");
    localStorage.setItem("key", JSON.stringify("wrong"));

    const val = storageService.get("key", null);
    expect(val).toBe("val"); // Should come from cache, not localStorage
  });

  it("should parse tasks correctly with dates", () => {
    const rawTasks = [
      {
        id: "1",
        jobId: "J1",
        projectId: "p1",
        title: "T1",
        status: "Todo",
        createdAt: "2026-04-01T10:00:00Z",
        updatedAt: "2026-04-02T10:00:00Z",
        dueDate: "2026-04-03T10:00:00Z",
        subtasks: [],
        attachments: [],
        customFieldValues: {},
        links: [],
        tags: [],
      },
    ];
    localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(rawTasks));

    const tasks = storageService.get(STORAGE_KEYS.TASKS, []);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].createdAt).toBeInstanceOf(Date);
    expect(tasks[0].updatedAt).toBeInstanceOf(Date);
    expect(tasks[0].dueDate).toBeInstanceOf(Date);
  });

  it("should remove items from storage and cache", () => {
    storageService.set("key", "val");
    storageService.remove("key");
    expect(storageService.get("key", null)).toBeNull();
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("should clear all items", () => {
    storageService.set("key1", "val1");
    storageService.set("key2", "val2");
    storageService.clear();
    expect(storageService.get("key1", null)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("should export data as JSON string", () => {
    storageService.set(STORAGE_KEYS.ACTIVE_PROJECT, "p1");
    const exported = storageService.exportData();
    const parsed = JSON.parse(exported);
    expect(parsed.activeProjectId).toBe("p1");
    expect(parsed.version).toBeDefined();
  });

  it("should import valid data string", () => {
    const data = {
      columns: [],
      projectTypes: [],
      priorities: [],
      customFields: [],
      projects: [],
      tasks: [],
      activeProjectId: "imported",
      sidebarCollapsed: true,
      grouping: "none",
      version: "2.0.0",
    };
    const result = storageService.importData(JSON.stringify(data));
    expect(result.data?.activeProjectId).toBe("imported");
    expect(result.error).toBeUndefined();
  });

  it("should return error for invalid import string", () => {
    // Mock console.error to avoid noise in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = storageService.importData("invalid-json");
    expect(result.data).toBeNull();
    expect(result.error).toBeDefined();
  });
});
