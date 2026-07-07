import { describe, expect, it } from "vitest";
import { failureKindLabel } from "../runProgress";

describe("failureKindLabel", () => {
  it("maps each failure kind to a short label", () => {
    expect(failureKindLabel("crashed")).toBe("Crashed");
    expect(failureKindLabel("timeout")).toBe("Timed out");
    expect(failureKindLabel("stall")).toBe("Stalled");
  });

  it("returns undefined for a normal run", () => {
    expect(failureKindLabel(undefined)).toBeUndefined();
  });
});
