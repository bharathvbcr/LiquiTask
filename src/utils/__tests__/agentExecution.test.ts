import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants";

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("../../services/storageService", () => ({
  __esModule: true,
  default: {
    get: mockGet,
    set: mockSet,
  },
}));

import {
  assertAgentExecutionEnabled,
  readAgentExecutionEnabled,
  writeAgentExecutionEnabled,
} from "../agentExecution";

/** Storage stub: unset keys fall through to the caller's default. */
const withStored = (values: Record<string, unknown>) => {
  mockGet.mockImplementation((key: string, def: unknown) =>
    key in values ? values[key] : def,
  );
};

describe("agentExecution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inherits the AI toggle when no value was ever stored", () => {
    withStored({ [STORAGE_KEYS.AI_FEATURES_ENABLED]: false });
    expect(readAgentExecutionEnabled()).toBe(false);

    withStored({ [STORAGE_KEYS.AI_FEATURES_ENABLED]: true });
    expect(readAgentExecutionEnabled()).toBe(true);
  });

  it("defaults to enabled on a fresh install with neither key stored", () => {
    withStored({});
    expect(readAgentExecutionEnabled()).toBe(true);
  });

  it("is independent of the AI toggle once stored", () => {
    // AI off, agents on.
    withStored({
      [STORAGE_KEYS.AI_FEATURES_ENABLED]: false,
      [STORAGE_KEYS.AGENT_EXECUTION_ENABLED]: true,
    });
    expect(readAgentExecutionEnabled()).toBe(true);

    // AI on, agents off — the case this split exists for.
    withStored({
      [STORAGE_KEYS.AI_FEATURES_ENABLED]: true,
      [STORAGE_KEYS.AGENT_EXECUTION_ENABLED]: false,
    });
    expect(readAgentExecutionEnabled()).toBe(false);
  });

  it("writeAgentExecutionEnabled persists via storage", () => {
    writeAgentExecutionEnabled(false);
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEYS.AGENT_EXECUTION_ENABLED, false);
  });

  it("assertAgentExecutionEnabled throws when disabled", () => {
    withStored({ [STORAGE_KEYS.AGENT_EXECUTION_ENABLED]: false });
    expect(() => assertAgentExecutionEnabled()).toThrow(/disabled/i);
  });

  it("assertAgentExecutionEnabled passes when enabled with AI off", () => {
    withStored({
      [STORAGE_KEYS.AI_FEATURES_ENABLED]: false,
      [STORAGE_KEYS.AGENT_EXECUTION_ENABLED]: true,
    });
    expect(() => assertAgentExecutionEnabled()).not.toThrow();
  });
});
