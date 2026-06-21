import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { type ArchiveConfig, ArchiveService } from "../archiveService";
import storageService from "../storageService";

vi.mock("../storageService", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

describe("ArchiveService", () => {
  let service: ArchiveService;

  const mockTasks: Task[] = [
    {
      id: "1",
      title: "Task 1",
      status: "Completed",
      completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      jobId: "T1",
      tags: [],
      createdAt: new Date(),
    } as Task,
    {
      id: "2",
      title: "Task 2",
      status: "Todo",
      jobId: "T2",
      tags: [],
      createdAt: new Date(),
    } as Task,
    {
      id: "3",
      title: "Task 3",
      status: "Completed",
      completedAt: new Date(),
      jobId: "T3",
      tags: [],
      createdAt: new Date(),
    } as Task,
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ArchiveService();
  });

  it("should initialize and load archived tasks", async () => {
    vi.mocked(storageService.get).mockReturnValue([mockTasks[0]]);
    await service.initialize();
    expect(await service.getAllArchived()).toHaveLength(1);
    expect(storageService.get).toHaveBeenCalledWith("liquitask-archived-tasks", []);
  });

  it("should archive completed tasks older than the configured grace period", async () => {
    const config: ArchiveConfig = {
      autoArchiveAfterDays: 5,
      archiveCompleted: true,
      archiveStorage: "localStorage",
    };

    // Only Task 1 is completed AND older than 5 days. Task 3 is completed but
    // recent (within the grace period); Task 2 is not completed.
    const activeTasks = await service.archiveTasks(mockTasks, config);
    expect(activeTasks).toHaveLength(2); // Task 2 and Task 3 remain
    expect(activeTasks.map((t) => t.id).sort()).toEqual(["2", "3"]);
    expect(await service.getAllArchived()).toHaveLength(1); // Task 1 archived
  });

  it("should not archive anything when archiveCompleted is disabled", async () => {
    const config: ArchiveConfig = {
      autoArchiveAfterDays: 5,
      archiveCompleted: false,
      archiveStorage: "localStorage",
    };

    const activeTasks = await service.archiveTasks(mockTasks, config);
    expect(activeTasks).toHaveLength(3); // Nothing archived
    expect(await service.getAllArchived()).toHaveLength(0);
  });

  it("should search archived tasks", async () => {
    vi.mocked(storageService.get).mockReturnValue(mockTasks);
    await service.initialize();

    const results = await service.searchArchive("Task 1");
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });

  it("should unarchive tasks", async () => {
    vi.mocked(storageService.get).mockReturnValue(mockTasks);
    await service.initialize();

    const toUnarchive = await service.unarchive(["1", "2"]);
    expect(toUnarchive).toHaveLength(2);
    expect(await service.getAllArchived()).toHaveLength(1);
    expect(storageService.set).toHaveBeenCalled();
  });

  it("should permanently delete archived tasks", async () => {
    vi.mocked(storageService.get).mockReturnValue(mockTasks);
    await service.initialize();

    await service.deleteArchived(["1"]);
    expect(await service.getAllArchived()).toHaveLength(2);
    expect(storageService.set).toHaveBeenCalled();
  });

  it("should get archive stats", async () => {
    vi.mocked(storageService.get).mockReturnValue([mockTasks[0], mockTasks[2]]);
    await service.initialize();

    const stats = service.getArchiveStats();
    expect(stats.total).toBe(2);
    expect(stats.oldestDate).not.toBeNull();
    expect(stats.newestDate).not.toBeNull();
  });
});
