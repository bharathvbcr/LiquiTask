/**
 * Bottom terminal drawer (VS Code-style), toggled with Ctrl+` or via the
 * command palette. Two tabs:
 * - Shell:  interactive PTY shell (ShellTerminal).
 * - Agents: raw live tail of all agent run output (AgentSpyConsole).
 *
 * Stays mounted while open so the shell session and spy buffer survive tab
 * switches; unmounting (isOpen=false after close animation) kills the shell.
 */

import { SquareTerminal, Radar, X } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import AgentSpyConsole from "./AgentSpyConsole";
import ShellTerminal from "./ShellTerminal";

type DrawerTab = "shell" | "agents";

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Initial working directory for new shell sessions. */
  cwd?: string;
}

const MIN_HEIGHT = 160;
const MAX_HEIGHT_RATIO = 0.8;

export const TerminalDrawer: React.FC<TerminalDrawerProps> = ({ isOpen, onClose, cwd }) => {
  const [tab, setTab] = useState<DrawerTab>("shell");
  const [height, setHeight] = useState(320);
  const [fitEpoch, setFitEpoch] = useState(0);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      dragState.current = { startY: e.clientY, startHeight: height };
      const onMove = (ev: PointerEvent) => {
        if (!dragState.current) return;
        const delta = dragState.current.startY - ev.clientY;
        const max = window.innerHeight * MAX_HEIGHT_RATIO;
        setHeight(Math.min(max, Math.max(MIN_HEIGHT, dragState.current.startHeight + delta)));
      };
      const onUp = () => {
        dragState.current = null;
        setFitEpoch((n) => n + 1);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [height],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-col border-t border-white/10 bg-[#070a12]/95 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom duration-200"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        onPointerDown={onDragStart}
        className="group absolute -top-1 left-0 right-0 h-2 cursor-row-resize"
      >
        <div className="mx-auto mt-0.5 h-1 w-16 rounded-full bg-white/10 transition-colors group-hover:bg-cyan-500/50" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-white/5 px-2 py-1">
        <button
          type="button"
          onClick={() => {
            setTab("shell");
            setFitEpoch((n) => n + 1);
          }}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "shell"
              ? "bg-white/10 text-cyan-300"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          <SquareTerminal size={13} />
          Shell
        </button>
        <button
          type="button"
          onClick={() => setTab("agents")}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "agents"
              ? "bg-white/10 text-cyan-300"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          <Radar size={13} />
          Agents
        </button>
        <span className="ml-2 hidden text-[10px] uppercase tracking-wider text-slate-600 sm:inline">
          Ctrl+` to toggle
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          title="Close terminal"
        >
          <X size={14} />
        </button>
      </div>

      {/* Panels: both stay mounted so the shell session / spy buffer persist */}
      <div className="min-h-0 flex-1">
        <div className={tab === "shell" ? "h-full" : "hidden"}>
          <ShellTerminal cwd={cwd} visible={tab === "shell"} fitEpoch={fitEpoch} />
        </div>
        <div className={tab === "agents" ? "h-full" : "hidden"}>
          <AgentSpyConsole visible={tab === "agents"} />
        </div>
      </div>
    </div>
  );
};

export default TerminalDrawer;
