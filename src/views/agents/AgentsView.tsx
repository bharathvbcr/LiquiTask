/**
 * Agents — the visual agent manager.
 *
 * The primary place to create, edit, organize, and skill-assign agent
 * teammates. Lists every configured agent with live presence (derived from
 * agentRuns), provider/model, and a compact summary of whatever it's currently
 * doing — plus a New Agent action, search/filter, per-row edit/delete, and
 * squad grouping (agents sharing a working directory). Mirrors the visual
 * language of AgentTeamPanel / AgentRunsDock (glass rows, PresenceRing,
 * StatusPill) so this feels like the same product.
 */
import { Bot, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type React from 'react';
import { useMemo, useState } from 'react';

import { deriveSquads } from '../../core/squads/deriveSquads';
import type { AgentProfile, AgentRun } from '../../../types';
import { FlatCard, PresenceRing, StatusPill } from '../../ui';
import type { PresenceStatus } from '../../ui';
import {
  deriveAgentSessionCost,
  formatCostUsd,
  formatTokenCount,
} from '../../utils/runUsage';

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
  /** Open the create-agent modal. */
  onCreateAgent?: () => void;
  /** Open the edit-agent modal for a specific agent. */
  onEditAgent?: (agentId: string) => void;
  /** Delete an agent (App confirms + persists + refreshes). */
  onDeleteAgent?: (agentId: string) => void;
  /** Called by parent after roster mutations; part of the manager contract. */
  onAgentsChanged?: () => void;
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
  sessionCost: ReturnType<typeof deriveAgentSessionCost>;
  onSelectAgent?: (agentId: string) => void;
  onOpenRun?: (runId: string) => void;
  onEditAgent?: (agentId: string) => void;
  onDeleteAgent?: (agentId: string) => void;
}

const AgentRosterRow: React.FC<AgentRosterRowProps> = ({
  agent,
  presenceInfo,
  sessionCost,
  onSelectAgent,
  onOpenRun,
  onEditAgent,
  onDeleteAgent,
}) => {
  const { presence, featuredRun } = presenceInfo;
  const handleSelect = onEditAgent ?? onSelectAgent;

  return (
    <FlatCard>
      <div className="flex items-start gap-3">
        <PresenceRing status={presence}>
          <span className="text-xs font-semibold text-slate-200">{initials(agent.name)}</span>
        </PresenceRing>

        <button
          type="button"
          onClick={() => handleSelect?.(agent.id)}
          disabled={!handleSelect}
          className="min-w-0 flex-1 text-left disabled:cursor-default"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-white">{agent.name}</span>
            {agent.role === 'planner' && (
              <span className="shrink-0 rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                planner
              </span>
            )}
            {(agent.skills?.length ?? 0) > 0 && (
              <span className="shrink-0 rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                {agent.skills?.length} skills
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-slate-500">
            {agent.provider}
            {agent.model ? ` · ${agent.model}` : ''}
            {sessionCost ? (
              <span
                className="ml-1 font-mono text-slate-600"
                title={
                  sessionCost.estimated
                    ? 'Session total estimated from token usage'
                    : 'Session total reported cost'
                }
              >
                · {formatCostUsd(sessionCost.costUsd, sessionCost.estimated)}
                {sessionCost.totalTokens > 0
                  ? ` · ${formatTokenCount(sessionCost.totalTokens)} tok`
                  : ''}
              </span>
            ) : null}
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

        <div className="flex shrink-0 items-center gap-1">
          {featuredRun &&
            onOpenRun &&
            (presence === 'working' || presence === 'awaiting-approval') && (
              <button
                type="button"
                onClick={() => onOpenRun(featuredRun.id)}
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-300 transition-colors hover:bg-red-500/20"
              >
                Open
              </button>
            )}
          {onEditAgent && (
            <button
              type="button"
              onClick={() => onEditAgent(agent.id)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              aria-label={`Edit ${agent.name}`}
            >
              <Pencil size={14} />
            </button>
          )}
          {onDeleteAgent && (
            <button
              type="button"
              onClick={() => onDeleteAgent(agent.id)}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
              aria-label={`Delete ${agent.name}`}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </FlatCard>
  );
};

/** The visual agent manager — roster, search, squads, and create/edit/delete actions. */
export const AgentsView: React.FC<AgentsViewProps> = ({
  agents,
  agentRuns,
  runtimeHealth,
  runtimeHealthLoading = false,
  onSelectAgent,
  onOpenRun,
  onCreateAgent,
  onEditAgent,
  onDeleteAgent,
  onAgentsChanged: _onAgentsChanged,
}) => {
  const [query, setQuery] = useState('');

  const presenceByAgentId = useMemo(() => {
    const map = new Map<string, AgentPresenceInfo>();
    for (const agent of agents) map.set(agent.id, derivePresence(agent.id, agentRuns));
    return map;
  }, [agents, agentRuns]);

  const sessionCostByAgentId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveAgentSessionCost>>();
    for (const agent of agents) {
      map.set(agent.id, deriveAgentSessionCost(agent.id, agentRuns));
    }
    return map;
  }, [agents, agentRuns]);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter(a =>
      [a.name, a.provider, a.model ?? '', a.workingDir].some(field =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [agents, query]);

  // Group by squad (agents sharing a working dir, ≥2 members); the rest are Solo.
  const { squadSections, soloAgents } = useMemo(() => {
    const byId = new Map(filteredAgents.map(a => [a.id, a]));
    const squads = deriveSquads(filteredAgents, agentRuns);
    const grouped = new Set<string>();
    const sections = squads.map(squad => {
      const members = squad.memberAgentIds
        .map(id => byId.get(id))
        .filter((a): a is AgentProfile => Boolean(a));
      for (const m of members) grouped.add(m.id);
      return { name: squad.name, members };
    });
    const solo = filteredAgents.filter(a => !grouped.has(a.id));
    return { squadSections: sections, soloAgents: solo };
  }, [filteredAgents, agentRuns]);

  const renderRow = (agent: AgentProfile) => (
    <AgentRosterRow
      key={agent.id}
      agent={agent}
      presenceInfo={presenceByAgentId.get(agent.id) ?? { presence: 'idle' as PresenceStatus }}
      sessionCost={sessionCostByAgentId.get(agent.id) ?? null}
      onSelectAgent={onSelectAgent}
      onOpenRun={onOpenRun}
      onEditAgent={onEditAgent}
      onDeleteAgent={onDeleteAgent}
    />
  );

  const hasAgents = agents.length > 0;
  const hasResults = filteredAgents.length > 0;

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {/* Header: title, search, New Agent */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search agents by name, runtime, or folder"
            className="w-full liquid-input rounded-lg py-2 pl-9 pr-3 text-sm"
            aria-label="Search agents"
          />
        </div>
        {onCreateAgent && (
          <button
            type="button"
            onClick={onCreateAgent}
            className="flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-all hover:bg-red-500/20"
          >
            <Plus size={16} /> New Agent
          </button>
        )}
      </div>

      {runtimeHealthLoading && !runtimeHealth ? (
        <RuntimeHealthSkeleton />
      ) : (
        runtimeHealth && runtimeHealth.length > 0 && <RuntimeHealthStrip runtimes={runtimeHealth} />
      )}

      {!hasAgents ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <Bot className="h-8 w-8 text-slate-600" aria-hidden />
          <p className="text-sm text-slate-500">No agents configured yet</p>
          {onCreateAgent && (
            <button
              type="button"
              onClick={onCreateAgent}
              className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-all hover:bg-red-500/20"
            >
              <Plus size={16} /> New Agent
            </button>
          )}
        </div>
      ) : !hasResults ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Search className="h-6 w-6 text-slate-600" aria-hidden />
          <p className="text-sm text-slate-500">No agents match “{query}”</p>
        </div>
      ) : (
        <div className="space-y-5">
          {squadSections.map(section => (
            <section key={section.name} className="space-y-2">
              <h3 className="px-1 text-[10px] uppercase tracking-widest text-slate-500">
                {section.name}
              </h3>
              <div className="space-y-2">{section.members.map(renderRow)}</div>
            </section>
          ))}
          {soloAgents.length > 0 && (
            <section className="space-y-2">
              {squadSections.length > 0 && (
                <h3 className="px-1 text-[10px] uppercase tracking-widest text-slate-500">Solo</h3>
              )}
              <div className="space-y-2">{soloAgents.map(renderRow)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentsView;
