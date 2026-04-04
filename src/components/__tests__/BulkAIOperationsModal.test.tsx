import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkAIOperationsModal } from "../BulkAIOperationsModal";
import { aiService } from "../../services/aiService";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    categorizeTasks: vi.fn().mockResolvedValue([]),
    suggestPriorities: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/storageService", () => ({
  default: {
    get: vi.fn().mockReturnValue({}),
  },
}));

describe("BulkAIOperationsModal", () => {
  const mockAddToast = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockTasks = [
    { id: "1", title: "Task 1", tags: [], priority: "medium" },
    { id: "2", title: "Task 2", tags: [], priority: "low" },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly", async () => {
    await act(async () => {
      render(
        <BulkAIOperationsModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          addToast={mockAddToast}
        />
      );
    });

    expect(screen.getByText("Bulk AI Operations")).toBeInTheDocument();
    // These might be broken into multiple elements, use findByText with more flexible matching
    expect(await screen.findByText(/Auto-Tagging/i)).toBeInTheDocument();
    expect(await screen.findByText(/Suggest Priorities/i)).toBeInTheDocument();
  });

  it("handles auto-tagging process", async () => {
    vi.mocked(aiService.categorizeTasks).mockResolvedValue([
      { taskId: "1", suggestedValue: ["ai", "work"], confidence: 0.9, reasoning: "R" } as any
    ]);

    await act(async () => {
      render(
        <BulkAIOperationsModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          addToast={mockAddToast}
        />
      );
    });

    const tagBtn = await screen.findByText(/Auto-Tagging/i);
    const tagCard = tagBtn.closest("button");
    if (tagCard) fireEvent.click(tagCard);
    
    const analyzeBtn = screen.getByText("Analyze Tasks");
    await act(async () => {
      fireEvent.click(analyzeBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("AI Recommendations")).toBeInTheDocument();
      expect(screen.getByText("ai, work")).toBeInTheDocument();
    });

    const applyBtn = screen.getByText("Apply Selected Changes");
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    expect(mockOnUpdateTask).toHaveBeenCalled();
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("applied"), "success");
  });
});
