import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIInsightsPanel } from "../AIInsightsPanel";
import { aiService } from "../../services/aiService";

// Mock aiService
vi.mock("../../services/aiService", () => ({
  aiService: {
    generateInsights: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/storageService", () => ({
  default: {
    get: vi.fn().mockReturnValue([]),
  },
}));

describe("AIInsightsPanel", () => {
  const mockTasks = [
    { id: "1", title: "Task 1" },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no insights", async () => {
    vi.mocked(aiService.generateInsights).mockResolvedValue([]);

    render(
      <AIInsightsPanel
        isOpen={true}
        onClose={vi.fn()}
        allTasks={mockTasks}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No insights available/i)).toBeInTheDocument();
    });
  });

  it("renders insights when available", async () => {
    vi.mocked(aiService.generateInsights).mockResolvedValue([
      { id: "i1", type: "pattern", title: "Insight Title", description: "Insight Desc" } as any
    ]);

    render(
      <AIInsightsPanel
        isOpen={true}
        onClose={vi.fn()}
        allTasks={mockTasks}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Insight Title")).toBeInTheDocument();
      expect(screen.getByText("Insight Desc")).toBeInTheDocument();
    });
  });
});
