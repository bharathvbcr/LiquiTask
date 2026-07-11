import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentProfile } from "../../../../types";
import { AgentDropTray } from "../AgentDropTray";

// dnd-kit's useDroppable needs a DndContext; stub it so the tray can render
// standalone. isOver is always false (no active drag in a unit test).
vi.mock("@dnd-kit/core", () => ({
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
}));

// Budget/availability come from the policy + run services — mock at the boundary
// so each test controls the derived chip subtitle.
const checkAgentBudget = vi.fn();
const getAgentDailyStats = vi.fn(() => ({}));
vi.mock("../../../services/agents/agentPolicyService", () => ({
  checkAgentBudget: (...args: unknown[]) => checkAgentBudget(...args),
  getAgentDailyStats: (...args: unknown[]) => getAgentDailyStats(...args),
}));

const isAgentBusy = vi.fn(() => false);
const getQueueLengthForAgent = vi.fn(() => 0);
vi.mock("../../../services/agents/agentRunService", () => ({
  default: {
    getRuns: () => [],
    isAgentBusy: (...args: unknown[]) => isAgentBusy(...args),
    getQueueLengthForAgent: (...args: unknown[]) => getQueueLengthForAgent(...args),
  },
}));

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "a1",
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

describe("AgentDropTray", () => {
  afterEach(() => {
    checkAgentBudget.mockReset();
    isAgentBusy.mockReset();
    isAgentBusy.mockReturnValue(false);
    getQueueLengthForAgent.mockReset();
    getQueueLengthForAgent.mockReturnValue(0);
  });

  it("renders nothing when not visible", () => {
    const { container } = render(
      <AgentDropTray agents={[makeAgent()]} visible={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing with no agents and no setup offer", () => {
    const { container } = render(<AgentDropTray agents={[]} visible offerSetup={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("offers a setup chip when there are no agents but setup is offered", () => {
    render(<AgentDropTray agents={[]} visible offerSetup />);
    expect(screen.getByText("Set Up an Agent")).toBeInTheDocument();
  });

  it("renders a chip per agent and a Best Match chip when more than one agent", () => {
    render(
      <AgentDropTray
        agents={[makeAgent({ id: "a1", name: "Claude" }), makeAgent({ id: "a2", name: "Codex" })]}
        visible
      />,
    );
    expect(screen.getByText("Best Match")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("does not show Best Match for a single agent", () => {
    render(<AgentDropTray agents={[makeAgent()]} visible />);
    expect(screen.queryByText("Best Match")).not.toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
  });

  it("shows the over-cap subtitle when the agent is over its daily budget", () => {
    checkAgentBudget.mockReturnValue({ reason: "daily cap" });
    render(<AgentDropTray agents={[makeAgent()]} visible />);
    expect(screen.getByText("over daily cap")).toBeInTheDocument();
  });

  it("shows the queue position when the agent is busy", () => {
    checkAgentBudget.mockReturnValue(null);
    isAgentBusy.mockReturnValue(true);
    getQueueLengthForAgent.mockReturnValue(2);
    render(<AgentDropTray agents={[makeAgent()]} visible />);
    expect(screen.getByText("busy — queues #3")).toBeInTheDocument();
  });

  it("labels a planner agent", () => {
    checkAgentBudget.mockReturnValue(null);
    render(<AgentDropTray agents={[makeAgent({ role: "planner" })]} visible />);
    expect(screen.getByText("planner — dev plan")).toBeInTheDocument();
  });
});
