import agentRunService from "./agentRunService";
import agentService from "./agentService";
import agentReservationService from "./agentReservationService";
import { checkAgentBudget, getAgentDailyStats } from "./agentPolicyService";
import type { AgentProfile, Task, ToastType } from "../../../types";

/**
 * One-call task → agent handoff ("send to agent" from anywhere).
 *
 * The board layer (useAgentTeammates) registers its `assignTaskToAgent` and
 * toast handlers here once; every entry point — card context menu, keyboard
 * shortcut, bulk actions bar — then dispatches through this singleton without
 * prop-drilling board callbacks through the component tree.
 *
 * When no agent is named, `smartMatch` picks one: the task's own assignee if
 * it is an agent, otherwise the least-loaded coder-role agent that has a
 * working directory and headroom under its daily budget caps.
 */

export interface SmartMatchResult {
  agent?: AgentProfile;
  /** Failure explanation when no agent matched. */
  reason?: string;
  /** Why this agent won, for the card's activity trail (e.g. "idle"). */
  matchNote?: string;
}

export interface DispatchResult {
  taskId: string;
  ok: boolean;
  agentName?: string;
  queued?: boolean;
  scopeQueued?: boolean;
  reason?: string;
}

export interface DispatchSummary {
  results: DispatchResult[];
  sent: number;
  queued: number;
  skipped: { task: Task; reason: string }[];
}

export interface DispatchAssignOptions {
  /** Suppress per-task success/queued toasts (batch sends emit one summary). */
  silent?: boolean;
  /** Provenance note for the card's activity trail (e.g. "smart match: idle"). */
  via?: string;
}

type AssignFn = (
  task: Task,
  agentId: string,
  options?: DispatchAssignOptions,
) => Promise<void>;
type NotifyFn = (message: string, type: ToastType) => void;

type InFlightListener = (taskIds: Set<string>) => void;

class AgentDispatchService {
  private assignFn: AssignFn | null = null;
  private notifyFn: NotifyFn | null = null;
  private setupFn: (() => void) | null = null;
  /** Tasks mid-dispatch — instant "sending" acknowledgment before the run exists. */
  private inFlight = new Set<string>();
  private inFlightListeners = new Set<InFlightListener>();

  /** Subscribe to the set of task ids currently being dispatched. */
  subscribeInFlight(listener: InFlightListener): () => void {
    this.inFlightListeners.add(listener);
    listener(new Set(this.inFlight));
    return () => {
      this.inFlightListeners.delete(listener);
    };
  }

  isDispatching(taskId: string): boolean {
    return this.inFlight.has(taskId);
  }

  private markInFlight(taskId: string, sending: boolean): void {
    if (sending) this.inFlight.add(taskId);
    else this.inFlight.delete(taskId);
    const snapshot = new Set(this.inFlight);
    this.inFlightListeners.forEach((l) => {
      l(snapshot);
    });
  }

  /** Registered once by useAgentTeammates; entry points dispatch through it. */
  registerHandlers(handlers: { assign: AssignFn; notify: NotifyFn }): void {
    this.assignFn = handlers.assign;
    this.notifyFn = handlers.notify;
  }

  /** True when the board wiring is live and at least one agent can take work. */
  canDispatch(): boolean {
    return (
      this.assignFn !== null &&
      agentService.getAgents().some((a) => Boolean(a.workingDir?.trim()))
    );
  }

  /** App-level hook that deep-links to Settings → Agents (first-run setup). */
  registerSetupHandler(open: () => void): void {
    this.setupFn = open;
  }

  /** Whether entry points can offer a guided "set up your first agent" path. */
  canOfferSetup(): boolean {
    return this.setupFn !== null && agentService.getAgents().length === 0;
  }

  /** Open agent setup — called by entry points when no agent exists yet. */
  requestSetup(): void {
    this.setupFn?.();
  }

  /**
   * Pick the best agent for a task without asking the user anything:
   * 1. the task's assignee, when it already names an agent with a workingDir;
   * 2. otherwise the least-loaded eligible agent (coder role, workingDir set,
   *    under budget), ranked by running+queued load, ties by seniority.
   *
   * `extraLoad` lets batch dispatch account for assignments made earlier in
   * the same fan-out so it spreads work instead of piling on one agent.
   */
  smartMatch(task: Task, extraLoad?: Map<string, number>): SmartMatchResult {
    const withDir = agentService.getAgents().filter((a) => Boolean(a.workingDir?.trim()));
    if (withDir.length === 0) {
      return {
        reason: "No agent has a working directory yet — add one in Settings → Agents.",
      };
    }

    const runs = agentRunService.getRuns();
    const overBudget = (agent: AgentProfile): string | null =>
      checkAgentBudget(agent, getAgentDailyStats(agent.id, runs));

    // Explicit assignment wins: a task already assigned to an agent goes there.
    const assigned = agentService.getAgentByAssignee(task.assignee);
    if (assigned?.workingDir?.trim()) {
      const blocked = overBudget(assigned);
      if (!blocked) return { agent: assigned, matchNote: "task assignee" };
      return { reason: `${assigned.name}: ${blocked}` };
    }

    // Planners decompose epics rather than code; smart match targets coders
    // and only falls back to planners when nothing else exists.
    const coders = withDir.filter((a) => (a.role ?? "default") !== "planner");
    const pool = coders.length > 0 ? coders : withDir;
    const eligible = pool.filter((a) => !overBudget(a));
    if (eligible.length === 0) {
      return { reason: "Every agent is over its daily budget cap." };
    }

    const load = (agent: AgentProfile): number =>
      (agentRunService.isAgentBusy(agent.id) ? 1 : 0) +
      agentRunService.getQueueLengthForAgent(agent.id) +
      (extraLoad?.get(agent.id) ?? 0);

    const ranked = [...eligible].sort((a, b) => {
      const diff = load(a) - load(b);
      if (diff !== 0) return diff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const winner = ranked[0];
    const winnerLoad = load(winner);
    return {
      agent: winner,
      matchNote:
        winnerLoad === 0 ? "idle" : `least busy (${winnerLoad} in pipeline)`,
    };
  }

  /**
   * Send one task to an agent. Omit `agentId` to smart-match. All feedback
   * (handoff, queued position, errors) flows through the registered handlers.
   */
  async dispatch(
    task: Task,
    agentId?: string,
    options?: DispatchAssignOptions,
  ): Promise<DispatchResult> {
    const fail = (reason: string): DispatchResult => {
      if (!options?.silent) this.notifyFn?.(reason, "warning");
      return { taskId: task.id, ok: false, reason };
    };

    if (!this.assignFn) return fail("Agent dispatch is not ready yet.");
    if (agentRunService.getActiveRunForTask(task.id)) {
      return fail(`"${task.title}" already has an active agent run.`);
    }

    let agent: AgentProfile | undefined;
    let via = options?.via;
    if (agentId) {
      agent = agentService.getAgentById(agentId);
      if (!agent) return fail("Agent profile no longer exists.");
    } else {
      const match = this.smartMatch(task);
      if (!match.agent) return fail(match.reason ?? "No eligible agent found.");
      agent = match.agent;
      via = via ?? (match.matchNote ? `smart match: ${match.matchNote}` : "smart match");
    }

    // Acknowledge instantly: the card shows "sending" until the run exists.
    this.markInFlight(task.id, true);
    try {
      const scopeConflict = agentReservationService.wouldTaskConflict(task);
      if (scopeConflict && !options?.silent) {
        this.notifyFn?.(
          `Scope overlap with another run — "${task.title}" will queue for file scope.`,
          "info",
        );
      }
      await this.assignFn(task, agent.id, { ...options, via });
    } finally {
      this.markInFlight(task.id, false);
    }
    const activeRun = agentRunService.getActiveRunForTask(task.id);
    const queued = activeRun?.status === "queued";
    return {
      taskId: task.id,
      ok: true,
      agentName: agent.name,
      queued,
      scopeQueued: Boolean(activeRun?.scopeBlocked),
    };
  }

  /**
   * Fan a batch of tasks out to agents in one action. Per-task toasts are
   * silenced; one summary toast reports sent/queued/skipped counts.
   */
  async dispatchMany(tasks: Task[], agentId?: string): Promise<DispatchSummary> {
    const summary: DispatchSummary = { results: [], sent: 0, queued: 0, skipped: [] };
    const extraLoad = new Map<string, number>();

    for (const task of tasks) {
      if (agentRunService.getActiveRunForTask(task.id)) {
        summary.skipped.push({ task, reason: "already has an active run" });
        continue;
      }

      let targetId = agentId;
      let via: string | undefined;
      if (!targetId) {
        const match = this.smartMatch(task, extraLoad);
        if (!match.agent) {
          summary.skipped.push({ task, reason: match.reason ?? "no eligible agent" });
          continue;
        }
        targetId = match.agent.id;
        via = match.matchNote ? `smart match: ${match.matchNote}` : "smart match";
      }

      let result: DispatchResult;
      try {
        result = await this.dispatch(task, targetId, { silent: true, via });
      } catch (err) {
        result = {
          taskId: task.id,
          ok: false,
          reason: err instanceof Error ? err.message : "dispatch failed",
        };
      }
      summary.results.push(result);
      if (result.ok) {
        summary.sent += 1;
        if (result.queued) summary.queued += 1;
        extraLoad.set(targetId, (extraLoad.get(targetId) ?? 0) + 1);
      } else {
        summary.skipped.push({ task, reason: result.reason ?? "dispatch failed" });
      }
    }

    if (this.notifyFn) {
      const parts: string[] = [];
      if (summary.sent > 0) {
        parts.push(
          `Sent ${summary.sent} task${summary.sent === 1 ? "" : "s"} to agents` +
            (summary.queued > 0 ? ` (${summary.queued} queued)` : ""),
        );
      }
      if (summary.skipped.length > 0) {
        const first = summary.skipped[0];
        parts.push(
          `${summary.skipped.length} skipped — ${first.reason}` +
            (summary.skipped.length > 1 ? " (and more)" : ""),
        );
      }
      if (parts.length > 0) {
        this.notifyFn(
          parts.join(". "),
          summary.sent > 0 ? "success" : "warning",
        );
      }
    }
    return summary;
  }
}

export const agentDispatchService = new AgentDispatchService();
export default agentDispatchService;
