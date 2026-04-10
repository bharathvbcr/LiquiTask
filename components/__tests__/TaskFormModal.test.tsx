import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { BoardColumn, PriorityDefinition, Task } from "../../types";
import { TaskFormModal } from "../TaskFormModal";

// Mock ModalWrapper since it might use portals or complex logic
vi.mock("../ModalWrapper", () => ({
  ModalWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("TaskFormModal Features", () => {
  const mockOnClose = vi.fn();
  const mockOnSubmit = vi.fn();

  const mockColumns: BoardColumn[] = [
    { id: "col1", title: "Todo", color: "#64748b" },
    { id: "col2", title: "Done", color: "#10b981", isCompleted: true },
  ];

  const mockPriorities: PriorityDefinition[] = [
    { id: "high", label: "High", color: "#ef4444", level: 1 },
    { id: "medium", label: "Medium", color: "#eab308", level: 2 },
  ];

  const baseProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSubmit: mockOnSubmit,
    projectId: "test-project",
    columns: mockColumns,
    priorities: mockPriorities,
  };

  const mockTask: Task = {
    id: "1",
    title: "Original Title",
    subtitle: "General",
    summary: "Original Summary",
    status: "Todo",
    priority: "Medium",
    columnId: "col1",
    projectId: "test-project",
    createdAt: new Date(),
    updatedAt: new Date(),
    attachments: [],
    subtasks: [{ id: "st1", title: "Subtask 1", completed: false }],
    comments: [],
    activity: [
      {
        id: "a1",
        type: "create",
        timestamp: new Date(),
        details: "Created task",
      },
    ],
  } as unknown as Task;

  it("should switch between Details and Activity tabs", () => {
    render(<TaskFormModal {...baseProps} initialData={mockTask} />);

    // Initially on Details tab
    expect(screen.getByPlaceholderText(/e\.g\., Update Q3 Financials/i)).toBeInTheDocument();

    // Switch to Activity tab
    fireEvent.click(screen.getByText(/Activity/i));
    expect(screen.getByText("Created task")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/e\.g\., Update Q3 Financials/i)).not.toBeInTheDocument();
  });

  it("should update fields and submit", () => {
    render(<TaskFormModal {...baseProps} initialData={mockTask} />);

    const titleInput = screen.getByPlaceholderText(/e\.g\., Update Q3 Financials/i);
    fireEvent.change(titleInput, { target: { value: "Updated Title" } });

    const summaryInput = screen.getByPlaceholderText(/Describe the task details/i);
    fireEvent.change(summaryInput, { target: { value: "Updated Summary" } });

    fireEvent.click(screen.getByText("Update Task"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updated Title",
        summary: "Updated Summary",
      }),
    );
  });

  it("should add a subtask within Details tab", () => {
    render(<TaskFormModal {...baseProps} initialData={mockTask} />);

    const subtaskInput = screen.getByPlaceholderText(/Add a subtask/i);
    fireEvent.change(subtaskInput, { target: { value: "New Subtask" } });
    fireEvent.keyDown(subtaskInput, { key: "Enter", code: "Enter" });

    fireEvent.click(screen.getByText("Update Task"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        subtasks: expect.arrayContaining([expect.objectContaining({ title: "New Subtask" })]),
      }),
    );
  });

  it("should add an attachment link", () => {
    render(<TaskFormModal {...baseProps} initialData={mockTask} />);

    const nameInput = screen.getByPlaceholderText(/Link Name \(Optional\)/i);
    const urlInput = screen.getByPlaceholderText(/https:\/\/.../i);

    fireEvent.change(nameInput, { target: { value: "My Link" } });
    fireEvent.change(urlInput, { target: { value: "https://google.com" } });

    fireEvent.click(screen.getByLabelText("Add link"));

    fireEvent.click(screen.getByText("Update Task"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            name: "My Link",
            url: "https://google.com/",
          }),
        ]),
      }),
    );
  });

  it("should reject unsafe attachment links", () => {
    render(<TaskFormModal {...baseProps} initialData={mockTask} />);

    const urlInput = screen.getByPlaceholderText(/https:\/\/.../i);
    fireEvent.change(urlInput, { target: { value: "javascript:alert(1)" } });

    fireEvent.click(screen.getByLabelText("Add link"));
    fireEvent.click(screen.getByText("Update Task"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [],
      }),
    );
  });

  it("should add a task link", () => {
    const availableTasks: Task[] = [{ id: "2", jobId: "LT-102", title: "Target Task" } as Task];
    render(<TaskFormModal {...baseProps} initialData={mockTask} availableTasks={availableTasks} />);

    fireEvent.change(screen.getByLabelText(/Select task to link/i), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("Add task link"));

    fireEvent.click(screen.getByText("Update Task"));

    expect(mockOnSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        links: expect.arrayContaining([
          expect.objectContaining({ targetTaskId: "2", type: "relates-to" }),
        ]),
      }),
    );
  });
});
