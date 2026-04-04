import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIHealthDashboard } from "../AIHealthDashboard";
import { aiService } from "../../services/aiService";
import { aiSummaryService } from "../../services/aiSummaryService";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    generateInsights: vi.fn(),
  },
}));

vi.mock("../../services/aiSummaryService", () => ({
  aiSummaryService: {
    generateDailyReport: vi.fn().mockResolvedValue({}),
    generateWeeklyReport: vi.fn().mockResolvedValue({}),
    downloadReport: vi.fn(),
  },
}));

vi.mock("../../services/storageService", () => ({
  __esModule: true,
  default: {
    get: vi.fn().mockReturnValue([]),
  },
}));

describe("AIHealthDashboard", () => {
  const mockAddToast = vi.fn();
  const mockTasks = [
    { id: "1", title: "Task 1", status: "Todo", priority: "high", createdAt: new Date() },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state initially", async () => {
    // Create a pending promise
    let resolveInsights: any;
    const pendingPromise = new Promise((resolve) => {
      resolveInsights = resolve;
    });
    vi.mocked(aiService.generateInsights).mockReturnValue(pendingPromise as any);

    render(
      <AIHealthDashboard
        isOpen={true}
        onClose={vi.fn()}
        allTasks={mockTasks}
        projects={[]}
        addToast={mockAddToast}
      />
    );
    
    expect(screen.getByText(/AI is analyzing/i)).toBeInTheDocument();
    
    // Resolve to avoid memory leaks/cleanup issues
    await act(async () => {
      resolveInsights([]);
    });
  });

  it("renders metrics and insights after loading", async () => {
    vi.mocked(aiService.generateInsights).mockResolvedValue([
      { id: "i1", type: "productivity", title: "Good job", description: "You are fast" } as any
    ]);

    await act(async () => {
      render(
        <AIHealthDashboard
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          projects={[]}
          addToast={mockAddToast}
        />
      );
    });

    await waitFor(() => expect(screen.queryByText(/AI is analyzing/i)).not.toBeInTheDocument());

    expect(screen.getByText("AI Task Health Overview")).toBeInTheDocument();
    expect(screen.getByText("Good job")).toBeInTheDocument();
    expect(screen.getByText("Completion Rate")).toBeInTheDocument();
  });

  it("handles daily report export", async () => {
    vi.mocked(aiService.generateInsights).mockResolvedValue([]);

    await act(async () => {
      render(
        <AIHealthDashboard
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          projects={[]}
          addToast={mockAddToast}
        />
      );
    });

    await waitFor(() => expect(screen.queryByText(/AI is analyzing/i)).not.toBeInTheDocument());

    const dailyBtn = screen.getByText("Daily Report");
    await act(async () => {
      fireEvent.click(dailyBtn);
    });

    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Generating daily report"), "info");
    await waitFor(() => {
      expect(aiSummaryService.generateDailyReport).toHaveBeenCalled();
      expect(aiSummaryService.downloadReport).toHaveBeenCalled();
    });
  });
});
