import {
  CheckCircle2,
  Code2,
  Cpu,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { localApi } from "../../core/api/localApi";
import { getDesktopApi, isTauri } from "../../runtime/runtimeEnvironment";
import agentRunService, { type IdeToolStatus } from "../../services/agents/agentRunService";
import type { ToastType } from "../../../types";

interface DevToolsSettingsProps {
  addToast: (msg: string, type: ToastType) => void;
}

/** Normalised runtime row shared by the agentd + legacy detection shapes. */
interface CliRuntime {
  id: string;
  name: string;
  version?: string;
  ready: boolean;
  path?: string;
}

/** `detectRuntimes()` returns agentd's `{ id, ready }` rows or the legacy
 * `{ name, available }` rows depending on the sidecar flag — flatten both. */
function normalizeRuntimes(list: Array<Record<string, unknown>> | undefined): CliRuntime[] {
  if (!list) return [];
  return list.map((r) => {
    if ("ready" in r) {
      return {
        id: String(r.id ?? r.name ?? ""),
        name: String(r.name ?? r.id ?? ""),
        version: r.version ? String(r.version) : undefined,
        ready: Boolean(r.ready),
        path: r.path ? String(r.path) : undefined,
      };
    }
    return {
      id: String(r.name ?? ""),
      name: String(r.name ?? ""),
      ready: Boolean(r.available),
      path: r.path ? String(r.path) : undefined,
    };
  });
}

/** Trailing two path segments — enough to identify a repo without the full path. */
function shortPath(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || p;
}

/**
 * "Installed developer tools" — surfaces every agentic CLI and IDE launcher the
 * host has on PATH, and lets the user open the selected repo in any of them.
 * Agent CLIs open in a Terminal running the tool; IDEs open the folder directly.
 */
export const DevToolsSettings: React.FC<DevToolsSettingsProps> = ({ addToast }) => {
  const [clis, setClis] = useState<CliRuntime[] | null>(null);
  const [ides, setIdes] = useState<IdeToolStatus[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [repos, setRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [launchingKey, setLaunchingKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    setChecking(true);
    try {
      const [runtimes, ideTools] = await Promise.all([
        localApi.detectRuntimes().catch(() => []),
        agentRunService.detectIdeTools().catch(() => []),
      ]);
      setClis(normalizeRuntimes(runtimes as Array<Record<string, unknown>>));
      setIdes(ideTools);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      const paths = (await getDesktopApi()?.workspace.getPaths()) ?? [];
      if (cancelled) return;
      setRepos(paths);
      setSelectedRepo((prev) => prev || paths[0] || "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addRepo = async () => {
    const api = getDesktopApi();
    const dir = await api?.workspace.selectDirectory();
    if (!dir) return;
    const paths = (await api?.workspace.getPaths()) ?? [];
    if (!paths.includes(dir)) {
      await api?.workspace.setPaths([...paths, dir]);
    }
    setRepos((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
    setSelectedRepo(dir);
  };

  const launch = async (tool: string, mode: "app" | "terminal" | "bundle", key: string) => {
    if (!selectedRepo) {
      addToast("Pick a repo to open in first.", "warning");
      return;
    }
    setLaunchingKey(key);
    try {
      await agentRunService.openInTool(tool, selectedRepo, mode);
      addToast(`Opening ${tool} in ${shortPath(selectedRepo)}…`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : `Couldn't launch ${tool}`, "error");
    } finally {
      setLaunchingKey(null);
    }
  };

  if (!isTauri()) {
    return (
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-sm text-slate-400">
        Tool detection needs the desktop app — it scans your machine's PATH.
      </div>
    );
  }

  const cliInstalled = clis?.filter((c) => c.ready).length ?? 0;
  const ideInstalled = ides?.filter((i) => i.available).length ?? 0;
  const launchDisabled = !selectedRepo;

  return (
    <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-white">Installed developer tools</h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Agent CLIs and editors found on your PATH. Open the chosen repo in any of them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors shrink-0"
        >
          {checking ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          Re-check
        </button>
      </div>

      {/* Launch target repo */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 shrink-0">Open in:</span>
        <select
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
          disabled={repos.length === 0}
          className="flex-1 min-w-0 liquid-input rounded-lg px-3 py-2 text-sm bg-black/20 disabled:opacity-50"
        >
          {repos.length === 0 ? (
            <option value="">No workspace folder added yet</option>
          ) : (
            repos.map((r) => (
              <option key={r} value={r}>
                {shortPath(r)}
              </option>
            ))
          )}
        </select>
        <button
          type="button"
          onClick={() => void addRepo()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 transition-all shrink-0"
        >
          <FolderOpen size={14} /> Browse
        </button>
      </div>

      {/* Agentic CLIs */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Cpu size={13} className="text-red-400" />
          Agentic CLIs
          <span className="text-slate-500">
            ({cliInstalled}/{clis?.length ?? 0} installed)
          </span>
        </div>
        <div className="space-y-1.5">
          {clis === null ? (
            <p className="text-xs text-slate-500">Scanning…</p>
          ) : (
            clis.map((cli) => (
              <ToolRow
                key={`cli-${cli.id}`}
                name={cli.name}
                sub={cli.version ?? cli.path ?? "on PATH"}
                available={cli.ready}
                launchLabel="Open in terminal"
                LaunchIcon={TerminalSquare}
                launching={launchingKey === `cli-${cli.id}`}
                disabled={launchDisabled}
                onLaunch={() => void launch(cli.id, "terminal", `cli-${cli.id}`)}
              />
            ))
          )}
        </div>
      </div>

      {/* IDEs / editors */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <Code2 size={13} className="text-sky-400" />
          IDEs &amp; editors
          <span className="text-slate-500">
            ({ideInstalled}/{ides?.length ?? 0} installed)
          </span>
        </div>
        <div className="space-y-1.5">
          {ides === null ? (
            <p className="text-xs text-slate-500">Scanning…</p>
          ) : (
            ides.map((ide) => (
              <ToolRow
                key={`ide-${ide.id}`}
                name={ide.name}
                sub={ide.path ?? ide.binary}
                available={ide.available}
                launchLabel="Open in repo"
                LaunchIcon={ExternalLink}
                launching={launchingKey === `ide-${ide.id}`}
                disabled={launchDisabled}
                onLaunch={() =>
                  void launch(
                    ide.launch === "bundle" ? (ide.appName ?? ide.name) : ide.binary,
                    ide.launch === "bundle" ? "bundle" : "app",
                    `ide-${ide.id}`,
                  )
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

interface ToolRowProps {
  name: string;
  sub: string;
  available: boolean;
  launchLabel: string;
  LaunchIcon: React.ComponentType<{ size?: number; className?: string }>;
  launching: boolean;
  disabled: boolean;
  onLaunch: () => void;
}

const ToolRow: React.FC<ToolRowProps> = ({
  name,
  sub,
  available,
  launchLabel,
  LaunchIcon,
  launching,
  disabled,
  onLaunch,
}) => (
  <div className="flex items-center gap-2 p-2 rounded-lg bg-black/20 border border-white/5">
    {available ? (
      <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
    ) : (
      <XCircle size={14} className="text-slate-600 shrink-0" />
    )}
    <div className="min-w-0 flex-1">
      <span className={`text-xs ${available ? "text-slate-200" : "text-slate-500"}`}>{name}</span>
      <p className="text-[10px] text-slate-500 truncate">{available ? sub : "not found"}</p>
    </div>
    {available && (
      <button
        type="button"
        onClick={onLaunch}
        disabled={disabled || launching}
        title={disabled ? "Pick a repo to open first" : launchLabel}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300 hover:bg-white/10 transition-all disabled:opacity-40 shrink-0"
      >
        {launching ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <LaunchIcon size={12} />
        )}
        {launchLabel}
      </button>
    )}
  </div>
);
