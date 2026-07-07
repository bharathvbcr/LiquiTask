/**
 * Auto-sync DevCouncil whenever the active workspace is set.
 *
 * When a workspace folder becomes active (app boot or project switch) and
 * DevCouncil is detected in it, this hook runs the sync in the background:
 * regenerate the repo map, inject skills, mirror the evidence graph, prewarm
 * repo-map context. It is a no-op when DevCouncil's CLI isn't installed.
 *
 * If the CLI is present but the repo isn't initialized, it does NOT touch the
 * repo. Instead it surfaces a prompt (`pendingInit`); confirming hands the
 * initialization to a coding agent via a board task (see `onInitializeDevCouncil`),
 * which matches LiquiTask's "let an agent do the work" model. A manual
 * `syncNow()` forces a resync (and, when uninitialized, kicks off the agent task
 * immediately rather than prompting).
 *
 * De-duped per working dir per app session so flipping between projects doesn't
 * re-run the (heavier) map/inject work.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getDesktopApi, isTauri } from "../runtime/runtimeEnvironment";
import {
  summarizeSync,
  syncDevCouncilWorkspace,
  type DevCouncilSyncResult,
} from "../services/agents/devcouncilWorkspaceSync";
import type { Project, ToastType } from "../../types";

export interface DevCouncilInitPrompt {
  dir: string;
}

export interface UseDevCouncilWorkspaceSyncArgs {
  projects: Project[];
  activeProjectId: string;
  addToast: (message: string, type: ToastType) => void;
  /**
   * Hand DevCouncil initialization to an agent for `dir` (create a board task and
   * dispatch it). Called on prompt-confirm and on manual sync of an uninitialized
   * repo.
   */
  onInitializeDevCouncil: (dir: string) => void | Promise<void>;
  /** Master switch (default true); off disables all auto behavior. */
  enabled?: boolean;
}

export interface UseDevCouncilWorkspaceSyncResult {
  /** The resolved active workspace directory (empty when none). */
  workspaceDir: string;
  syncing: boolean;
  lastResult: DevCouncilSyncResult | null;
  /** Set when DevCouncil is detected but the repo needs initializing. */
  pendingInit: DevCouncilInitPrompt | null;
  /** Approve the init prompt — hands initialization to an agent. */
  confirmInit: () => Promise<void>;
  /** Dismiss the init prompt (won't re-prompt for this dir this session). */
  dismissInit: () => void;
  /** Force a resync of the current workspace (manual "Sync Now"). */
  syncNow: () => Promise<DevCouncilSyncResult | undefined>;
}

export function useDevCouncilWorkspaceSync({
  projects,
  activeProjectId,
  addToast,
  onInitializeDevCouncil,
  enabled = true,
}: UseDevCouncilWorkspaceSyncArgs): UseDevCouncilWorkspaceSyncResult {
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<DevCouncilSyncResult | null>(null);
  const [pendingInit, setPendingInit] = useState<DevCouncilInitPrompt | null>(null);

  // Latest callbacks without re-triggering the sync effect on every render.
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  const onInitRef = useRef(onInitializeDevCouncil);
  onInitRef.current = onInitializeDevCouncil;

  // Dirs already auto-synced / init-handled this session (de-dupe).
  const syncedDirsRef = useRef<Set<string>>(new Set());
  const initHandledRef = useRef<Set<string>>(new Set());

  // Resolve the effective workspace: the active project's first linked folder,
  // else the first authorized workspace path (mirrors AgentSettings).
  useEffect(() => {
    if (!isTauri()) {
      setWorkspaceDir("");
      return;
    }
    const projectPath = projects
      .find((p) => p.id === activeProjectId)
      ?.workspacePaths?.[0]?.trim();
    if (projectPath) {
      setWorkspaceDir(projectPath);
      return;
    }
    let cancelled = false;
    void getDesktopApi()
      ?.workspace.getPaths()
      .then((paths) => {
        if (!cancelled) setWorkspaceDir(paths?.[0]?.trim() ?? "");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projects, activeProjectId]);

  const runSync = useCallback(
    async (dir: string, force: boolean): Promise<DevCouncilSyncResult | undefined> => {
      if (!dir) return undefined;
      setSyncing(true);
      try {
        const result = await syncDevCouncilWorkspace(dir, { force });
        setLastResult(result);

        if (result.needsInit) {
          if (force) {
            // Manual sync on an uninitialized repo: act now, don't prompt.
            if (!initHandledRef.current.has(dir)) {
              initHandledRef.current.add(dir);
              await onInitRef.current?.(dir);
            }
          } else if (!initHandledRef.current.has(dir)) {
            setPendingInit({ dir });
          }
        } else if (result.ran) {
          syncedDirsRef.current.add(dir);
          if (force) addToastRef.current(summarizeSync(result), "success");
        } else if (force && !result.status.cliAvailable) {
          addToastRef.current(
            "DevCouncil CLI not found in this workspace — nothing to sync.",
            "info",
          );
        }
        return result;
      } catch (err) {
        if (force) {
          addToastRef.current(
            err instanceof Error ? err.message : "DevCouncil sync failed.",
            "error",
          );
        }
        return undefined;
      } finally {
        setSyncing(false);
      }
    },
    [],
  );

  // Auto-run on workspace change (debounced, once per dir per session).
  useEffect(() => {
    if (!enabled || !workspaceDir || !isTauri()) return;
    if (syncedDirsRef.current.has(workspaceDir)) return;
    const timer = setTimeout(() => {
      void runSync(workspaceDir, false);
    }, 600);
    return () => clearTimeout(timer);
  }, [enabled, workspaceDir, runSync]);

  const confirmInit = useCallback(async () => {
    const dir = pendingInit?.dir;
    setPendingInit(null);
    if (!dir) return;
    initHandledRef.current.add(dir);
    await onInitRef.current?.(dir);
  }, [pendingInit]);

  const dismissInit = useCallback(() => {
    if (pendingInit?.dir) initHandledRef.current.add(pendingInit.dir);
    setPendingInit(null);
  }, [pendingInit]);

  const syncNow = useCallback(() => runSync(workspaceDir, true), [runSync, workspaceDir]);

  return {
    workspaceDir,
    syncing,
    lastResult,
    pendingInit,
    confirmInit,
    dismissInit,
    syncNow,
  };
}

export default useDevCouncilWorkspaceSync;
