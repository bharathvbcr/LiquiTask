import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../types";
import { Dashboard } from "../Dashboard";

// Mock sub-components with correct relative paths
vi.mock("../../src/components/CalendarView", () => ({
  CalendarView: () => <div data-testid="calendar-view">Calendar View</div>,
}));
vi.mock("../../src/components/ProjectBoard", () => ({
  default: () => <div data-testid="project-board">Project Board</div>,
}));
vi.mock("../../src/components/GanttView", () => ({
  default: () => <div data-testid="gantt-view">Gantt View</div>,
}));
vi.mock("../../src/components/ViewTransition", () => ({
  ViewTransition: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./TaskCard", () => ({
  TaskCard: ({ task }: { task: Task }) => <div>{task.title}</div>,
}));

describe("Dashboard", () => {
  const mockTasks: Task[] = [
    {
      id: "1",
      title: "High Task",
      priority: "high",
      status: "Todo",
      projectId: "p1",
      createdAt: new Date(),
    } as Task,
    {
      id: "2",
      title: "Soon Task",
      priority: "medium",
      status: "Todo",
      projectId: "p1",
      dueDate: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    } as Task,
    {
      id: "3",
      title: "Normal Task",
      priority: "low",
      status: "Todo",
      projectId: "p1",
      createdAt: new Date(),
    } as Task,
  ];

  const mockPriorities = [
    { id: "high", label: "High", level: 1, color: "red" },
    { id: "medium", label: "Medium", level: 2, color: "yellow" },
    { id: "low", label: "Low", level: 3, color: "blue" },
  ];

  const baseProps = {
    tasks: mockTasks,
    projects: [{ id: "p1", name: "Project 1", type: "default" as const }],
    priorities: mockPriorities,
    onEditTask: vi.fn(),
    onUpdateTask: vi.fn(),
    onDeleteTask: vi.fn(),
    onMoveTask: vi.fn(),
  };

  it("renders stats correctly", () => {
    render(<Dashboard {...baseProps} />);

    // Active Tasks (all 3 are not Delivered)
    expect(screen.getByText("3")).toBeInTheDocument();
    // High Priority (only '1' and '2' have level <= 2)
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders task lists", () => {
    render(<Dashboard {...baseProps} />);

    expect(screen.getAllByText("High Task").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Soon Task").length).toBeGreaterThan(0);
  });

  it("switches view modes", async () => {
    render(<Dashboard {...baseProps} />);

    // Default is stats - check for stats text
    expect(screen.getByText(/Active Tasks/i)).toBeInTheDocument();

    // Switch to Calendar
    fireEvent.click(screen.getByRole("button", { name: /Calendar/i }));
    expect(await screen.findByTestId("calendar-view")).toBeInTheDocument();

    // Switch to Board
    fireEvent.click(screen.getByRole("button", { name: /Board/i }));
    expect(await screen.findByTestId("project-board")).toBeInTheDocument();

    // Switch to Gantt
    fireEvent.click(screen.getByRole("button", { name: /Gantt/i }));
    expect(await screen.findByTestId("gantt-view")).toBeInTheDocument();
  });
});
