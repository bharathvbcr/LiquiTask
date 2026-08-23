import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { readAiFeaturesEnabled } from "./aiFeatures";
import { persistStorageQuiet } from "./persistStorage";

/**
 * Agent execution (coding-agent runs through `liquitask-agentd`) is configured
 * independently of the in-app AI features (assistant, insights, auto-organize).
 * A board can run with AI assistance and no agents, or with agents and no
 * in-app AI.
 *
 * Installs predating the split have no stored value; they inherit the AI master
 * toggle so behaviour is unchanged until the user touches either switch.
 */
export function readAgentExecutionEnabled(): boolean {
  const stored = storageService.get<boolean | null>(STORAGE_KEYS.AGENT_EXECUTION_ENABLED, null);
  if (typeof stored === "boolean") return stored;
  return readAiFeaturesEnabled();
}

/** Persist the agent-execution toggle. */
export function writeAgentExecutionEnabled(enabled: boolean): void {
  persistStorageQuiet(STORAGE_KEYS.AGENT_EXECUTION_ENABLED, enabled);
}

/** Throw when agent execution is turned off (defense in depth for run entry points). */
export function assertAgentExecutionEnabled(): void {
  if (!readAgentExecutionEnabled()) {
    throw new Error("Agent execution is disabled. Enable it in Settings > General.");
  }
}
