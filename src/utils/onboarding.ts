import type { Project, Task } from "../../types";
import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { persistStorageQuiet } from "./persistStorage";

type InstallSnapshot = {
  tasks?: Task[];
  projects?: Project[];
};

/** Whether the user already completed the first-run experience choice. */
export function readOnboardingExperienceChosen(): boolean {
  return storageService.get(STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN, false);
}

/** Persist that the first-run experience choice was made. */
export function writeOnboardingExperienceChosen(chosen = true): void {
  persistStorageQuiet(STORAGE_KEYS.ONBOARDING_EXPERIENCE_CHOSEN, chosen);
}

/** True when no substantive workspace data exists yet (brand-new install). */
export function isFreshInstallFromData(data: InstallSnapshot): boolean {
  const tasks = data.tasks ?? [];
  const projects = data.projects ?? [];
  if (tasks.length > 0 || projects.length > 0) return false;

  const agents = storageService.get<unknown[]>(STORAGE_KEYS.AGENTS, []);
  if (agents.length > 0) return false;

  const agentRuns = storageService.get<unknown[]>(STORAGE_KEYS.AGENT_RUNS, []);
  if (agentRuns.length > 0) return false;

  return true;
}

/** Existing installs skip the gate; only fresh installs without a saved choice see it. */
export function needsOnboardingExperienceChoice(data: InstallSnapshot): boolean {
  if (readOnboardingExperienceChosen()) return false;
  return isFreshInstallFromData(data);
}

/**
 * Upgraded installs that already have data should not be prompted — mark the
 * onboarding step complete without changing AI preferences.
 */
export function skipOnboardingForExistingInstall(data: InstallSnapshot): void {
  if (readOnboardingExperienceChosen()) return;
  if (!isFreshInstallFromData(data)) {
    writeOnboardingExperienceChosen(true);
  }
}
