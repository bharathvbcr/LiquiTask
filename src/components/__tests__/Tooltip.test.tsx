import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../Tooltip";

const { mockFeatureFlags } = vi.hoisted(() => ({
  mockFeatureFlags: { TOOLTIPS_ENABLED: true },
}));

vi.mock("../../constants", () => ({
  FEATURE_FLAGS: mockFeatureFlags,
}));

describe("Tooltip", () => {
  beforeEach(() => {
    mockFeatureFlags.TOOLTIPS_ENABLED = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows tooltip after delay on mouse enter", async () => {
    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.mouseEnter(trigger);

    // Initially not visible
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();

    // Advance timers by 300ms (default delay)
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();
  });

  it("hides tooltip on mouse leave", () => {
    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();
  });

  it("shows tooltip on focus and hides on blur", () => {
    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.focus(trigger);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();

    fireEvent.blur(trigger);
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();
  });

  it("uses custom delay", () => {
    render(
      <Tooltip content="Tooltip Content" delay={1000}>
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();
  });

  it("links the trigger to the tooltip via aria-describedby once visible", () => {
    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    expect(trigger).not.toHaveAttribute("aria-describedby");

    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("dismisses on Escape while the trigger is focused", () => {
    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();
  });

  it("renders only children when tooltips are disabled", () => {
    mockFeatureFlags.TOOLTIPS_ENABLED = false;

    render(
      <Tooltip content="Tooltip Content">
        <button>Trigger</button>
      </Tooltip>,
    );

    const trigger = screen.getByText("Trigger");
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("wraps a disabled trigger in a focusable proxy so the tooltip stays reachable", () => {
    render(
      <Tooltip content="Tooltip Content">
        <button disabled>Trigger</button>
      </Tooltip>,
    );

    const button = screen.getByText("Trigger");
    expect(button).toBeDisabled();

    // Disabled elements can't receive focus, so the tooltip's listeners must
    // live on a wrapping element instead of the button itself.
    const wrapper = button.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe("SPAN");
    expect(wrapper).toHaveAttribute("tabIndex", "0");

    fireEvent.focus(wrapper);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const tooltip = screen.getByRole("tooltip");
    expect(screen.getByText("Tooltip Content")).toBeInTheDocument();
    expect(wrapper).toHaveAttribute("aria-describedby", tooltip.id);

    fireEvent.blur(wrapper);
    expect(screen.queryByText("Tooltip Content")).not.toBeInTheDocument();
  });
});
