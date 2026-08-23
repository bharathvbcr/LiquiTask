import { useCallback, useEffect, useState } from "react";
import type { BoardColumn, Project, Task, ToastType } from "../../types";
import sessionDiscoveryService, {
  type AdoptableSession,
} from "../services/agents/sessionDiscoveryService";
import agentRunService from "../services/agents/agentRunService";

interface UseSessionDiscoveryInboxProps {
  isLoaded: boolean;
  tasks: Task[];
  projects: Project[];
  columns: BoardColumn[];
  handleCreateTask?: (task: Task) => void;
  addToast: (message: string, type?: ToastType) => void;
}

/**
 * External session discovery inbox: scans agent session dirs, reconciles against
 * runs, and exposes adopt/dismiss actions for unmatched sessions.
 */
export function useSessionDiscoveryInbox({
  isLoaded,
  tasks,
  projects,
  columns,
  handleCreateTask,
  addToast,
}: UseSessionDiscoveryInboxProps) {
  const [adoptableSessions, setAdoptableSessions] = useState<AdoptableSession[]>([]);

  useEffect(() => sessionDiscoveryService.subscribe(setAdoptableSessions), []);

  useEffect(() => {
    if (!isLoaded) return;
    sessionDiscoveryService.startPolling();
    return () => sessionDiscoveryService.stopPolling();
  }, [isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    void sessionDiscoveryService.scan(agentRunService.getRuns(), tasks, projects);
  }, [isLoaded, tasks, projects]);

  const handleAdoptSession = useCallback(
    (sessionId: string) => {
      void sessionDiscoveryService
        .adopt(sessionId, tasks, projects, columns, {
          onCreateTask: handleCreateTask,
        })
        .then((run) => {
          if (run) addToast("External session adopted — use Follow-up to continue.", "success");
        })
        .catch((err) =>
          addToast(err instanceof Error ? err.message : "Could not adopt session.", "error"),
        );
    },
    [addToast, columns, handleCreateTask, projects, tasks],
  );

  const handleDismissSession = useCallback(
    (sessionId: string) => {
      sessionDiscoveryService.dismiss(sessionId);
      addToast("Session dismissed.", "info");
    },
    [addToast],
  );

  return {
    adoptableSessions,
    handleAdoptSession,
    handleDismissSession,
  };
}
