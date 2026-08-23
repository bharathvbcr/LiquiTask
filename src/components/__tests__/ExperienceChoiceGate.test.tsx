import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperienceChoiceGate } from "../ExperienceChoiceGate";

describe("ExperienceChoiceGate", () => {
  it("renders all three experience options", () => {
    render(<ExperienceChoiceGate onChoose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Choose Your Experience")).toBeInTheDocument();
    expect(screen.getByText("Simple Task Management")).toBeInTheDocument();
    expect(screen.getByText("AI Assisted Board")).toBeInTheDocument();
    expect(screen.getByText("AI Agent Board")).toBeInTheDocument();
    expect(screen.getByText("Use Simple Mode")).toBeInTheDocument();
    expect(screen.getByText("Use AI Assist")).toBeInTheDocument();
    expect(screen.getByText("Enable AI Agent Board")).toBeInTheDocument();
  });

  it("turns both features off for simple mode", () => {
    const onChoose = vi.fn();
    render(<ExperienceChoiceGate onChoose={onChoose} />);

    fireEvent.click(screen.getByText("Use Simple Mode"));
    expect(onChoose).toHaveBeenCalledWith({
      aiFeaturesEnabled: false,
      agentExecutionEnabled: false,
    });
  });

  it("enables AI without agent execution for the assisted board", () => {
    const onChoose = vi.fn();
    render(<ExperienceChoiceGate onChoose={onChoose} />);

    fireEvent.click(screen.getByText("Use AI Assist"));
    expect(onChoose).toHaveBeenCalledWith({
      aiFeaturesEnabled: true,
      agentExecutionEnabled: false,
    });
  });

  it("enables both for the AI Agent Board", () => {
    const onChoose = vi.fn();
    render(<ExperienceChoiceGate onChoose={onChoose} />);

    fireEvent.click(screen.getByText("Enable AI Agent Board"));
    expect(onChoose).toHaveBeenCalledWith({
      aiFeaturesEnabled: true,
      agentExecutionEnabled: true,
    });
  });
});
