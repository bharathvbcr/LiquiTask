import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "../Input";

describe("Input", () => {
  it("should render a label associated with the input", () => {
    render(<Input label="Email" name="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("id", "email");
  });

  it("should not mark a valid input as invalid", () => {
    render(<Input label="Title" name="title" />);
    const input = screen.getByLabelText("Title");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("should associate the error message with the input for screen readers", () => {
    render(<Input label="Title" name="title" error="Title is required" />);
    const input = screen.getByLabelText("Title");

    expect(input).toHaveAttribute("aria-invalid", "true");

    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    const message = screen.getByRole("alert");
    expect(message).toHaveTextContent("Title is required");
    expect(message).toHaveAttribute("id", describedBy as string);
  });

  it("should preserve a caller-provided aria-describedby alongside the error", () => {
    render(<Input name="title" error="Required" aria-describedby="hint-1" />);
    const input = screen.getByRole("textbox");
    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toContain("hint-1");
    expect(describedBy.split(" ").length).toBe(2);
  });

  it("should generate a stable id when none is supplied", () => {
    render(<Input label="Search" error="Bad" />);
    const input = screen.getByLabelText("Search");
    const describedBy = input.getAttribute("aria-describedby");
    expect(input.id).toBeTruthy();
    expect(describedBy).toBe(`${input.id}-error`);
  });
});
