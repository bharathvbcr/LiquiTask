import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineDatePicker, InlineEditable, InlineSelect } from "../InlineEditable";

describe("InlineEditable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Restore real timers so waitFor/findBy in later test files (same worker)
  // aren't starved by leaked fake timers — this broke TaskCard's quick-view
  // portal test when the suites ran together.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render initial value in a span", () => {
    render(<InlineEditable value="Test Value" onSave={() => {}} />);
    const span = screen.getByText("Test Value");
    expect(span.tagName).toBe("SPAN");
  });

  it("should switch to input on click", () => {
    render(<InlineEditable value="Test Value" onSave={() => {}} />);
    fireEvent.click(screen.getByText("Test Value"));

    const input = screen.getByDisplayValue("Test Value");
    expect(input.tagName).toBe("INPUT");
  });

  it("should call onSave when Enter is pressed", () => {
    const onSave = vi.fn();
    render(<InlineEditable value="Test Value" onSave={onSave} />);
    fireEvent.click(screen.getByText("Test Value"));

    const input = screen.getByDisplayValue("Test Value");
    fireEvent.change(input, { target: { value: "New Value" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onSave).toHaveBeenCalledWith("New Value");
    expect(screen.queryByDisplayValue("New Value")).not.toBeInTheDocument();
  });

  it("should call onSave on blur after a timeout", async () => {
    const onSave = vi.fn();
    render(<InlineEditable value="Test Value" onSave={onSave} />);
    fireEvent.click(screen.getByText("Test Value"));

    const input = screen.getByDisplayValue("Test Value");
    fireEvent.change(input, { target: { value: "Blurred Value" } });
    fireEvent.blur(input);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onSave).toHaveBeenCalledWith("Blurred Value");
  });

  it("should cancel and call onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    render(<InlineEditable value="Original" onSave={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Original"));

    const input = screen.getByDisplayValue("Original");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

    expect(onCancel).toHaveBeenCalled();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("should show placeholder when value is empty", () => {
    render(<InlineEditable value="" onSave={() => {}} placeholder="Custom Placeholder" />);
    expect(screen.getByText("Custom Placeholder")).toBeInTheDocument();
    expect(screen.getByText("Custom Placeholder")).toHaveClass("italic");
  });

  it("should render textarea when multiline is true", () => {
    render(<InlineEditable value="Multi" onSave={() => {}} multiline />);
    fireEvent.click(screen.getByText("Multi"));

    const textarea = screen.getByDisplayValue("Multi");
    expect(textarea.tagName).toBe("TEXTAREA");
  });
});

describe("InlineSelect", () => {
  const options = [
    { id: "low", label: "Low", color: "#00ff00" },
    { id: "high", label: "High", color: "#ff0000" },
  ];

  it("renders current option label", () => {
    render(<InlineSelect value="high" options={options} onSave={() => {}} />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("opens listbox and calls onSave when option selected", () => {
    const onSave = vi.fn();
    render(<InlineSelect value="low" options={options} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: /Low/i }));
    fireEvent.click(screen.getByRole("option", { name: "High" }));

    expect(onSave).toHaveBeenCalledWith("high");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stops pointerdown propagation on trigger", () => {
    const outerHandler = vi.fn();
    render(
      <div onPointerDown={outerHandler}>
        <InlineSelect value="low" options={options} onSave={() => {}} />
      </div>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: /Low/i }));
    expect(outerHandler).not.toHaveBeenCalled();
  });
});

describe("InlineDatePicker", () => {
  it("renders formatted date", () => {
    render(
      <InlineDatePicker value={new Date(2026, 6, 5)} onSave={() => {}} />,
    );
    expect(screen.getByText("Jul 5")).toBeInTheDocument();
  });

  it("opens picker and calls onSave when date changes", () => {
    const onSave = vi.fn();
    render(<InlineDatePicker value={null} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Select due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(onSave).toHaveBeenCalled();
    const savedDate = onSave.mock.calls[0][0] as Date;
    expect(savedDate).toBeInstanceOf(Date);
  });

  it("clears date when Clear Date is clicked", () => {
    const onSave = vi.fn();
    render(<InlineDatePicker value={new Date(2026, 6, 5)} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Select due date" }));
    fireEvent.click(screen.getByText("Clear Date"));

    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("stops pointerdown propagation on calendar controls", () => {
    const outerHandler = vi.fn();
    render(
      <div onPointerDown={outerHandler}>
        <InlineDatePicker value={null} onSave={() => {}} />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select due date" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Today" }));
    expect(outerHandler).not.toHaveBeenCalled();
  });
});
