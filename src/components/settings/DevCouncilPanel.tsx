import {
  CheckCircle2,
  Download,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  ShieldCheck,
  Wand2,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { isTauri } from "../../runtime/runtimeEnvironment";
import devcouncilService, {
  DEVCOUNCIL_INSTALL_COMMAND,
  type DevCouncilStatus,
} from "../../services/agents/devcouncilService";
import type { ToastType } from "../../../types";

interface DevCouncilPanelProps {
  workingDir: string;
  addToast: (message: string, type: ToastType) => void;
}

function formatAge(secs?: number): string {
  if (secs === undefined) return "";
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m old`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h old`;
  return `${Math.round(secs / 86400)}d old`;
}

/**
 * DevCouncil management card: install the CLI, `dev init` the repo, and keep
 * `.devcouncil/repo_map.json` fresh — the map is injected into every agent
 * prompt so agents navigate by subsystems instead of blind searching.
 */
export const DevCouncilPanel: React.FC<DevCouncilPanelProps> = ({ workingDir, addToast }) => {
  const [status, setStatus] = useState<DevCouncilStatus | null>(null);
  const [busy, setBusy] = useState<"install" | "init" | "map" | "bootstrap" | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri() || !workingDir) {
      setStatus(null);
      return;
    }
    setStatus(await devcouncilService.getStatus(workingDir));
    // Keep the evidence-graph mirror fresh so task cards can show provenance.
    void devcouncilService.getEvidenceGraph(workingDir);
  }, [workingDir]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 400);
    return () => clearTimeout(timer);
  }, [refresh]);

  if (!workingDir || !status) return null;

  /**
   * One-click bootstrap: auto-discover the CLI (PATH → ~/Code/DevCouncil
   * checkout), lazy-install it (uv/pipx from the checkout, npm fallback),
   * `dev init` the workspace, and generate the repo map.
   */
  const runBootstrap = async () => {
    setBusy("bootstrap");
    try {
      const result = await devcouncilService.bootstrap(workingDir, {
        autoInstall: true,
        autoInit: true,
      });
      const ready =
        result.status.cliAvailable && result.status.initialized && result.status.repoMapPresent;
      addToast(
        ready
          ? "DevCouncil is set up — plan/verify gates and repo-map context are live."
          : `DevCouncil setup incomplete: ${result.log.slice(-1)[0] ?? "see status flags"}`,
        ready ? "success" : "warning",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "DevCouncil bootstrap failed.", "error");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const runAction = async (
    kind: "install" | "init" | "map",
    action: () => Promise<{ success: boolean; output: string }>,
    successMessage: string,
  ) => {
    setBusy(kind);
    try {
      const result = await action();
      addToast(
        result.success ? successMessage : `Failed: ${result.output.slice(-300)}`,
        result.success ? "success" : "error",
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "DevCouncil action failed.", "error");
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
          <ShieldCheck size={13} className="text-purple-300" /> DevCouncil
          {status.version && <span className="text-slate-500">v{status.version}</span>}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="p-1 rounded text-slate-500 hover:text-white transition-colors"
          aria-label="Refresh DevCouncil status"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="space-y-1 text-[11px]">
        <span className={`flex items-center gap-1.5 ${status.cliAvailable ? "text-emerald-400" : "text-amber-400"}`}>
          {status.cliAvailable ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          CLI {status.cliAvailable ? "installed" : "not installed"}
          {!status.cliAvailable && (
            <code className="text-slate-500">({DEVCOUNCIL_INSTALL_COMMAND})</code>
          )}
        </span>
        <span className={`flex items-center gap-1.5 ${status.initialized ? "text-emerald-400" : "text-slate-400"}`}>
          {status.initialized ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          Project {status.initialized ? "initialized (.devcouncil)" : "not initialized"}
        </span>
        <span className={`flex items-center gap-1.5 ${status.repoMapPresent ? "text-emerald-400" : "text-slate-400"}`}>
          {status.repoMapPresent ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
          {status.repoMapPresent
            ? `Repo map: ${status.repoMapFileCount ?? "?"} files, ${status.repoMapSubsystemCount ?? "?"} subsystems (${formatAge(status.repoMapAgeSecs)}) — injected into agent prompts`
            : "No repo map — agents navigate without subsystem context"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {!(status.cliAvailable && status.initialized && status.repoMapPresent) && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void runBootstrap()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-50"
          >
            {busy === "bootstrap" ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Wand2 size={11} />
            )}
            {busy === "bootstrap"
              ? "Setting up…"
              : "Set up DevCouncil (auto: install → init → map)"}
          </button>
        )}
        {!status.cliAvailable && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction(
                "install",
                () => devcouncilService.installLocal(),
                "DevCouncil installed.",
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-medium hover:bg-purple-500/20 transition-all disabled:opacity-50"
          >
            {busy === "install" ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            {busy === "install" ? "Installing…" : "Install only (local checkout → npm)"}
          </button>
        )}
        {status.cliAvailable && !status.initialized && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction(
                "init",
                () => devcouncilService.init(workingDir),
                "DevCouncil initialized — plan/verify gates enabled.",
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[11px] font-medium hover:bg-purple-500/20 transition-all disabled:opacity-50"
          >
            {busy === "init" ? <Loader2 size={11} className="animate-spin" /> : <Wand2 size={11} />}
            {busy === "init" ? "Initializing…" : "Run dev init"}
          </button>
        )}
        {status.cliAvailable && status.initialized && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void runAction(
                "map",
                () => devcouncilService.generateRepoMap(workingDir),
                "Repo map regenerated.",
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[11px] font-medium hover:bg-sky-500/20 transition-all disabled:opacity-50"
          >
            {busy === "map" ? <Loader2 size={11} className="animate-spin" /> : <MapIcon size={11} />}
            {busy === "map"
              ? "Mapping…"
              : status.repoMapPresent
                ? "Refresh repo map"
                : "Generate repo map"}
          </button>
        )}
      </div>
    </div>
  );
};

export default DevCouncilPanel;
