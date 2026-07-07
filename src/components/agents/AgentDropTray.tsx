import { useDroppable } from "@dnd-kit/core";
import { Bot, Sparkles } from "lucide-react";
import type React from "react";

import { checkAgentBudget, getAgentDailyStats } from "../../services/agents/agentPolicyService";
import agentRunService from "../../services/agents/agentRunService";
import type { AgentProfile } from "../../../types";

export const AGENT_DROP_PREFIX = "agent-drop:";

/** Live availability for a chip, computed at render (tray only mounts mid-drag). */
function agentSubtitle(agent: AgentProfile): { label: string; dim: boolean } {
  const blocked = checkAgentBudget(
    agent,
    getAgentDailyStats(agent.id, agentRunService.getRuns()),
  );
  if (blocked) return { label: "over daily cap", dim: true };
  if (agentRunService.isAgentBusy(agent.id)) {
    const next = agentRunService.getQueueLengthForAgent(agent.id) + 1;
    return { label: `busy — queues #${next}`, dim: true };
  }
  if ((agent.role ?? "default") === "planner") return { label: "planner — dev plan", dim: false };
  if ((agent.runMode ?? "direct") === "council") return { label: "council mode", dim: false };
  return { label: "ready", dim: false };
}

/**
 * Zero-aim handoff target: dropping here smart-matches the task to the
 * least-loaded eligible agent (see agentDispatchService.smartMatch).
 */
const BestMatchChip: React.FC = () => {
  const { isOver, setNodeRef } = useDroppable({
    id: `${AGENT_DROP_PREFIX}smart`,
    data: { type: "agent", agentId: "smart" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all select-none ${
        isOver
          ? "bg-red-500/30 border-red-400 scale-110 shadow-lg shadow-red-500/25"
          : "bg-red-500/10 border-red-500/30"
      }`}
    >
      <Sparkles size={16} className={isOver ? "text-red-200" : "text-red-400"} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">Best Match</p>
        <p className="text-[10px] text-slate-500 truncate">
          {isOver ? "release to hand off" : "auto-picks an agent"}
        </p>
      </div>
    </div>
  );
};

/**
 * First-run affordance: no agents exist, so the tray offers a drop target
 * that opens Settings → Agents with the dragged intent acknowledged.
 */
const SetupChip: React.FC = () => {
  const { isOver, setNodeRef } = useDroppable({
    id: `${AGENT_DROP_PREFIX}setup`,
    data: { type: "agent", agentId: "setup" },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed transition-all select-none ${
        isOver ? "bg-red-500/25 border-red-400 scale-110" : "bg-black/60 border-white/20"
      }`}
    >
      <Bot size={16} className="text-red-400" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">Set Up an Agent</p>
        <p className="text-[10px] text-slate-500 truncate">
          {isOver ? "release to open setup" : "none configured yet"}
        </p>
      </div>
    </div>
  );
};

const AgentDropChip: React.FC<{ agent: AgentProfile }> = ({ agent }) => {
  const { isOver, setNodeRef } = useDroppable({
    id: `${AGENT_DROP_PREFIX}${agent.id}`,
    data: { type: "agent", agentId: agent.id },
  });
  const status = agentSubtitle(agent);

  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all select-none ${
        isOver
          ? "bg-red-500/25 border-red-400 scale-110 shadow-lg shadow-red-500/20"
          : "bg-black/60 border-white/10"
      } ${!isOver && status.dim ? "opacity-70" : ""}`}
    >
      <Bot size={16} className={isOver ? "text-red-300" : "text-red-400"} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white truncate">{agent.name}</p>
        <p className="text-[10px] text-slate-500 truncate">
          {isOver ? "release to hand off" : status.label}
        </p>
      </div>
    </div>
  );
};

/**
 * Multica-style handoff surface: while a task card is being dragged, agent
 * chips slide up from the bottom of the board. Dropping the card on a chip
 * assigns the task to that agent and starts the run; the leading Best Match
 * chip smart-matches so no per-agent aiming is needed.
 *
 * Must be rendered inside the board's DndContext (portals preserve context).
 */
export const AgentDropTray: React.FC<{
  agents: AgentProfile[];
  visible: boolean;
  /** Render a setup chip when no agents exist (first-run discovery). */
  offerSetup?: boolean;
}> = ({ agents, visible, offerSetup = false }) => {
  if (!visible || (agents.length === 0 && !offerSetup)) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 p-3 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-4">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 pl-1">
        Hand off to
      </span>
      {agents.length === 0 && offerSetup && <SetupChip />}
      {agents.length > 1 && <BestMatchChip />}
      {agents.slice(0, 6).map((agent) => (
        <AgentDropChip key={agent.id} agent={agent} />
      ))}
    </div>
  );
};

export default AgentDropTray;
