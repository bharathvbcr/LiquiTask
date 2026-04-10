import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "../../services/aiService";
import { AIProjectAssignmentModal } from "../AIProjectAssignmentModal";

// Mock services
vi.mock("../../services/aiService", () => ({
  aiService: {
    suggestProjectReassignment: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/storageService", () => ({
  __esModule: true,
  default: {
    get: vi.fn().mockReturnValue([]),
  },
}));

describe("AIProjectAssignmentModal", () => {
  const mockAddToast = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockTasks = [{ id: "1", title: "Task 1", projectId: "p1", tags: [], summary: "S" }] as any;
  const mockProjects = [
    { id: "p1", name: "Project 1" },
    { id: "p2", name: "Project 2" },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders correctly and scans for reassignments", async () => {
    vi.mocked(aiService.suggestProjectReassignment).mockResolvedValue([
      {
        taskId: "1",
        currentProjectId: "p1",
        suggestedProjectId: "p2",
        confidence: 0.9,
        reasoning: "Belongs to P2",
      },
    ]);

    await act(async () => {
      render(
        <AIProjectAssignmentModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          projects={mockProjects}
          onUpdateTask={mockOnUpdateTask}
          addToast={mockAddToast}
        />,
      );
    });

    // Use exact name match for the modal title heading
    expect(
      screen.getByRole("heading", { name: "Smart Project Assignment", level: 3 }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Found 1 project assignment suggestion/i)).toBeInTheDocument();
      expect(screen.getByText("Belongs to P2")).toBeInTheDocument();
      expect(screen.getByText("Project 2")).toBeInTheDocument();
    });
  });

  it("handles assignment approval and application", async () => {
    vi.mocked(aiService.suggestProjectReassignment).mockResolvedValue([
      {
        taskId: "1",
        currentProjectId: "p1",
        suggestedProjectId: "p2",
        confidence: 0.9,
        reasoning: "R",
      },
    ]);

    await act(async () => {
      render(
        <AIProjectAssignmentModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          projects={mockProjects}
          onUpdateTask={mockOnUpdateTask}
          addToast={mockAddToast}
        />,
      );
    });

    await waitFor(() => screen.getByText(/Found 1 project/i));

    const approveBtn = screen.getByText("Approve");
    await act(async () => {
      fireEvent.click(approveBtn);
    });

    const applyBtn = screen.getByRole("button", { name: /Apply Assignments/i });
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    expect(mockOnUpdateTask).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ projectId: "p2" }),
    );
    expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining("reassigned"), "success");
  });
});
