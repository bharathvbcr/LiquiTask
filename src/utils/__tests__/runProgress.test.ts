import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../../types";
import { deriveRunProgress, formatRunError } from "../runProgress";

const makeRun = (over: Partial<AgentRun>): Pick<AgentRun, "status" | "isPaused" | "events" | "error"> => ({
  status: "running",
  isPaused: false,
  events: [],
  error: undefined,
  ...over,
});

describe("deriveRunProgress", () => {
  it("reports a small non-zero percent for queued runs", () => {
    const p = deriveRunProgress(makeRun({ status: "queued" }));
    expect(p).toMatchObject({ phase: "queued", percent: 5, active: true });
  });

  it("tracks subtask completion when totals are known", () => {
    const p = deriveRunProgress(makeRun({ status: "running" }), {
      subtasksTotal: 4,
      subtasksDone: 2,
    });
    // 15 + (2/4)*70 = 50
    expect(p.percent).toBe(50);
    expect(p.phase).toBe("running");
    expect(p.active).toBe(true);
  });

  it("advances with event volume when no subtasks", () => {
    const few = deriveRunProgress(makeRun({ status: "running", events: mkEvents(2) }));
    const many = deriveRunProgress(makeRun({ status: "running", events: mkEvents(50) }));
    expect(many.percent).toBeGreaterThan(few.percent);
    expect(many.percent).toBeLessThanOrEqual(85);
  });

  it("marks paused runs as inactive", () => {
    const p = deriveRunProgress(makeRun({ status: "running", isPaused: true }));
    expect(p).toMatchObject({ phase: "paused", label: "Paused", active: false });
  });

  it("caps verifying/terminal states", () => {
    expect(deriveRunProgress(makeRun({ status: "verifying" })).percent).toBe(90);
    expect(deriveRunProgress(makeRun({ status: "completed" })).percent).toBe(100);
    expect(deriveRunProgress(makeRun({ status: "failed" })).active).toBe(false);
  });
});

describe("formatRunError", () => {
  it("returns undefined for non-failed runs", () => {
    expect(formatRunError(makeRun({ status: "running" }))).toBeUndefined();
  });

  it("uses the explicit error, first line only", () => {
    const msg = formatRunError(
      makeRun({ status: "failed", error: "invalid args `task`: expected a string\nstack trace..." }),
    );
    expect(msg).toBe("invalid args `task`: expected a string");
  });

  it("falls back to the last stderr/result event", () => {
    const run = makeRun({
      status: "failed",
      error: undefined,
      events: [
        { ts: new Date(), kind: "info", text: "started" },
        { ts: new Date(), kind: "stderr", text: "boom: something broke" },
      ],
    });
    expect(formatRunError(run)).toBe("boom: something broke");
  });

  it("never returns an empty reason", () => {
    expect(formatRunError(makeRun({ status: "failed", error: "   ", events: [] }))).toBe(
      "Run failed with no error detail.",
    );
  });
});

function mkEvents(n: number): AgentRun["events"] {
  return Array.from({ length: n }, () => ({
    ts: new Date(),
    kind: "assistant" as const,
    text: "x",
  }));
}
