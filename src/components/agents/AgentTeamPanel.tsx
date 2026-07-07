/**
 * Agent Team section — run a group of agents on an epic and watch progress.
 *
 * Rendered inside the AgentRunsDock "Team" tab (the old standalone floating
 * panel was merged into the dock): pick an epic and start a team run — the
 * Coordinator hands it to the Lead, who splits it into subtasks and assigns
 * Workers in parallel with Reviewer checks. Shows the team roles, live
 * roster, per-subtask results and the Lead's dashboard.
 */

import {
  CheckCircle2,
  ClipboardList,
  Megaphone,
  SearchCheck,
  SkipForward,
  Users,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { CAMPAIGN_ROLES } from '../../services/agents/campaignRoles';
import type {
  CampaignOutcomeStatus,
  CampaignPhase,
  CampaignRank,
  CampaignState,
} from '../../services/agents/campaignTypes';
import type { AgentProfile, Task } from '../../../types';

interface AgentTeamSectionProps {
  tasks: Task[];
  agents: AgentProfile[];
  /** Live campaign state (owned by the dock's useCampaign hook). */
  state?: CampaignState;
  isRunning: boolean;
  onStart: (epic: Task) => void;
  onCancel: () => void;
}

const RANK_COLOR: Record<CampaignRank, string> = {
  commander: 'text-amber-300',
  lead: 'text-sky-300',
  worker: 'text-emerald-300',
  reviewer: 'text-violet-300',
};

/** Plain-language labels for the internal campaign phases. */
export const PHASE_LABEL: Record<CampaignPhase, string> = {
  mustering: 'planning',
  dispatching: 'running',
  complete: 'done',
};

const STATUS_META: Record<CampaignOutcomeStatus, { color: string; label: string }> = {
  verified: { color: 'text-emerald-400', label: 'verified' },
  blocked: { color: 'text-red-400', label: 'blocked' },
  failed: { color: 'text-red-400', label: 'failed' },
  skipped: { color: 'text-amber-400', label: 'skipped' },
};

export function AgentTeamSection({
  tasks,
  agents,
  state,
  isRunning,
  onStart,
  onCancel,
}: AgentTeamSectionProps) {
  const [showDashboard, setShowDashboard] = useState(false);
  const [selectedEpicId, setSelectedEpicId] = useState<string>('');

  const workerCount = useMemo(
    () => agents.filter(a => (a.role ?? 'default') !== 'planner').length,
    [agents]
  );

  const selectedEpic = tasks.find(t => t.id === selectedEpicId);
  const ranks: CampaignRank[] = ['commander', 'lead', 'worker', 'reviewer'];

  return (
    <div className="space-y-3">
      {/* Start controls */}
      <div className="space-y-2">
        <label
          className="text-[10px] font-medium uppercase tracking-widest text-slate-500"
          htmlFor="campaign-epic"
        >
          Epic to work on
        </label>
        <div className="flex gap-2">
          <select
            id="campaign-epic"
            value={selectedEpicId}
            onChange={e => setSelectedEpicId(e.target.value)}
            className="liquid-input min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">Select an epic…</option>
            {tasks.map(t => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="shrink-0 rounded-lg bg-red-500/90 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-400"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => selectedEpic && onStart(selectedEpic)}
              disabled={!selectedEpic}
              className="liquid-button shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          <Users className="mr-1 inline h-3 w-3" />
          {workerCount} worker{workerCount === 1 ? '' : 's'} available
          {agents.some(a => a.role === 'planner')
            ? ' · reviewer available'
            : ' · no reviewer (add a planner agent)'}
        </p>
      </div>

      {/* Plan fallback banner */}
      {state?.planFallback && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <p className="font-medium">{state.planFallback.message}</p>
          <p className="mt-1 text-amber-300/80">{state.planFallback.hint}</p>
        </div>
      )}

      {/* Team roles */}
      <div className="rounded-lg border border-white/5 bg-white/5 p-2">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-500">
          Team Roles
        </div>
        <ul className="space-y-1">
          {ranks.map(rank => {
            const live = state?.roster.filter(r => r.rank === rank) ?? [];
            const role = CAMPAIGN_ROLES[rank];
            return (
              <li key={rank} className="flex items-start gap-2 text-xs">
                <RankIcon rank={rank} />
                <div className="min-w-0">
                  <span className={`font-semibold ${RANK_COLOR[rank]}`}>{role.title}</span>
                  {live.length > 0 && (
                    <span className="ml-1 text-slate-400">
                      {live
                        .map(
                          r =>
                            `${r.agent}${r.status !== 'idle' ? ` (${r.status}: ${r.current})` : ''}`
                        )
                        .join(', ')}
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
              <span className="font-medium">In progress:</span> {state.inProgress.join(' · ')}
            </div>
          )}
          {state.outcomes.length > 0 && (
            <ul className="space-y-1">
              {state.outcomes.map(o => {
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
                onClick={() => setShowDashboard(v => !v)}
                className="text-xs text-sky-300 hover:underline"
              >
                {showDashboard ? 'Hide' : 'Show'} dashboard
              </button>
              {showDashboard && (
                <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] leading-relaxed text-slate-300">
                  {state.dashboardMarkdown}
                </pre>
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
  if (rank === 'commander') return <Megaphone className={cls} />;
  if (rank === 'lead') return <ClipboardList className={cls} />;
  if (rank === 'reviewer') return <SearchCheck className={cls} />;
  return <Users className={cls} />;
}

function OutcomeIcon({ status }: { status: CampaignOutcomeStatus }) {
  if (status === 'verified') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (status === 'skipped') return <SkipForward className="h-3.5 w-3.5 text-amber-400" />;
  return <XCircle className="h-3.5 w-3.5 text-red-400" />;
}

export default AgentTeamSection;
