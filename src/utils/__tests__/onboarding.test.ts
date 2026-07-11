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
  isFreshInstallFromData,
  needsOnboardingExperienceChoice,
  readOnboardingExperienceChosen,
  skipOnboardingForExistingInstall,
  writeOnboardingExperienceChosen,
} from "../onboarding";

describe("onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((_key: string, def: unknown) => def);
  });

  it("readOnboardingExperienceChosen defaults to false", () => {
    expect(readOnboardingExperienceChosen()).toBe(false);
    expect(mockGet).toHaveBeenCalledWith(STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN, false);
  });

  it("writeOnboardingExperienceChosen persists the flag", () => {
    writeOnboardingExperienceChosen(true);
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN, true);
  });

  it("isFreshInstallFromData is true for empty workspace", () => {
    expect(isFreshInstallFromData({ tasks: [], projects: [] })).toBe(true);
  });

  it("isFreshInstallFromData is false when tasks exist", () => {
    expect(
      isFreshInstallFromData({
        tasks: [{ id: "t1", title: "Task", status: "Task", projectId: "p1" } as any],
        projects: [],
      }),
    ).toBe(false);
  });

  it("isFreshInstallFromData is false when projects exist", () => {
    expect(
      isFreshInstallFromData({
        tasks: [],
        projects: [{ id: "p1", name: "P1", type: "custom", order: 0 } as any],
      }),
    ).toBe(false);
  });

  it("needsOnboardingExperienceChoice is true on fresh install", () => {
    expect(needsOnboardingExperienceChoice({ tasks: [], projects: [] })).toBe(true);
  });

  it("needsOnboardingExperienceChoice is false after choice is saved", () => {
    mockGet.mockImplementation((key: string, def: unknown) => {
      if (key === STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN) return true;
      return def;
    });
    expect(needsOnboardingExperienceChoice({ tasks: [], projects: [] })).toBe(false);
  });

  it("needsOnboardingExperienceChoice is false for existing installs with data", () => {
    expect(
      needsOnboardingExperienceChoice({
        tasks: [],
        projects: [{ id: "p1", name: "P1", type: "custom", order: 0 } as any],
      }),
    ).toBe(false);
  });

  it("skipOnboardingForExistingInstall marks choice for upgraded installs", () => {
    skipOnboardingForExistingInstall({
      tasks: [],
      projects: [{ id: "p1", name: "P1", type: "custom", order: 0 } as any],
    });
    expect(mockSet).toHaveBeenCalledWith(STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN, true);
  });

  it("skipOnboardingForExistingInstall does nothing on fresh install", () => {
    skipOnboardingForExistingInstall({ tasks: [], projects: [] });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
