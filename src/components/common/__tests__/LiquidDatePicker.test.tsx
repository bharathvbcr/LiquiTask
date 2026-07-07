import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiquidDatePicker } from "../LiquidDatePicker";

describe("LiquidDatePicker", () => {
  it("opens a calendar popover from the field trigger", () => {
    render(<LiquidDatePicker value="" onChange={() => {}} placeholder="Pick a date" />);

    expect(screen.getByRole("button", { name: "Select due date" })).toHaveTextContent("Pick a date");
    fireEvent.click(screen.getByRole("button", { name: "Select due date" }));

    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today" })).toBeInTheDocument();
  });

  it("selects a date and closes the popover", () => {
    const onChange = vi.fn();
    render(<LiquidDatePicker value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Select due date" }));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("shows a formatted value when a date is selected", () => {
    render(<LiquidDatePicker value="2026-07-15" onChange={() => {}} />);

    expect(screen.getByRole("button", { name: "Select due date" })).not.toHaveTextContent("Pick a date");
  });
});
