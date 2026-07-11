import { describe, expect, it } from "vitest";
import type { AgentProfile, AgentRun } from "../../../../types";
import {
  agentdStartTimeoutMs,
  evaluateRunLimits,
  exceededCostCap,
  resolveRunLimits,
  type RunLimits,
} from "../runLimits";

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => over as AgentProfile;

const run = (over: Partial<AgentRun> = {}): Pick<AgentRun, "status" | "isPaused" | "startedAt" | "events"> => ({
  status: "running",
  isPaused: false,
  startedAt: new Date(1_000_000),
  events: [],
  ...over,
});

const ev = (tsMs: number) => ({ ts: new Date(tsMs), kind: "assistant" as const, text: "x" });

describe("resolveRunLimits", () => {
  it("prefers agent settings over defaults and converts minutes to ms", () => {
    const limits = resolveRunLimits(agent({ runTimeoutMinutes: 30 }), {
      timeoutMinutes: 10,
      stallMinutes: 5,
    });
    expect(limits.timeoutMs).toBe(30 * 60_000);
    expect(limits.stallMs).toBe(5 * 60_000);
  });

  it("treats 0 / undefined as disabled", () => {
    expect(resolveRunLimits(agent({ runTimeoutMinutes: 0 }), {})).toEqual({
      timeoutMs: 0,
      stallMs: 0,
      perRunCostCapUsd: 0,
    });
  });
});

describe("agentdStartTimeoutMs", () => {
  it("forwards the resolved wall-clock cap to agentd", () => {
    expect(agentdStartTimeoutMs(agent({ runTimeoutMinutes: 45 }))).toBe(45 * 60_000);
    expect(agentdStartTimeoutMs(agent({ runTimeoutMinutes: 0 }), { timeoutMinutes: 10 })).toBe(0);
  });
});

const LIMITS: RunLimits = { timeoutMs: 60_000, stallMs: 30_000, perRunCostCapUsd: 0 };

describe("evaluateRunLimits", () => {
  it("returns null while within limits", () => {
    expect(evaluateRunLimits(run({ events: [ev(1_050_000)] }), LIMITS, 1_060_000)).toBeNull();
  });

  it("fires timeout once wall-clock exceeds the cap", () => {
    const v = evaluateRunLimits(run(), LIMITS, 1_000_000 + 61_000);
    expect(v?.reason).toBe("timeout");
    expect(v?.message).toMatch(/time limit/);
  });

  it("excludes paused time from the timeout (no false abort after a long pause)", () => {
    // 61s elapsed but 40s of it was paused → 21s active < 60s timeout. The
    // recent event mirrors the "Run resumed" event, so stall doesn't fire either.
    expect(
      evaluateRunLimits(run({ pausedMs: 40_000, events: [ev(1_056_000)] }), LIMITS, 1_000_000 + 61_000),
    ).toBeNull();
    // Still fires once *active* time (elapsed − paused) exceeds the cap.
    expect(
      evaluateRunLimits(run({ pausedMs: 40_000, events: [ev(1_100_000)] }), LIMITS, 1_000_000 + 101_000)
        ?.reason,
    ).toBe("timeout");
  });

  it("fires stall when no output for longer than stallMs", () => {
    const v = evaluateRunLimits(
      run({ events: [ev(1_000_000)] }),
      LIMITS,
      1_000_000 + 31_000, // 31s since last event > 30s stall
    );
    expect(v?.reason).toBe("stall");
  });

  it("ignores paused and terminal runs", () => {
    expect(evaluateRunLimits(run({ isPaused: true }), LIMITS, 9_000_000)).toBeNull();
    expect(evaluateRunLimits(run({ status: "completed" }), LIMITS, 9_000_000)).toBeNull();
  });

  it("does nothing when both guardrails are disabled", () => {
    const off: RunLimits = { timeoutMs: 0, stallMs: 0, perRunCostCapUsd: 0 };
    expect(evaluateRunLimits(run(), off, 9_999_999)).toBeNull();
  });
});

describe("exceededCostCap", () => {
  it("flags overspend only when a positive cap is set", () => {
    expect(exceededCostCap({ costUsd: 5 }, { perRunCostCapUsd: 3 })).toBe(true);
    expect(exceededCostCap({ costUsd: 2 }, { perRunCostCapUsd: 3 })).toBe(false);
    expect(exceededCostCap({ costUsd: 5 }, { perRunCostCapUsd: 0 })).toBe(false);
    expect(exceededCostCap({ costUsd: undefined }, { perRunCostCapUsd: 3 })).toBe(false);
  });
});
