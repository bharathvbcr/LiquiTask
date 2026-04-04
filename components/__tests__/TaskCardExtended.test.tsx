import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { TaskCard } from "../TaskCard";

describe("TaskCard Extended", () => {
  const mockTask: Task = {
    id: "task-1",
    jobId: "JOB-1",
    title: "Test Task",
    subtitle: "Sub",
    summary: "Summary",
    status: "Pending",
    priority: "high",
    projectId: "p1",
    createdAt: new Date(),
    subtasks: [
      { id: "s1", title: "Subtask 1", completed: false },
      { id: "s2", title: "Subtask 2", completed: true },
    ],
    tags: ["tag1"],
    attachments: [],
    customFieldValues: { "Field 1": "Value 1" },
    timeEstimate: 60,
    timeSpent: 0,
  } as Task;

  const defaultProps = {
    task: mockTask,
    onMoveTask: vi.fn(),
    onEditTask: vi.fn(),
    onUpdateTask: vi.fn(),
    onDeleteTask: vi.fn(),
    priorities: [{ id: "high", label: "High", color: "red", level: 1 }],
    projects: [{ id: "p1", name: "Project 1", type: "custom" }],
  };

  it("renders correctly in expanded mode", () => {
    render(<TaskCard {...defaultProps} />);
    expect(screen.getByText("Test Task")).toBeDefined();
    expect(screen.getByText("Sub")).toBeDefined();
    expect(screen.getByText("Value 1")).toBeDefined();
  });

  it("renders correctly in compact mode", () => {
    render(<TaskCard {...defaultProps} isCompact={true} />);
    expect(screen.getByText("Test Task")).toBeDefined();
    // Subtitle should be hidden in compact
    expect(screen.queryByText("Sub")).toBeNull();
  });

  it("handles subtask toggling", () => {
    render(<TaskCard {...defaultProps} />);
    // Expand subtasks first
    const progressText = screen.getByText(/1\/2/);
    fireEvent.click(progressText);

    const subtask1Check = screen.getByLabelText("Toggle subtask Subtask 1");
    fireEvent.click(subtask1Check);
    
    expect(defaultProps.onUpdateTask).toHaveBeenCalled();
  });

  it("handles context menu trigger", () => {
    render(<TaskCard {...defaultProps} />);
    const card = screen.getByText("Test Task").closest(".liquid-card");
    if (card) fireEvent.contextMenu(card);
    
    expect(screen.getByText("Copy as JSON")).toBeDefined();
    expect(screen.getByText("Save as Template")).toBeDefined();
  });

  it("handles 'Mark Verified & Close' button", () => {
    render(<TaskCard {...defaultProps} isCompletedColumn={true} />);
    const verifyBtn = screen.getByText("Mark Verified & Close");
    fireEvent.click(verifyBtn);
    expect(defaultProps.onMoveTask).toHaveBeenCalledWith("task-1", "Delivered");
  });

  it("shows blocked status when task has blocked-by links", () => {
    const blockedTask = {
      ...mockTask,
      links: [{ id: "l1", type: "blocked-by", targetTaskId: "task-2" }]
    } as any;
    const allTasks = [
      blockedTask,
      { id: "task-2", jobId: "JOB-2", status: "Pending", title: "Blocker" }
    ] as any;

    render(<TaskCard {...defaultProps} task={blockedTask} allTasks={allTasks} />);
    expect(screen.getByText("Blocked")).toBeDefined();
  });
});
