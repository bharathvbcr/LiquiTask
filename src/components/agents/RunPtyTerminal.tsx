/**
 * Live agent PTY stream rendered with xterm.js (mirrors ShellTerminal patterns).
 * Input is gated behind an explicit Take Over action from the parent.
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";
import agentPtyService from "../../services/agents/agentPtyService";
import "@xterm/xterm/css/xterm.css";

interface RunPtyTerminalProps {
  /** Sidecar run id (agentdRunId), not the local run id. */
  agentdRunId: string;
  visible: boolean;
  /** When true, keystrokes are forwarded to the PTY. */
  inputEnabled: boolean;
  fitEpoch?: number;
}

export const RunPtyTerminal: React.FC<RunPtyTerminalProps> = ({
  agentdRunId,
  visible,
  inputEnabled,
  fitEpoch,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const inputEnabledRef = useRef(inputEnabled);
  const [unsupported, setUnsupported] = useState(false);

  inputEnabledRef.current = inputEnabled;

  // biome-ignore lint/correctness/useExhaustiveDependencies: one xterm session per agentdRunId mount
  useEffect(() => {
    if (!containerRef.current || !agentPtyService.isAvailable() || !agentdRunId) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];

    const boot = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        fontSize: 12.5,
        fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
        cursorBlink: true,
        allowTransparency: true,
        scrollback: 5000,
        disableStdin: true,
        theme: {
          background: "rgba(0,0,0,0)",
          foreground: "#cbd5e1",
          cursor: "#f87171",
          selectionBackground: "rgba(248,113,113,0.25)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      cleanups.push(() => term.dispose());

      const history = await agentPtyService.history(agentdRunId).catch(() => null);
      if (disposed) return;
      if (history && !history.supportsPty) {
        setUnsupported(true);
        term.writeln("\x1b[90mThis runtime uses pipe mode — live terminal attach is unavailable.\x1b[0m");
        return;
      }
      if (history?.data) {
        term.write(history.data);
      }

      const unOutput = await agentPtyService.onOutput((e) => {
        if (e.runId !== agentdRunId) return;
        term.write(e.data);
      });
      cleanups.push(unOutput);

      const keyDisposable = term.onData((data) => {
        if (!inputEnabledRef.current) return;
        void agentPtyService.write(agentdRunId, data).catch(() => undefined);
      });
      cleanups.push(() => keyDisposable.dispose());

      fitRef.current = () => fit.fit();
      const observer = new ResizeObserver(() => fitRef.current?.());
      observer.observe(containerRef.current);
      cleanups.push(() => observer.disconnect());
    };

    void boot();
    return () => {
      disposed = true;
      fitRef.current = null;
      for (const fn of cleanups) fn();
    };
  }, [agentdRunId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-backed input gate + fit trigger
  useEffect(() => {
    if (visible) fitRef.current?.();
  }, [visible, fitEpoch, inputEnabled]);

  if (!agentPtyService.isAvailable()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Live terminal attach requires the desktop app with agentd enabled.
      </div>
    );
  }

  if (unsupported) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500 px-4 text-center">
        This runtime does not support PTY attach — use the Transcript tab instead.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full px-3 py-2" />;
};

export default RunPtyTerminal;
