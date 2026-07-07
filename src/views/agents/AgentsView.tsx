/**
 * Agents — roster view.
 *
 * A read-only surface listing every configured agent teammate with live
 * presence (derived from agentRuns), provider/model, and a compact summary
 * of whatever it's currently doing. Mirrors the visual language already used
 * by AgentTeamPanel / AgentRunsDock (glass rows, PresenceRing, StatusPill) so this
 * feels like the same product, not a competing design.
 */
import { Bot } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import type { AgentProfile, AgentRun } from '../../../types';
import { FlatCard, PresenceRing, StatusPill } from '../../ui';
import type { PresenceStatus } from '../../ui';

/** Health of a single detected runtime binary (agentd sidecar, when enabled). */
export interface RuntimeHealthInfo {
  id: string;
  name: string;
  binary: string;
  path?: string;
  version?: string;
  ready: boolean;
}

export interface AgentsViewProps {
  agents: AgentProfile[];
  agentRuns: AgentRun[];
  /** Detected runtime binaries (from `localApi.detectRuntimes()`), when the agentd sidecar is enabled. */
  runtimeHealth?: RuntimeHealthInfo[];
  /** True while the first runtime scan is still running — shows a shimmer instead of popping in. */
  runtimeHealthLoading?: boolean;
  onSelectAgent?: (agentId: string) => void;
  /** Jump to a specific active/awaiting run for an agent. */
  onOpenRun?: (runId: string) => void;
}

const ACTIVE_RUN_STATUSES = new Set<AgentRun['status']>(['running', 'verifying', 'queued']);

interface AgentPresenceInfo {
  presence: PresenceStatus;
  /** The run to surface a summary for (current active run, awaiting review, or most recent). */
  featuredRun?: AgentRun;
}

/**
 * Derives an agent's presence from its runs:
 * - `working` — has an active run (running/verifying/queued)
 * - `awaiting-approval` — has a completed run not yet reviewed
 * - `blocked` — most recent run failed
 * - `idle` — otherwise
 */
function derivePresence(agentId: string, runs: AgentRun[]): AgentPresenceInfo {
  const agentRuns = runs
    .filter(r => r.agentId === agentId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (agentRuns.length === 0) return { presence: 'idle' };

  const activeRun = agentRuns.find(r => ACTIVE_RUN_STATUSES.has(r.status));
  if (activeRun) return { presence: 'working', featuredRun: activeRun };

  const awaitingRun = agentRuns.find(r => r.status === 'completed' && !r.reviewOutcome);
  if (awaitingRun) return { presence: 'awaiting-approval', featuredRun: awaitingRun };

  const mostRecent = agentRuns[0];
  if (mostRecent.status === 'failed') return { presence: 'blocked', featuredRun: mostRecent };

  return { presence: 'idle', featuredRun: mostRecent };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Shimmer placeholder while the first (slow) runtime scan runs. */
const RuntimeHealthSkeleton: React.FC = () => (
  <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/5 bg-white/5 p-2.5">
    <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">Runtimes</span>
    {[64, 88, 72].map(width => (
      <span
        key={width}
        className="h-5 animate-pulse rounded-full bg-white/5 border border-white/5"
        style={{ width }}
        aria-hidden
      />
    ))}
    <span className="text-[10px] text-slate-600">Detecting installed runtimes…</span>
  </div>
);

/**
 * Compact runtime strip: installed runtimes get chips; the rest collapse into
 * a single "+N more" toggle so a long catalog doesn't clutter the view.
 */
const RuntimeHealthStrip: React.FC<{ runtimes: RuntimeHealthInfo[] }> = ({ runtimes }) => {
  const [showAll, setShowAll] = useState(false);
  if (runtimes.length === 0) return null;

  const ready = runtimes.filter(r => r.ready);
  const notReady = runtimes.filter(r => !r.ready);
  const visible = showAll ? [...ready, ...notReady] : ready;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/5 bg-white/5 p-2.5 animate-in fade-in">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 mr-1">Runtimes</span>
      {visible.map(runtime => (
        <span
          key={runtime.id}
          title={runtime.path ?? runtime.binary}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            runtime.ready
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
              : 'bg-white/5 text-slate-500 border-white/10'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${runtime.ready ? 'bg-emerald-400' : 'bg-slate-600'}`}
            aria-hidden
          />
          {runtime.name}
          {runtime.ready && runtime.version ? (
            <span className="text-emerald-400/60">{runtime.version}</span>
          ) : null}
        </span>
      ))}
      {ready.length === 0 && !showAll && (
        <span className="text-[10px] text-slate-500">No runtimes installed yet</span>
      )}
      {notReady.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-white/10 hover:text-white"
        >
          {showAll ? 'Show Less' : `+${notReady.length} Not Installed`}
        </button>
      )}
    </div>
  );
};

interface AgentRosterRowProps {
  agent: AgentProfile;
  presenceInfo: AgentPresenceInfo;
  onSelectAgent?: (agentId: string) => void;
  onOpenRun?: (runId: string) => void;
}

const AgentRosterRow: React.FC<AgentRosterRowProps> = ({
  agent,
  presenceInfo,
  onSelectAgent,
  onOpenRun,
}) => {
  const { presence, featuredRun } = presenceInfo;

  return (
    <FlatCard>
      <div className="flex items-start gap-3">
        <PresenceRing status={presence}>
          <span className="text-xs font-semibold text-slate-200">{initials(agent.name)}</span>
        </PresenceRing>

        <button
          type="button"
          onClick={() => onSelectAgent?.(agent.id)}
          disabled={!onSelectAgent}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{agent.name}</span>
            {agent.role === 'planner' && (
              <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                planner
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-500">
            {agent.provider}
            {agent.model ? ` · ${agent.model}` : ''}
          </p>

          {featuredRun && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <StatusPill status={featuredRun.status} />
              {featuredRun.summary ? (
                <span className="truncate text-[11px] text-slate-400">{featuredRun.summary}</span>
              ) : (
                <span className="truncate text-[11px] text-slate-600">run {featuredRun.id}</span>
              )}
            </div>
          )}
        </button>

        {featuredRun &&
          onOpenRun &&
          (presence === 'working' || presence === 'awaiting-approval') && (
            <button
              type="button"
              onClick={() => onOpenRun(featuredRun.id)}
              className="shrink-0 rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
            >
              Open
            </button>
          )}
      </div>
    </FlatCard>
  );
};

/** Roster view — every configured agent with presence, provider/model, and current run summary. */
export const AgentsView: React.FC<AgentsViewProps> = ({
  agents,
  agentRuns,
  runtimeHealth,
  runtimeHealthLoading = false,
  onSelectAgent,
  onOpenRun,
}) => {
  const presenceByAgentId = useMemo(() => {
    const map = new Map<string, AgentPresenceInfo>();
    for (const agent of agents) map.set(agent.id, derivePresence(agent.id, agentRuns));
    return map;
  }, [agents, agentRuns]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {runtimeHealthLoading && !runtimeHealth ? (
        <RuntimeHealthSkeleton />
      ) : (
        runtimeHealth && runtimeHealth.length > 0 && <RuntimeHealthStrip runtimes={runtimeHealth} />
      )}

      {agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Bot className="h-8 w-8 text-slate-600" aria-hidden />
          <p className="text-sm text-slate-500">No agents configured yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {agents.map(agent => (
            <AgentRosterRow
              key={agent.id}
              agent={agent}
              presenceInfo={
                presenceByAgentId.get(agent.id) ?? { presence: 'idle' as PresenceStatus }
              }
              onSelectAgent={onSelectAgent}
              onOpenRun={onOpenRun}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentsView;
