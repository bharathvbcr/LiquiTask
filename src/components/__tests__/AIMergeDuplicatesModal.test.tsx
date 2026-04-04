import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIMergeDuplicatesModal } from "../AIMergeDuplicatesModal";
import { taskCleanupService } from "../../services/taskCleanupService";

// Mock taskCleanupService
vi.mock("../../services/taskCleanupService", () => ({
  taskCleanupService: {
    detectDuplicates: vi.fn(),
    suggestMerge: vi.fn(),
    executeMerge: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(taskCleanupService.detectDuplicates).mockResolvedValue([
      { id: "g1", tasks: [mockTasks[0], mockTasks[1]], confidence: 0.9, reasons: ["Similar title"] } as any
    ]);
    vi.mocked(taskCleanupService.suggestMerge).mockResolvedValue({
      keepTaskId: "1",
      archiveTaskIds: ["2"],
      mergedFields: { title: "Merged" },
      reasoning: "R"
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

    expect(screen.getByRole('heading', { name: "Smart Merge Duplicates", level: 3 })).toBeInTheDocument();
    
    await waitFor(() => {
      expect(screen.getAllByText(/duplicate task/i).length).toBeGreaterThan(0);
      expect(screen.getByText("Similar title")).toBeInTheDocument();
    });
  });

  it("handles merge suggestion and application", async () => {
    vi.mocked(taskCleanupService.detectDuplicates).mockResolvedValue([
      { id: "g1", tasks: [mockTasks[0], mockTasks[1]], confidence: 0.9, reasons: ["R"] } as any
    ]);
    vi.mocked(taskCleanupService.suggestMerge).mockResolvedValue({
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

    await waitFor(() => expect(screen.getAllByText(/duplicate task/i).length).toBeGreaterThan(0));

    const approveBtn = screen.getByText("Approve");
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Better title")).toBeInTheDocument();
    });

    const applyBtn = screen.getByText("Apply Merges");
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    expect(mockOnUpdateTask).toHaveBeenCalled();
  });
});
