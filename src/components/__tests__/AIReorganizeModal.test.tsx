import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider } from "../../contexts/ConfirmationContext";
import { aiService } from "../../services/aiService";
import { AIReorganizeModal } from "../AIReorganizeModal";

vi.mock("../../services/aiService", () => ({
  aiService: {
    clusterTasks: vi.fn(),
  },
}));

vi.mock("../../services/storageService", () => ({
  __esModule: true,
  default: {
    get: vi.fn().mockReturnValue([]),
  },
}));

const renderWithConfirmation = (ui: ReactElement) =>
  render(<ConfirmationProvider>{ui}</ConfirmationProvider>);

describe("AIReorganizeModal", () => {
  const mockAddToast = vi.fn();
  const mockOnCreateProject = vi.fn();
  const mockOnMoveTask = vi.fn();
  const mockTasks = [
    { id: "1", title: "Fix login", tags: [], summary: "S1" },
    { id: "2", title: "Fix signup", tags: [], summary: "S2" },
  ] as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows task titles and drops unknown ids from clusters", async () => {
    vi.mocked(aiService.clusterTasks).mockResolvedValue([
      {
        id: "c1",
        taskIds: ["1", "2", "ghost"],
        theme: "Auth fixes",
        suggestedTags: [],
        confidence: 0.9,
      },
    ]);

    await act(async () => {
      renderWithConfirmation(
        <AIReorganizeModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onCreateProject={mockOnCreateProject}
          onMoveTask={mockOnMoveTask}
          addToast={mockAddToast}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Fix login")).toBeInTheDocument();
      expect(screen.getByText("Fix signup")).toBeInTheDocument();
      expect(screen.queryByText(/ghost/i)).not.toBeInTheDocument();
    });
  });

  it("requires confirmation before applying reorganization", async () => {
    vi.mocked(aiService.clusterTasks).mockResolvedValue([
      {
        id: "c1",
        taskIds: ["1", "2"],
        theme: "Auth fixes",
        suggestedTags: [],
        confidence: 0.9,
      },
    ]);

    await act(async () => {
      renderWithConfirmation(
        <AIReorganizeModal
          isOpen={true}
          onClose={vi.fn()}
          allTasks={mockTasks}
          onCreateProject={mockOnCreateProject}
          onMoveTask={mockOnMoveTask}
          addToast={mockAddToast}
        />,
      );
    });

    await waitFor(() => screen.getByText("Approve"));
    await act(async () => {
      fireEvent.click(screen.getByText("Approve"));
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Apply Reorganization"));
    });

    expect(mockOnCreateProject).not.toHaveBeenCalled();

    const confirmBtn = await screen.findByRole("button", { name: "Reorganize" });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => expect(mockOnCreateProject).toHaveBeenCalled());
    expect(mockOnMoveTask).toHaveBeenCalledWith("1", expect.any(String));
    expect(mockOnMoveTask).toHaveBeenCalledWith("2", expect.any(String));
  });
});
