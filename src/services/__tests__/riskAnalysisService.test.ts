import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIContext, Task } from "../../types";
import { aiService } from "../aiService";
import { riskAnalysisService } from "../riskAnalysisService";

vi.mock("../aiService", () => ({
  aiService: {
    analyzeTasks: vi.fn(),
  },
}));

describe("RiskAnalysisService", () => {
  const mockTasks: Task[] = [
    {
      id: "t1",
      title: "Task 1",
      status: "Todo",
      priority: "high",
      timeEstimate: 120,
      links: [],
    },
    {
      id: "t2",
      title: "Task 2",
      status: "Todo",
      priority: "medium",
      timeEstimate: 60,
      links: [{ targetTaskId: "t1", type: "blocked-by" }],
    },
    {
      id: "t3",
      title: "Task 3",
      status: "Todo",
      priority: "low",
      timeEstimate: 30,
      links: [{ targetTaskId: "t2", type: "blocked-by" }],
    },
  ] as any[];

  const mockContext: AIContext = {
    activeProjectId: "p1",
    projects: [],
    priorities: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates critical path correctly (longest dependency chain)", async () => {
    vi.mocked(aiService.analyzeTasks).mockResolvedValue([]);

    const summary = await riskAnalysisService.analyzeProjectRisks(mockTasks, mockContext);

    // t3 depends on t2, t2 depends on t1. Path: t1 -> t2 -> t3
    expect(summary.criticalPath).toContain("t1");
    expect(summary.criticalPath).toContain("t2");
    expect(summary.criticalPath).toContain("t3");
    expect(summary.criticalPath.length).toBe(3);
  });

  it("detects overdue tasks as high risk", async () => {
    const overdueTask: Task = {
      id: "overdue",
      title: "Overdue Task",
      status: "Todo",
      dueDate: new Date(Date.now() - 86400000), // Yesterday
      links: [],
      priority: "medium",
      timeEstimate: 60,
    } as any;

    vi.mocked(aiService.analyzeTasks).mockResolvedValue([]);

    const summary = await riskAnalysisService.analyzeProjectRisks([overdueTask], mockContext);
    const risk = summary.risks.find((r) => r.taskId === "overdue");

    expect(risk).toBeDefined();
    expect(risk?.level).toBe("high");
    expect(risk?.reason).toContain("overdue");
  });

  it("incorporates AI insights when available", async () => {
    const aiRisk = {
      taskId: "t1",
      score: 0.9,
      level: "high",
      reason: "AI identified complex architectural risk",
      mitigationSuggestion: "Break into smaller tasks",
    };

    vi.mocked(aiService.analyzeTasks).mockResolvedValue([aiRisk]);

    const summary = await riskAnalysisService.analyzeProjectRisks(mockTasks, mockContext);

    expect(summary.risks).toContainEqual(aiRisk);
    expect(vi.mocked(aiService.analyzeTasks)).toHaveBeenCalled();
  });

  it("falls back to heuristics if AI fails", async () => {
    vi.mocked(aiService.analyzeTasks).mockRejectedValue(new Error("AI Offline"));

    // Add a high-priority, large-estimate task to guarantee heuristic score > 0
    const riskyTask: Task = {
      id: "risky",
      title: "Risky Task",
      status: "Todo",
      priority: "high",
      timeEstimate: 1000, // Large
      links: [],
    } as any;

    const summary = await riskAnalysisService.analyzeProjectRisks([riskyTask], mockContext);

    expect(summary.overallScore).toBeGreaterThan(0);
    expect(summary.risks.length).toBeGreaterThan(0);
    expect(summary.predictionMessage).toContain("Heuristic");
  });
});
