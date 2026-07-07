import type { AgentRun, Task } from "../../../types";
import taskEventStore from "../../core/events/taskEventStore";
import { isTauri } from "../../runtime/runtimeEnvironment";
import deadLetterService, { type DeadLetter } from "../deadLetterService";
import { nativeDevVerify } from "../nativeBridge";

/**
 * The transactional Commit-stage pipeline (Completed → Commit).
 *
 * Both entry points — the Approve button and dragging a card into the Commit
 * column — run this exact sequence:
 *
 *   verify (DevCouncil gate, when enabled)
 *     → agent_git_merge_worktree_tx (repo-locked; pre-merge SHA captured;
 *       auto-commit → --no-ff merge → prune; rollback on partial failure)
 *     → worktree.merged event appended to the task log
 *     → the card is moved to Commit by the caller with `viaMergePipeline`
 *
 * Every failure is recorded as a `merge.failed` event AND dead-lettered with
 * a retryable payload, so a conflicted or interrupted merge is never a silent
 * dead end — it shows up in the Inbox with a Retry action.
 */

export interface MergeTxResult {
  status: "merged" | "noop";
  message: string;
  preMergeSha: string;
  mergedSha?: string;
  committedHash?: string;
}

export interface CommitPipelineInput {
  task: Task;
  run: AgentRun;
  /** Repo root (the agent's workingDir). */
  repoDir: string;
  /** Run the DevCouncil verify gate before merging. */
  verify?: boolean;
  commitMessage?: string;
}

export interface CommitPipelineOutcome {
  result: MergeTxResult;
  verifyPassed?: boolean;
}

/** Board actions the pipeline needs after a successful retry from the DLQ. */
export interface MergePipelineBoardHooks {
  moveTaskToCommit: (taskId: string, note: string) => void;
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

    let verifyPassed: boolean | undefined;
    try {
      // -- Gate: DevCouncil verification (context-aware, optional) ----------
      if (input.verify) {
        const verdict = await nativeDevVerify(run.worktreePath ?? repoDir).catch(() => null);
        if (verdict?.cli_available) {
          verifyPassed = verdict.ok && verdict.blocked_tasks === 0;
          if (!verifyPassed) {
            const gaps = verdict.tasks
              .flatMap((t) => t.gaps)
              .filter((g) => g.blocking)
              .map((g) => g.description)
              .slice(0, 5);
            throw new Error(
              `DevCouncil verify gate failed (${verdict.total_gaps} gap(s))${
                gaps.length ? `: ${gaps.join("; ")}` : ""
              }`,
            );
          }
        }
        // CLI missing → gate degrades gracefully (recorded as undefined).
      }

      // -- Transactional merge ----------------------------------------------
      const { invoke } = await import("@tauri-apps/api/core");
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
          },
          actor: "user",
          runId: run.id,
        },
      ]);

      return { result, verifyPassed };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      void taskEventStore.appendSafe([
        {
          streamId: task.id,
          type: "merge.failed",
          payload: { branch: run.gitBranch, reason: reason.slice(0, 1000), verifyPassed },
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
          taskTitle: task.title,
        },
      });
      throw err;
    }
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
    };
    if (!p.repoDir || !p.worktreePath || !p.branch) {
      throw new Error("Dead letter is missing merge parameters.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
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
