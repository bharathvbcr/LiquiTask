import type { AgentProfile, AgentRun, Task } from "../../../types";
import taskEventStore from "../../core/events/taskEventStore";
import { isTauri } from "../../runtime/runtimeEnvironment";
import deadLetterService, { type DeadLetter } from "../deadLetterService";
import { nativeDevVerify, type DevVerifyResult } from "../nativeBridge";
import { evaluateReviewGate } from "./feedbackLoopService";

/**
 * The transactional Commit-stage pipeline (Completed → Commit).
 *
 * Both entry points — the Approve button and dragging a card into the Commit
 * column — run this exact sequence:
 *
 *   verify (DevCouncil gate, when enabled)
 *     → optional LLM / reviewer-agent review gate
 *     → merge path: agent_git_merge_worktree_tx (repo-locked; pre-merge SHA captured;
 *       auto-commit → --no-ff merge → prune; rollback on partial failure)
 *     → push+PR path: agent_git_push → agent_git_create_pr (branch stays remote)
 *     → worktree.merged / pr.opened event appended to the task log
 *     → the card is moved to Commit by the caller with `viaMergePipeline`
 *
 * Every failure is recorded as a `merge.failed` event AND dead-lettered with
 * a retryable payload, so a conflicted or interrupted merge is never a silent
 * dead end — it shows up in the Inbox with a Retry action.
 */

export type CommitStageMode = "merge" | "pushPr";

export interface MergeTxResult {
  status: "merged" | "noop";
  message: string;
  preMergeSha: string;
  mergedSha?: string;
  committedHash?: string;
}

export interface PushPrResult {
  status: "pushed";
  message: string;
  prUrl?: string;
  committedHash?: string;
}

export type CommitPipelineResult = MergeTxResult | PushPrResult;

export interface MergeMainIntoWorktreeResult {
  status: "clean" | "conflicts" | "already_up_to_date" | string;
  baseBranch: string;
  conflictFiles: string[];
  conflictMarkers: string;
  message: string;
}

export interface CommitPipelineInput {
  task: Task;
  run: AgentRun;
  /** Repo root (the agent's workingDir). */
  repoDir: string;
  /** Run DevCouncil verify gate before merging. */
  verify?: boolean;
  /** Run LLM diff review gate instead of (or after) DevCouncil verify. */
  llmReview?: boolean;
  /** Optional reviewer-agent gate (full agent run, read-only). */
  reviewerAgent?: AgentProfile;
  reviewerAgentGate?: boolean;
  /** Commit strategy: local merge (default) or push + open PR. */
  commitStage?: CommitStageMode;
  commitMessage?: string;
}

export interface CommitPipelineOutcome {
  result: CommitPipelineResult;
  commitStage: CommitStageMode;
  verifyPassed?: boolean;
  llmReviewPassed?: boolean;
  prUrl?: string;
}

/** Board actions the pipeline needs after a successful retry from the DLQ. */
export interface MergePipelineBoardHooks {
  moveTaskToCommit: (taskId: string, note: string) => void;
  /** Move card to In Review after push+PR opens a pull request. */
  moveTaskToInReview?: (taskId: string, note: string, prUrl: string) => void;
  /** Skip re-merge when the card already advanced to Commit. */
  isTaskCommitted?: (taskId: string) => boolean;
  /** Persist prUrl on the run after push+PR commit. */
  setRunPrUrl?: (runId: string, prUrl: string) => void;
}

export interface VerifyGateDecision {
  passed: boolean;
  blockingGaps: string[];
  blockCount: number;
}

/**
 * Decide whether the DevCouncil verify gate should block a merge. Only
 * *concrete* blocking evidence stops it — blocking gaps or blocked tasks. A
 * non-passing verdict with neither (e.g. nothing tracked to verify, or only
 * advisory findings) must NOT block: that produced the contradictory
 * "verify gate failed (0 gap(s))" that blocked legitimate commits.
 */
export function evaluateVerifyGate(verdict: DevVerifyResult): VerifyGateDecision {
  const blockingGaps = (verdict.tasks ?? [])
    .flatMap((t) => t.gaps ?? [])
    .filter((g) => g.blocking)
    .map((g) => g.description)
    .filter((d): d is string => Boolean(d?.trim()));
  const blockCount = Math.max(blockingGaps.length, verdict.blocked_tasks ?? 0);
  return { passed: blockCount === 0, blockingGaps, blockCount };
}

class MergePipelineService {
  private boardHooks: MergePipelineBoardHooks | null = null;

  constructor() {
    deadLetterService.registerRetryHandler("merge", (letter) => this.retryFromLetter(letter));
  }

  setBoardHooks(hooks: MergePipelineBoardHooks): void {
    this.boardHooks = hooks;
  }

  /**
   * Execute the pipeline. Throws on failure (after dead-lettering); the
   * caller keeps the card in Completed and surfaces the reason.
   */
  async run(input: CommitPipelineInput): Promise<CommitPipelineOutcome> {
    if (!isTauri()) throw new Error("The commit pipeline requires the desktop app.");
    const { task, run, repoDir } = input;
    if (!run.worktreePath || !run.gitBranch) {
      throw new Error("No worktree/branch recorded on this run — nothing to merge.");
    }

    const commitStage: CommitStageMode = input.commitStage ?? "merge";

    let verifyPassed: boolean | undefined;
    let llmReviewPassed: boolean | undefined;
    try {
      // -- Gate: DevCouncil verification (context-aware, optional) ----------
      if (input.verify) {
        const verdict = await nativeDevVerify(run.worktreePath ?? repoDir).catch(() => null);
        if (verdict?.cli_available) {
          const gate = evaluateVerifyGate(verdict);
          verifyPassed = gate.passed;
          if (!gate.passed) {
            throw new Error(
              `DevCouncil verify gate failed (${gate.blockCount} blocking issue(s))${
                gate.blockingGaps.length ? `: ${gate.blockingGaps.slice(0, 5).join("; ")}` : ""
              }`,
            );
          }
        }
        // CLI missing → gate degrades gracefully (recorded as undefined).
      }

      // -- Gate: optional LLM / reviewer-agent review -------------------------
      if (input.llmReview || input.reviewerAgentGate) {
        const diffResult = await (async () => {
          const { invoke } = await import("@tauri-apps/api/core");
          return invoke<{ diff: string }>("agent_git_diff", {
            workingDir: run.worktreePath ?? repoDir,
            baseRef: null,
          });
        })();
        const reviewGate = await evaluateReviewGate(diffResult.diff, task.title, {
          llmReview: input.llmReview,
          reviewerAgentGate: input.reviewerAgentGate,
          reviewerAgent: input.reviewerAgent,
          repoDir,
        });
        llmReviewPassed = reviewGate.passed;
        if (!reviewGate.passed) {
          throw new Error(
            `Review gate failed (${reviewGate.blockingIssues.length} blocking issue(s))${
              reviewGate.blockingIssues.length
                ? `: ${reviewGate.blockingIssues.slice(0, 5).join("; ")}`
                : reviewGate.summary
                  ? `: ${reviewGate.summary.slice(0, 200)}`
                  : ""
            }`,
          );
        }
      }

      const { invoke } = await import("@tauri-apps/api/core");

      if (commitStage === "pushPr") {
        const pushResult = await invoke<{ message: string; committedHash?: string }>(
          "agent_git_push",
          {
            repoDir,
            worktreePath: run.worktreePath,
            branch: run.gitBranch,
            commitMessage: input.commitMessage ?? null,
          },
        );
        const prResult = await invoke<{ url?: string; stdout: string }>("agent_git_create_pr", {
          workingDir: repoDir,
          title: task.title,
          body: run.summary ?? "Agent teammate run",
          headBranch: run.gitBranch,
        });
        const prUrl = prResult.url;
        const message = prUrl
          ? `${pushResult.message}; opened ${prUrl}`
          : `${pushResult.message}; ${prResult.stdout || "PR created"}`;
        const result: PushPrResult = {
          status: "pushed",
          message,
          prUrl,
          committedHash: pushResult.committedHash,
        };

        if (prUrl) {
          this.boardHooks?.setRunPrUrl?.(run.id, prUrl);
          this.boardHooks?.moveTaskToInReview?.(
            task.id,
            message,
            prUrl,
          );
        }

        void taskEventStore.appendSafe([
          {
            streamId: task.id,
            type: "task.pr_opened",
            payload: {
              branch: run.gitBranch,
              prUrl,
              prState: {
                url: prUrl,
                state: "open",
                updatedAt: new Date().toISOString(),
              },
              committedHash: pushResult.committedHash,
              message,
              verifyPassed,
              llmReviewPassed,
            },
            actor: "system",
            runId: run.id,
          },
        ]);

        return { result, commitStage, verifyPassed, llmReviewPassed, prUrl };
      }

      // -- Transactional merge ----------------------------------------------
      const result = await invoke<MergeTxResult>("agent_git_merge_worktree_tx", {
        repoDir,
        worktreePath: run.worktreePath,
        branch: run.gitBranch,
        commitMessage: input.commitMessage ?? null,
        runId: run.id,
      });

      void taskEventStore.appendSafe([
        {
          streamId: task.id,
          type: "worktree.merged",
          payload: {
            branch: run.gitBranch,
            preMergeSha: result.preMergeSha,
            mergedSha: result.mergedSha,
            committedHash: result.committedHash,
            message: result.message,
            verifyPassed,
            llmReviewPassed,
          },
          actor: "user",
          runId: run.id,
        },
      ]);

      return { result, commitStage, verifyPassed, llmReviewPassed };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void taskEventStore.appendSafe([
        {
          streamId: task.id,
          type: "merge.failed",
          payload: {
            branch: run.gitBranch,
            reason: reason.slice(0, 1000),
            verifyPassed,
            llmReviewPassed,
            commitStage,
          },
          actor: "user",
          runId: run.id,
        },
      ]);
      deadLetterService.record({
        kind: "merge",
        taskId: task.id,
        runId: run.id,
        title: `Merge failed: ${task.title.slice(0, 80)}`,
        detail: reason,
        payload: {
          taskId: task.id,
          runId: run.id,
          repoDir,
          worktreePath: run.worktreePath,
          branch: run.gitBranch,
          commitMessage: input.commitMessage,
          verify: input.verify ?? false,
          commitStage,
          taskTitle: task.title,
        },
      });
      throw err;
    }
  }

  /** DLQ retry: re-run the transactional merge from the letter's payload. */
  async retryFromDeadLetter(letter: DeadLetter): Promise<void> {
    await this.retryFromLetter(letter);
  }

  /** DLQ retry: re-run the transactional merge from the letter's payload. */
  private async retryFromLetter(letter: DeadLetter): Promise<void> {
    if (!isTauri()) throw new Error("The commit pipeline requires the desktop app.");
    const p = letter.payload as {
      taskId?: string;
      runId?: string;
      repoDir?: string;
      worktreePath?: string;
      branch?: string;
      commitMessage?: string;
      commitStage?: CommitStageMode;
    };
    if (!p.repoDir || !p.worktreePath || !p.branch) {
      throw new Error("Dead letter is missing merge parameters.");
    }

    if (p.taskId && this.boardHooks?.isTaskCommitted?.(p.taskId)) {
      return;
    }

    const { invoke } = await import("@tauri-apps/api/core");
    const state = await invoke<{ exists: boolean }>("agent_git_worktree_state", {
      repoDir: p.repoDir,
      worktreePath: p.worktreePath,
    });
    if (!state.exists) {
      if (p.repoDir && p.branch) {
        const merged = await invoke<boolean>("agent_git_branch_is_ancestor", {
          repoDir: p.repoDir,
          branch: p.branch,
        });
        if (merged && p.taskId) {
          this.boardHooks?.moveTaskToCommit(
            p.taskId,
            "Merge already completed (branch merged into HEAD).",
          );
        }
      }
      return;
    }

    if ((p.commitStage ?? "merge") === "pushPr") {
      throw new Error("Push+PR dead letters must be retried from the Commit action, not auto-merge.");
    }

    const result = await invoke<MergeTxResult>("agent_git_merge_worktree_tx", {
      repoDir: p.repoDir,
      worktreePath: p.worktreePath,
      branch: p.branch,
      commitMessage: p.commitMessage ?? null,
      runId: p.runId ?? null,
    });
    if (p.taskId) {
      void taskEventStore.appendSafe([
        {
          streamId: p.taskId,
          type: "worktree.merged",
          payload: {
            branch: p.branch,
            preMergeSha: result.preMergeSha,
            mergedSha: result.mergedSha,
            message: `${result.message} (retried from dead-letter queue)`,
          },
          actor: "user",
          runId: p.runId,
        },
      ]);
      this.boardHooks?.moveTaskToCommit(p.taskId, result.message);
    }
  }
}

export const mergePipelineService = new MergePipelineService();
export default mergePipelineService;
