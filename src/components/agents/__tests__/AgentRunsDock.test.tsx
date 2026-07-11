import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { COLUMN_STATUS } from "../../../constants";
import type { AgentProfile, AgentRun, BoardColumn, Task } from "../../../../types";
import { AgentRunsDock } from "../AgentRunsDock";

// Campaign wiring belongs to a separate hook — stub it so the dock renders the
// Runs tab without spinning up a real campaign.
vi.mock("../../../hooks/useCampaign", () => ({
  useCampaign: () => ({
    state: undefined,
    isRunning: false,
    startCampaign: vi.fn(),
    cancelCampaign: vi.fn(),
    epicCandidates: [],
  }),
}));

// Run service is consulted only for queue position in this surface.
vi.mock("../../../services/agents/agentRunService", () => ({
  default: {
    getQueuePosition: () => null,
  },
}));

// Permission stream: no pending prompts in these tests.
vi.mock("../../../services/agents/agentMcpService", () => ({
  default: {
    subscribePermissions: () => () => {},
    respondToPermission: vi.fn(),
    respondToAllPending: vi.fn(),
  },
  describePermissionInput: () => ({ summary: "", detail: "" }),
}));

// Quick-create pulls in the agent service; not under test here.
vi.mock("../AgentQuickCreate", () => ({
  AgentQuickCreate: () => null,
}));

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-1",
    name: "Claude",
    provider: "claude-code",
    workingDir: "/repo",
    permissionMode: "acceptEdits",
    sandbox: "host",
    autoPickup: true,
    runsOnRecurrence: true,
    devCouncilVerify: false,
    createdAt: new Date(),
    ...overrides,
  } as AgentProfile;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fix the parser",
    status: COLUMN_STATUS.IN_PROGRESS,
    subtasks: [],
    ...overrides,
  } as unknown as Task;
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "running",
    createdAt: new Date(),
    events: [],
    ...overrides,
  } as AgentRun;
}

const columns: BoardColumn[] = [
  { id: COLUMN_STATUS.TASK, title: "Task", color: "#333" },
  { id: COLUMN_STATUS.IN_PROGRESS, title: "In Progress", color: "#333" },
  { id: COLUMN_STATUS.COMPLETED, title: "Completed", color: "#333", isCompleted: true },
];

function baseProps() {
  return {
    tasks: [] as Task[],
    columns,
    agents: [makeAgent()],
    runs: [] as AgentRun[],
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onOpenTerminal: vi.fn(),
  };
}

describe("AgentRunsDock", () => {
  it("is collapsed by default and expands on click", () => {
    render(<AgentRunsDock {...baseProps()} />);
    const pill = screen.getByLabelText("Open agents dock");
    expect(pill).toBeInTheDocument();

    fireEvent.click(pill);
    expect(screen.getByText("Team Run")).toBeInTheDocument();
  });

  it("auto-expands and renders an active run with its status", () => {
    const task = makeTask();
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[task]}
        runs={[makeRun({ status: "running" })]}
        onPause={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByText("Fix the parser")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("calls onPause and onCancel for a running run", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onCancel = vi.fn();
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[makeTask()]}
        runs={[makeRun({ status: "running" })]}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByLabelText("Pause run"));
    expect(onPause).toHaveBeenCalledWith("run-1");

    fireEvent.click(screen.getByLabelText("Stop run"));
    expect(onCancel).toHaveBeenCalledWith("run-1");
  });

  it("shows a resume affordance for a paused run", () => {
    const onResume = vi.fn();
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[makeTask()]}
        runs={[makeRun({ status: "running", isPaused: true })]}
        onPause={vi.fn()}
        onResume={onResume}
      />,
    );
    expect(screen.getByText("paused")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Resume run"));
    expect(onResume).toHaveBeenCalledWith("run-1");
  });

  it("routes approve/reject decisions for a run awaiting review", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const task = makeTask({ status: COLUMN_STATUS.COMPLETED });
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[task]}
        runs={[makeRun({ status: "completed" })]}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    // No active runs — open the dock manually.
    fireEvent.click(screen.getByLabelText("Open agents dock"));

    expect(screen.getByText("Needs review")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Rejection feedback/), {
      target: { value: "needs tests" },
    });
    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledWith(task, expect.objectContaining({ id: "run-1" }), "needs tests");

    fireEvent.click(screen.getByText("Approve"));
    expect(onApprove).toHaveBeenCalledWith(task, expect.objectContaining({ id: "run-1" }));
  });

  it("offers retry and return actions for a failed run in Done", () => {
    const onRetryRun = vi.fn();
    const onReturnToBoard = vi.fn();
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[makeTask()]}
        runs={[makeRun({ status: "failed", error: "boom" })]}
        onRetryRun={onRetryRun}
        onReturnToBoard={onReturnToBoard}
      />,
    );

    fireEvent.click(screen.getByLabelText("Open agents dock"));
    fireEvent.click(screen.getByLabelText("Expand done runs"));

    expect(screen.getByText("boom")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Retry"));
    expect(onRetryRun).toHaveBeenCalledWith("run-1");

    fireEvent.click(screen.getByText("Return"));
    expect(onReturnToBoard).toHaveBeenCalledWith("run-1");
  });

  it("prompts to create an agent when the roster is empty", () => {
    render(<AgentRunsDock {...baseProps()} agents={[]} />);
    fireEvent.click(screen.getByLabelText("Open agents dock"));
    expect(
      screen.getByText(/No agents yet/),
    ).toBeInTheDocument();
  });

  it("shows batch approve/deny when runs await review", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const task = makeTask({ status: COLUMN_STATUS.COMPLETED });
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[task]}
        runs={[makeRun({ status: "completed" })]}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByLabelText("Open agents dock"));
    expect(screen.getByText("Approve All")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Approve All"));
    expect(onApprove).toHaveBeenCalledWith(task, expect.objectContaining({ id: "run-1" }));
  });

  it("shows live cost in an active run row", () => {
    render(
      <AgentRunsDock
        {...baseProps()}
        tasks={[makeTask()]}
        runs={[
          makeRun({
            status: "running",
            costUsd: 0.42,
            usage: { "claude-sonnet-4": { inputTokens: 1200, outputTokens: 300 } },
          }),
        ]}
      />,
    );

    expect(screen.getByText("~$0.42")).toBeInTheDocument();
    expect(screen.getByText(/1\.5k tok/)).toBeInTheDocument();
  });
});
