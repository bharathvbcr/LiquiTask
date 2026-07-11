import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  __esModule: true,
  invoke: invokeMock,
}));

vi.mock("../../../core/events/taskEventStore", () => ({
  default: { appendSafe: vi.fn(async () => true) },
}));

const deadLetterMocks = vi.hoisted(() => {
  const record = vi.fn();
  const registerRetryHandler = vi.fn();
  return { record, registerRetryHandler };
});

vi.mock("../../deadLetterService", () => ({
  default: {
    record: (...args: unknown[]) => deadLetterMocks.record(...args),
    registerRetryHandler: (...args: unknown[]) =>
      deadLetterMocks.registerRetryHandler(...args),
  },
}));

const nativeDevVerify = vi.fn();
vi.mock("../../nativeBridge", () => ({
  nativeDevVerify: (...args: unknown[]) => nativeDevVerify(...args),
}));

const evaluateReviewGate = vi.fn();
vi.mock("../feedbackLoopService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../feedbackLoopService")>();
  return {
    ...actual,
    evaluateReviewGate: (...args: unknown[]) => evaluateReviewGate(...args),
  };
});

import type { AgentRun, Task } from "../../../../types";
import type { MergeTxResult } from "../mergePipelineService";

const task = (overrides: Partial<Task> = {}): Task =>
  ({
    id: "task-1",
    jobId: "TSK-1",
    projectId: "p1",
    title: "Fix auth",
    summary: "",
    assignee: "",
    priority: "medium",
    status: "Completed",
    createdAt: new Date(),
    subtasks: [],
    attachments: [],
    tags: [],
    timeEstimate: 0,
    timeSpent: 0,
    ...overrides,
  }) as Task;

const run = (overrides: Partial<AgentRun> = {}): AgentRun =>
  ({
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "completed",
    createdAt: new Date(),
    worktreePath: "/repo/.worktrees/run-1",
    gitBranch: "agent/run-1-fix-auth",
    ...overrides,
  }) as AgentRun;

async function loadPipeline() {
  vi.resetModules();
  const mod = await import("../mergePipelineService");
  return mod.default;
}

describe("mergePipelineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_git_worktree_state") return { exists: true };
      if (cmd === "agent_git_merge_worktree_tx") {
        return {
          status: "merged",
          message: "merged cleanly",
          preMergeSha: "abc123",
          mergedSha: "def456",
        } satisfies MergeTxResult;
      }
      return undefined;
    });
    nativeDevVerify.mockResolvedValue({
      ok: true,
      cli_available: true,
      blocked_tasks: 0,
      tasks: [],
    });
    evaluateReviewGate.mockResolvedValue({
      passed: true,
      blockingIssues: [],
      summary: "ok",
    });
  });

  it("registers a merge retry handler at construction", async () => {
    await loadPipeline();
    expect(deadLetterMocks.registerRetryHandler).toHaveBeenCalledWith(
      "merge",
      expect.any(Function),
    );
  });

  it("runs the transactional merge and returns the invoke result", async () => {
    const mergePipelineService = await loadPipeline();
    const outcome = await mergePipelineService.run({
      task: task(),
      run: run(),
      repoDir: "/repo",
    });
    expect(invokeMock).toHaveBeenCalledWith("agent_git_merge_worktree_tx", {
      repoDir: "/repo",
      worktreePath: "/repo/.worktrees/run-1",
      branch: "agent/run-1-fix-auth",
      commitMessage: null,
      runId: "run-1",
    });
    expect(outcome.result.status).toBe("merged");
  });

  it("blocks when verify gate reports concrete blocking gaps", async () => {
    const mergePipelineService = await loadPipeline();
    nativeDevVerify.mockResolvedValue({
      ok: false,
      cli_available: true,
      blocked_tasks: 0,
      tasks: [
        {
          task_id: "t1",
          status: "blocked",
          gap_count: 1,
          blocking_gap_count: 1,
          gaps: [
            {
              id: "g1",
              severity: "high",
              gap_type: "test",
              description: "missing coverage",
              evidence: [],
              recommended_fix: "",
              blocking: true,
            },
          ],
          next_actions: [],
          advisory_actions: [],
        },
      ],
    });
    await expect(
      mergePipelineService.run({
        task: task(),
        run: run(),
        repoDir: "/repo",
        verify: true,
      }),
    ).rejects.toThrow(/verify gate failed/i);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "merge", taskId: "task-1" }),
    );
  });

  it("blocks when review gate reports blocking issues", async () => {
    const mergePipelineService = await loadPipeline();
    evaluateReviewGate.mockResolvedValue({
      passed: false,
      blockingIssues: ["security hole in auth"],
      summary: "blocked",
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_git_diff") return { diff: "+ unsafe code" };
      throw new Error("should not merge");
    });
    await expect(
      mergePipelineService.run({
        task: task(),
        run: run(),
        repoDir: "/repo",
        llmReview: true,
      }),
    ).rejects.toThrow(/Review gate failed/i);
    expect(invokeMock).not.toHaveBeenCalledWith("agent_git_merge_worktree_tx", expect.anything());
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "merge" }),
    );
  });

  it("runs push+PR path when commitStage is pushPr", async () => {
    const mergePipelineService = await loadPipeline();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_git_push") {
        return { message: "pushed branch", committedHash: "abc123" };
      }
      if (cmd === "agent_git_create_pr") {
        return { url: "https://github.com/acme/widgets/pull/99", stdout: "" };
      }
      throw new Error(`unexpected ${cmd}`);
    });
    const outcome = await mergePipelineService.run({
      task: task(),
      run: run(),
      repoDir: "/repo",
      commitStage: "pushPr",
    });
    expect(invokeMock).toHaveBeenCalledWith("agent_git_push", expect.objectContaining({
      branch: "agent/run-1-fix-auth",
    }));
    expect(invokeMock).toHaveBeenCalledWith("agent_git_create_pr", expect.objectContaining({
      headBranch: "agent/run-1-fix-auth",
    }));
    expect(outcome.prUrl).toBe("https://github.com/acme/widgets/pull/99");
    expect(outcome.result.status).toBe("pushed");
  });

  it("dead-letters and rethrows when merge invoke fails", async () => {
    const mergePipelineService = await loadPipeline();
    invokeMock.mockRejectedValue(new Error("merge conflict"));
    await expect(
      mergePipelineService.run({ task: task(), run: run(), repoDir: "/repo" }),
    ).rejects.toThrow(/merge conflict/);
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "merge",
        detail: "merge conflict",
        payload: expect.objectContaining({ branch: "agent/run-1-fix-auth" }),
      }),
    );
  });

  it("moves the card to Commit when a merge DLQ retry succeeds", async () => {
    const mergePipelineService = await loadPipeline();
    const moveTaskToCommit = vi.fn();
    mergePipelineService.setBoardHooks({ moveTaskToCommit });
    const handler = deadLetterMocks.registerRetryHandler.mock.calls.find(
      ([kind]) => kind === "merge",
    )?.[1] as (letter: { payload: Record<string, unknown> }) => Promise<void>;
    expect(handler).toBeTypeOf("function");
    await handler({
      payload: {
        taskId: "task-1",
        runId: "run-1",
        repoDir: "/repo",
        worktreePath: "/repo/.worktrees/run-1",
        branch: "agent/run-1-fix-auth",
      },
    });
    expect(moveTaskToCommit).toHaveBeenCalledWith("task-1", "merged cleanly");
  });

  it("skips re-merge when the task is already in Commit", async () => {
    const mergePipelineService = await loadPipeline();
    const moveTaskToCommit = vi.fn();
    mergePipelineService.setBoardHooks({
      moveTaskToCommit,
      isTaskCommitted: () => true,
    });
    const handler = deadLetterMocks.registerRetryHandler.mock.calls.find(
      ([kind]) => kind === "merge",
    )?.[1] as (letter: { payload: Record<string, unknown> }) => Promise<void>;
    await handler({
      payload: {
        taskId: "task-1",
        repoDir: "/repo",
        worktreePath: "/repo/.worktrees/run-1",
        branch: "agent/run-1-fix-auth",
      },
    });
    expect(invokeMock).not.toHaveBeenCalledWith("agent_git_merge_worktree_tx", expect.anything());
    expect(moveTaskToCommit).not.toHaveBeenCalled();
  });

  it("advances the board without re-merge when the worktree is already gone", async () => {
    const mergePipelineService = await loadPipeline();
    const moveTaskToCommit = vi.fn();
    mergePipelineService.setBoardHooks({ moveTaskToCommit, isTaskCommitted: () => false });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "agent_git_worktree_state") return { exists: false };
      return {
        status: "merged",
        message: "merged cleanly",
        preMergeSha: "abc123",
        mergedSha: "def456",
      };
    });
    const handler = deadLetterMocks.registerRetryHandler.mock.calls.find(
      ([kind]) => kind === "merge",
    )?.[1] as (letter: { payload: Record<string, unknown> }) => Promise<void>;
    await handler({
      payload: {
        taskId: "task-1",
        repoDir: "/repo",
        worktreePath: "/repo/.worktrees/run-1",
        branch: "agent/run-1-fix-auth",
      },
    });
    expect(invokeMock).not.toHaveBeenCalledWith("agent_git_merge_worktree_tx", expect.anything());
    expect(moveTaskToCommit).toHaveBeenCalledWith(
      "task-1",
      "Merge already completed (worktree absent).",
    );
  });
});
