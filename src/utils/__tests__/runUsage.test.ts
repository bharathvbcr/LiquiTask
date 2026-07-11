import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../../types";
import {
  deriveAgentSessionCost,
  deriveRunCostDisplay,
  formatCostUsd,
  formatTokenCount,
  sumTokenUsage,
} from "../runUsage";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "run-1",
    taskId: "task-1",
    agentId: "agent-1",
    status: "running",
    createdAt: new Date(),
    events: [],
    ...overrides,
  } as AgentRun;
}

describe("runUsage", () => {
  it("sums token fields across models", () => {
    expect(
      sumTokenUsage({
        "claude-sonnet": { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10 },
      }),
    ).toBe(160);
  });

  it("derives estimated cost from usage when costUsd is absent", () => {
    const display = deriveRunCostDisplay(
      run({
        usage: { "claude-sonnet-4": { inputTokens: 1_000_000, outputTokens: 0 } },
      }),
    );
    expect(display?.estimated).toBe(true);
    expect(display?.costUsd).toBeCloseTo(3, 5);
    expect(display?.totalTokens).toBe(1_000_000);
  });

  it("prefers explicit costUsd over usage estimation", () => {
    const display = deriveRunCostDisplay(
      run({
        status: "completed",
        costUsd: 0.42,
        usage: { "claude-sonnet-4": { inputTokens: 1_000_000, outputTokens: 0 } },
      }),
    );
    expect(display?.costUsd).toBe(0.42);
    expect(display?.estimated).toBe(false);
  });

  it("marks active runs with usage as estimated even when costUsd is set", () => {
    const display = deriveRunCostDisplay(
      run({
        status: "running",
        costUsd: 0.1,
        usage: { "claude-sonnet-4": { inputTokens: 500, outputTokens: 100 } },
      }),
    );
    expect(display?.estimated).toBe(true);
  });

  it("aggregates session cost across an agent's runs", () => {
    const total = deriveAgentSessionCost("agent-1", [
      run({ id: "r1", costUsd: 0.5, status: "completed" }),
      run({ id: "r2", costUsd: 0.25, status: "completed" }),
      run({ id: "r3", agentId: "other", costUsd: 9 }),
    ]);
    expect(total?.costUsd).toBeCloseTo(0.75, 5);
    expect(total?.estimated).toBe(false);
  });

  it("formats cost and token labels", () => {
    expect(formatCostUsd(1.234, false)).toBe("$1.23");
    expect(formatCostUsd(1.234, true)).toBe("~$1.23");
    expect(formatTokenCount(1500)).toBe("1.5k");
    expect(formatTokenCount(2_500_000)).toBe("2.5M");
  });
});
