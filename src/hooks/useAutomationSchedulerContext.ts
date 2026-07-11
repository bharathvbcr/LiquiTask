import type { MutableRefObject } from "react";
import { useEffect } from "react";
import type { BoardColumn, Task, ToastType } from "../../types";
import type { AutomationRule } from "../services/automationService";

type AutomationSchedulerServiceLike = {
  configureSchedulerContext: (context: {
    getAllTasks: () => Task[];
    applyTaskUpdates: (taskId: string, updates: Partial<Task>) => void;
    notify?: (message: string) => void;
    getColumns?: () => BoardColumn[];
    onRulesPersist?: (rules: AutomationRule[]) => void;
  }) => void;
  clearSchedulerContext: () => void;
};

interface UseAutomationSchedulerContextProps<S extends AutomationSchedulerServiceLike> {
  isLoaded: boolean;
  automationServiceRef: MutableRefObject<S | null>;
  tasksRef: MutableRefObject<Task[]>;
  columnsRef: MutableRefObject<BoardColumn[]>;
  applyTaskUpdates: (
    taskId: string,
    updates: Partial<Task>,
    options?: { actor?: "user" | "automation" | "agent" | "system" },
  ) => void;
  addToast: (message: string, type?: ToastType) => void;
  onRulesPersist?: (rules: AutomationRule[]) => void;
}

/**
 * Feeds the automation scheduler its live board context (tasks, columns, update
 * + notify callbacks) once data is loaded, and tears it down on unmount.
 * Extracted from App.tsx as a behavior-neutral wiring block.
 */
export function useAutomationSchedulerContext<S extends AutomationSchedulerServiceLike>({
  isLoaded,
  automationServiceRef,
  tasksRef,
  columnsRef,
  applyTaskUpdates,
  addToast,
  onRulesPersist,
}: UseAutomationSchedulerContextProps<S>) {
  useEffect(() => {
    if (!isLoaded) return;
    const service = automationServiceRef.current;
    if (!service) return;

    service.configureSchedulerContext({
      getAllTasks: () => tasksRef.current,
      applyTaskUpdates: (taskId, updates) => {
        applyTaskUpdates(taskId, updates, { actor: "automation" });
      },
      notify: (message) => addToast(message, "info"),
      getColumns: () => columnsRef.current,
      onRulesPersist,
    });

    return () => {
      service.clearSchedulerContext();
    };
  }, [isLoaded, addToast, applyTaskUpdates, automationServiceRef, tasksRef, columnsRef, onRulesPersist]);
}
