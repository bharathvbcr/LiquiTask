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
  assertAiFeaturesEnabled,
  readAiFeaturesEnabled,
  writeAiFeaturesEnabled,
} from "../aiFeatures";

describe("aiFeatures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("readAiFeaturesEnabled defaults to true", () => {
    mockGet.mockImplementation((_key: string, def: unknown) => def);
    expect(readAiFeaturesEnabled()).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(STORAGE_KEYS.AI_FEATURES_ENABLED, true);
  });

  it("readAiFeaturesEnabled returns stored false", () => {
    mockGet.mockReturnValue(false);
    expect(readAiFeaturesEnabled()).toBe(false);
  });

  it("writeAiFeaturesEnabled persists via storage", () => {
    writeAiFeaturesEnabled(false);
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEYS.AI_FEATURES_ENABLED, false);
  });

  it("assertAiFeaturesEnabled throws when disabled", () => {
    mockGet.mockReturnValue(false);
    expect(() => assertAiFeaturesEnabled()).toThrow(/disabled/i);
  });

  it("assertAiFeaturesEnabled passes when enabled", () => {
    mockGet.mockReturnValue(true);
    expect(() => assertAiFeaturesEnabled()).not.toThrow();
  });
});
