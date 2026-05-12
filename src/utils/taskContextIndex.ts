import type { Task } from "../../types";

export type TaskContextIndex = Map<string, Task[]>;

const TASK_CONTEXT_SEPARATOR = "\u0000";

const getContextKey = (statusId: string, priorityId?: string) =>
  priorityId ? `${statusId}${TASK_CONTEXT_SEPARATOR}${priorityId}` : statusId;

const getTaskOrderValue = (task: Task) => {
  if (task.order !== undefined) return task.order;

  const createdAtTime =
    task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();

  return Number.isFinite(createdAtTime) ? createdAtTime : 0;
};

export const buildTaskContextIndex = (tasks: Task[]): TaskContextIndex => {
  const index: TaskContextIndex = new Map();

  const addToIndex = (key: string, task: Task) => {
    const existingTasks = index.get(key);
    if (existingTasks) {
      existingTasks.push(task);
    } else {
      index.set(key, [task]);
    }
  };

  for (const task of tasks) {
    addToIndex(getContextKey(task.status), task);
    if (task.priority) {
      addToIndex(getContextKey(task.status, task.priority), task);
    }
  }

  for (const contextTasks of index.values()) {
    contextTasks.sort((a, b) => getTaskOrderValue(a) - getTaskOrderValue(b));
  }

  return index;
};

export const getTasksFromContextIndex = (
  index: TaskContextIndex,
  statusId: string,
  priorityId?: string,
) => index.get(getContextKey(statusId, priorityId)) ?? [];
