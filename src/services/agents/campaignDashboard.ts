/**
 * The team dashboard — the Lead's single source of truth for the user.
 *
 * Renders the roster, the current goal, work in progress, completed
 * (verified) subtasks and anything blocked/skipped as markdown. Only the Lead
 * writes it (enforced in the orchestrator via `assertAllowed`).
 */

import type { CampaignRosterEntry } from "./campaignTypes";

export interface CampaignDashboardInput {
  goal: string;
  roster: CampaignRosterEntry[];
  inProgress: string[];
  achievements: string[];
  blocked: string[];
  skipped: string[];
  routing?: { worker: number; reviewer: number };
}

export function renderCampaignDashboard(state: CampaignDashboardInput): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Team Dashboard", "");
  lines.push(`_Updated ${now} — written by the Lead._`, "");
  lines.push("## Goal", "", `> ${state.goal || "(none)"}`, "");
  if (state.routing) {
    lines.push(`Routing — worker: ${state.routing.worker}, reviewer: ${state.routing.reviewer}`, "");
  }

  lines.push("## Roster", "");
  lines.push("| Agent | Rank | Status | Current |", "| --- | --- | --- | --- |");
  for (const e of state.roster) {
    lines.push(`| ${e.agent} | ${e.rank} | ${e.status} | ${e.current} |`);
  }
  lines.push("");

  lines.push(`## In Progress (${state.inProgress.length})`, "");
  if (state.inProgress.length) {
    for (const row of state.inProgress) lines.push(`- 🔄 ${row}`);
  } else {
    lines.push("- (quiet)");
  }
  lines.push("");

  lines.push(`## Completed (${state.achievements.length})`, "");
  if (state.achievements.length) {
    for (const row of state.achievements) lines.push(`- ✅ ${row}`);
  } else {
    lines.push("- (none yet)");
  }
  lines.push("");

  if (state.blocked.length) {
    lines.push(`## Blocked (${state.blocked.length})`, "");
    for (const row of state.blocked) lines.push(`- ⛔ ${row}`);
    lines.push("");
  }
  if (state.skipped.length) {
    lines.push(`## Skipped — unmet dependencies (${state.skipped.length})`, "");
    for (const row of state.skipped) lines.push(`- ⏭️ ${row}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
