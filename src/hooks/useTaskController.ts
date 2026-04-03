import type { MutableRefObject } from "react";
import { useCallback, useRef, useState } from "react";
import type {
  ActivityItem,
  ActivityType,
  BoardColumn,
  PriorityDefinition,
  Project,
  Task,
  ToastType,
} from "../../types";
import { COLUMN_STATUS } from "../constants";
import type { AutomationTrigger, TaskContext } from "../services/automationService";
import { indexedDBService } from "../services/indexedDBService";
import type { RecurringTaskService } from "../services/recurringTaskService";
import type { SearchIndexService } from "../services/searchIndexService";

interface UndoAction {
  type: "task-create" | "task-update" | "task-delete" | "task-move";
  task?: Task;
  previousState?: Task;
  taskId?: string;
}

type ActivityServiceLike = {
  createActivity: (
    type: ActivityType,
    details: string,
    field?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ) => ActivityItem;
  logChange: (task: Task, changes: Partial<Task>, activityType?: ActivityType) => Task;
};

type AutomationServiceLike = {
  processTaskEvent: (
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: { onNotify?: (message: string) => void },
  ) => Partial<Task> | null;
};

interface TaskControllerProps {
  initialTasks: Task[];
  columns: BoardColumn[];
  projects: Project[];
  priorities: PriorityDefinition[];
  activeProjectId: string;
  addToast: (message: string, type?: ToastType) => void;
  automationServiceRef: MutableRefObject<AutomationServiceLike | null>;
  activityServiceRef: MutableRefObject<ActivityServiceLike | null>;
  recurringTaskServiceRef: MutableRefObject<RecurringTaskService | null>;
  searchIndexServiceRef: MutableRefObject<SearchIndexService | null>;
}

export const useTaskController = ({
  initialTasks,
  columns,
  projects,
  priorities: _priorities,
  activeProjectId,
  addToast,
  automationServiceRef,
  activityServiceRef,
  recurringTaskServiceRef,
  searchIndexServiceRef,
}: TaskControllerProps) => {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const undoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const MAX_UNDO = 20;

  const pushUndo = useCallback((action: UndoAction) => {
    undoStack.current = [action, ...undoStack.current.slice(0, MAX_UNDO - 1)];
    setCanUndo(undoStack.current.length > 0);
  }, []);

  const handleUndo = useCallback(() => {
    const action = undoStack.current.shift();
    setCanUndo(undoStack.current.length > 0);

    if (!action) {
      addToast("Nothing to undo", "info");
      return;
    }

    switch (action.type) {
      case "task-delete":
        if (action.task) {
          setTasks((prev) => [...prev, action.task]);
          addToast(`Restored "${action.task.title}"`, "success");
        }
        break;
      case "task-update":
        if (action.previousState) {
          setTasks((prev) =>
            prev.map((t) => (t.id === action.previousState.id ? action.previousState : t)),
          );
          addToast("Change undone", "info");
        }
        break;
      case "task-create":
        if (action.taskId) {
          setTasks((prev) => prev.filter((t) => t.id !== action.taskId));
          addToast("Task creation undone", "info");
        }
        break;
      case "task-move":
        if (action.previousState) {
          setTasks((prev) =>
            prev.map((t) => (t.id === action.previousState.id ? action.previousState : t)),
          );
          addToast("Move undone", "info");
        }
        break;
    }
  }, [addToast]);

  const handleUpdateTask = useCallback(
    (updatedTask: Task) => {
      const previousTask = tasks.find((t) => t.id === updatedTask.id);
      const taskWithUpdatedTime = {
        ...updatedTask,
        updatedAt: new Date(),
      };
      if (previousTask) {
        pushUndo({
          type: "task-update",
          task: taskWithUpdatedTime,
          previousState: previousTask,
        });
      }
      setTasks((prev) => prev.map((t) => (t.id === updatedTask.id ? taskWithUpdatedTime : t)));
    },
    [tasks, pushUndo],
  );

  const handleUpdateTaskDueDate = useCallback(
    (taskId: string, newDate: Date) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        addToast("Task not found", "error");
        return;
      }

      const normalizedDate = new Date(newDate);
      normalizedDate.setHours(0, 0, 0, 0);

      const currentDueDate = task.dueDate ? new Date(task.dueDate) : null;
      if (currentDueDate) {
        currentDueDate.setHours(0, 0, 0, 0);
        if (currentDueDate.getTime() === normalizedDate.getTime()) {
          return;
        }
      }

      const previousTask = { ...task };
      const updates: Partial<Task> = {
        dueDate: normalizedDate,
        updatedAt: new Date(),
      };

      const updatedTask = activityServiceRef.current?.logChange(task, updates) || {
        ...task,
        ...updates,
      };

      pushUndo({
        type: "task-update",
        task: updatedTask,
        previousState: previousTask,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));

      const dateStr = normalizedDate.toLocaleDateString();
      addToast(`Due date updated to ${dateStr}`, "success");
    },
    [tasks, addToast, pushUndo, activityServiceRef],
  );

  const handleMoveTaskToWorkspace = useCallback(
    (taskId: string, projectId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const targetProject = projects.find((p) => p.id === projectId);
      if (!targetProject) return;

      if (task.projectId === projectId) {
        addToast("Task is already in this workspace", "info");
        return;
      }

      const previousTask = { ...task };
      const updatedTask = {
        ...task,
        projectId,
        updatedAt: new Date(),
      };

      pushUndo({
        type: "task-update",
        task: updatedTask,
        previousState: previousTask,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
      addToast(`Task moved to "${targetProject.name}"`, "success");
    },
    [tasks, projects, addToast, pushUndo],
  );

  const handleCreateOrUpdateTask = useCallback(
    (taskData: Partial<Task>, editingTask: Task | null) => {
      if (editingTask) {
        const previousTask = tasks.find((t) => t.id === editingTask.id);
        const updates = { ...taskData, updatedAt: new Date() };
        let updatedTask = activityServiceRef.current?.logChange(editingTask, updates) || {
          ...editingTask,
          ...updates,
        };

        const automationUpdates = automationServiceRef.current?.processTaskEvent(
          "onUpdate",
          {
            previousTask,
            newTask: updatedTask,
            changedFields: Object.keys(updates),
          },
          tasks,
        );
        if (automationUpdates) {
          updatedTask = { ...updatedTask, ...automationUpdates };
        }

        if (previousTask) {
          pushUndo({
            type: "task-update",
            task: updatedTask,
            previousState: previousTask,
          });
        }
        setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? updatedTask : t)));
        searchIndexServiceRef.current?.updateTask(updatedTask, previousTask);

        const recurringService = recurringTaskServiceRef.current;
        if (
          updatedTask.recurring?.enabled &&
          recurringService &&
          !updatedTask.recurring.nextOccurrence
        ) {
          const nextOccurrence = recurringService.calculateNextOccurrence(updatedTask.recurring);
          setTasks((prev) =>
            prev.map((t) =>
              t.id === updatedTask.id ? { ...t, recurring: { ...t.recurring, nextOccurrence } } : t,
            ),
          );
        }

        addToast("Task updated successfully", "success");
        return;
      }

      const now = new Date();
      const newTask: Task = {
        ...(taskData as Task),
        id: `task-${Date.now()}`,
        jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
        projectId: activeProjectId,
        title: taskData.title || "Untitled",
        status: taskData.status || columns[0]?.id || "Pending",
        createdAt: now,
        updatedAt: now,
        subtasks: taskData.subtasks || [],
        attachments: taskData.attachments || [],
        customFieldValues: taskData.customFieldValues || {},
        links: taskData.links || [],
        tags: taskData.tags || [],
        timeEstimate: taskData.timeEstimate || 0,
        timeSpent: taskData.timeSpent || 0,
        errorLogs: taskData.errorLogs || [],
        activity: activityServiceRef.current
          ? [activityServiceRef.current.createActivity("create", "Task created")]
          : [],
        recurring: taskData.recurring,
      };

      const recurringService = recurringTaskServiceRef.current;
      if (newTask.recurring?.enabled && recurringService && !newTask.recurring.nextOccurrence) {
        newTask.recurring.nextOccurrence = recurringService.calculateNextOccurrence(
          newTask.recurring,
        );
      }

      const automationUpdates = automationServiceRef.current?.processTaskEvent(
        "onCreate",
        { newTask },
        tasks,
      );
      if (automationUpdates) {
        Object.assign(newTask, automationUpdates);
      }

      pushUndo({ type: "task-create", taskId: newTask.id });
      setTasks((prev) => [...prev, newTask]);
      searchIndexServiceRef.current?.updateTask(newTask);

      if (indexedDBService.isAvailable()) {
        indexedDBService.saveTask(newTask).catch(console.error);
      }

      addToast("Task created successfully (Ctrl+Z to undo)", "success");
    },
    [
      tasks,
      activeProjectId,
      columns,
      pushUndo,
      addToast,
      automationServiceRef,
      activityServiceRef,
      recurringTaskServiceRef,
      searchIndexServiceRef,
    ],
  );

  const handleBulkCreateTasks = useCallback(
    (newTasksData: Partial<Task>[]) => {
      const now = new Date();
      const createdTasks = newTasksData.map(
        (taskData, idx) =>
          ({
            ...taskData,
            id: `task-${Date.now()}-${idx}`,
            jobId: `IMP-${Math.floor(Math.random() * 9000) + 1000}`,
            projectId: activeProjectId,
            title: taskData.title || "Untitled",
            subtitle: taskData.subtitle || "",
            summary: taskData.summary || "",
            assignee: taskData.assignee || "",
            priority: taskData.priority || "medium",
            status: columns[0]?.id || "Pending",
            createdAt: now,
            updatedAt: now,
            subtasks: taskData.subtasks || [],
            attachments: [],
            customFieldValues: {},
            links: [],
            tags: taskData.tags || [],
            timeEstimate: taskData.timeEstimate || 0,
            timeSpent: 0,
            errorLogs: taskData.errorLogs || [],
          }) as Task,
      );

      setTasks((prev) => [...prev, ...createdTasks]);

      if (indexedDBService.isAvailable()) {
        indexedDBService.saveTasks(createdTasks).catch(console.error);
      }
    },
    [activeProjectId, columns],
  );

  const handleDeleteTaskInternal = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      pushUndo({ type: "task-delete", task });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      searchIndexServiceRef.current?.removeTask(task);
      addToast("Task deleted (Ctrl+Z to undo)", "info");
    },
    [tasks, pushUndo, addToast, searchIndexServiceRef],
  );

  const moveTask = useCallback(
    (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        addToast("Task not found", "error");
        return;
      }

      const targetColumn = columns.find((c) => c.id === newStatus);
      if (!targetColumn) {
        addToast("Invalid column", "error");
        return;
      }

      if (newStatus !== columns[0].id) {
        const blockedLinks = task.links?.filter((l) => l.type === "blocked-by") || [];
        for (const link of blockedLinks) {
          const blocker = tasks.find((t) => t.id === link.targetTaskId);
          if (blocker) {
            const blockerCol = columns.find((c) => c.id === blocker.status);
            if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.DELIVERED) {
              addToast(`Cannot start: Blocked by task ${blocker.jobId}`, "error");
              return;
            }
          }
        }
      }

      if (newStatus !== task.status && targetColumn.wipLimit && targetColumn.wipLimit > 0) {
        const tasksInColumn = tasks.filter((t) => t.status === newStatus && t.id !== taskId);
        if (tasksInColumn.length >= targetColumn.wipLimit) {
          addToast(`Column "${targetColumn.title}" has reached its WIP limit`, "error");
          return;
        }
      }

      const previousTask = { ...task };

      let finalOrder = newOrder;
      if (finalOrder === undefined) {
        if (newStatus === task.status) {
          finalOrder = task.order;
        } else {
          const tasksInNewColumn = tasks.filter((t) => t.status === newStatus && t.id !== taskId);
          const maxOrder = tasksInNewColumn.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
          finalOrder = maxOrder + 1;
        }
      }

      const updates: Partial<Task> = {
        status: newStatus,
        priority: newPriority ?? task.priority,
        order: finalOrder,
        updatedAt: new Date(),
      };

      const activity: ActivityItem[] = [];
      if (newStatus !== task.status && activityServiceRef.current) {
        activity.push(
          activityServiceRef.current.createActivity(
            "move",
            `Moved to ${columns.find((c) => c.id === newStatus)?.title}`,
            "status",
            task.status,
            newStatus,
          ),
        );
      }
      if (newPriority && newPriority !== task.priority && activityServiceRef.current) {
        activity.push(
          activityServiceRef.current.createActivity(
            "update",
            `Priority changed to ${newPriority}`,
            "priority",
            task.priority,
            newPriority,
          ),
        );
      }

      let updatedTask = {
        ...task,
        ...updates,
        activity: [...(task.activity || []), ...activity],
      };

      const automationUpdates = automationServiceRef.current?.processTaskEvent(
        "onMove",
        { previousTask, newTask: updatedTask },
        tasks,
      );
      if (automationUpdates) {
        updatedTask = { ...updatedTask, ...automationUpdates };
      }

      const recurringService = recurringTaskServiceRef.current;
      if (targetColumn.isCompleted && updatedTask.recurring?.enabled && recurringService) {
        recurringService.updateNextOccurrence(updatedTask);

        const completeUpdates = automationServiceRef.current?.processTaskEvent(
          "onComplete",
          { previousTask, newTask: updatedTask },
          tasks,
        );
        if (completeUpdates) {
          updatedTask = { ...updatedTask, ...completeUpdates };
        }
      }

      pushUndo({
        type: "task-move",
        task: updatedTask,
        previousState: previousTask,
      });
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
      searchIndexServiceRef.current?.updateTask(updatedTask, previousTask);

      if (indexedDBService.isAvailable()) {
        indexedDBService.saveTask(updatedTask).catch(console.error);
      }
    },
    [
      tasks,
      columns,
      addToast,
      pushUndo,
      automationServiceRef,
      activityServiceRef,
      recurringTaskServiceRef,
      searchIndexServiceRef,
    ],
  );

  const canMoveTask = useCallback(
    (taskId: string, newStatus: string, _newPriority?: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return { allowed: false, reason: "Task not found" };

      const targetColumn = columns.find((c) => c.id === newStatus);
      if (!targetColumn) return { allowed: false, reason: "Invalid column" };

      if (newStatus !== columns[0].id) {
        const blockedLinks = task.links?.filter((l) => l.type === "blocked-by") || [];
        for (const link of blockedLinks) {
          const blocker = tasks.find((t) => t.id === link.targetTaskId);
          if (blocker) {
            const blockerCol = columns.find((c) => c.id === blocker.status);
            if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.DELIVERED) {
              return {
                allowed: false,
                reason: `Cannot start: Blocked by task ${blocker.jobId}`,
              };
            }
          }
        }
      }

      if (newStatus !== task.status && targetColumn.wipLimit && targetColumn.wipLimit > 0) {
        const tasksInColumn = tasks.filter((t) => t.status === newStatus && t.id !== taskId);
        if (tasksInColumn.length >= targetColumn.wipLimit) {
          return {
            allowed: false,
            reason: `Column "${targetColumn.title}" has reached its WIP limit`,
          };
        }
      }

      return { allowed: true };
    },
    [tasks, columns],
  );

  return {
    tasks,
    setTasks,
    canUndo,
    canMoveTask,
    handleUndo,
    handleUpdateTask,
    handleUpdateTaskDueDate,
    handleMoveTaskToWorkspace,
    handleCreateOrUpdateTask,
    handleBulkCreateTasks,
    handleDeleteTaskInternal,
    moveTask,
    pushUndo,
  };
};
