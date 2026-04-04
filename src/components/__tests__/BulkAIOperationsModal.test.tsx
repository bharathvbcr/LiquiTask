import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkAIOperationsModal } from "../BulkAIOperationsModal";
import { aiService } from "../../services/aiService";
import { taskCleanupService } from "../../services/taskCleanupService";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    categorizeTasks: vi.fn().mockResolvedValue({ success: 1, message: "Categorized" }),
    suggestPriorities: vi.fn().mockResolvedValue([]),
    generateInsights: vi.fn().mockResolvedValue([]),
    suggestSchedule: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../services/taskCleanupService", () => ({
  taskCleanupService: {
    detectDuplicates: vi.fn().mockResolvedValue([]),
    suggestMerge: vi.fn().mockResolvedValue({ archiveTaskIds: [] }),
    analyzeRedundancy: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/storageService", () => ({
  default: {
    get: vi.fn().mockReturnValue([]),
  },
}));

describe("BulkAIOperationsModal", () => {
  const mockAddToast = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockOnArchiveTask = vi.fn();
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
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    expect(screen.getByText("Bulk AI Operations")).toBeInTheDocument();
    expect(screen.getByText(/Auto-Categorize/i)).toBeInTheDocument();
    expect(screen.getByText(/AI Reprioritize/i)).toBeInTheDocument();
  });

  it("handles auto-categorize process", async () => {
    vi.mocked(aiService.categorizeTasks).mockResolvedValue([
      { taskId: "1", suggestedTags: ["ai"], confidence: 0.9, reasoning: "R" } as any
    ]);

    await act(async () => {
      render(
        <BulkAIOperationsModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    const tagBtn = screen.getByText(/Auto-Categorize/i).closest("button");
    if (tagBtn) {
      await act(async () => {
        fireEvent.click(tagBtn);
      });
    }

    await waitFor(() => {
      expect(aiService.categorizeTasks).toHaveBeenCalled();
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Categorized"), "success");
    });
  });
});
