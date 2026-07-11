import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { persistStorageQuiet } from "./persistStorage";

/** Read the master AI-features toggle (defaults to enabled for existing installs). */
export function readAiFeaturesEnabled(): boolean {
  return storageService.get(STORAGE_KEYS.AI_FEATURES_ENABLED, true);
}

/** Persist the master AI-features toggle. */
export function writeAiFeaturesEnabled(enabled: boolean): void {
  persistStorageQuiet(STORAGE_KEYS.AI_FEATURES_ENABLED, enabled);
}

/** Throw when AI features are turned off (defense in depth for LLM entry points). */
export function assertAiFeaturesEnabled(): void {
  if (!readAiFeaturesEnabled()) {
    throw new Error("AI features are disabled. Enable them in Settings > General.");
  }
}
