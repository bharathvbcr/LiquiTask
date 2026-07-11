import { FileDiff, Loader2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

import { isTauri } from "../runtime/runtimeEnvironment";
import { DiffView } from "./DiffView";

export interface GitChangedFile {
  path: string;
  status: string;
  insertions: number;
  deletions: number;
}

export interface LazyDiffBrowserProps {
  workingDir: string;
  baseRef?: string | null;
  /** Legacy stat-only diff from older runs — shown when file list is unavailable. */
  fallbackDiff?: string | null;
  className?: string;
}

const STATUS_LABEL: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

export const LazyDiffBrowser: React.FC<LazyDiffBrowserProps> = ({
  workingDir,
  baseRef = null,
  fallbackDiff,
  className = "",
}) => {
  const [files, setFiles] = useState<GitChangedFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPatch, setLoadingPatch] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || !workingDir) return;
    let cancelled = false;
    setLoadingList(true);
    setListError(null);
    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke<{ files: GitChangedFile[] }>("agent_git_list_changed_files", {
          workingDir,
          baseRef,
        }),
      )
      .then((result) => {
        if (cancelled) return;
        setFiles(result.files);
        if (result.files.length > 0) {
          setSelectedPath(result.files[0].path);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setListError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workingDir, baseRef]);

  const loadPatch = useCallback(
    async (path: string) => {
      if (!isTauri()) return;
      setLoadingPatch(true);
      setFileDiff(null);
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ diff: string }>("agent_git_file_diff", {
          workingDir,
          filePath: path,
          baseRef,
        });
        setFileDiff(result.diff);
      } catch {
        setFileDiff("");
      } finally {
        setLoadingPatch(false);
      }
    },
    [workingDir, baseRef],
  );

  useEffect(() => {
    if (selectedPath) void loadPatch(selectedPath);
  }, [selectedPath, loadPatch]);

  if (!isTauri()) {
    return fallbackDiff ? <DiffView diff={fallbackDiff} className={className} /> : null;
  }

  if (loadingList) {
    return (
      <div className={`flex items-center gap-2 text-[11px] text-slate-500 ${className}`}>
        <Loader2 size={12} className="animate-spin" /> Loading changed files…
      </div>
    );
  }

  if (listError || files.length === 0) {
    if (fallbackDiff) {
      return <DiffView diff={fallbackDiff} className={className} />;
    }
    return (
      <div className={`text-[11px] text-slate-500 ${className}`}>
        {listError ? `Could not load diff: ${listError}` : "No file changes detected."}
      </div>
    );
  }

  const selected = files.find((f) => f.path === selectedPath);

  return (
    <div className={`flex gap-2 min-h-0 ${className}`}>
      <div className="w-44 shrink-0 max-h-56 overflow-y-auto custom-scrollbar rounded-xl border border-white/5 bg-black/30">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
          {files.length} file{files.length === 1 ? "" : "s"}
        </div>
        {files.map((file) => {
          const active = file.path === selectedPath;
          const badge = STATUS_LABEL[file.status] ?? file.status.slice(0, 1).toUpperCase();
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => setSelectedPath(file.path)}
              className={`w-full text-left px-2 py-1.5 flex items-start gap-1.5 text-[10px] font-mono transition-colors ${
                active ? "bg-red-500/15 text-red-200" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
              title={file.path}
            >
              <span className="shrink-0 w-3 text-slate-500">{badge}</span>
              <span className="truncate flex-1">{file.path.split("/").pop() ?? file.path}</span>
              {!file.status.includes("untracked") && (
                <span className="shrink-0 text-slate-600">
                  +{file.insertions}/-{file.deletions}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-w-0 max-h-56 overflow-y-auto custom-scrollbar">
        {selected && (
          <div className="text-[10px] font-mono text-slate-400 mb-1 truncate flex items-center gap-1">
            <FileDiff size={11} className="shrink-0" />
            {selected.path}
          </div>
        )}
        {loadingPatch ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 py-4">
            <Loader2 size={12} className="animate-spin" /> Loading patch…
          </div>
        ) : (
          <DiffView diff={fileDiff} />
        )}
      </div>
    </div>
  );
};

export default LazyDiffBrowser;
