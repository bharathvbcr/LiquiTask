import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));

vi.mock("../../../constants", () => ({
  COLUMN_STATUS: {
    TASK: "Task",
    IN_PROGRESS: "InProgress",
    COMPLETED: "Completed",
    IN_REVIEW: "InReview",
    COMMIT: "Commit",
  },
  FEATURE_FLAGS: { AGENTD_SIDECAR_ENABLED: false },
}));

const feedbackWatch = vi.fn();
vi.mock("../../../core/api/localApi", () => ({
  localApi: {
    feedbackWatch: (...args: unknown[]) => feedbackWatch(...args),
    subscribe: vi.fn(async () => () => undefined),
    listRunEvents: vi.fn(async () => []),
    runStart: vi.fn(),
    runCancel: vi.fn(),
  },
}));

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const deadLetterMocks = vi.hoisted(() => ({
  record: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("../../deadLetterService", () => ({
  default: {
    record: (...args: unknown[]) => deadLetterMocks.record(...args),
    resolve: (...args: unknown[]) => deadLetterMocks.resolve(...args),
  },
}));

const getAgentById = vi.fn();
vi.mock("../agentService", () => ({
  default: {
    getAgentById: (...args: unknown[]) => getAgentById(...args),
  },
}));

const followUpMock = vi.fn();
vi.mock("../agentRunService", () => ({
  default: {
    followUp: (...args: unknown[]) => followUpMock(...args),
  },
}));

const refineTaskDraft = vi.fn();
vi.mock("../../aiService", () => ({
  default: { refineTaskDraft: (...args: unknown[]) => refineTaskDraft(...args) },
}));

const retryFromDeadLetter = vi.fn();
vi.mock("../mergePipelineService", () => ({
  mergePipelineService: {
    retryFromDeadLetter: (...args: unknown[]) => retryFromDeadLetter(...args),
  },
}));

import type { AgentRun } from "../../../../types";
import feedbackLoopService, {
  buildConflictRepairPrompt,
  buildReviewFollowUpPrompt,
  evaluateLlmReviewGate,
  evaluateReviewGate,
  mapFeedbackTransition,
} from "../feedbackLoopService";

const run = (overrides: Partial<AgentRun> = {}): AgentRun =>
  ({
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "completed",
    createdAt: new Date(),
    worktreePath: "/repo/.worktrees/run-1",
    gitBranch: "agent/run-1-fix-auth",
    prUrl: "https://github.com/acme/widgets/pull/42",
    repoDir: "/repo",
    ...overrides,
  }) as AgentRun;

describe("feedbackLoopService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAgentById.mockReturnValue(undefined);
    invokeMock.mockResolvedValue({
      status: "conflicts",
      baseBranch: "main",
      conflictFiles: ["src/auth.ts"],
      conflictMarkers: "<<<<<<< HEAD",
      message: "conflicts in 1 file",
    });
    retryFromDeadLetter.mockResolvedValue(undefined);
    refineTaskDraft.mockResolvedValue({
      passed: true,
      blockingIssues: [],
      summary: "Looks good",
    });
    followUpMock.mockResolvedValue(undefined);
  });

  it("builds a conflict repair prompt with file list and markers", () => {
    const prompt = buildConflictRepairPrompt(
      {
        status: "conflicts",
        baseBranch: "main",
        conflictFiles: ["src/a.ts", "src/b.ts"],
        conflictMarkers: "<<<<<<< HEAD\n=======\n>>>>>>> main",
        message: "stopped with conflicts",
      },
      "merge conflict in src/a.ts",
    );
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("<<<<<<< HEAD");
    expect(prompt).toContain("Original merge error:");
  });

  it("builds a review follow-up prompt from PR comments", () => {
    const prompt = buildReviewFollowUpPrompt([
      { author: "alice", body: "Please add tests", path: "src/foo.ts", line: 12 },
    ]);
    expect(prompt).toContain("alice");
    expect(prompt).toContain("Please add tests");
    expect(prompt).toContain("src/foo.ts:12");
  });

  it("resolveMergeConflictWithAgent merges main then followUps", async () => {
    const followUp = vi.fn(async () => undefined);
    await feedbackLoopService.resolveMergeConflictWithAgent(
      {
        id: "dlq-1",
        kind: "merge",
        title: "Merge failed",
        detail: "conflict",
        payload: {
          repoDir: "/repo",
          worktreePath: "/repo/.worktrees/run-1",
          runId: "run-1",
          taskTitle: "Fix auth",
        },
        createdAt: new Date(),
        attempts: 0,
        status: "open",
      },
      followUp,
    );
    expect(invokeMock).toHaveBeenCalledWith("agent_git_merge_main_into_worktree", {
      repoDir: "/repo",
      worktreePath: "/repo/.worktrees/run-1",
      baseBranch: null,
    });
    expect(followUp).toHaveBeenCalledWith("run-1", expect.stringContaining("conflict"));
  });

  it("onRunFinished re-merges after a conflict-repair follow-up completes", async () => {
    const followUp = vi.fn(async () => undefined);
    const letter = {
      id: "dlq-1",
      kind: "merge" as const,
      title: "Merge failed",
      detail: "conflict",
      payload: {
        repoDir: "/repo",
        worktreePath: "/repo/.worktrees/run-1",
        runId: "run-1",
        taskTitle: "Fix auth",
      },
      createdAt: new Date(),
      attempts: 0,
      status: "open" as const,
    };
    await feedbackLoopService.resolveMergeConflictWithAgent(letter, followUp);
    await feedbackLoopService.onRunFinished(run({ status: "completed" }));
    expect(retryFromDeadLetter).toHaveBeenCalledWith(letter);
    expect(deadLetterMocks.resolve).toHaveBeenCalledWith("dlq-1");
  });

  it("pollCiForRuns dead-letters when gh pr checks fail", async () => {
    invokeMock.mockResolvedValue({
      prNumber: 42,
      checks: [{ name: "test", state: "FAILURE" }],
      failedCount: 1,
      pendingCount: 0,
      allPassed: false,
    });
    await feedbackLoopService.pollCiForRuns([run()]);
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ci", runId: "run-1" }),
    );
  });

  it("pollReviewsForRuns dead-letters when PR comments exist", async () => {
    invokeMock.mockResolvedValue({
      prNumber: 42,
      comments: [{ author: "bob", body: "nit: rename this" }],
    });
    await feedbackLoopService.pollReviewsForRuns([run()]);
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "review", runId: "run-1" }),
    );
  });

  it("maps pr_opened to InReview when task is Completed", () => {
    expect(mapFeedbackTransition("pr_opened", "Completed")).toBe("InReview");
    expect(mapFeedbackTransition("pr_opened", "InReview")).toBeNull();
  });

  it("maps pr_merged to Commit when task is InReview", () => {
    expect(mapFeedbackTransition("pr_merged", "InReview")).toBe("Commit");
  });

  it("handleDaemonEvent moves task to InReview on pr_opened", () => {
    const moveTask = vi.fn();
    const updateTaskPrState = vi.fn();
    feedbackLoopService.setBoardHooks({
      getTask: () =>
        ({
          id: "task-1",
          status: "Completed",
        }) as never,
      moveTask,
      updateTaskPrState,
    });
    feedbackLoopService.startPolling(() => [run()]);
    feedbackLoopService.handleDaemonEvent({
      kind: "pr_opened",
      runId: "run-1",
      taskId: "task-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      payload: { state: "open", prNumber: 42 },
    });
    expect(updateTaskPrState).toHaveBeenCalled();
    expect(moveTask).toHaveBeenCalledWith("task-1", "InReview", {
      actor: "system",
      hasPrOpen: true,
    });
    feedbackLoopService.setBoardHooks(null);
    feedbackLoopService.stopPolling();
  });

  it("auto-repairs CI failures when policy enabled and within max attempts", async () => {
    getAgentById.mockReturnValue({
      id: "agent-1",
      autoRepair: { ciFailures: true, maxAttempts: 2 },
    });
    invokeMock.mockResolvedValue("log output");
    const moveTask = vi.fn();
    feedbackLoopService.setBoardHooks({
      getTask: () => ({ id: "task-1", status: "InReview" }) as never,
      moveTask,
      updateTaskPrState: vi.fn(),
    });
    feedbackLoopService.startPolling(() => [run()]);
    feedbackLoopService.handleDaemonEvent({
      kind: "ci_failed",
      runId: "run-1",
      taskId: "task-1",
      payload: { failedChecks: [{ name: "test", state: "FAILURE" }] },
    });
    await vi.waitFor(() => {
      expect(followUpMock).toHaveBeenCalled();
    });
    expect(deadLetterMocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ci", autoHandled: true }),
    );
    feedbackLoopService.setBoardHooks(null);
    feedbackLoopService.stopPolling();
  });

  it("escalates CI failures to Inbox when auto-repair max attempts exceeded", async () => {
    getAgentById.mockReturnValue({
      id: "agent-1",
      autoRepair: { ciFailures: true, maxAttempts: 1 },
    });
    invokeMock.mockResolvedValue("log output");
    feedbackLoopService.setBoardHooks({
      getTask: () => ({ id: "task-1", status: "InReview" }) as never,
      moveTask: vi.fn(),
      updateTaskPrState: vi.fn(),
    });
    feedbackLoopService.startPolling(() => [run()]);
    feedbackLoopService.handleDaemonEvent({
      kind: "ci_failed",
      runId: "run-1",
      taskId: "task-1",
      payload: { failedChecks: [{ name: "test", state: "FAILURE" }] },
    });
    feedbackLoopService.handleDaemonEvent({
      kind: "ci_failed",
      runId: "run-1",
      taskId: "task-1",
      payload: { failedChecks: [{ name: "lint", state: "FAILURE" }] },
    });
    await vi.waitFor(() => {
      expect(deadLetterMocks.record.mock.calls.some((c) => !c[0]?.autoHandled)).toBe(true);
    });
    feedbackLoopService.setBoardHooks(null);
    feedbackLoopService.stopPolling();
  });

  it("evaluateLlmReviewGate blocks when the model returns passed=false", async () => {
    refineTaskDraft.mockResolvedValue({
      passed: false,
      blockingIssues: ["Missing error handling"],
      summary: "Incomplete",
    });
    const verdict = await evaluateLlmReviewGate("+ added feature\n", "Add feature");
    expect(verdict.passed).toBe(false);
    expect(verdict.blockingIssues).toContain("Missing error handling");
  });

  it("evaluateLlmReviewGate degrades gracefully when AI is unavailable", async () => {
    refineTaskDraft.mockRejectedValue(new Error("no provider"));
    const verdict = await evaluateLlmReviewGate("+ diff", "Task");
    expect(verdict.passed).toBe(true);
    expect(verdict.summary).toContain("unavailable");
  });

  it("evaluateReviewGate delegates to LLM review when llmReview is enabled", async () => {
    refineTaskDraft.mockResolvedValue({
      passed: true,
      blockingIssues: [],
      summary: "ok",
    });
    const verdict = await evaluateReviewGate("+ diff", "Task", { llmReview: true });
    expect(verdict.passed).toBe(true);
  });

  it("evaluateReviewGate skips when no gate options are set", async () => {
    const verdict = await evaluateReviewGate("+ diff", "Task");
    expect(verdict.passed).toBe(true);
    expect(verdict.summary).toContain("skipped");
  });
});
