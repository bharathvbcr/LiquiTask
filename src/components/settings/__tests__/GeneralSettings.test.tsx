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
    addToast: vi.fn(),
    onUpdateGrouping: vi.fn(),
  };

  it("renders the Enable AI Features toggle", () => {
    render(<GeneralSettings {...baseProps} />);
    expect(screen.getByText("Enable AI Features")).toBeInTheDocument();
    expect(screen.getByLabelText("Toggle AI features")).toBeInTheDocument();
  });

  it("calls onUpdateAiFeaturesEnabled when toggled", () => {
    render(<GeneralSettings {...baseProps} />);
    fireEvent.click(screen.getByLabelText("Toggle AI features"));
    expect(baseProps.onUpdateAiFeaturesEnabled).toHaveBeenCalled();
  });

  it("renders the max concurrent agent runs control when AI features are on", () => {
    render(<GeneralSettings {...baseProps} aiFeaturesEnabled={true} />);
    expect(screen.getByLabelText("Max concurrent agent runs")).toBeInTheDocument();
  });
});
