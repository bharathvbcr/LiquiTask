import { useDroppable } from "@dnd-kit/core";
import { Bot } from "lucide-react";
import type React from "react";

import type { AgentProfile } from "../../../types";

export const AGENT_DROP_PREFIX = "agent-drop:";

const AgentDropChip: React.FC<{ agent: AgentProfile }> = ({ agent }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `${AGENT_DROP_PREFIX}${agent.id}`,
    data: { type: "agent", agentId: agent.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all select-none ${
        isOver
          ? "bg-red-500/25 border-red-400 scale-110 shadow-lg shadow-red-500/20"
          : "bg-slate-900/90 border-white/10"
      }`}
    >
      <Bot size={16} className={isOver ? "text-red-300" : "text-red-400"} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">{agent.name}</p>
        <p className="text-[10px] text-slate-500 truncate">
          {isOver
            ? "release to hand off"
            : (agent.role ?? "default") === "planner"
              ? "planner — dev plan"
              : (agent.runMode ?? "direct") === "council"
                ? "council mode"
                : "claude code"}
        </p>
      </div>
    </div>
  );
};

/**
 * Multica-style handoff surface: while a task card is being dragged, agent
 * chips slide up from the bottom of the board. Dropping the card on a chip
 * assigns the task to that agent and starts the run.
 *
 * Must be rendered inside the board's DndContext (portals preserve context).
 */
export const AgentDropTray: React.FC<{ agents: AgentProfile[]; visible: boolean }> = ({
  agents,
  visible,
}) => {
  if (!visible || agents.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 p-3 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 pl-1">
        Hand off to
      </span>
      {agents.slice(0, 6).map((agent) => (
        <AgentDropChip key={agent.id} agent={agent} />
      ))}
    </div>
  );
};

export default AgentDropTray;
