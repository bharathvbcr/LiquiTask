import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock("../../services/storageService", () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

import {
  DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
  getMaxConcurrentAgentRuns,
  isConcurrentRunCapReached,
  setMaxConcurrentAgentRuns,
} from "../agentRunLimits";
import { STORAGE_KEYS } from "../../constants";

describe("agentRunLimits", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
  });

  it("defaults to unlimited when unset", () => {
    mockGet.mockReturnValue(DEFAULT_MAX_CONCURRENT_AGENT_RUNS);
    expect(getMaxConcurrentAgentRuns()).toBe(0);
    expect(isConcurrentRunCapReached(99)).toBe(false);
  });

  it("persists a non-negative integer cap", () => {
    setMaxConcurrentAgentRuns(3.8);
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEYS.MAX_CONCURRENT_AGENT_RUNS, 3);
  });

  it("detects when the cap is reached", () => {
    mockGet.mockReturnValue(2);
    expect(isConcurrentRunCapReached(1)).toBe(false);
    expect(isConcurrentRunCapReached(2)).toBe(true);
  });
});
