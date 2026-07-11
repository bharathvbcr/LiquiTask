import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CampaignState } from "../../../services/agents/campaignTypes";
import type { AgentProfile, Task } from "../../../../types";
import { AgentTeamSection } from "../AgentTeamPanel";

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
    id: "epic-1",
    title: "Ship the workbench",
    status: "Task",
    subtasks: [],
    ...overrides,
  } as unknown as Task;
}

describe("AgentTeamSection (roster)", () => {
  const baseProps = {
    tasks: [makeTask()],
    agents: [makeAgent()],
    isRunning: false,
    onStart: vi.fn(),
    onCancel: vi.fn(),
  };

  it("lists epics in the picker and the team roles", () => {
    render(<AgentTeamSection {...baseProps} onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Ship the workbench" })).toBeInTheDocument();
    // Role titles from CAMPAIGN_ROLES.
    expect(screen.getByText("Coordinator")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Worker")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
  });

  it("reports the available worker count", () => {
    render(
      <AgentTeamSection
        {...baseProps}
        agents={[makeAgent({ id: "a1" }), makeAgent({ id: "a2", name: "Codex" })]}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 workers available/)).toBeInTheDocument();
  });

  it("keeps Start disabled until an epic is picked, then calls onStart", () => {
    const onStart = vi.fn();
    render(<AgentTeamSection {...baseProps} onStart={onStart} onCancel={vi.fn()} />);

    const startBtn = screen.getByRole("button", { name: "Start" });
    expect(startBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Epic to work on"), { target: { value: "epic-1" } });
    expect(startBtn).toBeEnabled();

    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ id: "epic-1" }));
  });

  it("shows a Stop control while running and calls onCancel", () => {
    const onCancel = vi.fn();
    render(<AgentTeamSection {...baseProps} isRunning onStart={vi.fn()} onCancel={onCancel} />);

    const stopBtn = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopBtn);
    expect(onCancel).toHaveBeenCalled();
  });

  it("surfaces a plan-fallback banner from campaign state", () => {
    const state: CampaignState = {
      id: "c1",
      goal: "Ship the workbench",
      phase: "dispatching",
      roster: [],
      outcomes: [],
      inProgress: [],
      events: [],
      dashboardMarkdown: "",
      startedAt: Date.now(),
      planFallback: {
        reason: "no_planner",
        message: "No planner agent configured",
        hint: "Add a planner agent to enable decomposition",
      },
    };
    render(
      <AgentTeamSection {...baseProps} state={state} onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("No planner agent configured")).toBeInTheDocument();
    expect(
      screen.getByText("Add a planner agent to enable decomposition"),
    ).toBeInTheDocument();
  });

  it("renders live subtask outcomes", () => {
    const state: CampaignState = {
      id: "c1",
      goal: "Ship the workbench",
      phase: "dispatching",
      roster: [],
      outcomes: [
        {
          subtaskId: "s1",
          title: "Wire the dock",
          owner: "worker1",
          bloom: "Apply",
          status: "verified",
          verified: true,
          blockingGaps: [],
        },
      ],
      inProgress: ["Refactor the parser"],
      events: [],
      dashboardMarkdown: "",
      startedAt: Date.now(),
    };
    render(
      <AgentTeamSection {...baseProps} state={state} onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Wire the dock")).toBeInTheDocument();
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText(/Refactor the parser/)).toBeInTheDocument();
  });
});
