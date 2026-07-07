/**
 * Squads — agent teams derived from the roster, not stored.
 *
 * A squad is the set of agents working the same repo (`AgentProfile.workingDir`)
 * — the same grouping `campaignOrchestratorService` drafts a campaign role set
 * from. Deriving squads from workingDir keeps them in lockstep with campaign
 * reality instead of introducing a second, manually-curated team concept.
 */
import { getRole } from "../../services/agents/campaignRoles";
import { isBlockedRun } from "../inbox/deriveInboxItems";
import type { CampaignRank } from "../../services/agents/campaignTypes";
import type { AgentProfile, AgentRun } from "../../../types";

export interface Squad {
  id: string;
  name: string;
  /** Sorted by agent name so roster order is stable across renders. */
  memberAgentIds: string[];
  /** Member runs currently queued, running, or verifying. */
  activeRunCount: number;
  /** Most recent run activity (finish, else start, else creation) across members. */
  lastActivityAt?: Date;
}

export type SquadPresence = "idle" | "working" | "blocked";

/** A member mapped onto the team roles. */
export interface SquadRankAssignment {
  agentId: string;
  rank: CampaignRank;
  /** Display title from CAMPAIGN_ROLES (e.g. "Lead"). */
  title: string;
}

const ACTIVE_STATUSES: ReadonlySet<AgentRun["status"]> = new Set(["queued", "running", "verifying"]);

/** Persisted dates may round-trip through storage as strings; normalize defensively. */
function toMillis(value: Date | string | undefined): number | undefined {
  if (value == null) return undefined;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function normalizeDir(dir: string): string {
  const trimmed = dir.trim().replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

/** Last path segment as the human name — "/Users/x/Code/LiquiTask" → "LiquiTask". */
function squadName(dir: string): string {
  const segments = normalizeDir(dir).split("/").filter(Boolean);
  return segments[segments.length - 1] ?? dir;
}

/**
 * Group agents into squads by shared workingDir. A single agent on a repo is
 * just an agent — the team structure needs at least two heads (one
 * to assign work, one to do it), so squads require ≥2 members.
 */
export function deriveSquads(agents: AgentProfile[], runs: AgentRun[]): Squad[] {
  const byDir = new Map<string, AgentProfile[]>();
  for (const agent of agents) {
    if (!agent.workingDir?.trim()) continue;
    const dir = normalizeDir(agent.workingDir);
    const members = byDir.get(dir);
    if (members) members.push(agent);
    else byDir.set(dir, [agent]);
  }

  const squads: Squad[] = [];
  for (const [dir, members] of byDir) {
    if (members.length < 2) continue;

    const memberIds = new Set(members.map((agent) => agent.id));
    let activeRunCount = 0;
    let lastActivityMs: number | undefined;
    for (const run of runs) {
      if (!memberIds.has(run.agentId)) continue;
      if (ACTIVE_STATUSES.has(run.status)) activeRunCount++;
      const ms = toMillis(run.finishedAt) ?? toMillis(run.startedAt) ?? toMillis(run.createdAt);
      if (ms !== undefined && (lastActivityMs === undefined || ms > lastActivityMs)) {
        lastActivityMs = ms;
      }
    }

    squads.push({
      id: `squad:${dir}`,
      name: squadName(dir),
      memberAgentIds: members
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((agent) => agent.id),
      activeRunCount,
      lastActivityAt: lastActivityMs !== undefined ? new Date(lastActivityMs) : undefined,
    });
  }

  return squads.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * Squad presence for the roster rail. Blocked wins over working: a squad with
 * one blocked run needs the user's attention even if others are still moving.
 */
export function deriveSquadPresence(squad: Squad, runs: AgentRun[]): SquadPresence {
  const memberIds = new Set(squad.memberAgentIds);
  let working = false;
  for (const run of runs) {
    if (!memberIds.has(run.agentId)) continue;
    if (isBlockedRun(run)) return "blocked";
    if (ACTIVE_STATUSES.has(run.status)) working = true;
  }
  return working ? "working" : "idle";
}

/**
 * Map squad members onto the team roles (campaignRoles.ts):
 * first member leads, second reviews, the rest work. The coordinator rank is
 * the relay for the user's request — it is never staffed from the squad itself.
 * Member order is the squad's roster order (name-sorted by deriveSquads).
 */
export function suggestSquadRanks(memberAgentIds: string[]): SquadRankAssignment[] {
  return memberAgentIds.map((agentId, index) => {
    const rank: CampaignRank = index === 0 ? "lead" : index === 1 ? "reviewer" : "worker";
    return { agentId, rank, title: getRole(rank).title };
  });
}
