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
import { useCallback, useRef, useState } from "react";
import agentDispatchService from "../services/agents/agentDispatchService";
import agentReservationService from "../services/agents/agentReservationService";
import type { BoardColumn, Task } from "../../types";
import { isDragHoveringQuickAddDropTarget, isDragOverQuickAddDropTarget } from "../utils/taskParser";

/** Where the just-dropped card landed — drives the liquid splash effect. */
export interface DropSplash {
  x: number;
  y: number;
  id: number;
}

type ActiveDrag =
  | {
      type: "task";
      id: string;
      data: Task;
    }
  | {
      type: "column";
      id: string;
      data: BoardColumn;
    };

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
  /** Called when a task card is dropped on an agent chip (`agent-drop:<id>`). */
  onAssignToAgent?: (task: Task, agentId: string) => void;
  /** Called when a task card is dropped on the New Task / quick-add target. */
  onQuickAddFromTask?: (task: Task) => void;
}

/** Droppable id prefix used by the agent handoff tray. */
export const AGENT_DROP_ID_PREFIX = "agent-drop:";
/** Sentinel suffix for the tray's Best Match chip (smart-matched dispatch). */
export const AGENT_DROP_SMART_ID = "smart";

export const useBoardDnDController = ({
  columns,
  tasks,
  boardGrouping,
  onUpdateColumns,
  onMoveTask,
  canMoveTask,
  getTasksByContext,
  showToast,
  onAssignToAgent,
  onQuickAddFromTask,
}: UseBoardDnDControllerProps) => {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const [highlightedZone, setHighlightedZone] = useState<string | null>(null);
  const [isQuickAddDropHover, setIsQuickAddDropHover] = useState(false);
  const [splash, setSplash] = useState<DropSplash | null>(null);
  const splashIdRef = useRef(0);

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
        const drag = { type: "task" as const, id, data: data.task };
        activeDragRef.current = drag;
        setActiveDrag(drag);
      } else if (data?.type === "column" && data.column) {
        const drag = { type: "column" as const, id, data: data.column };
        activeDragRef.current = drag;
        setActiveDrag(drag);
      } else {
        const task = tasks.find((t) => t.id === id);
        if (task) {
          const drag = { type: "task" as const, id, data: task };
          activeDragRef.current = drag;
          setActiveDrag(drag);
          return;
        }
        const column = columns.find((c) => c.id === id);
        if (column) {
          const drag = { type: "column" as const, id, data: column };
          activeDragRef.current = drag;
          setActiveDrag(drag);
        }
      }
    },
    [tasks, columns],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setHighlightedZone(event.over ? String(event.over.id) : null);
    if (activeDragRef.current?.type === "task") {
      setIsQuickAddDropHover(isDragHoveringQuickAddDropTarget(event));
    } else {
      setIsQuickAddDropHover(false);
    }
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
      if (
        activeDrag?.type === "task" &&
        onQuickAddFromTask &&
        isDragOverQuickAddDropTarget(event)
      ) {
        onQuickAddFromTask(activeDrag.data);
        activeDragRef.current = null;
        setActiveDrag(null);
        setHighlightedZone(null);
        setIsQuickAddDropHover(false);
        return;
      }

      const { over } = event;
      if (!activeDrag || !over) {
        activeDragRef.current = null;
        setActiveDrag(null);
        setHighlightedZone(null);
        setIsQuickAddDropHover(false);
        return;
      }

      const overId = String(over.id);
      if (activeDrag.type === "task" && overId.startsWith(AGENT_DROP_ID_PREFIX)) {
        const agentId = overId.slice(AGENT_DROP_ID_PREFIX.length);
        if (agentId === AGENT_DROP_SMART_ID) {
          // Best Match chip: smart-match picks the agent, no aiming required.
          void agentDispatchService.dispatch(activeDrag.data);
        } else if (agentId === "setup") {
          // First-run chip: no agents yet — open Settings → Agents.
          agentDispatchService.requestSetup();
        } else {
          const conflict = agentReservationService.wouldTaskConflict(activeDrag.data);
          if (conflict) {
            showToast(
              "Scope overlap with an active run — task will queue for file scope.",
              "info",
            );
          }
          onAssignToAgent?.(activeDrag.data, agentId);
        }
      } else if (activeDrag.type === "column") {
        handleColumnReorder(activeDrag.id, overId);
      } else if (activeDrag.type === "task") {
        handleTaskDrop(activeDrag.data, overId);
        // Splash where the card landed (center of its translated rect).
        const rect = event.active?.rect?.current?.translated;
        if (rect) {
          const id = splashIdRef.current + 1;
          splashIdRef.current = id;
          setSplash({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id });
          setTimeout(() => setSplash((s) => (s?.id === id ? null : s)), 650);
        }
      }

      activeDragRef.current = null;
      setActiveDrag(null);
      setHighlightedZone(null);
      setIsQuickAddDropHover(false);
    },
    [activeDrag, handleColumnReorder, handleTaskDrop, onAssignToAgent, onQuickAddFromTask],
  );

  const handleDragCancel = useCallback(() => {
    activeDragRef.current = null;
    setActiveDrag(null);
    setHighlightedZone(null);
    setIsQuickAddDropHover(false);
  }, []);

  return {
    activeDrag,
    highlightedZone,
    isQuickAddDropHover,
    splash,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
};
