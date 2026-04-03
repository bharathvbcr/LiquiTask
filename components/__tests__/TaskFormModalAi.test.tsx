import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "../../src/services/aiService";
import { TaskFormModal } from "../TaskFormModal";

// Mock aiService
vi.mock("../../src/services/aiService", () => ({
  aiService: {
    refineTaskDraft: vi.fn(),
    extractTasksFromText: vi.fn(),
    generateSubtasks: vi.fn(),
  },
}));

describe("TaskFormModal AI Integration", () => {
  const mockOnSubmit = vi.fn();
  const mockOnClose = vi.fn();
  const mockProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSubmit: mockOnSubmit,
    projectId: "p1",
    priorities: [{ id: "high", label: "High", color: "red", level: 1 }],
    columns: [{ id: "c1", title: "Pending", color: "gray" }],
    allProjects: [{ id: "p1", name: "Project 1", type: "default" }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders AI Action section", () => {
    render(<TaskFormModal {...mockProps} />);
    expect(screen.getByText("AI Assistant")).toBeDefined();
    expect(screen.getByPlaceholderText("Paste meeting notes or describe tasks...")).toBeDefined();
  });

  it("handles Refine Draft action", async () => {
    (aiService.refineTaskDraft as Mock).mockResolvedValue({
      title: "AI Refined Title",
      summary: "AI Refined Summary",
    });

    render(<TaskFormModal {...mockProps} />);

    const titleInput = screen.getByPlaceholderText("e.g., Update Q3 Financials");
    fireEvent.change(titleInput, { target: { value: "Old Title" } });

    const aiInput = screen.getByPlaceholderText("Paste meeting notes or describe tasks...");
    fireEvent.change(aiInput, { target: { value: "Make it better" } });

    const refineButton = screen.getByText("Refine Draft");
    fireEvent.click(refineButton);

    await waitFor(() => {
      expect(aiService.refineTaskDraft).toHaveBeenCalled();
      expect(screen.getByDisplayValue("AI Refined Title")).toBeDefined();
      expect(screen.getByDisplayValue("AI Refined Summary")).toBeDefined();
    });
  });

  it("handles Extract Tasks action", async () => {
    (aiService.extractTasksFromText as Mock).mockResolvedValue([
      { title: "Task 1", summary: "Summary 1", priority: "high", tags: [] },
      { title: "Task 2", summary: "Summary 2", priority: "high", tags: [] },
    ]);

    render(<TaskFormModal {...mockProps} />);

    const aiInput = screen.getByPlaceholderText("Paste meeting notes or describe tasks...");
    fireEvent.change(aiInput, {
      target: { value: "Notes about task 1 and task 2" },
    });

    const extractButton = screen.getByText("Extract Tasks");
    fireEvent.click(extractButton);

    await waitFor(() => {
      expect(screen.getByText("Review Extracted Tasks (2)")).toBeDefined();
      expect(screen.getByText("Task 1")).toBeDefined();
      expect(screen.getByText("Task 2")).toBeDefined();
    });

    const createButton = screen.getByText("Create All 2 Tasks");
    fireEvent.click(createButton);

    expect(mockOnSubmit).toHaveBeenCalledTimes(2);
    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
      }),
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("handles AI Breakdown for subtasks", async () => {
    (aiService.generateSubtasks as Mock).mockResolvedValue(["Subtask A", "Subtask B"]);

    render(<TaskFormModal {...mockProps} />);

    const titleInput = screen.getByPlaceholderText("e.g., Update Q3 Financials");
    fireEvent.change(titleInput, { target: { value: "Main Task" } });

    const breakdownButton = screen.getByText("AI Breakdown");
    fireEvent.click(breakdownButton);

    await waitFor(() => {
      expect(aiService.generateSubtasks).toHaveBeenCalled();
      expect(screen.getByDisplayValue("Subtask A")).toBeDefined();
      expect(screen.getByDisplayValue("Subtask B")).toBeDefined();
    });
  });

  it("handles Polish description", async () => {
    (aiService.refineTaskDraft as Mock).mockResolvedValue({
      summary: "Polished description",
    });

    render(<TaskFormModal {...mockProps} />);

    const summaryArea = screen.getByPlaceholderText(/Describe the task details/);
    fireEvent.change(summaryArea, { target: { value: "rough draft" } });

    const polishButton = screen.getByText("Polish");
    fireEvent.click(polishButton);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Polished description")).toBeDefined();
    });
  });
});
