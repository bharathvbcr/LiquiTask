import type { MutableRefObject } from "react";
import { useEffect } from "react";
import type { Task, ToastType } from "../../types";
import { isTauri } from "../runtime/runtimeEnvironment";
import agentRunService from "../services/agents/agentRunService";

interface UseAgentTeammateWiringProps {
  assignToAgentRef: MutableRefObject<((taskId: string, agentId: string) => void) | null>;
  tasksRef: MutableRefObject<Task[]>;
  assignTaskToAgent: (task: Task, agentId: string) => void | Promise<void>;
  cancelAgentRun: (runId: string) => void | Promise<void>;
  addToast: (message: string, type?: ToastType) => void;
}

/**
 * Agent-teammate wiring extracted from App.tsx (behavior-neutral):
 * - bridges the task controller's `assignToAgentRef` to the teammate
 *   `assignTaskToAgent` handler, resolving the live task by id;
 * - wires desktop tray events (`tray-cancel-all`, `tray-view-runs`) to the
 *   agent-run lifecycle.
 */
export function useAgentTeammateWiring({
  assignToAgentRef,
  tasksRef,
  assignTaskToAgent,
  cancelAgentRun,
  addToast,
}: UseAgentTeammateWiringProps) {
  useEffect(() => {
    assignToAgentRef.current = (taskId, agentId) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (task) void assignTaskToAgent(task, agentId);
    };
  }, [assignTaskToAgent, assignToAgentRef, tasksRef]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      const cancelAllUnsub = await listen("tray-cancel-all", () => {
        for (const run of agentRunService.getRuns()) {
          if (run.status === "queued" || run.status === "running" || run.status === "verifying") {
            void cancelAgentRun(run.id);
          }
        }
      });
      if (cancelled) {
        cancelAllUnsub();
        return;
      }
      unsubs.push(cancelAllUnsub);

      const viewRunsUnsub = await listen("tray-view-runs", () => {
        addToast("Agent runs dock is at the bottom-right", "info");
      });
      if (cancelled) {
        viewRunsUnsub();
        return;
      }
      unsubs.push(viewRunsUnsub);
    })();

    return () => {
      cancelled = true;
      unsubs.forEach((u) => {
        u();
      });
    };
  }, [cancelAgentRun, addToast]);
}
