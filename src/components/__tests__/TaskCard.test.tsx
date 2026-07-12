import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PriorityDefinition, Task } from "../../types";
import { TaskCard } from "../TaskCard";

vi.mock("../TimeTracker", () => ({
  default: () => null,
}));

describe("TaskCard Features", () => {
  const mockOnMoveTask = vi.fn();
  const mockOnEditTask = vi.fn();
  const mockOnUpdateTask = vi.fn();
  const mockOnDeleteTask = vi.fn();

  const mockPriorities: PriorityDefinition[] = [
    { id: "high", label: "High Priority", color: "#ff0000", level: 1 },
  ];

  const baseProps = {
    onMoveTask: mockOnMoveTask,
    onEditTask: mockOnEditTask,
    onUpdateTask: mockOnUpdateTask,
    onDeleteTask: mockOnDeleteTask,
    priorities: mockPriorities,
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
    // The subtitle is no longer shown on the card face (editable via the task modal).
    // Priority is a read-only badge showing the resolved priority label.
    expect(screen.getByText("High Priority")).toBeInTheDocument();
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

  it("calls onEditTask when the title is double-clicked", () => {
    render(<TaskCard {...baseProps} task={mockTask} />);

    fireEvent.doubleClick(screen.getByText("Test Task"));
    expect(mockOnEditTask).toHaveBeenCalled();
  });
});
