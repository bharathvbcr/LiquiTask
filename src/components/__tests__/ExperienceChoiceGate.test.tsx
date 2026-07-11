import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperienceChoiceGate } from "../ExperienceChoiceGate";

describe("ExperienceChoiceGate", () => {
  it("renders both experience options", () => {
    render(<ExperienceChoiceGate onChoose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Choose Your Experience")).toBeInTheDocument();
    expect(screen.getByText("Simple Task Management")).toBeInTheDocument();
    expect(screen.getByText("AI Agent Board")).toBeInTheDocument();
    expect(screen.getByText("Use Simple Mode")).toBeInTheDocument();
    expect(screen.getByText("Enable AI Agent Board")).toBeInTheDocument();
  });

  it("calls onChoose(false) for simple mode", () => {
    const onChoose = vi.fn();
    render(<ExperienceChoiceGate onChoose={onChoose} />);

    fireEvent.click(screen.getByText("Use Simple Mode"));
    expect(onChoose).toHaveBeenCalledWith(false);
  });

  it("calls onChoose(true) for AI Agent Board", () => {
    const onChoose = vi.fn();
    render(<ExperienceChoiceGate onChoose={onChoose} />);

    fireEvent.click(screen.getByText("Enable AI Agent Board"));
    expect(onChoose).toHaveBeenCalledWith(true);
  });
});
