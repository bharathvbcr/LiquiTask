import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIConfig, AIContext } from "../../../types";
import { aiService } from "../aiService";
import storageService from "../storageService";

// Mock storageService
vi.mock("../storageService", () => ({
  default: {
    get: vi.fn(),
    set: vi.fn(),
  },
  storageService: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

// Mock @google/generative-ai
const mockGenerateContent = vi.fn();

const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock("@google/generative-ai", () => {
  class GoogleGenerativeAI {
    getGenerativeModel = mockGetGenerativeModel;
  }

  return {
    GoogleGenerativeAI,
    SchemaType: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      ARRAY: "ARRAY",
      NUMBER: "NUMBER",
    },
  };
});

// Mock fetch for Ollama
global.fetch = vi.fn();

describe("AiService", () => {
  const mockContext: AIContext = {
    activeProjectId: "p1",
    projects: [{ id: "p1", name: "Project 1", type: "default" }],
    priorities: [
      { id: "high", label: "High", color: "red", level: 1 },
      { id: "medium", label: "Medium", color: "yellow", level: 2 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // aiService.listModels = vi.fn().mockResolvedValue([]);
  });

  describe("extractTasksFromText", () => {
    it("throws error if provider is not configured", async () => {
      (storageService.get as Mock).mockReturnValue(null);
      await expect(aiService.extractTasksFromText("test", mockContext)).rejects.toThrow(
        "AI provider is not configured",
      );
    });

    it("extracts tasks using Gemini provider", async () => {
      const config: AIConfig = {
        provider: "gemini",
        geminiApiKey: "test-key",
        geminiModel: "gemini-3.1-flash-lite",
      };
      (storageService.get as Mock).mockReturnValue(config);

      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () =>
            JSON.stringify([
              {
                title: "Test Task",
                summary: "Test Summary",
                priority: "high",
                tags: ["ai"],
                timeEstimate: 30,
              },
            ]),
        },
      });

      const tasks = await aiService.extractTasksFromText("Extract some tasks", mockContext);

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("Test Task");
      expect(tasks[0].priority).toBe("high");
    });
  });

  describe("New AI Methods", () => {
    const config: AIConfig = {
      provider: "gemini",
      geminiApiKey: "test-key",
      geminiModel: "gemini-3.1-flash-lite",
    };

    beforeEach(() => {
      (storageService.get as Mock).mockReturnValue(config);
    });

    it("refineTaskDraft refines task", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ title: "Refined", summary: "Refined desc" }),
        },
      });
      const result = await aiService.refineTaskDraft("refine", { title: "Old" }, mockContext);
      expect(result.title).toBe("Refined");
    });

    it("detectDuplicates identifies duplicates", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ confidence: 0.9, reasons: ["similar"] }),
        },
      });
      const task1 = { id: "1", title: "Task 1", tags: [], summary: "S1" } as any;
      const task2 = { id: "2", title: "Task 2", tags: [], summary: "S2" } as any;
      const results = await aiService.detectDuplicates([{ task1, task2 }], mockContext);
      expect(results[0].confidence).toBe(0.9);
    });

    it("suggestMerge suggests merge details", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ keepTaskId: "1", archiveTaskIds: ["2"], reasoning: "better", mergedFields: {} }),
        },
      });
      const group = { id: "g1", tasks: [{ id: "1", subtasks: [], tags: [] }, { id: "2", subtasks: [], tags: [] }] } as any;
      const result = await aiService.suggestMerge(group, mockContext);
      expect(result.keepTaskId).toBe("1");
    });

    it("categorizeTasks categorizes in batches", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ taskId: "1", confidence: 0.8, reasoning: "R" }]),
        },
      });
      const tasks = [{ id: "1", tags: [], title: "T", summary: "S" }] as any;
      const results = await aiService.categorizeTasks(tasks, mockContext);
      expect(results[0].taskId).toBe("1");
    });

    it("clusterTasks groups tasks", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ taskIds: ["1", "2"], theme: "work", suggestedTags: ["T"], confidence: 0.8 }]),
        },
      });
      const tasks = [{ id: "1", tags: [], title: "T1" }, { id: "2", tags: [], title: "T2" }] as any;
      const results = await aiService.clusterTasks(tasks, mockContext);
      expect(results[0].theme).toBe("work");
    });

    it("suggestPriorities suggests priority changes", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ taskId: "1", suggestedValue: "high", currentValue: "low", confidence: 0.8, reasoning: "R" }]),
        },
      });
      const tasks = [{ id: "1", priority: "low", title: "T" }] as any;
      const results = await aiService.suggestPriorities(tasks, mockContext);
      expect(results[0].suggestedValue).toBe("high");
    });

    it("suggestSchedule suggests due date", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ suggestedDueDate: "2026-04-04T00:00:00Z", conflicts: [], reasoning: "R" }),
        },
      });
      const task = { id: "1", title: "Task", summary: "S" } as any;
      const result = await aiService.suggestSchedule(task, [], mockContext);
      expect(result.suggestedDueDate).toBeDefined();
    });

    it("generateInsights generates insights from stats", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ type: "bottleneck", title: "Too many tasks", description: "D", data: {} }]),
        },
      });
      const results = await aiService.generateInsights([], mockContext);
      expect(results[0].type).toBe("bottleneck");
    });

    it("parseNaturalQuery converts text to filter", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ filterGroup: { id: "ai", rules: [] }, explanation: "Search" }),
        },
      });
      const result = await aiService.parseNaturalQuery("find high priority", mockContext);
      expect(result.explanation).toBe("Search");
    });

    it("suggestProjectReassignment suggests new project", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify([{ taskId: "1", suggestedProjectId: "p2", currentProjectId: "p1", confidence: 0.8, reasoning: "R" }]),
        },
      });
      const tasks = [{ id: "1", title: "T", tags: [], summary: "S" }] as any;
      const results = await aiService.suggestProjectReassignment(tasks, mockContext);
      expect(results[0].suggestedProjectId).toBe("p2");
    });

    it("suggestNextTask identifies critical task", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ taskId: "1", reasoning: "deadline", confidence: 0.9 }),
        },
      });
      const tasks = [{ id: "1", title: "T", summary: "S" }] as any;
      const result = await aiService.suggestNextTask(tasks, mockContext);
      expect(result?.taskId).toBe("1");
    });

    it("suggestTimeEstimate estimates duration", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ suggestedTimeEstimate: 45, reasoning: "R" }),
        },
      });
      const task = { id: "1", title: "T", summary: "S" } as any;
      const result = await aiService.suggestTimeEstimate(task, mockContext);
      expect(result).toBe(45);
    });

    it("evaluateAutomationCondition checks if rule triggers", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ shouldTrigger: true, reasoning: "R" }),
        },
      });
      const result = await aiService.evaluateAutomationCondition({ naturalLanguage: "if", conditions: "" }, mockContext);
      expect(result).toBe(true);
    });

    it("generateTemplate creates template from desc", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          text: () => JSON.stringify({ name: "Template", taskData: { title: "T" }, subtasks: [], tags: [], variables: [] }),
        },
      });
      const result = await aiService.generateTemplate("desc", mockContext);
      expect(result.name).toBe("Template");
    });
  });
});
