import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { aiSummaryService } from "../aiSummaryService";

// Mock aiService
vi.mock("../aiService", () => ({
  aiService: {
    generateInsights: vi.fn().mockResolvedValue([]),
  },
}));

describe("AISummaryService", () => {
  const mockTasks: Task[] = [
    { id: "1", title: "T1", status: "Delivered", completedAt: new Date(), subtasks: [] },
    { id: "2", title: "T2", status: "Pending", subtasks: [] },
  ] as any;

  it("calculates basic stats", async () => {
    const report = await aiSummaryService.generateDailyReport(mockTasks);
    expect(report.overview.completedTasks).toBe(1);
    expect(report.overview.totalTasks).toBe(2);
  });

  it("identifies bottlenecks", async () => {
    const overdueTask = {
      id: "3",
      title: "Overdue",
      dueDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
      status: "Pending",
      subtasks: [],
      priority: "high",
    } as any;
    const report = await aiSummaryService.generateDailyReport([...mockTasks, overdueTask]);
    expect(report.overview.overdueTasks).toBe(1);
    expect(report.bottlenecks.oldestTask?.title).toBe("Overdue");
  });

  it("generates markdown content", async () => {
    const report = await aiSummaryService.generateDailyReport(mockTasks);
    const md = aiSummaryService.exportReportAsMarkdown(report);
    expect(md).toContain("# LiquiTask Daily AI Summary");
  });

  it("handles empty task list", async () => {
    const report = await aiSummaryService.generateDailyReport([]);
    expect(report.overview.totalTasks).toBe(0);
  });
});
