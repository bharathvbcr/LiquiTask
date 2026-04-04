import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortableTask } from "../SortableTask";
import { DndContext } from "@dnd-kit/core";

// Mock TaskCard with correct relative path from THIS test file
vi.mock("../../../../components/TaskCard", () => ({
  TaskCard: ({ task }: any) => <div data-testid="task-card">{task.title}</div>,
  default: ({ task }: any) => <div data-testid="task-card">{task.title}</div>,
}));

describe("SortableTask", () => {
  const mockTask = { 
    id: "1", 
    title: "T1", 
    status: "Todo",
    priority: "high",
    subtasks: [],
    tags: [],
    attachments: [],
    links: [],
  } as any;

  const mockPriorities = [
    { id: "high", label: "High", color: "red", level: 1 }
  ];

  it("renders TaskCard", () => {
    render(
      <DndContext>
        <SortableTask
          task={mockTask}
          onEditTask={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveTask={vi.fn()}
          priorities={mockPriorities}
          projects={[]}
          allTasks={[]}
        />
      </DndContext>
    );

    expect(screen.getByTestId("task-card")).toBeDefined();
    expect(screen.getByText("T1")).toBeDefined();
  });
});
