/**
 * Agent spy console: a raw, terminal-style live tail of every agent run.
 *
 * Unlike RunView (curated per-run transcript), this listens directly to the
 * two native event channels and shows everything, interleaved:
 * - `agent-run-event`  — legacy Rust runner: { runId, stream, line?, code? }
 * - `agentd-run-event` — agentd sidecar:     { runId, kind, text?, tool?, ... }
 */

import { Ban, Eraser, Pause, Play } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../runtime/runtimeEnvironment";

const MAX_LINES = 2000;

interface SpyLine {
  seq: number;
  ts: number;
  runId: string;
  /** Channel + stream/kind, e.g. "stdout", "stderr", "tool_use". */
  tag: string;
  text: string;
}

interface LegacyRunEvent {
  runId: string;
  stream: "stdout" | "stderr" | "exit" | "error";
  line?: string;
  code?: number;
}

interface AgentdRunEvent {
  runId: string;
  kind: string;
  text?: string;
  tool?: string;
  output?: string;
  status?: string;
  error?: string;
  code?: number;
}

const TAG_COLORS: Record<string, string> = {
  stdout: "text-slate-300",
  stderr: "text-red-400",
  exit: "text-slate-500",
  error: "text-red-400",
  message: "text-slate-200",
  thinking: "text-violet-400",
  tool_use: "text-cyan-400",
  tool_result: "text-cyan-600",
  status: "text-amber-400",
  log: "text-slate-500",
  permission_request: "text-amber-300",
  result: "text-emerald-400",
};

function runHue(runId: string): number {
  let hash = 0;
  for (let i = 0; i < runId.length; i++) hash = (hash * 31 + runId.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export const AgentSpyConsole: React.FC<{ visible: boolean }> = ({ visible }) => {
  const [lines, setLines] = useState<SpyLine[]>([]);
  const [runFilter, setRunFilter] = useState<string>("all");
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const push = useCallback((runId: string, tag: string, text: string) => {
    if (pausedRef.current) return;
    setLines((prev) => {
      const next = [
        ...prev,
        { seq: seqRef.current++, ts: Date.now(), runId, tag, text },
      ];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];

    void import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      void listen<LegacyRunEvent>("agent-run-event", (e) => {
        const { runId, stream, line, code } = e.payload;
        const text =
          stream === "exit" ? `process exited (code ${code ?? "?"})` : (line ?? "");
        if (text) push(runId, stream, text);
      }).then((u) => unsubs.push(u));

      void listen<AgentdRunEvent>("agentd-run-event", (e) => {
        const p = e.payload;
        const text =
          p.text ??
          p.output ??
          p.error ??
          (p.tool ? `→ ${p.tool}` : (p.status ?? ""));
        if (text) push(p.runId, p.kind, text);
      }).then((u) => unsubs.push(u));
    });

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [push]);

  const runIds = useMemo(() => {
    const ids = new Set<string>();
    for (const l of lines) ids.add(l.runId);
    return Array.from(ids);
  }, [lines]);

  const shown = useMemo(
    () => (runFilter === "all" ? lines : lines.filter((l) => l.runId === runFilter)),
    [lines, runFilter],
  );

  // Auto-scroll to the newest line while live.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    if (!paused && visible && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [shown, paused, visible]);

  if (!isTauri()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Agent tracking is only available in the desktop app.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <select
          value={runFilter}
          onChange={(e) => setRunFilter(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-300 outline-none focus:border-cyan-500/50"
        >
          <option value="all">All runs ({runIds.length})</option>
          {runIds.map((id) => (
            <option key={id} value={id}>
              {id.slice(0, 18)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
          title={paused ? "Resume live tail" : "Pause live tail"}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() => setLines([])}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
          title="Clear console"
        >
          <Eraser size={12} />
          Clear
        </button>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">
          {shown.length} lines
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed"
      >
        {shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
            <Ban size={18} />
            <span className="text-xs">
              No agent output yet — start a run and its raw stream lands here.
            </span>
          </div>
        ) : (
          shown.map((l) => (
            <div key={l.seq} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-slate-600">
                {new Date(l.ts).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              <span
                className="shrink-0"
                style={{ color: `hsl(${runHue(l.runId)} 70% 65%)` }}
                title={l.runId}
              >
                {l.runId.slice(0, 10)}
              </span>
              <span className={`shrink-0 ${TAG_COLORS[l.tag] ?? "text-slate-400"}`}>
                [{l.tag}]
              </span>
              <span className={TAG_COLORS[l.tag] ?? "text-slate-300"}>{l.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AgentSpyConsole;
