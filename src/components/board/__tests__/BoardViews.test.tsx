import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StandardBoardView } from "../StandardBoardView";
import { PriorityBoardView } from "../PriorityBoardView";
import type { BoardColumn, PriorityDefinition, Task } from "../../../../types";

// Mock sub-components
vi.mock("../SortableColumn", () => ({
  SortableColumn: ({ title, column }: any) => <div data-testid="column">{title || column?.title}</div>,
}));

describe("Board Views", () => {
  const mockTasks: Task[] = [
    { id: "1", title: "T1", status: "Todo", priority: "high", subtasks: [], tags: [] },
    { id: "2", title: "T2", status: "Done", priority: "low", subtasks: [], tags: [] },
  ] as any;

  const mockColumns: BoardColumn[] = [
    { id: "Todo", title: "Todo", color: "blue", wipLimit: 0 },
    { id: "Done", title: "Done", color: "green", wipLimit: 0 },
  ];

  const mockPriorities: PriorityDefinition[] = [
    { id: "high", label: "High", color: "red", level: 1 },
    { id: "low", label: "Low", color: "blue", level: 3 },
  ];

  describe("StandardBoardView", () => {
    it("renders all columns", () => {
      render(
        <StandardBoardView
          columns={mockColumns}
          tasks={mockTasks}
          onEditTask={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveTask={vi.fn()}
          onUpdateColumns={vi.fn()}
          priorities={mockPriorities}
          projects={[]}
        />
      );
      expect(screen.getAllByTestId("column")).toHaveLength(2);
      expect(screen.getByText("Todo")).toBeDefined();
      expect(screen.getByText("Done")).toBeDefined();
    });
  });

  describe("PriorityBoardView", () => {
    it("renders columns based on priorities", () => {
      render(
        <PriorityBoardView
          priorities={mockPriorities}
          tasks={mockTasks}
          onEditTask={vi.fn()}
          onUpdateTask={vi.fn()}
          onDeleteTask={vi.fn()}
          onMoveTask={vi.fn()}
          projects={[]}
        />
      );
      expect(screen.getAllByTestId("column")).toHaveLength(3); // 2 priorities + 1 unprioritized
      expect(screen.getByText("High")).toBeDefined();
      expect(screen.getByText("Low")).toBeDefined();
      expect(screen.getByText("Unprioritized")).toBeDefined();
    });
  });
});
