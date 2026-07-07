import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { groupToolEvents, ToolTimeline } from "../ToolTimeline";
import type { AgentRunEvent } from "../../../types";

function event(
  kind: AgentRunEvent["kind"],
  text: string,
  ts = new Date("2026-07-06T10:15:30Z"),
): AgentRunEvent {
  return { ts, kind, text };
}

describe("groupToolEvents", () => {
  it("pairs a tool call with its following → output", () => {
    const entries = groupToolEvents([
      event("tool", 'Read({"file_path":"/a.ts"})'),
      event("tool", "→ 120 lines"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Read");
    expect(entries[0].detail).toBe('{"file_path":"/a.ts"}');
    expect(entries[0].outputs).toEqual(["120 lines"]);
  });

  it("starts a new entry per call and keeps outputs with the right call", () => {
    const entries = groupToolEvents([
      event("tool", 'Read({"file_path":"/a.ts"})'),
      event("tool", "→ ok"),
      event("tool", 'Bash({"command":"npm test"})'),
      event("tool", "→ 12 passed"),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].outputs).toEqual(["ok"]);
    expect(entries[1].name).toBe("Bash");
    expect(entries[1].outputs).toEqual(["12 passed"]);
  });

  it("ignores non-tool events entirely", () => {
    const entries = groupToolEvents([
      event("assistant", "thinking…"),
      event("tool", "Glob(**/*.ts)"),
      event("stderr", "warning"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("Glob");
  });

  it("uses the whole text as the name when there is no ( prefix", () => {
    const entries = groupToolEvents([event("tool", "WebSearch")]);
    expect(entries[0].name).toBe("WebSearch");
    expect(entries[0].detail).toBe("");
  });

  it("keeps a leading orphan output rather than dropping it", () => {
    const entries = groupToolEvents([event("tool", "→ resumed mid-run")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].detail).toBe("resumed mid-run");
  });
});

describe("ToolTimeline", () => {
  it("renders one timeline item per call, with name, detail and output", () => {
    const { container } = render(
      <ToolTimeline
        events={[
          event("tool", 'Read({"file_path":"/a.ts"})'),
          event("tool", "→ 120 lines"),
          event("tool", 'Edit({"file_path":"/b.ts"})'),
        ]}
      />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText('{"file_path":"/a.ts"}')).toBeInTheDocument();
    expect(screen.getByText("→ 120 lines")).toBeInTheDocument();
  });

  it("renders nothing when the run has no tool events", () => {
    const { container } = render(
      <ToolTimeline events={[event("assistant", "hello"), event("result", "done")]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for an empty event list", () => {
    const { container } = render(<ToolTimeline events={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
