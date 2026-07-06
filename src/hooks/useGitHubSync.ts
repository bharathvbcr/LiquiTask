import { useEffect, useRef } from "react";

import { COLUMN_STATUS } from "../constants";
import githubSyncService from "../services/githubSyncService";
import type { BoardColumn, Task } from "../../types";

/**
 * Watches task status changes and pushes updates to linked GitHub issues.
 */
export function useGitHubSync(
  tasks: Task[],
  columns: BoardColumn[],
  isLoaded: boolean,
): void {
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isLoaded) return;
    githubSyncService.load();
    if (!githubSyncService.isEnabled()) return;

    const prev = prevRef.current;
    for (const task of tasks) {
      const oldStatus = prev.get(task.id);
      if (oldStatus === undefined) {
        prev.set(task.id, task.status);
        continue;
      }
      if (oldStatus !== task.status && task.githubIssue) {
        const previous = { ...task, status: oldStatus };
        void githubSyncService
          .syncTaskStatusChange(task, previous, columns)
          .catch((err) => console.warn("[github-sync]", err));
      }
      prev.set(task.id, task.status);
    }
  }, [tasks, columns, isLoaded]);
}

export function getGitHubBacklogStatus(columns: BoardColumn[]): string {
  return columns.find((c) => c.id === COLUMN_STATUS.PENDING)?.id ?? columns[0]?.id ?? "Pending";
}
