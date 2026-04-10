import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortableColumn } from "../SortableColumn";

// Mock sub-components
vi.mock("../SortableTask", () => ({
  SortableTask: ({ task }: any) => <div data-testid="task">{task.title}</div>,
}));

describe("SortableColumn", () => {
  const mockTasks = [
    { id: "1", title: "T1", status: "Todo", priority: "high", subtasks: [], tags: [] },
    { id: "2", title: "T2", status: "Todo", priority: "low", subtasks: [], tags: [] },
  ] as any;

  const mockColumn = { id: "Todo", title: "Todo", color: "blue", wipLimit: 5 };

  it("renders tasks and title", () => {
    render(
      <DndContext>
        <SortableColumn
          column={mockColumn}
          tasks={mockTasks}
          onEditTask={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveTask={vi.fn()}
          priorities={[]}
          projects={[]}
        />
      </DndContext>,
    );

    expect(screen.getByText("Todo")).toBeDefined();
    expect(screen.getAllByTestId("task")).toHaveLength(2);
    expect(screen.getByText(/2 \/ 5/)).toBeDefined(); // WIP limit display
  });

  it("shows limit warning when WIP limit exceeded", () => {
    const limitedCol = { ...mockColumn, wipLimit: 1 };
    render(
      <DndContext>
        <SortableColumn
          column={limitedCol}
          tasks={mockTasks}
          onEditTask={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveTask={vi.fn()}
          priorities={[]}
          projects={[]}
        />
      </DndContext>,
    );
    // Check for red text or warning class
    const wipBadge = screen.getByText(/2 \/ 1/);
    expect(wipBadge.className).toContain("text-red-400");
  });
});
