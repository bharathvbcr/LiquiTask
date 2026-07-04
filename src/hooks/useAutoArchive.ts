import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { BoardColumn, Task, ToastType } from "../../types";
import {
  archiveService,
  buildArchiveConfig,
  loadArchiveSettings,
} from "../services/archiveService";
import { indexedDBService } from "../services/indexedDBService";

type SearchIndexServiceLike = {
  removeTask?: (task: Task) => void;
};

interface UseAutoArchiveProps {
  isLoaded: boolean;
  tasks: Task[];
  columns: BoardColumn[];
  setTasks: Dispatch<SetStateAction<Task[]>>;
  searchIndexServiceRef: MutableRefObject<SearchIndexServiceLike | null>;
  addToast: (message: string, type?: ToastType) => void;
}

const AUTO_ARCHIVE_CHECK_MS = 60 * 60 * 1000;

export function useAutoArchive({
  isLoaded,
  tasks,
  columns,
  setTasks,
  searchIndexServiceRef,
  addToast,
}: UseAutoArchiveProps) {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const applyArchivedTasks = useCallback(
    (currentTasks: Task[], remaining: Task[]) => {
      const remainingIds = new Set(remaining.map((task) => task.id));
      const archivedTasks = currentTasks.filter((task) => !remainingIds.has(task.id));
      if (archivedTasks.length === 0) return 0;

      setTasks(remaining);
      for (const task of archivedTasks) {
        searchIndexServiceRef.current?.removeTask?.(task);
        if (indexedDBService.isAvailable()) {
          indexedDBService.deleteTask(task.id).catch(console.error);
        }
      }
      return archivedTasks.length;
    },
    [setTasks, searchIndexServiceRef],
  );

  const runAutoArchive = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      const settings = loadArchiveSettings();
      if (!settings.enabled && !options?.force) {
        if (!options?.silent) {
          addToast("Auto-archive is disabled in Settings → Data", "info");
        }
        return 0;
      }

      const currentTasks = tasksRef.current;
      const effectiveSettings = options?.force ? { ...settings, enabled: true } : settings;
      const config = buildArchiveConfig(effectiveSettings, columnsRef.current);
      const remaining = await archiveService.archiveTasks(currentTasks, config);
      const archivedCount = applyArchivedTasks(currentTasks, remaining);

      if (archivedCount === 0) {
        if (!options?.silent) {
          addToast("No completed tasks matched the auto-archive criteria", "info");
        }
        return 0;
      }

      if (!options?.silent) {
        addToast(`Auto-archived ${archivedCount} completed task(s)`, "success");
      }
      return archivedCount;
    },
    [addToast, applyArchivedTasks],
  );

  useEffect(() => {
    if (!isLoaded) return;

    const settings = loadArchiveSettings();
    if (!settings.enabled) return;

    void runAutoArchive({ silent: true }).then((count) => {
      if (count > 0) {
        addToast(`Auto-archived ${count} completed task(s) on startup`, "info");
      }
    });

    const intervalId = window.setInterval(() => {
      void runAutoArchive({ silent: true }).then((count) => {
        if (count > 0) {
          addToast(`Auto-archived ${count} completed task(s)`, "info");
        }
      });
    }, AUTO_ARCHIVE_CHECK_MS);

    return () => clearInterval(intervalId);
  }, [isLoaded, runAutoArchive, addToast]);

  return { runAutoArchive };
}
