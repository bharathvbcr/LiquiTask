import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMergeDuplicatesModal } from "../AIMergeDuplicatesModal";
import { aiService } from "../../services/aiService";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    detectDuplicates: vi.fn().mockResolvedValue([]),
    suggestMerge: vi.fn().mockResolvedValue({}),
  },
}));

describe("AIMergeDuplicatesModal", () => {
  const mockAddToast = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockOnArchiveTask = vi.fn();
  const mockTasks = [
    { id: "1", title: "Task 1", summary: "S1", subtasks: [], tags: [] },
    { id: "2", title: "Task 1", summary: "S1 duplicate", subtasks: [], tags: [] },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly and scans for duplicates", async () => {
    vi.mocked(aiService.detectDuplicates).mockResolvedValue([
      { task1: mockTasks[0], task2: mockTasks[1], confidence: 0.9, reasons: ["Similar title"] }
    ]);

    await act(async () => {
      render(
        <AIMergeDuplicatesModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    expect(screen.getByText(/Smart Merge Duplicates/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Found 1 duplicate group/i)).toBeInTheDocument();
      expect(screen.getByText("Similar title")).toBeInTheDocument();
    });
  });

  it("handles merge suggestion and application", async () => {
    vi.mocked(aiService.detectDuplicates).mockResolvedValue([
      { task1: mockTasks[0], task2: mockTasks[1], confidence: 0.9, reasons: ["R"] }
    ]);
    vi.mocked(aiService.suggestMerge).mockResolvedValue({
      keepTaskId: "1",
      archiveTaskIds: ["2"],
      mergedFields: { title: "Merged Task" },
      reasoning: "Better title"
    });

    await act(async () => {
      render(
        <AIMergeDuplicatesModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    await waitFor(() => screen.getByText(/Found 1 duplicate group/i));

    const mergeBtn = screen.getByText("Review Merge");
    await act(async () => {
      fireEvent.click(mergeBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Merged Task")).toBeInTheDocument();
    });

    const confirmBtn = screen.getByText("Confirm Merge");
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mockOnUpdateTask).toHaveBeenCalled();
    expect(mockOnArchiveTask).toHaveBeenCalledWith("2");
  });
});
