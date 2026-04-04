import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoOrganizeChange, Task } from "../../types";
import { autoOrganizeService } from "../autoOrganizeService";
import { aiService } from "../aiService";
import storageService from "../storageService";

// Mock dependencies
vi.mock("../aiService", () => ({
  aiService: {
    getAutoOrganizeConfig: vi.fn().mockReturnValue({
      enabled: true,
      autoApplyThreshold: 0.8,
      suggestThreshold: 0.6,
      maxTasksPerBatch: 100,
      excludedProjectIds: [],
      operations: {
        clustering: true,
        deduplication: true,
        autoTagging: true,
        hierarchyDetection: true,
        projectAssignment: true,
        tagConsolidation: true,
      }
    }),
    detectDuplicates: vi.fn().mockResolvedValue([]),
    clusterTasks: vi.fn().mockResolvedValue([]),
    categorizeTasks: vi.fn().mockResolvedValue([]),
    analyzeTasks: vi.fn().mockResolvedValue([]),
    saveOrganizeHistory: vi.fn(),
    saveAutoOrganizeConfig: vi.fn(),
    getOrganizeHistory: vi.fn().mockReturnValue([]),
  },
}));

vi.mock("../storageService", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

describe("AutoOrganizeService", () => {
  const mockTasks: Task[] = [
    { id: "1", title: "Task 1", summary: "S1", tags: [], priority: "medium", status: "Todo", projectId: "p1", subtasks: [] },
    { id: "2", title: "Task 2", summary: "S2", tags: [], priority: "medium", status: "Todo", projectId: "p1", subtasks: [] },
    { id: "3", title: "Task 3", summary: "S3", tags: [], priority: "medium", status: "Todo", projectId: "p1", subtasks: [] },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
    (storageService.get as any).mockImplementation((key: string) => {
      if (key.includes("projects")) return [{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }];
      if (key.includes("priorities")) return [];
      if (key.includes("tasks")) return mockTasks;
      return null;
    });
  });

  describe("runAutoOrganize", () => {
    it("should process all enabled phases", async () => {
      const onProgress = vi.fn();
      
      // Mock aiService responses for different phases
      vi.mocked(aiService.detectDuplicates).mockResolvedValue([
        { task1: mockTasks[0], task2: mockTasks[1], confidence: 0.9, reasons: ["Same"] }
      ]);
      vi.mocked(aiService.clusterTasks).mockResolvedValue([
        { id: "c1", taskIds: ["1", "2"], theme: "Theme", suggestedTags: ["tag"], confidence: 0.9 }
      ] as any);

      const result = await autoOrganizeService.runAutoOrganize(mockTasks, onProgress);

      expect(result.tasksAnalyzed).toBe(3);
      expect(result.changes.length).toBeGreaterThan(0);
      expect(onProgress).toHaveBeenCalled();
      expect(aiService.saveOrganizeHistory).toHaveBeenCalled();
    });

    it("should respect maxTasksPerBatch limit", async () => {
      vi.mocked(aiService.getAutoOrganizeConfig).mockReturnValue({
        enabled: true,
        autoApplyThreshold: 0.8,
        suggestThreshold: 0.6,
        maxTasksPerBatch: 1,
        excludedProjectIds: [],
        operations: { deduplication: true }
      } as any);

      const result = await autoOrganizeService.runAutoOrganize(mockTasks);
      expect(result.tasksAnalyzed).toBe(1);
    });
  });

  describe("applyChanges", () => {
    it("should call appropriate callbacks for each change type", async () => {
      const changes: AutoOrganizeChange[] = [
        { id: "c1", type: "tag", taskId: "1", before: {}, after: { tags: ["new"] }, confidence: 1, reasoning: "R", status: "auto-applied" },
        { id: "c2", type: "merge", taskId: "1", relatedTaskIds: ["2"], before: {}, after: { title: "Merged" }, confidence: 1, reasoning: "R", status: "auto-applied" },
        { id: "c3", type: "project-move", taskId: "3", before: {}, after: { projectId: "p2" }, confidence: 1, reasoning: "R", status: "auto-applied" },
      ];

      const callbacks = {
        onUpdateTask: vi.fn(),
        onArchiveTask: vi.fn(),
        onMoveTask: vi.fn(),
      };

      const result = await autoOrganizeService.applyChanges(changes, callbacks);

      expect(result.applied).toBe(3);
      expect(callbacks.onUpdateTask).toHaveBeenCalledWith("1", expect.objectContaining({ tags: ["new"] }));
      expect(callbacks.onArchiveTask).toHaveBeenCalledWith("2");
      expect(callbacks.onMoveTask).toHaveBeenCalledWith("3", "p2");
    });

    it("should count rejected changes", async () => {
      const changes: AutoOrganizeChange[] = [
        { id: "c1", type: "tag", taskId: "1", before: {}, after: {}, confidence: 1, reasoning: "R", status: "rejected" },
      ];
      const result = await autoOrganizeService.applyChanges(changes, { onUpdateTask: vi.fn(), onArchiveTask: vi.fn(), onMoveTask: vi.fn() });
      expect(result.rejected).toBe(1);
      expect(result.applied).toBe(0);
    });
  });
});
