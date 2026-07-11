import { describe, expect, it } from "vitest";

import { parseClaudeStreamLine, parseCouncilReport } from "../agentStreamParser";

describe("parseClaudeStreamLine", () => {
  it("captures the session id from the system init message", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "abc-123",
    });
    const parsed = parseClaudeStreamLine(line);
    expect(parsed.sessionId).toBe("abc-123");
    expect(parsed.events[0].kind).toBe("system");
  });

  it("extracts assistant text and tool_use blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Looking at the failing test." },
          { type: "tool_use", name: "Edit", input: { file_path: "src/app.ts" } },
        ],
      },
    });
    const parsed = parseClaudeStreamLine(line);
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toEqual({ kind: "assistant", text: "Looking at the failing test." });
    expect(parsed.events[1].kind).toBe("tool");
    expect(parsed.events[1].text).toContain("Edit");
    expect(parsed.events[1].text).toContain("src/app.ts");
  });

  it("extracts summary, turns and cost from a success result", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Fixed the bug and added a regression test.",
      num_turns: 7,
      total_cost_usd: 0.42,
      session_id: "abc-123",
    });
    const parsed = parseClaudeStreamLine(line);
    expect(parsed.result).toEqual({
      summary: "Fixed the bug and added a regression test.",
      numTurns: 7,
      costUsd: 0.42,
      isError: false,
    });
  });

  it("flags non-success results as errors", () => {
    const line = JSON.stringify({ type: "result", subtype: "error_max_turns" });
    const parsed = parseClaudeStreamLine(line);
    expect(parsed.result?.isError).toBe(true);
  });

  it("degrades gracefully on non-JSON lines", () => {
    const parsed = parseClaudeStreamLine("plain log noise");
    expect(parsed.events).toEqual([{ kind: "info", text: "plain log noise" }]);
    expect(parsed.result).toBeUndefined();
  });
});

describe("parseCouncilReport", () => {
  it("passes when the report is ok with no gaps", () => {
    const verdict = parseCouncilReport(JSON.stringify({ ok: true, blocking_gaps: [] }));
    expect(verdict.passed).toBe(true);
    expect(verdict.blockingGaps).toEqual([]);
  });

  it("fails when blocking gaps are present, even if ok is true", () => {
    const verdict = parseCouncilReport(
      JSON.stringify({ ok: true, blocking_gaps: ["missing test for edge case"] }),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.blockingGaps).toEqual(["missing test for edge case"]);
  });

  it("tolerates log noise before the JSON payload", () => {
    const raw = `Running checks...\ndone\n${JSON.stringify({ passed: false, blocking_gaps: [{ id: "GAP-1" }] })}`;
    const verdict = parseCouncilReport(raw);
    expect(verdict.passed).toBe(false);
    expect(verdict.blockingGaps[0]).toContain("GAP-1");
  });

  it("fails closed when no parseable verdict exists", () => {
    const verdict = parseCouncilReport("no json here at all");
    expect(verdict.passed).toBe(false);
    expect(verdict.blockingGaps.length).toBeGreaterThan(0);
  });
});
