import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COLUMN_STATUS } from "../../constants";
import type { AgentProfile, AgentRun, BoardColumn, Task } from "../../../types";

const mockAgentRunService = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(() => () => {}),
  setWorkspaceResolver: vi.fn(),
  setTaskHooks: vi.fn(),
  rehydrateActiveRuns: vi.fn(),
  flushPendingBoardSync: vi.fn(),
  signalReady: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  isReady: vi.fn(() => true),
  pruneStaleWorktrees: vi.fn(),
  getRuns: vi.fn(() => []),
  getRunsForTask: vi.fn(() => []),
  getActiveRunForTask: vi.fn(() => undefined),
  assign: vi.fn(),
  cancel: vi.fn(),
  mergeWorktree: vi.fn(),
  rejectWithFeedback: vi.fn(),
  removeRun: vi.fn(),
  clearFinishedRuns: vi.fn(() => 0),
  restoreRuns: vi.fn(() => 0),
}));

const mockAgentService = vi.hoisted(() => ({
  getAgents: vi.fn(() => []),
  getAgentById: vi.fn(),
  getAgentByAssignee: vi.fn(),
}));

const mockDeadLetterService = vi.hoisted(() => ({
  registerRetryHandler: vi.fn(),
  record: vi.fn(),
  discardAll: vi.fn(() => 0),
}));

const mockMergePipelineService = vi.hoisted(() => ({
  setBoardHooks: vi.fn(),
}));

vi.mock("../../runtime/runtimeEnvironment", () => ({ isTauri: () => true }));
vi.mock("../../services/agents/agentRunService", () => ({ default: mockAgentRunService }));
vi.mock("../../services/agents/agentService", () => ({ default: mockAgentService }));
vi.mock("../../services/agents/agentMcpService", () => ({
  default: { setHooks: vi.fn(), subscribePermissions: vi.fn(() => () => {}) },
}));
vi.mock("../../services/agents/agentPlannerService", () => ({
  default: { subscribePendingPlans: vi.fn(() => () => {}) },
}));
vi.mock("../../services/agents/agentDispatchService", () => ({
  default: { registerHandlers: vi.fn() },
}));
vi.mock("../../services/agents/mergePipelineService", () => ({ default: mockMergePipelineService }));
vi.mock("../../services/deadLetterService", () => ({ default: mockDeadLetterService }));
vi.mock("../../services/notificationService", () => ({
  default: {
    requestPermission: vi.fn(),
    show: vi.fn(),
    notifyRunCompleted: vi.fn(),
    notifyRunFailed: vi.fn(),
    notifyPermissionRequest: vi.fn(),
  },
}));
vi.mock("../../services/agents/agentEstimateLearningService", () => ({
  recordRunOutcome: vi.fn(),
  runDurationMinutes: vi.fn(() => 12),
}));

import { useAgentTeammates } from "../useAgentTeammates";

const columns: BoardColumn[] = [
  { id: COLUMN_STATUS.IN_PROGRESS, title: "In Progress", color: "blue", wipLimit: 0 },
  { id: COLUMN_STATUS.COMPLETED, title: "Completed", color: "green", wipLimit: 0 },
  { id: COLUMN_STATUS.COMMIT, title: "Commit", color: "purple", wipLimit: 0, isCompleted: true },
  { id: "Task", title: "Task", color: "gray", wipLimit: 0 },
];

const agent: AgentProfile = {
  id: "agent-1",
  name: "DevBot",
  provider: "claude-code",
  workingDir: "/repo",
  autoPickup: false,
};

const task: Task = {
  id: "task-1",
  jobId: "TSK-1",
  projectId: "p1",
  title: "Ship feature",
  summary: "",
  assignee: "DevBot",
  priority: "medium",
  status: COLUMN_STATUS.COMPLETED,
  createdAt: new Date(),
  subtasks: [],
  attachments: [],
  tags: [],
  timeEstimate: 0,
  timeSpent: 0,
  activity: [],
};

const completedRun: AgentRun = {
  id: "run-1",
  taskId: "task-1",
  agentId: "agent-1",
  status: "completed",
  createdAt: new Date(),
  gitBranch: "agent/run-1",
  worktreePath: "/repo/.worktrees/run-1",
};

function renderTeammates(overrides?: {
  handleUpdateTask?: ReturnType<typeof vi.fn>;
  addToast?: ReturnType<typeof vi.fn>;
}) {
  const handleUpdateTask = overrides?.handleUpdateTask ?? vi.fn();
  const addToast = overrides?.addToast ?? vi.fn();
  const hook = renderHook(() =>
    useAgentTeammates({
      isLoaded: true,
      tasks: [task],
      columns,
      projects: [{ id: "p1", name: "Project", type: "default" }],
      handleUpdateTask,
      addToast,
    }),
  );
  return { ...hook, handleUpdateTask, addToast };
}

describe("useAgentTeammates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getAgentById.mockReturnValue(agent);
    mockAgentService.getAgentByAssignee.mockReturnValue(agent);
    mockAgentRunService.mergeWorktree.mockResolvedValue("merged branch");
    mockAgentRunService.rejectWithFeedback.mockResolvedValue(undefined);
  });

  it("registers run and merge DLQ retry handlers on mount", () => {
    renderTeammates();
    expect(mockDeadLetterService.registerRetryHandler).toHaveBeenCalledWith(
      "run",
      expect.any(Function),
    );
    expect(mockMergePipelineService.setBoardHooks).toHaveBeenCalled();
  });

  it("registers task hooks before initialize and signals ready after rehydrate", async () => {
    const order: string[] = [];
    mockAgentRunService.setTaskHooks.mockImplementation(() => {
      order.push("setTaskHooks");
    });
    mockAgentRunService.initialize.mockImplementation(async () => {
      order.push("initialize");
    });
    mockAgentRunService.rehydrateActiveRuns.mockImplementation(() => {
      order.push("rehydrateActiveRuns");
    });
    mockAgentRunService.flushPendingBoardSync.mockImplementation(() => {
      order.push("flushPendingBoardSync");
    });
    mockAgentRunService.signalReady.mockImplementation(() => {
      order.push("signalReady");
    });

    renderTeammates();
    await waitFor(() => {
      expect(order).toEqual([
        "setTaskHooks",
        "initialize",
        "rehydrateActiveRuns",
        "flushPendingBoardSync",
        "signalReady",
      ]);
    });
  });

  it("approveAgentWork merges and moves the card to Commit", async () => {
    const { result, handleUpdateTask, addToast } = renderTeammates();
    await act(async () => {
      await result.current.approveAgentWork(task, completedRun);
    });
    expect(mockAgentRunService.mergeWorktree).toHaveBeenCalledWith(completedRun);
    expect(handleUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: COLUMN_STATUS.COMMIT }),
      expect.objectContaining({ actor: "user", viaMergePipeline: true }),
    );
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining("Committed"), "success");
  });

  it("approveAgentWork surfaces merge failures without moving the card", async () => {
    mockAgentRunService.mergeWorktree.mockRejectedValue(new Error("merge conflict"));
    const { result, handleUpdateTask, addToast } = renderTeammates();
    await act(async () => {
      await result.current.approveAgentWork(task, completedRun);
    });
    expect(handleUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({
        activity: expect.arrayContaining([
          expect.objectContaining({ details: expect.stringContaining("commit failed") }),
        ]),
      }),
    );
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining("Commit failed"), "error");
  });

  it("rejectAgentWork requires feedback before resuming the agent", async () => {
    const { result, addToast } = renderTeammates();
    await act(async () => {
      await result.current.rejectAgentWork(task, completedRun, "   ");
    });
    expect(mockAgentRunService.rejectWithFeedback).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining("feedback"),
      "warning",
    );
  });

  it("rejectAgentWork sends feedback and moves the card back to In Progress", async () => {
    const { result, handleUpdateTask } = renderTeammates();
    await act(async () => {
      await result.current.rejectAgentWork(task, completedRun, "Add tests");
    });
    expect(handleUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: COLUMN_STATUS.IN_PROGRESS }),
    );
    expect(mockAgentRunService.rejectWithFeedback).toHaveBeenCalledWith("run-1", "Add tests");
  });

  it("onRunFinished moves successful runs to Completed and dead-letters normal failures", async () => {
    renderTeammates();
    const hooks = mockAgentRunService.setTaskHooks.mock.calls.at(-1)?.[0];
    expect(hooks?.onRunFinished).toBeTypeOf("function");

    const handleUpdateTask = vi.fn();
    renderTeammates({ handleUpdateTask });

    const successHooks = mockAgentRunService.setTaskHooks.mock.calls.at(-1)?.[0];
    act(() => {
      successHooks.onRunFinished("task-1", { ...completedRun, summary: "done" });
    });
    expect(handleUpdateTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ status: COLUMN_STATUS.COMPLETED }),
      expect.objectContaining({ actor: "system" }),
    );

    act(() => {
      successHooks.onRunFinished("task-1", {
        ...completedRun,
        id: "run-2",
        status: "failed",
        error: "exit 1",
      });
    });
    expect(mockDeadLetterService.record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "run", taskId: "task-1" }),
    );
  });

  it("run DLQ retry handler re-dispatches the task to its agent", async () => {
    renderTeammates();
    const handler = mockDeadLetterService.registerRetryHandler.mock.calls.find(
      ([kind]) => kind === "run",
    )?.[1] as (letter: {
      payload: { taskId: string; agentId: string };
    }) => Promise<void>;
    mockAgentRunService.assign.mockResolvedValue({ id: "run-retry" });
    await handler({
      payload: { taskId: "task-1", agentId: "agent-1" },
    });
    await waitFor(() => {
      expect(mockAgentRunService.assign).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-1" }),
        agent,
      );
    });
  });
});
