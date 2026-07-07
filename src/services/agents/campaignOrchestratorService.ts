/**
 * Campaign orchestration for LiquiTask.
 *
 * Layers a team structure on top of the existing agent engine:
 *
 * - the **Coordinator** passes the user's request (an epic board task) to the Lead;
 * - the **Lead** decomposes the epic via DevCouncil (`agentPlannerService.planEpic`),
 *   classifies each subtask by Bloom level, materialises board tasks, and
 *   dispatches them to the worker pool **in parallel** — never releasing a task
 *   before its dependencies are verified;
 * - each **Worker** runs one subtask as a real agent run (`agentRunService`);
 * - the **Reviewer** quality-controls every run through the DevCouncil verify gate
 *   and reports the verdict back up to the Lead, who updates the dashboard.
 *
 * The planner and the runner are injected, so the whole control flow — routing,
 * dependency waves, QC gating, role-boundary enforcement, mailbox + dashboard
 * side effects — is unit-testable without the Tauri backend or a coding CLI.
 */

import type { AgentProfile, BoardColumn, Task } from "../../../types";
import type { DevCouncilSubtask } from "../nativeBridge";
import agentRunService from "./agentRunService";
import { buildLinkedTask, planEpic } from "./agentPlannerService";
import { bloomLabel, classifyBloom, routeRank, summarizeRouting } from "./campaignBloom";
import { renderCampaignDashboard } from "./campaignDashboard";
import { campaignMailbox, type CampaignMailbox } from "./campaignMailbox";
import { nullNotifier, CampaignNotifier } from "./campaignNotify";
import { assertAllowed } from "./campaignRoles";
import type {
  CampaignAssignment,
  CampaignPhase,
  CampaignResult,
  CampaignState,
  CampaignRank,
  CampaignRosterEntry,
  CampaignTaskOutcome,
  PlanFallbackInfo,
  PlanFallbackReason,
} from "./campaignTypes";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/** The verdict of running one subtask through an agent + the verify gate. */
export interface CampaignRunOutcome {
  ok: boolean;
  verified: boolean;
  blockingGaps: string[];
  summary?: string;
}

/** Executes a single subtask. Default wraps `agentRunService`. */
export interface CampaignRunner {
  run(task: Task, agent: AgentProfile): Promise<CampaignRunOutcome>;
}

/** Decomposes an epic into subtasks. Default wraps `agentPlannerService`. */
export interface CampaignDecomposeResult {
  subtasks: DevCouncilSubtask[];
  fallbackReason?: PlanFallbackReason;
  detail?: string;
}

export interface CampaignPlanner {
  decompose(epic: Task, plannerAgent: AgentProfile | undefined): Promise<CampaignDecomposeResult>;
}

export function describePlanFallback(
  reason: PlanFallbackReason,
  detail?: string,
): PlanFallbackInfo {
  switch (reason) {
    case "no_planner":
      return {
        reason,
        message: "Planned without DevCouncil — running as a single task (no planner agent).",
        hint: "Add an agent with role “planner” in Agent settings.",
      };
    case "cli_missing":
      return {
        reason,
        message: "Planned without DevCouncil — running as a single task (CLI unavailable).",
        hint: detail ?? "Use the Tauri desktop app and install the DevCouncil CLI.",
      };
    case "plan_failure":
      return {
        reason,
        message: "Planned without DevCouncil — running as a single task (plan failed).",
        hint: detail ?? "Check the planner agent working directory and DevCouncil setup.",
      };
    case "plan_empty":
      return {
        reason,
        message: "Planned without DevCouncil — running as a single task (empty plan).",
        hint: "Try a clearer epic title and summary, then start again.",
      };
  }
}

export interface CampaignConfig {
  epic: Task;
  agents: AgentProfile[];
  columns: BoardColumn[];
  plannerAgent?: AgentProfile;
  maxParallel?: number;
  runner?: CampaignRunner;
  planner?: CampaignPlanner;
  mailbox?: CampaignMailbox;
  notifier?: CampaignNotifier;
  ntfyTopic?: string;
  onEvent?: (message: string) => void;
  /** Fired when DevCouncil planning fails and the campaign falls back to one subtask. */
  onPlanFallback?: (info: PlanFallbackInfo) => void;
  /** Called with materialised subtask board tasks so the UI can render them. */
  onCreateTasks?: (tasks: Task[]) => void;
  onState?: (state: CampaignState) => void;
}

/** Default runner: dispatch through `agentRunService` and await the verdict. */
export const defaultCampaignRunner: CampaignRunner = {
  run(task, agent) {
    return new Promise<CampaignRunOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: CampaignRunOutcome) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(outcome);
      };
      const unsubscribe = agentRunService.subscribe((runs) => {
        const run = runs.find((r) => r.taskId === task.id && r.agentId === agent.id);
        if (run && TERMINAL_RUN_STATUSES.has(run.status)) {
          finish({
            ok: run.status === "completed",
            verified: run.verification ? run.verification.passed : run.status === "completed",
            blockingGaps: run.verification?.blockingGaps ?? [],
            summary: run.summary,
          });
        }
      });
      void agentRunService.assign(task, agent).then((run) => {
        if (run === null) {
          finish({ ok: false, verified: false, blockingGaps: ["run could not be started"] });
        }
      });
    });
  },
};

/** Default planner: DevCouncil `dev plan` via `agentPlannerService.planEpic`. */
export const defaultCampaignPlanner: CampaignPlanner = {
  async decompose(epic, plannerAgent) {
    if (!plannerAgent) {
      return { subtasks: [], fallbackReason: "no_planner" };
    }
    const { result } = await planEpic(epic, plannerAgent);
    if (!result.cliAvailable) {
      return {
        subtasks: [],
        fallbackReason: "cli_missing",
        detail: result.error,
      };
    }
    if (!result.success) {
      return {
        subtasks: [],
        fallbackReason: "plan_failure",
        detail: result.error,
      };
    }
    const subtasks = result.tasks ?? [];
    if (!subtasks.length) {
      return { subtasks: [], fallbackReason: "plan_empty", detail: result.error };
    }
    return { subtasks };
  },
};

class Campaign {
  private readonly runner: CampaignRunner;
  private readonly planner: CampaignPlanner;
  private readonly mailbox: CampaignMailbox;
  private readonly notifier: CampaignNotifier;
  private readonly maxParallel: number;
  private readonly workers: AgentProfile[];
  private readonly reviewerAgent?: AgentProfile;
  private rr = 0;
  private cancelled = false;

  private readonly state: CampaignState;
  private readonly achievements: string[] = [];
  private readonly blocked: string[] = [];
  private readonly skipped: string[] = [];
  private readonly outcomes: CampaignTaskOutcome[] = [];

  constructor(private readonly config: CampaignConfig) {
    this.runner = config.runner ?? defaultCampaignRunner;
    this.planner = config.planner ?? defaultCampaignPlanner;
    this.mailbox = config.mailbox ?? campaignMailbox;
    this.notifier =
      config.notifier ?? (config.ntfyTopic ? new CampaignNotifier({ topic: config.ntfyTopic }) : nullNotifier);
    this.maxParallel = Math.max(1, config.maxParallel ?? 4);

    this.workers = config.agents.filter((a) => (a.role ?? "default") !== "planner");
    this.reviewerAgent = config.agents.find((a) => a.role === "planner");

    const roster: CampaignRosterEntry[] = [
      { agent: "commander", rank: "commander", status: "idle", current: "-" },
      { agent: "lead", rank: "lead", status: "idle", current: "-" },
      ...this.workers.map((_w, i) => ({
        agent: `worker${i + 1}`,
        rank: "worker" as CampaignRank,
        status: "idle" as const,
        current: "-",
      })),
      { agent: "reviewer", rank: "reviewer", status: "idle", current: "-" },
    ];
    this.state = {
      id: `campaign-${Date.now().toString(36)}`,
      goal: epicGoal(config.epic),
      phase: "mustering",
      roster,
      outcomes: [],
      inProgress: [],
      events: [],
      dashboardMarkdown: "",
      startedAt: Date.now(),
    };
  }

  // -- state plumbing ---------------------------------------------------------

  private emit(message: string): void {
    this.state.events.push(message);
    this.config.onEvent?.(message);
    this.publish();
  }

  private setPhase(phase: CampaignPhase): void {
    this.state.phase = phase;
    this.publish();
  }

  private setRoster(agent: string, status: CampaignRosterEntry["status"], current: string): void {
    const entry = this.state.roster.find((e) => e.agent === agent);
    if (entry) {
      entry.status = status;
      entry.current = current;
    }
  }

  private writeDashboard(routing?: { worker: number; reviewer: number }): void {
    // Only the Lead may write the dashboard.
    assertAllowed("lead", "write_dashboard");
    this.state.dashboardMarkdown = renderCampaignDashboard({
      goal: this.state.goal,
      roster: this.state.roster,
      inProgress: this.state.inProgress,
      achievements: this.achievements,
      blocked: this.blocked,
      skipped: this.skipped,
      routing,
    });
    this.publish();
  }

  private publish(): void {
    const snapshot: CampaignState = {
      ...this.state,
      roster: this.state.roster.map((e) => ({ ...e })),
      outcomes: [...this.outcomes],
      inProgress: [...this.state.inProgress],
      events: [...this.state.events],
    };
    this.config.onState?.(snapshot);
  }

  // -- main flow --------------------------------------------------------------

  /** Cooperative cancel — the user stops the run. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.emit("Run cancelled by the user.");
  }

  async run(): Promise<CampaignResult> {
    this.relayOrder();
    const assignments = await this.leadPlan();
    await this.dispatchWaves(assignments);
    this.leadRollup();
    return this.result();
  }

  private relayOrder(): void {
    assertAllowed("commander", "relay_order");
    this.mailbox.send("lead", this.state.goal, "cmd_new", "commander");
    this.emit(`Coordinator hands the epic to the Lead: “${this.state.goal}”`);
  }

  private async leadPlan(): Promise<CampaignAssignment[]> {
    assertAllowed("lead", "decompose");
    this.setPhase("mustering");
    const decomposed = await this.planner.decompose(this.config.epic, this.config.plannerAgent);
    let subtasks = decomposed.subtasks;
    if (!subtasks.length) {
      const reason = decomposed.fallbackReason ?? "plan_empty";
      const fallback = describePlanFallback(reason, decomposed.detail);
      this.state.planFallback = fallback;
      this.config.onPlanFallback?.(fallback);
      this.emit(
        `${fallback.message} ${decomposed.detail ? `(${decomposed.detail})` : ""} — ${fallback.hint}`,
      );
      // No DevCouncil plan available — fall back to a single subtask from the epic.
      subtasks = [
        {
          id: `${this.config.epic.id}-1`,
          title: this.config.epic.title,
          description: this.config.epic.summary || this.config.epic.title,
          priority: this.config.epic.priority,
          dependsOn: [],
        },
      ];
    }

    const routing = summarizeRouting(subtasks.map((s) => `${s.title}. ${s.description}`));
    this.emit(
      `Lead created ${subtasks.length} task(s) → ${routing.worker} to Workers, ${routing.reviewer} to Reviewer`,
    );

    const assignments = subtasks.map((subtask) => this.assign(subtask));
    const createdTasks = assignments.map((a) => a.task).filter((t): t is Task => Boolean(t));
    if (createdTasks.length) this.config.onCreateTasks?.(createdTasks);

    this.writeDashboard(routing);
    return assignments;
  }

  private assign(subtask: DevCouncilSubtask): CampaignAssignment {
    assertAllowed("lead", "assign");
    const bloom = classifyBloom(`${subtask.title}. ${subtask.description}`);
    const rank = routeRank(bloom);

    let owner: string;
    let agent: AgentProfile | undefined;
    if (rank === "reviewer" && this.reviewerAgent) {
      owner = "reviewer";
      agent = this.reviewerAgent;
    } else if (this.workers.length) {
      const idx = this.rr % this.workers.length;
      this.rr += 1;
      owner = `worker${idx + 1}`;
      agent = this.workers[idx];
    } else {
      owner = "worker1";
      agent = undefined;
    }

    const task = buildLinkedTask(
      {
        title: subtask.title,
        summary: subtask.description || subtask.title,
        projectId: this.config.epic.projectId,
        assignee: agent?.name ?? "",
        priority: subtask.priority ?? this.config.epic.priority,
        tags: [`epic:${this.config.epic.id}`, `campaign:${subtask.id}`, `bloom:${bloomLabel(bloom)}`],
        links: [{ targetTaskId: this.config.epic.id, type: "relates-to" }],
      },
      this.config.columns,
    );

    this.mailbox.send(owner, `task ${subtask.id} assigned: ${subtask.title}`, "task_assigned", "lead");
    this.emit(`Lead → ${owner}: ${subtask.title} (${bloomLabel(bloom)})`);
    return { subtask, task, agent, owner, rank, bloom };
  }

  private async dispatchWaves(assignments: CampaignAssignment[]): Promise<void> {
    this.setPhase("dispatching");
    const completed = new Set<string>();
    const failed = new Set<string>();
    let remaining = [...assignments];

    while (remaining.length) {
      if (this.cancelled) {
        for (const a of remaining) {
          this.outcomes.push({
            subtaskId: a.subtask.id,
            taskId: a.task?.id,
            title: a.subtask.title,
            owner: a.owner,
            bloom: bloomLabel(a.bloom),
            status: "skipped",
            verified: false,
            blockingGaps: ["run cancelled by the user"],
          });
          this.skipped.push(`${a.subtask.title} — cancelled`);
        }
        break;
      }

      const ready = remaining.filter(
        (a) =>
          a.subtask.dependsOn.every((d) => completed.has(d)) &&
          !a.subtask.dependsOn.some((d) => failed.has(d)),
      );

      if (!ready.length) {
        for (const a of remaining) {
          const unmet = a.subtask.dependsOn.filter((d) => !completed.has(d));
          this.outcomes.push({
            subtaskId: a.subtask.id,
            taskId: a.task?.id,
            title: a.subtask.title,
            owner: a.owner,
            bloom: bloomLabel(a.bloom),
            status: "skipped",
            verified: false,
            blockingGaps: [`unmet dependencies: ${unmet.join(", ")}`],
          });
          this.skipped.push(`${a.subtask.title} — unmet deps: ${unmet.join(", ")}`);
          this.emit(`⏭️  ${a.subtask.id} skipped — unmet dependencies ${unmet.join(", ")}`);
        }
        break;
      }

      const wave = ready.slice(0, this.maxParallel);
      for (const a of wave) {
        this.state.inProgress.push(`${a.subtask.title} · ${a.owner} · ${bloomLabel(a.bloom)}`);
      }
      this.publish();

      const settled = await Promise.all(wave.map((a) => this.runOne(a)));
      for (const outcome of settled) {
        this.outcomes.push(outcome);
        if (outcome.status === "verified") completed.add(outcome.subtaskId);
        else failed.add(outcome.subtaskId);
      }

      this.state.inProgress = this.state.inProgress.filter(
        (row) => !wave.some((a) => row.startsWith(`${a.subtask.title} · `)),
      );
      this.writeDashboard();
      remaining = remaining.filter((a) => !wave.includes(a));
    }
  }

  private async runOne(a: CampaignAssignment): Promise<CampaignTaskOutcome> {
    const ownerRank: CampaignRank = a.owner === "reviewer" ? "reviewer" : "worker";
    this.setRoster(a.owner, "working", a.subtask.title);

    if (!a.agent || !a.task) {
      this.setRoster(a.owner, "idle", "-");
      const outcome: CampaignTaskOutcome = {
        subtaskId: a.subtask.id,
        taskId: a.task?.id,
        title: a.subtask.title,
        owner: a.owner,
        bloom: bloomLabel(a.bloom),
        status: "failed",
        verified: false,
        blockingGaps: ["no worker agent available"],
      };
      this.blocked.push(`${a.subtask.title} — no worker agent available`);
      this.emit(`⛔ ${a.subtask.id} — no worker agent available`);
      return outcome;
    }

    assertAllowed(ownerRank, ownerRank === "reviewer" ? "deep_analysis" : "execute_task");
    const run = await this.runner.run(a.task, a.agent);

    // Report up: worker → Reviewer for QC.
    if (a.owner !== "reviewer") {
      assertAllowed(ownerRank, "write_report");
      this.mailbox.send("reviewer", `${a.subtask.id} finished by ${a.owner} — request QC`, "report_received", a.owner);
    }

    // Reviewer quality control (the DevCouncil verify gate result).
    assertAllowed("reviewer", "qc_review");
    const verified = Boolean(run.ok && run.verified);
    this.mailbox.send("lead", `${a.subtask.id}: ${verified ? "verified" : "blocked"}`, "qc_result", "reviewer");
    this.setRoster(a.owner, "idle", "-");

    let status: CampaignTaskOutcome["status"];
    if (verified) {
      status = "verified";
      this.achievements.push(`${a.subtask.title} · ${a.owner} · ${bloomLabel(a.bloom)}`);
      this.emit(`Reviewer verifies ${a.subtask.id} — worked by ${a.owner}`);
    } else if (!run.ok) {
      status = "failed";
      const reason = run.blockingGaps[0] ?? "execution failed";
      this.blocked.push(`${a.subtask.title} — ${reason}`);
      this.emit(`Reviewer blocks ${a.subtask.id}: ${reason}`);
    } else {
      status = "blocked";
      const reason = run.blockingGaps.join("; ") || "verification failed";
      this.blocked.push(`${a.subtask.title} — ${reason}`);
      this.emit(`Reviewer blocks ${a.subtask.id}: ${reason}`);
    }

    return {
      subtaskId: a.subtask.id,
      taskId: a.task.id,
      title: a.subtask.title,
      owner: a.owner,
      bloom: bloomLabel(a.bloom),
      status,
      verified,
      blockingGaps: run.blockingGaps,
      summary: run.summary,
    };
  }

  private leadRollup(): void {
    assertAllowed("lead", "rollup");
    this.writeDashboard();
    const verified = this.outcomes.filter((o) => o.status === "verified").length;
    const blocked = this.outcomes.filter((o) => o.status === "blocked" || o.status === "failed").length;
    const skipped = this.outcomes.filter((o) => o.status === "skipped").length;
    const summary = `Team run complete — ${verified} verified, ${blocked} blocked, ${skipped} skipped. Goal: ${this.state.goal}`;

    assertAllowed("lead", "notify");
    void this.notifier.notify(summary, { title: "Agent team", tags: ["white_check_mark"] });
    this.emit(`Lead summary: ${verified} verified / ${blocked} blocked / ${skipped} skipped`);

    // The Coordinator reads the dashboard to answer for the user (never writes it).
    assertAllowed("commander", "read_dashboard");
    this.state.finishedAt = Date.now();
    this.setPhase("complete");
  }

  private result(): CampaignResult {
    const ids = (status: CampaignTaskOutcome["status"]) =>
      this.outcomes.filter((o) => o.status === status).map((o) => o.subtaskId);
    const verified = ids("verified");
    const blocked = [...ids("blocked"), ...ids("failed")];
    const skipped = ids("skipped");
    const actionable = this.outcomes.filter((o) => o.status !== "skipped");
    return {
      goal: this.state.goal,
      outcomes: [...this.outcomes],
      verified,
      blocked,
      skipped,
      success: actionable.length > 0 && actionable.every((o) => o.status === "verified"),
      dashboardMarkdown: this.state.dashboardMarkdown,
    };
  }
}

function epicGoal(task: Task): string {
  const parts = [task.title];
  if (task.summary?.trim()) parts.push(task.summary.trim());
  return parts.join(" — ").slice(0, 4000);
}

/**
 * Singleton service managing the active campaign. Mirrors the other agent
 * services (subscribe + singleton) so hooks/components can react to campaign state.
 */
class CampaignOrchestratorService {
  private listeners = new Set<(state: CampaignState) => void>();
  private current?: CampaignState;
  private running = false;
  private activeCampaign?: Campaign;

  subscribe(listener: (state: CampaignState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): CampaignState | undefined {
    return this.current;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Signal the active run to stop (in-flight tasks finish first). */
  cancelCampaign(): void {
    this.activeCampaign?.cancel();
  }

  /** Start the team run and execute an epic. */
  async startCampaign(config: CampaignConfig): Promise<CampaignResult> {
    this.running = true;
    const publish = (state: CampaignState) => {
      this.current = state;
      config.onState?.(state);
      for (const listener of this.listeners) listener(state);
    };
    const campaign = new Campaign({ ...config, onState: publish });
    this.activeCampaign = campaign;
    try {
      return await campaign.run();
    } finally {
      this.running = false;
      this.activeCampaign = undefined;
    }
  }
}

export const campaignOrchestratorService = new CampaignOrchestratorService();
export default campaignOrchestratorService;
