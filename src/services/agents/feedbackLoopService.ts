import type { AgentProfile, AgentRun, Task, TaskPrState } from "../../../types";
import { COLUMN_STATUS, FEATURE_FLAGS } from "../../constants";
import { localApi } from "../../core/api/localApi";
import taskEventStore from "../../core/events/taskEventStore";
import { isTauri } from "../../runtime/runtimeEnvironment";
import deadLetterService, { type DeadLetter } from "../deadLetterService";
import storageService from "../storageService";
import aiService from "../aiService";
import agentService from "./agentService";
import {
  autoRepairMaxAttempts,
  checkAutoRepairAllowed,
  isAutoRepairEnabled,
  type AutoRepairKind,
} from "./agentPolicyService";
import type { MergeMainIntoWorktreeResult } from "./mergePipelineService";

export interface GitHubPrCheck {
  name: string;
  state: string;
  bucket?: string;
  link?: string;
  workflow?: string;
}

export interface GitHubPrChecksResult {
  prNumber: number;
  checks: GitHubPrCheck[];
  failedCount: number;
  pendingCount: number;
  allPassed: boolean;
}

export interface GitHubPrReviewComment {
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt?: string;
  url?: string;
}

export interface LlmReviewVerdict {
  passed: boolean;
  blockingIssues: string[];
  summary: string;
}

export interface ReviewGateOptions {
  llmReview?: boolean;
  reviewerAgentGate?: boolean;
  reviewerAgent?: AgentProfile;
  repoDir?: string;
}

export type FeedbackDaemonKind =
  | "ci_failed"
  | "review_comments"
  | "pr_opened"
  | "pr_merged"
  | "pr_closed"
  | "pr_draft"
  | "pr_state"
  | "ci_state"
  | "review_state";

export interface FeedbackDaemonEvent {
  kind: FeedbackDaemonKind;
  runId: string;
  taskId: string;
  prUrl?: string;
  payload?: Record<string, unknown>;
}

type FollowUpFn = (runId: string, message: string) => Promise<void>;

/** Runs awaiting an automatic re-merge after a conflict-repair follow-up. */
interface PendingReMerge {
  letter: DeadLetter;
  taskTitle?: string;
}

export interface FeedbackLoopBoardHooks {
  getTask: (taskId: string) => Task | undefined;
  moveTask: (
    taskId: string,
    newStatus: string,
    options?: {
      actor?: "system" | "user";
      viaMergePipeline?: boolean;
      hasPrOpen?: boolean;
      prMerged?: boolean;
    },
  ) => void;
  updateTaskPrState: (taskId: string, patch: TaskPrState, eventType: FeedbackDaemonKind) => void;
  unhideInReviewColumn?: () => void;
}

const WATCH_SYNC_MS = 60_000;
const AUTO_REPAIR_ATTEMPTS_KEY = "liquitask-auto-repair-attempts";

class FeedbackLoopService {
  private pendingReMerge = new Map<string, PendingReMerge>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenFeedback: (() => void) | null = null;
  private getRunsRef: (() => AgentRun[]) | null = null;
  private boardHooks: FeedbackLoopBoardHooks | null = null;
  private autoRepairAttempts = new Map<string, number>();

  constructor() {
    const raw = storageService.get<Record<string, number>>(AUTO_REPAIR_ATTEMPTS_KEY, {}) ?? {};
    this.autoRepairAttempts = new Map(Object.entries(raw));
  }

  private persistAttempts(): void {
    storageService.set(AUTO_REPAIR_ATTEMPTS_KEY, Object.fromEntries(this.autoRepairAttempts));
  }

  setBoardHooks(hooks: FeedbackLoopBoardHooks | null): void {
    this.boardHooks = hooks;
  }

  private attemptKey(taskId: string, kind: AutoRepairKind): string {
    return `${taskId}:${kind}`;
  }

  private getAttemptCount(taskId: string, kind: AutoRepairKind): number {
    return this.autoRepairAttempts.get(this.attemptKey(taskId, kind)) ?? 0;
  }

  private bumpAttempt(taskId: string, kind: AutoRepairKind): number {
    const key = this.attemptKey(taskId, kind);
    const next = (this.autoRepairAttempts.get(key) ?? 0) + 1;
    this.autoRepairAttempts.set(key, next);
    this.persistAttempts();
    return next;
  }

  /** Called when a follow-up run finishes — may trigger re-merge. */
  async onRunFinished(run: AgentRun): Promise<void> {
    const pending = this.pendingReMerge.get(run.id);
    if (!pending || run.status !== "completed") return;
    this.pendingReMerge.delete(run.id);
    const { mergePipelineService } = await import("./mergePipelineService");
    try {
      await mergePipelineService.retryFromDeadLetter(pending.letter);
      deadLetterService.resolve(pending.letter.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deadLetterService.record({
        kind: "merge",
        taskId: pending.letter.taskId,
        runId: run.id,
        title: `Re-merge failed after conflict repair: ${(pending.taskTitle ?? "task").slice(0, 60)}`,
        detail: message,
        payload: pending.letter.payload,
      });
    }
  }

  /**
   * Merge-conflict repair loop: merge main into the worktree, send conflict
   * context to the agent via followUp, then re-merge when the run completes.
   */
  async resolveMergeConflictWithAgent(letter: DeadLetter, followUp: FollowUpFn): Promise<void> {
    if (!isTauri()) throw new Error("Conflict repair requires the desktop app.");
    const p = letter.payload as {
      repoDir?: string;
      worktreePath?: string;
      runId?: string;
      taskTitle?: string;
      branch?: string;
    };
    if (!p.repoDir || !p.worktreePath || !p.runId) {
      throw new Error("Dead letter is missing merge repair parameters.");
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const mergeMain = await invoke<MergeMainIntoWorktreeResult>(
      "agent_git_merge_main_into_worktree",
      {
        repoDir: p.repoDir,
        worktreePath: p.worktreePath,
        baseBranch: null,
      },
    );

    const prompt = buildConflictRepairPrompt(mergeMain, letter.detail);
    await followUp(p.runId, prompt);
    this.pendingReMerge.set(p.runId, { letter, taskTitle: p.taskTitle });
  }

  /** CI-failure loop: fetch logs and send them to the agent. */
  async sendCiFailureToAgent(letter: DeadLetter, followUp: FollowUpFn): Promise<void> {
    if (!isTauri()) throw new Error("CI repair requires the desktop app.");
    const p = letter.payload as {
      runId?: string;
      prUrl?: string;
      repoDir?: string;
      gitBranch?: string;
      failedChecks?: GitHubPrCheck[];
    };
    if (!p.runId || !p.prUrl) throw new Error("CI dead letter is missing run/PR context.");

    const { invoke } = await import("@tauri-apps/api/core");
    let logs = "";
    try {
      logs = await invoke<string>("github_pr_failed_logs", {
        prUrl: p.prUrl,
        workingDir: p.repoDir ?? null,
        headBranch: p.gitBranch ?? null,
      });
    } catch {
      logs = "(Could not fetch workflow logs — see failed check names below.)";
    }

    const checkSummary = (p.failedChecks ?? [])
      .map((c) => `- ${c.name}: ${c.state}${c.link ? ` (${c.link})` : ""}`)
      .join("\n");
    const prompt = [
      "CI checks failed on the pull request. Fix the failures and push an updated commit.",
      "",
      "Failed checks:",
      checkSummary || letter.detail,
      "",
      "Failed job logs (truncated):",
      logs.slice(0, 12_000),
    ].join("\n");

    await followUp(p.runId, prompt);
    deadLetterService.resolve(letter.id);
  }

  /** Review-comment loop: route PR feedback to the worker via followUp. */
  async sendReviewCommentsToAgent(letter: DeadLetter, followUp: FollowUpFn): Promise<void> {
    if (!isTauri()) throw new Error("Review repair requires the desktop app.");
    const p = letter.payload as {
      runId?: string;
      prUrl?: string;
      comments?: GitHubPrReviewComment[];
    };
    if (!p.runId) throw new Error("Review dead letter is missing run context.");

    const prompt = buildReviewFollowUpPrompt(p.comments ?? [], letter.detail);
    await followUp(p.runId, prompt);
    deadLetterService.resolve(letter.id);
  }

  /** @deprecated App-side polling — kept for tests; production uses daemon subscriber. */
  async pollCiForRuns(runs: AgentRun[]): Promise<void> {
    if (!isTauri()) return;
    const candidates = runs.filter((r) => r.prUrl && r.status === "completed");
    if (candidates.length === 0) return;

    const { invoke } = await import("@tauri-apps/api/core");
    for (const run of candidates) {
      try {
        const result = await invoke<GitHubPrChecksResult>("github_pr_checks", {
          prUrl: run.prUrl,
          workingDir: run.repoDir ?? null,
        });
        if (result.pendingCount > 0) continue;
        if (result.allPassed || result.checks.length === 0) continue;
        if (result.failedCount === 0) continue;

        const failed = result.checks.filter((c) => c.state.toUpperCase().includes("FAIL"));
        this.recordCiFailure(run, failed);
      } catch {
        // gh unavailable — skip quietly.
      }
    }
  }

  /** @deprecated App-side polling — kept for tests; production uses daemon subscriber. */
  async pollReviewsForRuns(runs: AgentRun[]): Promise<void> {
    if (!isTauri()) return;
    const candidates = runs.filter((r) => r.prUrl && r.status === "completed");
    if (candidates.length === 0) return;

    const { invoke } = await import("@tauri-apps/api/core");
    for (const run of candidates) {
      try {
        const result = await invoke<{ prNumber: number; comments: GitHubPrReviewComment[] }>(
          "github_pr_review_comments",
          {
            prUrl: run.prUrl,
            workingDir: run.repoDir ?? null,
          },
        );
        const fresh = result.comments.filter((c) => c.body.trim().length > 0);
        if (fresh.length === 0) continue;
        this.recordReviewComments(run, fresh, result.prNumber);
      } catch {
        // Non-fatal — gh may be unavailable.
      }
    }
  }

  /** Subscribe to daemon CI/review events and sync the watch list periodically. */
  startPolling(getRuns: () => AgentRun[]): void {
    if (!isTauri() || this.pollTimer) return;
    this.getRunsRef = getRuns;

    const syncWatchList = () => {
      if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return;
      const runs = getRuns()
        .filter((r) => r.prUrl && r.status === "completed")
        .map((r) => ({
          runId: r.id,
          taskId: r.taskId,
          prUrl: r.prUrl as string,
          repoDir: r.repoDir,
          gitBranch: r.gitBranch,
          status: r.status,
        }));
      void localApi.feedbackWatch(runs);
    };

    void (async () => {
      if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
        this.unlistenFeedback = await localApi.subscribe<FeedbackDaemonEvent>(
          "agentd-feedback-event",
          (ev) => this.handleDaemonEvent(ev),
        );
        syncWatchList();
        this.pollTimer = setInterval(syncWatchList, WATCH_SYNC_MS);
        return;
      }
      // Legacy fallback when sidecar is disabled.
      const tick = () => {
        const runs = getRuns();
        void this.pollCiForRuns(runs);
        void this.pollReviewsForRuns(runs);
      };
      tick();
      this.pollTimer = setInterval(tick, WATCH_SYNC_MS);
    })();
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.unlistenFeedback) {
      this.unlistenFeedback();
      this.unlistenFeedback = null;
    }
    this.getRunsRef = null;
  }

  /** Map daemon feedback events to board transitions + card metadata. */
  handleDaemonEvent(ev: FeedbackDaemonEvent): void {
    const runs = this.getRunsRef?.() ?? [];
    const run = runs.find((r) => r.id === ev.runId);
    if (!run) return;

    const payload = ev.payload ?? {};

    if (ev.kind === "pr_opened" || ev.kind === "pr_draft" || ev.kind === "pr_state") {
      this.handlePrOpened(run, ev);
      return;
    }

    if (ev.kind === "pr_merged") {
      this.handlePrMerged(run, payload);
      return;
    }

    if (ev.kind === "pr_closed") {
      this.patchPrState(run.taskId, {
        url: ev.prUrl ?? run.prUrl,
        prNumber: typeof payload.prNumber === "number" ? payload.prNumber : undefined,
        state: "closed",
        updatedAt: new Date().toISOString(),
      }, "pr_closed");
      return;
    }

    if (ev.kind === "ci_state") {
      const rollup = typeof payload.rollup === "string" ? payload.rollup : undefined;
      const patch: TaskPrState = {
        url: ev.prUrl ?? run.prUrl,
        prNumber: typeof payload.prNumber === "number" ? payload.prNumber : undefined,
        updatedAt: new Date().toISOString(),
      };
      if (rollup === "success") {
        patch.ci = { passed: 1, failed: 0, pending: 0, allPassed: true };
      } else if (rollup === "failure") {
        patch.ci = { passed: 0, failed: 1, pending: 0, allPassed: false };
      } else if (rollup === "pending") {
        patch.ci = { passed: 0, failed: 0, pending: 1, allPassed: false };
      }
      this.patchPrState(run.taskId, patch, "ci_state");
      return;
    }

    if (ev.kind === "review_state") {
      const decision = typeof payload.decision === "string" ? payload.decision : "pending";
      this.patchPrState(
        run.taskId,
        {
          url: ev.prUrl ?? run.prUrl,
          prNumber: typeof payload.prNumber === "number" ? payload.prNumber : undefined,
          review: { decision },
          updatedAt: new Date().toISOString(),
        },
        "review_state",
      );
      if (decision === "changes_requested") {
        this.boardHooks?.moveTask(run.taskId, COLUMN_STATUS.IN_PROGRESS, { actor: "system" });
      }
      return;
    }

    if (ev.kind === "ci_failed") {
      const failedChecks = Array.isArray(payload.failedChecks)
        ? (payload.failedChecks as GitHubPrCheck[])
        : [];
      void this.handleCiFailure(run, failedChecks);
      return;
    }

    if (ev.kind === "review_comments") {
      const comments = Array.isArray(payload.comments)
        ? (payload.comments as GitHubPrReviewComment[])
        : [];
      const prNumber =
        typeof payload.prNumber === "number" ? payload.prNumber : undefined;
      if (comments.length > 0) {
        void this.handleReviewComments(run, comments, prNumber);
      }
    }
  }

  private handlePrOpened(run: AgentRun, ev: FeedbackDaemonEvent): void {
    const payload = ev.payload ?? {};
    const state =
      typeof payload.state === "string"
        ? payload.state
        : ev.kind === "pr_draft"
          ? "draft"
          : "open";
    const patch: TaskPrState = {
      url: ev.prUrl ?? run.prUrl,
      prNumber: typeof payload.prNumber === "number" ? payload.prNumber : undefined,
      state,
      isDraft: state === "draft" || payload.isDraft === true,
      review: {
        decision:
          typeof payload.reviewDecision === "string" ? payload.reviewDecision : "pending",
      },
      updatedAt: new Date().toISOString(),
    };
    this.patchPrState(run.taskId, patch, "pr_opened");
    this.boardHooks?.unhideInReviewColumn?.();
    const task = this.boardHooks?.getTask(run.taskId);
    if (task && task.status === COLUMN_STATUS.COMPLETED) {
      this.boardHooks?.moveTask(run.taskId, COLUMN_STATUS.IN_REVIEW, {
        actor: "system",
        hasPrOpen: true,
      });
    }
  }

  private handlePrMerged(run: AgentRun, payload: Record<string, unknown>): void {
    this.patchPrState(
      run.taskId,
      {
        url: run.prUrl,
        prNumber: typeof payload.prNumber === "number" ? payload.prNumber : undefined,
        state: "merged",
        updatedAt: new Date().toISOString(),
      },
      "pr_merged",
    );
    const task = this.boardHooks?.getTask(run.taskId);
    if (task && task.status === COLUMN_STATUS.IN_REVIEW) {
      this.boardHooks?.moveTask(run.taskId, COLUMN_STATUS.COMMIT, {
        actor: "system",
        viaMergePipeline: true,
        prMerged: true,
      });
    }
  }

  private patchPrState(
    taskId: string,
    patch: TaskPrState,
    source: FeedbackDaemonKind,
  ): void {
    if (this.boardHooks?.updateTaskPrState) {
      this.boardHooks.updateTaskPrState(taskId, patch, source);
      return;
    }
    const task = this.boardHooks?.getTask(taskId);
    if (!task) return;
    void taskEventStore.appendSafe([
      {
        streamId: taskId,
        type: mapFeedbackToTaskEvent(source),
        payload: { prState: patch },
        actor: "system",
      },
    ]);
  }

  private async handleCiFailure(run: AgentRun, failed: GitHubPrCheck[]): Promise<void> {
    this.patchPrState(
      run.taskId,
      {
        url: run.prUrl,
        ci: { passed: 0, failed: failed.length, pending: 0, allPassed: false },
        updatedAt: new Date().toISOString(),
      },
      "ci_failed",
    );
    this.boardHooks?.moveTask(run.taskId, COLUMN_STATUS.IN_PROGRESS, { actor: "system" });

    const letter = this.buildCiLetter(run, failed);
    const agent = agentService.getAgentById(run.agentId);
    if (agent && isAutoRepairEnabled(agent, "ci")) {
      const attempt = this.bumpAttempt(run.taskId, "ci");
      const runs = this.getRunsRef?.() ?? [];
      const block = checkAutoRepairAllowed(agent, "ci", attempt, runs);
      if (!block && run.status === "completed") {
        try {
          await this.sendCiFailureFollowUp(run, failed);
          deadLetterService.record({ ...letter, autoHandled: true });
          return;
        } catch {
          // Fall through to open dead letter for Inbox escalation.
        }
      }
    }

    deadLetterService.record(letter);
  }

  private async sendCiFailureFollowUp(run: AgentRun, failed: GitHubPrCheck[]): Promise<void> {
    if (!isTauri()) throw new Error("CI repair requires the desktop app.");
    if (!run.prUrl) throw new Error("CI repair is missing PR context.");

    const { invoke } = await import("@tauri-apps/api/core");
    let logs = "";
    try {
      logs = await invoke<string>("github_pr_failed_logs", {
        prUrl: run.prUrl,
        workingDir: run.repoDir ?? null,
        headBranch: run.gitBranch ?? null,
      });
    } catch {
      logs = "(Could not fetch workflow logs — see failed check names below.)";
    }

    const checkSummary = failed
      .map((c) => `- ${c.name}: ${c.state}${c.link ? ` (${c.link})` : ""}`)
      .join("\n");
    const prompt = [
      "CI checks failed on the pull request. Fix the failures and push an updated commit.",
      "",
      "Failed checks:",
      checkSummary,
      "",
      "Failed job logs (truncated):",
      logs.slice(0, 12_000),
    ].join("\n");

    const { default: agentRunService } = await import("./agentRunService");
    await agentRunService.followUp(run.id, prompt);
  }

  private async sendReviewFollowUp(run: AgentRun, comments: GitHubPrReviewComment[]): Promise<void> {
    if (!isTauri()) throw new Error("Review repair requires the desktop app.");
    const prompt = buildReviewFollowUpPrompt(comments);
    const { default: agentRunService } = await import("./agentRunService");
    await agentRunService.followUp(run.id, prompt);
  }

  private async handleReviewComments(
    run: AgentRun,
    comments: GitHubPrReviewComment[],
    prNumber?: number,
  ): Promise<void> {
    this.patchPrState(
      run.taskId,
      {
        url: run.prUrl,
        prNumber,
        review: { decision: "commented", unresolvedThreads: comments.length },
        updatedAt: new Date().toISOString(),
      },
      "review_comments",
    );
    this.boardHooks?.moveTask(run.taskId, COLUMN_STATUS.IN_PROGRESS, { actor: "system" });

    const letter = this.buildReviewLetter(run, comments, prNumber);
    const agent = agentService.getAgentById(run.agentId);
    if (agent && isAutoRepairEnabled(agent, "review")) {
      const attempt = this.bumpAttempt(run.taskId, "review");
      const runs = this.getRunsRef?.() ?? [];
      const block = checkAutoRepairAllowed(agent, "review", attempt, runs);
      if (!block && run.status === "completed") {
        try {
          await this.sendReviewFollowUp(run, comments);
          deadLetterService.record({ ...letter, autoHandled: true });
          return;
        } catch {
          // Fall through to open dead letter for Inbox escalation.
        }
      }
    }

    deadLetterService.record(letter);
  }

  private buildCiLetter(run: AgentRun, failed: GitHubPrCheck[]): Omit<DeadLetter, "id" | "createdAt" | "attempts" | "status"> {
    return {
      kind: "ci",
      taskId: run.taskId,
      runId: run.id,
      title: `CI failed: ${failed.map((c) => c.name).slice(0, 3).join(", ")}`,
      detail: failed.map((c) => `${c.name}: ${c.state}`).join("\n"),
      payload: {
        runId: run.id,
        taskId: run.taskId,
        prUrl: run.prUrl,
        repoDir: run.repoDir,
        gitBranch: run.gitBranch,
        failedChecks: failed,
        autoRepairAttempt: this.getAttemptCount(run.taskId, "ci"),
        autoRepairMax: autoRepairMaxAttempts(agentService.getAgentById(run.agentId) ?? ({} as AgentProfile)),
      },
    };
  }

  private buildReviewLetter(
    run: AgentRun,
    comments: GitHubPrReviewComment[],
    prNumber?: number,
  ): Omit<DeadLetter, "id" | "createdAt" | "attempts" | "status"> {
    return {
      kind: "review",
      taskId: run.taskId,
      runId: run.id,
      title: `PR review: ${comments.length} comment(s)${prNumber ? ` on #${prNumber}` : ""}`,
      detail: comments
        .slice(0, 5)
        .map((c) => `${c.author}${c.path ? ` @ ${c.path}` : ""}: ${c.body.slice(0, 300)}`)
        .join("\n\n"),
      payload: {
        runId: run.id,
        taskId: run.taskId,
        prUrl: run.prUrl,
        comments,
        autoRepairAttempt: this.getAttemptCount(run.taskId, "review"),
        autoRepairMax: autoRepairMaxAttempts(agentService.getAgentById(run.agentId) ?? ({} as AgentProfile)),
      },
    };
  }

  private recordCiFailure(run: AgentRun, failed: GitHubPrCheck[]): void {
    void this.handleCiFailure(run, failed);
  }

  private recordReviewComments(
    run: AgentRun,
    comments: GitHubPrReviewComment[],
    prNumber?: number,
  ): void {
    void this.handleReviewComments(run, comments, prNumber);
  }
}

export function mapFeedbackToTaskEvent(
  kind: FeedbackDaemonKind,
): "task.pr_opened" | "task.ci_state" | "task.review_state" {
  switch (kind) {
    case "pr_opened":
    case "pr_draft":
    case "pr_state":
    case "pr_merged":
    case "pr_closed":
      return "task.pr_opened";
    case "ci_state":
    case "ci_failed":
      return "task.ci_state";
    default:
      return "task.review_state";
  }
}

export function mapFeedbackTransition(
  kind: FeedbackDaemonKind,
  taskStatus: string,
): string | null {
  switch (kind) {
    case "pr_opened":
    case "pr_draft":
    case "pr_state":
      return taskStatus === COLUMN_STATUS.COMPLETED ? COLUMN_STATUS.IN_REVIEW : null;
    case "pr_merged":
      return taskStatus === COLUMN_STATUS.IN_REVIEW ? COLUMN_STATUS.COMMIT : null;
    case "ci_failed":
    case "review_comments":
    case "review_state":
      if (kind === "review_state") return null;
      return COLUMN_STATUS.IN_PROGRESS;
    default:
      return null;
  }
}

export function buildConflictRepairPrompt(
  mergeMain: MergeMainIntoWorktreeResult,
  priorDetail?: string,
): string {
  const parts = [
    "The commit pipeline hit merge conflicts. Bring the worktree branch up to date and resolve all conflict markers.",
    mergeMain.message,
  ];
  if (priorDetail?.trim()) {
    parts.push("", "Original merge error:", priorDetail.slice(0, 2000));
  }
  if (mergeMain.conflictFiles.length > 0) {
    parts.push("", "Conflicted files:", ...mergeMain.conflictFiles.map((f) => `- ${f}`));
  }
  if (mergeMain.conflictMarkers.trim()) {
    parts.push("", "Conflict markers (snippets):", mergeMain.conflictMarkers);
  }
  parts.push(
    "",
    "Resolve every conflict, stage the fixes, and commit. Do not force-push or delete the worktree.",
  );
  return parts.join("\n");
}

export function buildReviewFollowUpPrompt(
  comments: GitHubPrReviewComment[],
  fallbackDetail?: string,
): string {
  if (comments.length === 0) {
    return [
      "Address the pull-request review feedback below:",
      fallbackDetail ?? "(no comment bodies returned)",
    ].join("\n\n");
  }
  const lines = comments.slice(0, 12).map((c, i) => {
    const loc = c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : "";
    return `${i + 1}. ${c.author}${loc}: ${c.body.trim()}`;
  });
  return ["Address every pull-request review comment:", "", ...lines].join("\n");
}

/**
 * Unified review gate: optional reviewer-agent (full agent run) or LLM reviewer.
 */
export async function evaluateReviewGate(
  diff: string,
  taskTitle: string,
  options?: ReviewGateOptions,
): Promise<LlmReviewVerdict> {
  if (options?.reviewerAgentGate && options.reviewerAgent) {
    return evaluateReviewerAgentGate(diff, taskTitle, options.reviewerAgent, options.repoDir);
  }
  if (options?.llmReview) {
    return evaluateLlmReviewGate(diff, taskTitle);
  }
  return { passed: true, blockingIssues: [], summary: "Review gate skipped." };
}

/**
 * Optional LLM reviewer merge gate — alternative to DevCouncil verify.
 * Returns blocking issues when the model finds serious problems in the diff.
 */
export async function evaluateLlmReviewGate(
  diff: string,
  taskTitle: string,
): Promise<LlmReviewVerdict> {
  const trimmed = diff.trim();
  if (!trimmed) {
    return { passed: true, blockingIssues: [], summary: "No diff to review." };
  }
  try {
    const prompt = [
      "You are a code reviewer merge gate. Review this diff for a task titled:",
      `"${taskTitle}".`,
      "",
      'Reply with JSON only: {"passed": boolean, "blockingIssues": string[], "summary": string}',
      "",
      "Set passed=false only for serious issues (bugs, security, broken tests, incomplete implementation).",
      "Advisory nits should not block.",
      "",
      "Diff:",
      trimmed.slice(0, 12_000),
    ].join("\n");
    const refined = await aiService.refineTaskDraft(prompt, {}, {
      activeProjectId: "",
      projects: [],
      priorities: [],
    });
    return parseReviewVerdict(refined);
  } catch {
    return { passed: true, blockingIssues: [], summary: "LLM review unavailable — gate skipped." };
  }
}

/**
 * Reviewer-agent gate: spawn a read-only agent run whose verdict feeds Commit.
 * Falls back to the LLM gate when agentd is unavailable.
 */
export async function evaluateReviewerAgentGate(
  diff: string,
  taskTitle: string,
  reviewerAgent: AgentProfile,
  repoDir?: string,
): Promise<LlmReviewVerdict> {
  const trimmed = diff.trim();
  if (!trimmed) {
    return { passed: true, blockingIssues: [], summary: "No diff to review." };
  }
  if (!isTauri() || !FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
    return evaluateLlmReviewGate(diff, taskTitle);
  }

  const prompt = [
    "You are a merge-gate code reviewer. Review this diff for a task titled:",
    `"${taskTitle}".`,
    "",
    'Reply with JSON only on your final line: {"passed": boolean, "blockingIssues": string[], "summary": string}',
    "",
    "Set passed=false only for serious issues (bugs, security, broken tests, incomplete implementation).",
    "Do not modify any files — review only.",
    "",
    "Diff:",
    trimmed.slice(0, 12_000),
  ].join("\n");

  try {
    const runId = await localApi.runStart({
      taskId: `review-${Date.now()}`,
      runtime: reviewerAgent.provider,
      prompt,
      cwd: repoDir ?? reviewerAgent.workingDir,
      model: reviewerAgent.model,
      permissionMode: "plan",
      autoApprove: true,
      toolPolicy: { "*": "deny", Read: "allow", Grep: "allow", Glob: "allow" },
      sandboxMode: reviewerAgent.sandboxMode ?? "os",
      timeoutMs: 5 * 60_000,
    });
    if (!runId) {
      return evaluateLlmReviewGate(diff, taskTitle);
    }

    const verdict = await waitForReviewerVerdict(runId);
    if (verdict) return verdict;
    return evaluateLlmReviewGate(diff, taskTitle);
  } catch {
    return evaluateLlmReviewGate(diff, taskTitle);
  }
}

async function waitForReviewerVerdict(runId: string): Promise<LlmReviewVerdict | null> {
  const deadline = Date.now() + 5 * 60_000;
  let lastText = "";

  return new Promise((resolve) => {
    let unlisten: (() => void) | undefined;
    const finish = (verdict: LlmReviewVerdict | null) => {
      unlisten?.();
      resolve(verdict);
    };

    void localApi.subscribe<{ runId?: string; kind?: string; text?: string; status?: string }>(
      "agentd-run-event",
      (ev) => {
        if (ev.runId !== runId) return;
        if (ev.kind === "message" && ev.text?.trim()) {
          lastText = ev.text;
        }
        if (ev.kind === "result") {
          const parsed = parseReviewVerdictFromText(ev.text ?? lastText);
          finish(parsed);
        }
        if (ev.kind === "error") {
          finish(null);
        }
      },
    ).then((fn) => {
      unlisten = fn;
    });

    const poll = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(poll);
        await localApi.runCancel(runId).catch(() => undefined);
        finish(parseReviewVerdictFromText(lastText));
        return;
      }
      const events = await localApi.listRunEvents?.(runId);
      if (!events?.length) return;
      const terminal = events.find((e) => e.kind === "result" || e.kind === "error");
      if (terminal) {
        clearInterval(poll);
        if (terminal.kind === "error") {
          finish(null);
        } else {
          finish(parseReviewVerdictFromText(terminal.text ?? lastText));
        }
      }
    }, 2000);
  });
}

function parseReviewVerdictFromText(text: string): LlmReviewVerdict | null {
  const match = text.match(/\{[\s\S]*"passed"[\s\S]*\}/);
  if (!match) return null;
  try {
    return parseReviewVerdict(JSON.parse(match[0]) as Record<string, unknown>);
  } catch {
    return null;
  }
}

function parseReviewVerdict(raw: unknown): LlmReviewVerdict {
  const obj =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const blockingIssues = Array.isArray(obj.blockingIssues)
    ? obj.blockingIssues.filter((s): s is string => typeof s === "string")
    : [];
  return {
    passed: obj.passed !== false,
    blockingIssues,
    summary: typeof obj.summary === "string" ? obj.summary : "",
  };
}

export const feedbackLoopService = new FeedbackLoopService();
export default feedbackLoopService;
