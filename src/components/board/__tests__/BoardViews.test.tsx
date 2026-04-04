import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StandardBoardView from "../StandardBoardView";
import PriorityBoardView from "../PriorityBoardView";
import type { BoardColumn, PriorityDefinition, Task } from "../../../../types";

// Mock sub-components
vi.mock("../SortableColumn", () => ({
  SortableColumn: ({ title, column }: any) => <div data-testid="column">{title || column?.title}</div>,
}));

vi.mock("../SortableTask", () => ({
  SortableTask: ({ task }: any) => <div data-testid="task">{task.title}</div>,
}));

vi.mock("../DroppableCell", () => ({
  DroppableCell: ({ children }: any) => <div data-testid="drop-cell">{children}</div>,
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

  const commonProps = {
    sensors: [],
    collisionDetection: vi.fn(),
    measuringConfig: { droppable: { strategy: 0, frequency: 0 } } as any,
    dropAnimation: null as any,
    boardRef: { current: null },
    highlightedZone: null,
    focusedColumnIndex: 0,
    focusedTaskId: null,
    activeTask: null,
    activeColumn: null,
    isCompact: false,
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDragEnd: vi.fn(),
    onDragCancel: vi.fn(),
    onMoveTask: vi.fn(),
    onEditTask: vi.fn(),
    onUpdateTask: vi.fn(),
    onDeleteTask: vi.fn(),
    getTasksByContext: vi.fn((s, p) => mockTasks.filter(t => t.status === s && (!p || t.priority === p))),
    allTasks: mockTasks,
  };

  describe("StandardBoardView", () => {
    it("renders all columns", () => {
      render(
        <StandardBoardView
          {...commonProps}
          columnIds={["Todo", "Done"]}
          columns={mockColumns}
          tasks={mockTasks}
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
    it("renders tasks by priority", () => {
      render(
        <PriorityBoardView
          {...commonProps}
          columns={mockColumns}
          priorities={mockPriorities}
          tasks={mockTasks}
          projects={[]}
        />
      );
      // PriorityBoardView maps over priorities.
      expect(screen.getByText("High")).toBeDefined();
      expect(screen.getByText("Low")).toBeDefined();
      // Should find tasks
      expect(screen.getAllByTestId("task")).toHaveLength(2);
    });
  });
});
