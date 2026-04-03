import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/types";
import { TaskCard } from "../TaskCard";

// Mock sub-components to avoid complex rendering dependencies
vi.mock("../../src/components/InlineEditable", () => ({
  InlineEditable: ({ value }: { value: string }) => <span>{value}</span>,
  InlineSelect: ({ value }: { value: string }) => <span>{value}</span>,
  InlineDatePicker: () => <span>Date</span>,
}));

describe("TaskCard Features", () => {
  const mockOnMoveTask = vi.fn();
  const mockOnEditTask = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockOnDeleteTask = vi.fn();

  const baseProps = {
    onMoveTask: mockOnMoveTask,
    onEditTask: mockOnEditTask,
    onUpdateTask: mockOnUpdateTask,
    onDeleteTask: mockOnDeleteTask,
    priorities: [{ id: "high", label: "High Priority", color: "#ff0000" }],
    allTasks: [],
  };

  const mockTask: Task = {
    id: "1",
    jobId: "T-1",
    title: "Test Task",
    subtitle: "General",
    summary: "Task summary",
    status: "Todo",
    priority: "high",
    columnId: "col1",
    projectId: "test-project",
    createdAt: new Date(),
    updatedAt: new Date(),
    attachments: [],
    subtasks: [{ id: "st-1", title: "Subtask 1", completed: false }],
    customFieldValues: {
      field1: "Custom Value",
      field2: "https://google.com",
    },
  } as unknown as Task;

  it("renders task details in non-compact mode", () => {
    render(<TaskCard {...baseProps} task={mockTask} isCompact={false} />);

    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    // Since InlineSelect is mocked to show value, it will show 'high'
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("Custom Value")).toBeInTheDocument();
    expect(screen.getByText("Link")).toHaveAttribute("href", "https://google.com/");
  });

  it("renders focused state", () => {
    const { container } = render(<TaskCard {...baseProps} task={mockTask} isFocused />);

    // Check for focused styles (ring-red-500/70)
    expect(container.firstChild).toHaveClass("ring-2");
    expect(container.firstChild).toHaveClass("ring-red-500/70");
  });

  it("does not render unsafe custom field URLs as links", () => {
    const unsafeTask: Task = {
      ...mockTask,
      customFieldValues: {
        field1: "javascript:alert(1)",
      },
    } as unknown as Task;

    render(<TaskCard {...baseProps} task={unsafeTask} isCompact={false} />);

    expect(screen.queryByRole("link", { name: "Link" })).not.toBeInTheDocument();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("calls onEditTask when edit button is clicked", () => {
    render(<TaskCard {...baseProps} task={mockTask} />);

    fireEvent.click(screen.getByTitle(/Edit task/i));
    expect(mockOnEditTask).toHaveBeenCalled();
  });
});
