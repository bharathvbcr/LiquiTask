/**
 * Interactive PTY shell rendered with xterm.js.
 *
 * Owns exactly one backend session (terminal.rs). The session survives
 * drawer hide/show because the component stays mounted while the drawer is
 * merely translated off-screen; it is killed on unmount.
 */

import type React from "react";
import { useEffect, useRef } from "react";
import terminalService from "../../services/terminal/terminalService";
import "@xterm/xterm/css/xterm.css";

interface ShellTerminalProps {
  /** Start the shell in this directory (defaults to the user's home). */
  cwd?: string;
  /** Re-fit the grid when this changes (e.g. drawer resized). */
  fitEpoch?: number;
  visible: boolean;
}

export const ShellTerminal: React.FC<ShellTerminalProps> = ({ cwd, fitEpoch, visible }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one session per mount — cwd applies to the next session, not the live one
  useEffect(() => {
    if (!containerRef.current || !terminalService.isAvailable()) return;

    let disposed = false;
    let termId: string | null = null;
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
        theme: {
          background: "rgba(0,0,0,0)",
          foreground: "#cbd5e1",
          cursor: "#38bdf8",
          selectionBackground: "rgba(56,189,248,0.25)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      fit.fit();
      cleanups.push(() => term.dispose());

      const id = await terminalService
        .open(term.cols, term.rows, cwd)
        .catch((err: unknown) => {
          term.writeln(`\x1b[31mFailed to start shell: ${String(err)}\x1b[0m`);
          return null;
        });
      if (!id) return;
      termId = id;
      if (disposed) {
        void terminalService.close(id);
        return;
      }
      cleanups.push(() => void terminalService.close(id));

      const keyDisposable = term.onData((data) => {
        void terminalService.write(id, data).catch(() => undefined);
      });
      cleanups.push(() => keyDisposable.dispose());

      const unOutput = await terminalService.onOutput((e) => {
        if (e.id === id) term.write(e.data);
      });
      cleanups.push(unOutput);

      const unExit = await terminalService.onExit((e) => {
        if (e.id !== id) return;
        termId = null;
        term.writeln(`\r\n\x1b[90m[shell exited${e.code !== undefined ? ` (${e.code})` : ""}]\x1b[0m`);
      });
      cleanups.push(unExit);

      fitRef.current = () => {
        fit.fit();
        if (termId) void terminalService.resize(termId, term.cols, term.rows).catch(() => undefined);
      };

      const observer = new ResizeObserver(() => fitRef.current?.());
      observer.observe(containerRef.current);
      cleanups.push(() => observer.disconnect());

      term.focus();
    };

    void boot();
    return () => {
      disposed = true;
      fitRef.current = null;
      for (const fn of cleanups) fn();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: fitEpoch is a re-fit trigger (drawer resize / tab switch)
  useEffect(() => {
    if (visible) fitRef.current?.();
  }, [visible, fitEpoch]);

  if (!terminalService.isAvailable()) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        The shell is only available in the desktop app.
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full px-3 py-2" />;
};

export default ShellTerminal;
