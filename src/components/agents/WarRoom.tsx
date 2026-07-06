/**
 * War Room — launch and watch a multi-agent campaign.
 *
 * A collapsible dock (bottom-left) that lets the Lord pick an epic and muster
 * the team: the Commander relays it to the Lead, who decomposes it and dispatches
 * Workers in parallel with Reviewer QC. Shows the chain of command, live roster,
 * per-subtask verdicts and the Lead's dashboard.
 */

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crown,
  Loader2,
  ShieldCheck,
  SkipForward,
  Swords,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useCampaign } from "../../hooks/useCampaign";
import { CAMPAIGN_ROLES } from "../../services/agents/campaignRoles";
import type { CampaignOutcomeStatus, CampaignRank } from "../../services/agents/campaignTypes";
import type { AgentProfile, BoardColumn, Task, ToastType } from "../../../types";

interface WarRoomProps {
  tasks: Task[];
  columns: BoardColumn[];
  agents: AgentProfile[];
  onCreateTasks?: (tasks: Task[]) => void;
  addToast?: (message: string, type: ToastType) => void;
  ntfyTopic?: string;
}

const RANK_COLOR: Record<CampaignRank, string> = {
  commander: "text-amber-300",
  lead: "text-sky-300",
  worker: "text-emerald-300",
  reviewer: "text-violet-300",
};

const STATUS_META: Record<CampaignOutcomeStatus, { color: string; label: string }> = {
  verified: { color: "text-emerald-400", label: "verified" },
  blocked: { color: "text-red-400", label: "blocked" },
  failed: { color: "text-red-400", label: "failed" },
  skipped: { color: "text-amber-400", label: "skipped" },
};

export function WarRoom({
  tasks,
  columns,
  agents,
  onCreateTasks,
  addToast,
  ntfyTopic,
}: WarRoomProps) {
  const [open, setOpen] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedEpicId, setSelectedEpicId] = useState<string>("");

  const { state, isRunning, startCampaign, cancelCampaign } = useCampaign({
    tasks,
    columns,
    agents,
    onCreateTasks,
    addToast,
    ntfyTopic,
  });

  const workerCount = useMemo(
    () => agents.filter((a) => (a.role ?? "default") !== "planner").length,
    [agents],
  );

  const selectedEpic = tasks.find((t) => t.id === selectedEpicId);
  const ranks: CampaignRank[] = ["commander", "lead", "worker", "reviewer"];

  const muster = () => {
    if (selectedEpic) void startCampaign(selectedEpic);
  };

  return (
    <div className="fixed bottom-4 left-[104px] z-[55] w-96 max-w-[calc(100vw-7.5rem)] rounded-xl border border-white/10 bg-slate-900/80 text-slate-100 shadow-2xl backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-t-xl px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 font-semibold">
          <Swords className="h-4 w-4 text-amber-300" />
          War Room
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" />}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-400">
          {state ? state.phase : "idle"}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto px-4 pb-4">
          {/* Muster controls */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400" htmlFor="campaign-epic">
              Order (epic)
            </label>
            <div className="flex gap-2">
              <select
                id="campaign-epic"
                value={selectedEpicId}
                onChange={(e) => setSelectedEpicId(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-800/80 px-2 py-1.5 text-sm"
              >
                <option value="">Select an epic…</option>
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => cancelCampaign()}
                  className="shrink-0 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
                >
                  Stand down
                </button>
              ) : (
                <button
                  type="button"
                  onClick={muster}
                  disabled={!selectedEpic}
                  className="shrink-0 rounded-lg bg-amber-500/90 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Muster
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              <Users className="mr-1 inline h-3 w-3" />
              {workerCount} Workers ready
              {agents.some((a) => a.role === "planner") ? " · Reviewer on station" : " · no Reviewer (add a planner agent)"}
            </p>
          </div>

          {/* Chain of command */}
          <div className="rounded-lg border border-white/5 bg-slate-800/40 p-2">
            <div className="mb-1 text-xs font-medium text-slate-400">Chain of command</div>
            <ul className="space-y-1">
              {ranks.map((rank) => {
                const live = state?.roster.filter((r) => r.rank === rank) ?? [];
                const role = CAMPAIGN_ROLES[rank];
                return (
                  <li key={rank} className="flex items-start gap-2 text-xs">
                    <RankIcon rank={rank} />
                    <div className="min-w-0">
                      <span className={`font-semibold ${RANK_COLOR[rank]}`}>{role.title}</span>
                      {live.length > 0 && (
                        <span className="ml-1 text-slate-400">
                          {live
                            .map((r) => `${r.agent}${r.status !== "idle" ? ` (${r.status}: ${r.current})` : ""}`)
                            .join(", ")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Live outcomes */}
          {state && (
            <div className="space-y-2">
              {state.inProgress.length > 0 && (
                <div className="text-xs text-slate-400">
                  <span className="font-medium">In progress:</span> {state.inProgress.join(" · ")}
                </div>
              )}
              {state.outcomes.length > 0 && (
                <ul className="space-y-1">
                  {state.outcomes.map((o) => {
                    const meta = STATUS_META[o.status];
                    return (
                      <li key={o.subtaskId} className="flex items-center gap-2 text-xs">
                        <OutcomeIcon status={o.status} />
                        <span className="min-w-0 flex-1 truncate">{o.title}</span>
                        <span className="text-slate-500">{o.owner}</span>
                        <span className="text-slate-600">{o.bloom}</span>
                        <span className={meta.color}>{meta.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {state.dashboardMarkdown && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowDashboard((v) => !v)}
                    className="text-xs text-sky-300 hover:underline"
                  >
                    {showDashboard ? "Hide" : "Show"} dashboard
                  </button>
                  {showDashboard && (
                    <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-950/70 p-2 text-[10px] leading-relaxed text-slate-300">
                      {state.dashboardMarkdown}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RankIcon({ rank }: { rank: CampaignRank }) {
  const cls = `h-3.5 w-3.5 mt-0.5 ${RANK_COLOR[rank]}`;
  if (rank === "commander") return <Crown className={cls} />;
  if (rank === "lead") return <ShieldCheck className={cls} />;
  if (rank === "reviewer") return <Swords className={cls} />;
  return <Users className={cls} />;
}

function OutcomeIcon({ status }: { status: CampaignOutcomeStatus }) {
  if (status === "verified") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === "skipped") return <SkipForward className="h-3.5 w-3.5 text-amber-400" />;
  return <XCircle className="h-3.5 w-3.5 text-red-400" />;
}

export default WarRoom;
