/**
 * Multi-agent campaign orchestration — shared types.
 *
 * A generic team structure layered over LiquiTask's existing agent engine:
 *
 *     You → Coordinator → Lead → Workers ×N + Reviewer
 *
 * - **Coordinator** passes your request (an epic) to the Lead, then steps back.
 * - **Lead**       splits the epic into subtasks (DevCouncil `dev plan`), assigns
 *                  them to Workers in parallel, and owns the dashboard.
 * - **Worker**     worker agents — each runs one subtask via `agentRunService`.
 * - **Reviewer**   quality control — the DevCouncil verify gate on each run.
 *
 * Coordination is not an API bus: agents leave messages in per-agent mailboxes
 * (`campaignMailbox`) and wake each other with a content-free nudge.
 */

import type { AgentProfile, Task } from "../../../types";
import type { DevCouncilSubtask } from "../nativeBridge";

/** A position in the team structure ("commander" renders as Coordinator). */
export type CampaignRank = "commander" | "lead" | "worker" | "reviewer";

/** Message kinds carried by the mailbox. `clear_command` is a control signal. */
export type CampaignMessageType =
  | "cmd_new"
  | "task_assigned"
  | "report_received"
  | "qc_result"
  | "clear_command"
  | "info";

/** Control message types delivered but excluded from the "unread work" count. */
export const CAMPAIGN_SPECIAL_TYPES: ReadonlySet<CampaignMessageType> = new Set(["clear_command"]);

export interface CampaignMessage {
  id: string;
  /** Sender agent id. */
  from: string;
  /** Epoch milliseconds. */
  timestamp: number;
  type: CampaignMessageType;
  content: string;
  read: boolean;
}

/** A discrete capability a rank may or may not exercise. */
export type CampaignAction =
  | "relay_order"
  | "read_dashboard"
  | "decompose"
  | "assign"
  | "write_dashboard"
  | "route_qc"
  | "rollup"
  | "notify"
  | "execute_task"
  | "self_review"
  | "write_report"
  | "qc_review"
  | "deep_analysis"
  | "aggregate_reports"
  | "contact_human";

export interface CampaignRoleDef {
  rank: CampaignRank;
  title: string;
  summary: string;
  allowed: ReadonlySet<CampaignAction>;
  reportsTo: CampaignRank | null;
  duties: string[];
}

/** Bloom's taxonomy level — routing decides worker vs. thinker. */
export enum BloomLevel {
  Remember = 1,
  Understand = 2,
  Apply = 3,
  Analyze = 4,
  Evaluate = 5,
  Create = 6,
}

export type CampaignPhase = "mustering" | "dispatching" | "complete";

/** Why a campaign fell back to a single subtask instead of a DevCouncil plan. */
export type PlanFallbackReason = "no_planner" | "cli_missing" | "plan_failure" | "plan_empty";

export interface PlanFallbackInfo {
  reason: PlanFallbackReason;
  message: string;
  hint: string;
}

export type CampaignOutcomeStatus = "verified" | "blocked" | "failed" | "skipped";

/** One subtask's assignment as decided by the Lead. */
export interface CampaignAssignment {
  subtask: DevCouncilSubtask;
  /** Materialised board task (present once created). */
  task?: Task;
  /** The worker agent (undefined when no worker is available). */
  agent?: AgentProfile;
  /** Mailbox id of the owner: a `workerN`-style id or `reviewer`. */
  owner: string;
  rank: CampaignRank;
  bloom: BloomLevel;
}

/** The result of a single subtask passing (or failing) through the campaign. */
export interface CampaignTaskOutcome {
  subtaskId: string;
  taskId?: string;
  title: string;
  owner: string;
  bloom: string;
  status: CampaignOutcomeStatus;
  verified: boolean;
  blockingGaps: string[];
  summary?: string;
}

export interface CampaignRosterEntry {
  agent: string;
  rank: CampaignRank;
  status: "idle" | "working" | "reviewing";
  current: string;
}

export interface CampaignResult {
  goal: string;
  outcomes: CampaignTaskOutcome[];
  verified: string[];
  blocked: string[];
  skipped: string[];
  success: boolean;
  dashboardMarkdown: string;
}

/** Live, subscribable campaign state for the UI. */
export interface CampaignState {
  id: string;
  goal: string;
  phase: CampaignPhase;
  roster: CampaignRosterEntry[];
  outcomes: CampaignTaskOutcome[];
  inProgress: string[];
  events: string[];
  dashboardMarkdown: string;
  startedAt: number;
  finishedAt?: number;
  /** Set when DevCouncil planning failed and the campaign runs as a single task. */
  planFallback?: PlanFallbackInfo;
}
