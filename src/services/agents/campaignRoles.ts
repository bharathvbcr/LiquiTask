/**
 * The command hierarchy — ranks, duties, and enforceable boundaries.
 *
 * Each role couples a rank to the actions it may take. `assertAllowed` makes the
 * chain of command machine-checkable (only the Lead writes the dashboard, only
 * the Reviewer performs QC, a Worker never reviews its own work), so the
 * orchestrator can hard-enforce it rather than trusting a prompt.
 */

import type { CampaignAction, CampaignRank, CampaignRoleDef } from "./campaignTypes";

export class ForbiddenActionError extends Error {
  constructor(
    public readonly rank: CampaignRank,
    public readonly action: CampaignAction,
  ) {
    super(`${rank} is forbidden from '${action}' — it violates the chain of command`);
    this.name = "ForbiddenActionError";
  }
}

const role = (
  rank: CampaignRank,
  title: string,
  summary: string,
  reportsTo: CampaignRank | null,
  allowed: CampaignAction[],
  duties: string[],
): CampaignRoleDef => ({
  rank,
  title,
  summary,
  reportsTo,
  allowed: new Set(allowed),
  duties,
});

export const CAMPAIGN_ROLES: Record<CampaignRank, CampaignRoleDef> = {
  commander: role(
    "commander",
    "Commander",
    "Relays the Lord's order to the Lead and steps back. Never works.",
    null,
    ["relay_order", "read_dashboard", "notify", "contact_human"],
    [
      "Receive the Lord's order (an epic) and record it as a campaign command.",
      "Hand the command to the Lead, then yield so the Lord may issue more.",
      "Read the dashboard; never write it, never execute a task, never bypass the Lead.",
    ],
  ),
  lead: role(
    "lead",
    "Lead · Traffic Control",
    "Decomposes the epic, dispatches Workers in parallel, owns the dashboard.",
    "commander",
    ["decompose", "assign", "write_dashboard", "route_qc", "rollup", "notify", "read_dashboard", "contact_human"],
    [
      "Decompose the epic (DevCouncil plan) and classify each subtask by Bloom level.",
      "Dispatch execution tasks to Workers in parallel; route analysis/QC to the Reviewer.",
      "Own the dashboard and roll verified work up to the Commander.",
      "Never do the work yourself — running one worker when several could is Lead laziness.",
    ],
  ),
  worker: role(
    "worker",
    "Worker",
    "Runs exactly one task via an agent run, then reports to the Reviewer.",
    "reviewer",
    ["execute_task", "self_review", "write_report"],
    [
      "Execute the single task assigned to you and nothing beyond its scope.",
      "Self-review against the parent epic, then write a completion report.",
      "Notify the Reviewer for QC. Never QC your own work, never touch another's task.",
    ],
  ),
  reviewer: role(
    "reviewer",
    "Reviewer · Quality Control",
    "A thinker, not a doer. Verifies finished work via the DevCouncil gate.",
    "lead",
    ["qc_review", "deep_analysis", "aggregate_reports", "write_report"],
    [
      "Quality-control Worker output through the DevCouncil verify gate.",
      "Own architecture, root-cause and strategy work (Bloom Analyze/Evaluate/Create).",
      "Aggregate verdicts and report up to the Lead. Never manage Workers, never implement.",
    ],
  ),
};

export function getRole(rank: CampaignRank): CampaignRoleDef {
  return CAMPAIGN_ROLES[rank];
}

export function isAllowed(rank: CampaignRank, action: CampaignAction): boolean {
  return CAMPAIGN_ROLES[rank].allowed.has(action);
}

/** Throw {@link ForbiddenActionError} if `rank` may not perform `action`. */
export function assertAllowed(rank: CampaignRank, action: CampaignAction): void {
  if (!isAllowed(rank, action)) {
    throw new ForbiddenActionError(rank, action);
  }
}

/** Render a rank's persona/duties as markdown (for display / prompt injection). */
export function roleInstructions(rank: CampaignRank): string {
  const r = CAMPAIGN_ROLES[rank];
  const lines = [`# ${r.title}`, "", r.summary, ""];
  for (const duty of r.duties) lines.push(`- ${duty}`);
  return lines.join("\n");
}
