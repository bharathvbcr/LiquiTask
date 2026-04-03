import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useState } from "react";
import type { BoardColumn, Task } from "../../types";

interface ActiveDrag {
  type: "task" | "column";
  id: string;
  data: Task | BoardColumn;
}

interface DropTarget {
  status: string;
  priority?: string;
  order?: number;
}

interface UseBoardDnDControllerProps {
  columns: BoardColumn[];
  tasks: Task[];
  boardGrouping: "none" | "priority";
  onUpdateColumns: (cols: BoardColumn[]) => void;
  onMoveTask: (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => void;
  canMoveTask?: (
    taskId: string,
    newStatus: string,
    newPriority?: string,
  ) => { allowed: boolean; reason?: string };
  getTasksByContext: (statusId: string, priorityId?: string) => Task[];
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

export const useBoardDnDController = ({
  columns,
  tasks,
  boardGrouping,
  onUpdateColumns,
  onMoveTask,
  canMoveTask,
  getTasksByContext,
  showToast,
}: UseBoardDnDControllerProps) => {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [highlightedZone, setHighlightedZone] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const calculateInsertOrder = useCallback(
    (targetTask: Task, tasksInContext: Task[], draggedTaskId: string): number => {
      const targetIndex = tasksInContext.findIndex((t) => t.id === targetTask.id);
      if (targetIndex === -1) return (targetTask.order ?? 0) + 1;

      const targetOrder = targetTask.order ?? targetIndex;
      const prevTask = tasksInContext[targetIndex - 1];

      if (!prevTask || prevTask.id === draggedTaskId) return targetOrder - 0.5;
      const prevOrder = prevTask.order ?? targetIndex - 1;
      return (prevOrder + targetOrder) / 2;
    },
    [],
  );

  const resolveDropTarget = useCallback(
    (overId: string, draggedTask: Task): DropTarget | null => {
      if (boardGrouping === "priority" && overId.includes("::")) {
        const [priorityId, statusId] = overId.split("::");
        if (columns.some((c) => c.id === statusId))
          return { status: statusId, priority: priorityId };
      }

      const columnMatch = columns.find((c) => c.id === overId || `drop-${c.id}` === overId);
      if (columnMatch) return { status: columnMatch.id };

      const overTask = tasks.find((t) => t.id === overId);
      if (overTask) {
        const tasksInContext =
          boardGrouping === "priority"
            ? getTasksByContext(overTask.status, overTask.priority)
            : getTasksByContext(overTask.status);

        return {
          status: overTask.status,
          priority: boardGrouping === "priority" ? overTask.priority : undefined,
          order: calculateInsertOrder(overTask, tasksInContext, draggedTask.id),
        };
      }
      return null;
    },
    [boardGrouping, columns, tasks, getTasksByContext, calculateInsertOrder],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const { active } = event;
      const id = String(active.id);
      const data = active.data.current;

      if (data?.type === "task" && data.task) {
        setActiveDrag({ type: "task", id, data: data.task });
      } else if (data?.type === "column" && data.column) {
        setActiveDrag({ type: "column", id, data: data.column });
      } else {
        const task = tasks.find((t) => t.id === id);
        if (task) {
          setActiveDrag({ type: "task", id, data: task });
          return;
        }
        const column = columns.find((c) => c.id === id);
        if (column) setActiveDrag({ type: "column", id, data: column });
      }
    },
    [tasks, columns],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setHighlightedZone(event.over ? String(event.over.id) : null);
  }, []);

  const handleColumnReorder = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;
      const oldIndex = columns.findIndex((c) => c.id === activeId);
      const newIndex = columns.findIndex((c) => c.id === overId);
      if (oldIndex !== -1 && newIndex !== -1)
        onUpdateColumns(arrayMove(columns, oldIndex, newIndex));
    },
    [columns, onUpdateColumns],
  );

  const handleTaskDrop = useCallback(
    (task: Task, overId: string) => {
      const dropTarget = resolveDropTarget(overId, task);
      if (!dropTarget) {
        showToast("Could not determine drop target", "error");
        return;
      }

      const { status, priority, order } = dropTarget;
      const targetColumn = columns.find((c) => c.id === status);
      if (!targetColumn) {
        showToast("Invalid column", "error");
        return;
      }

      const moveValidation = canMoveTask
        ? canMoveTask(task.id, status, priority)
        : { allowed: true };
      if (!moveValidation.allowed) {
        showToast(moveValidation.reason || "Cannot move task", "error");
        return;
      }

      if (
        status !== task.status ||
        (priority !== undefined && priority !== task.priority) ||
        order !== undefined
      ) {
        onMoveTask(task.id, status, priority, order);
      }
    },
    [columns, resolveDropTarget, canMoveTask, onMoveTask, showToast],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { over } = event;
      if (!activeDrag || !over) {
        setActiveDrag(null);
        setHighlightedZone(null);
        return;
      }

      const overId = String(over.id);
      if (activeDrag.type === "column") {
        handleColumnReorder(activeDrag.id, overId);
      } else if (activeDrag.type === "task") {
        handleTaskDrop(activeDrag.data as Task, overId);
      }

      setActiveDrag(null);
      setHighlightedZone(null);
    },
    [activeDrag, handleColumnReorder, handleTaskDrop],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setHighlightedZone(null);
  }, []);

  return {
    activeDrag,
    highlightedZone,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
};
