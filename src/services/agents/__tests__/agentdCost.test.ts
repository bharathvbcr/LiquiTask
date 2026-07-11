import { describe, expect, it } from "vitest";

import { estimateCostUsdFromUsage } from "../agentdCost";

describe("estimateCostUsdFromUsage", () => {
  it("returns undefined when usage is empty or missing", () => {
    expect(estimateCostUsdFromUsage(undefined)).toBeUndefined();
    expect(estimateCostUsdFromUsage({})).toBeUndefined();
    expect(
      estimateCostUsdFromUsage({ "claude-sonnet": { inputTokens: 0, outputTokens: 0 } }),
    ).toBeUndefined();
  });

  it("estimates cost from per-model token tallies (sonnet rates)", () => {
    const cost = estimateCostUsdFromUsage({
      "claude-sonnet-4": { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(cost).toBeCloseTo(3, 5);
  });
});
