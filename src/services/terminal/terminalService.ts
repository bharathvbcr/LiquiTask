/**
 * Bridge to the Rust PTY terminal (src-tauri/src/terminal.rs).
 *
 * Event contract:
 * - `terminal-output` — `{ id, data }` raw ANSI chunk from the shell.
 * - `terminal-exit`   — `{ id, code? }` shell process ended.
 */

import { isTauri } from "../../runtime/runtimeEnvironment";

export interface TerminalOutputEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code?: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const terminalService = {
  isAvailable(): boolean {
    return isTauri();
  },

  /** Open a PTY shell session; resolves to the terminal id. */
  open(cols: number, rows: number, cwd?: string): Promise<string> {
    return invoke<string>("terminal_open", { cols, rows, cwd: cwd ?? null });
  },

  /** Send keystrokes / pasted text to the shell. */
  write(id: string, data: string): Promise<void> {
    return invoke<void>("terminal_write", { id, data });
  },

  resize(id: string, cols: number, rows: number): Promise<void> {
    return invoke<void>("terminal_resize", { id, cols, rows });
  },

  /** Kill the shell and forget the session. */
  close(id: string): Promise<void> {
    return invoke<void>("terminal_close", { id });
  },

  /** Subscribe to raw output chunks. Returns an unsubscribe fn. */
  async onOutput(handler: (event: TerminalOutputEvent) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<TerminalOutputEvent>("terminal-output", (e) => handler(e.payload));
  },

  /** Subscribe to shell-exit notifications. Returns an unsubscribe fn. */
  async onExit(handler: (event: TerminalExitEvent) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<TerminalExitEvent>("terminal-exit", (e) => handler(e.payload));
  },
};

export default terminalService;
