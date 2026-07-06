import { describe, expect, it } from "vitest";

import { bloomLabel, classifyBloom, routeRank, routeText, summarizeRouting } from "../campaignBloom";
import { BloomLevel } from "../campaignTypes";

describe("campaign bloom routing", () => {
  it("routes execution verbs to a Worker", () => {
    for (const text of ["Implement the login form", "Fix the null check", "Add a flag", "Refactor parser"]) {
      const level = classifyBloom(text);
      expect(level).toBeLessThanOrEqual(BloomLevel.Apply);
      expect(routeRank(level)).toBe("worker");
    }
  });

  it("routes cognition verbs to the Reviewer", () => {
    for (const text of [
      "Design the storage architecture",
      "Evaluate the caching strategies",
      "Analyze the flaky build",
      "Root-cause the deadlock",
    ]) {
      expect(routeText(text)).toBe("reviewer");
    }
  });

  it("honours an explicit override", () => {
    expect(classifyBloom("implement a button", BloomLevel.Create)).toBe(BloomLevel.Create);
  });

  it("defaults to Apply", () => {
    expect(classifyBloom("")).toBe(BloomLevel.Apply);
    expect(bloomLabel(BloomLevel.Apply)).toBe("Apply");
  });

  it("summarises a batch's routing", () => {
    expect(summarizeRouting(["Implement X", "Design Y", "Fix Z"])).toEqual({ worker: 2, reviewer: 1 });
  });
});
