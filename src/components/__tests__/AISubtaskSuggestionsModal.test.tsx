import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISubtaskSuggestionsModal } from "../AISubtaskSuggestionsModal";
import { taskCleanupService } from "../../services/taskCleanupService";

// Mock services
vi.mock("../../services/taskCleanupService", () => ({
  taskCleanupService: {
    analyzeRedundancy: vi.fn().mockResolvedValue([]),
  },
}));

describe("AISubtaskSuggestionsModal", () => {
  const mockAddToast = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockOnArchiveTask = vi.fn();
  const mockTasks = [
    { id: "1", title: "Parent Task" },
    { id: "2", title: "Child Task" },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly and scans for subtasks", async () => {
    vi.mocked(taskCleanupService.analyzeRedundancy).mockResolvedValue([
      { 
        taskId: "2", 
        type: "subset", 
        relatedTaskId: "1", 
        confidence: 0.9, 
        reasoning: "Task 2 is a part of Task 1" 
      }
    ]);

    await act(async () => {
      render(
        <AISubtaskSuggestionsModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    expect(screen.getByText(/Convert to Subtasks/i)).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getByText(/Found 1 subtask conversion suggestion/i)).toBeInTheDocument();
      expect(screen.getByText("Task 2 is a part of Task 1")).toBeInTheDocument();
    });
  });

  it("handles subtask conversion approval and application", async () => {
    vi.mocked(taskCleanupService.analyzeRedundancy).mockResolvedValue([
      { taskId: "2", type: "subset", relatedTaskId: "1", confidence: 0.9, reasoning: "R" }
    ]);

    await act(async () => {
      render(
        <AISubtaskSuggestionsModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onUpdateTask={mockOnUpdateTask}
          onArchiveTask={mockOnArchiveTask}
          addToast={mockAddToast}
        />
      );
    });

    await waitFor(() => screen.getByText(/Found 1 subtask/i));

    const approveBtn = screen.getByText("Approve");
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    const applyBtn = screen.getByText("Convert to Subtasks");
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    expect(mockOnUpdateTask).toHaveBeenCalledWith("1", expect.any(Object));
    expect(mockOnArchiveTask).toHaveBeenCalledWith("2");
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("Successfully converted"), "success");
  });
});
