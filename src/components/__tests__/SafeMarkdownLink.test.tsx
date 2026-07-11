import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SafeMarkdownLink } from "../SafeMarkdownLink";

describe("SafeMarkdownLink", () => {
  it("renders http(s) links with safe attributes", () => {
    render(
      <SafeMarkdownLink href="https://example.com">Example</SafeMarkdownLink>,
    );

    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", "https://example.com/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders unsafe hrefs as non-clickable text", () => {
    render(
      <SafeMarkdownLink href="javascript:alert(1)">Danger</SafeMarkdownLink>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Danger").tagName).toBe("SPAN");
  });
});
