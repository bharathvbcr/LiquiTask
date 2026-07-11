import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownRenderer from "../MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders safe https links as anchors", () => {
    render(<MarkdownRenderer content="See [docs](https://example.com/path)" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com/path");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("blocks javascript: URLs and renders link text as plain span", () => {
    render(<MarkdownRenderer content="[click me](javascript:alert(1))" />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("click me")).toBeInTheDocument();
    expect(screen.getByText("click me").tagName).toBe("SPAN");
  });

  it("blocks protocol-relative and bare-domain URLs", () => {
    render(
      <MarkdownRenderer content="[a](//evil.test) and [b](google.com)" />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });
});
