import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyGpuTier,
  getManualReducedEffectsPreference,
  setManualReducedEffectsPreference,
} from "../gpuDetection";

describe("gpuDetection manual override", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.gpuTier;
  });

  afterEach(() => {
    delete document.documentElement.dataset.gpuTier;
  });

  it("defaults to no manual preference", () => {
    expect(getManualReducedEffectsPreference()).toBe(false);
  });

  it("persists the preference and forces the reduced tier", () => {
    const tier = setManualReducedEffectsPreference(true);

    expect(tier).toBe("reduced");
    expect(getManualReducedEffectsPreference()).toBe(true);
    expect(document.documentElement.dataset.gpuTier).toBe("reduced");
  });

  it("clears the preference and falls back to auto-detection", () => {
    setManualReducedEffectsPreference(true);
    setManualReducedEffectsPreference(false);

    expect(getManualReducedEffectsPreference()).toBe(false);
    expect(document.documentElement.dataset.gpuTier).toBe(applyGpuTier());
  });
});
