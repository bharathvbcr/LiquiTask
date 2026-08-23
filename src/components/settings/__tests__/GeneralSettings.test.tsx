import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneralSettings } from "../GeneralSettings";

describe("GeneralSettings", () => {
  const baseProps = {
    localGrouping: "none" as const,
    setLocalGrouping: vi.fn(),
    showSubWorkspaceTasks: false,
    onUpdateShowSubWorkspaceTasks: vi.fn(),
    aiFeaturesEnabled: true,
    onUpdateAiFeaturesEnabled: vi.fn(),
    agentExecutionEnabled: true,
    onUpdateAgentExecutionEnabled: vi.fn(),
    addToast: vi.fn(),
    onUpdateGrouping: vi.fn(),
  };

  it("renders both feature toggles", () => {
    render(<GeneralSettings {...baseProps} />);
    expect(screen.getByText("Enable AI Features")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle AI features")).toBeInTheDocument();
    expect(screen.getByText("Enable Agent Execution")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle agent execution")).toBeInTheDocument();
  });

  it("calls onUpdateAiFeaturesEnabled when toggled", () => {
    render(<GeneralSettings {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Toggle AI features"));
    expect(baseProps.onUpdateAiFeaturesEnabled).toHaveBeenCalled();
  });

  it("calls onUpdateAgentExecutionEnabled when toggled", () => {
    render(<GeneralSettings {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Toggle agent execution"));
    expect(baseProps.onUpdateAgentExecutionEnabled).toHaveBeenCalled();
  });

  it("keeps the agent-execution toggle available with AI features off", () => {
    render(<GeneralSettings {...baseProps} aiFeaturesEnabled={false} />);
    expect(screen.getByLabelText("Toggle agent execution")).toBeInTheDocument();
    expect(screen.getByLabelText("Max concurrent agent runs")).toBeInTheDocument();
  });

  it("hides agent-only controls when agent execution is off", () => {
    render(<GeneralSettings {...baseProps} agentExecutionEnabled={false} />);
    expect(screen.queryByLabelText("Max concurrent agent runs")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Toggle agent attention alerts")).not.toBeInTheDocument();
    // AI assistance is unaffected by the agent switch.
    expect(screen.getByLabelText("Toggle AI features")).toBeInTheDocument();
  });
});
