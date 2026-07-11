import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { persistStorageQuiet } from "./persistStorage";

/** 0 = unlimited concurrent agent runs. */
export const DEFAULT_MAX_CONCURRENT_AGENT_RUNS = 0;

export function getMaxConcurrentAgentRuns(): number {
  const stored = storageService.get<number>(
    STORAGE_KEYS.MAX_CONCURRENT_AGENT_RUNS,
    DEFAULT_MAX_CONCURRENT_AGENT_RUNS,
  );
  if (typeof stored !== "number" || !Number.isFinite(stored) || stored < 0) {
    return DEFAULT_MAX_CONCURRENT_AGENT_RUNS;
  }
  return Math.floor(stored);
}

export function setMaxConcurrentAgentRuns(value: number): void {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  persistStorageQuiet(STORAGE_KEYS.MAX_CONCURRENT_AGENT_RUNS, normalized);
}

export function isConcurrentRunCapReached(activeCount: number): boolean {
  const max = getMaxConcurrentAgentRuns();
  return max > 0 && activeCount >= max;
}
