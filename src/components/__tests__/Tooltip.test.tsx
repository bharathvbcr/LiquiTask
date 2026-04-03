import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../Tooltip";

describe("Tooltip", () => {
  beforeEach(() => {
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
});
