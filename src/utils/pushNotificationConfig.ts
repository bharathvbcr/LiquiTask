import { STORAGE_KEYS } from "../constants";
import storageService from "../services/storageService";
import { persistStorageQuiet } from "./persistStorage";

export type RemotePushProvider = "none" | "pushover" | "webhook";

/** Remote push channel config (Pushover or generic webhook). Secrets are encrypted at rest via storage envelopes. */
export interface RemotePushConfig {
  enabled: boolean;
  provider: RemotePushProvider;
  pushoverUserKey: string;
  pushoverApiToken: string;
  webhookUrl: string;
}

export const DEFAULT_REMOTE_PUSH_CONFIG: RemotePushConfig = {
  enabled: false,
  provider: "none",
  pushoverUserKey: "",
  pushoverApiToken: "",
  webhookUrl: "",
};

export function readRemotePushConfig(): RemotePushConfig {
  const stored =
    storageService.get<Partial<RemotePushConfig>>(STORAGE_KEYS.REMOTE_PUSH_CONFIG, {}) ?? {};
  return {
    ...DEFAULT_REMOTE_PUSH_CONFIG,
    ...stored,
    provider: normalizeProvider(stored.provider),
  };
}

export function writeRemotePushConfig(config: RemotePushConfig): void {
  persistStorageQuiet(STORAGE_KEYS.REMOTE_PUSH_CONFIG, {
    ...config,
    provider: normalizeProvider(config.provider),
  });
}

function normalizeProvider(value: unknown): RemotePushProvider {
  if (value === "pushover" || value === "webhook") return value;
  return "none";
}

/** Plaintext payload forwarded to agentd (never persisted by the daemon). */
export interface DaemonPushConfig {
  enabled: boolean;
  provider: RemotePushProvider;
  pushoverUserKey?: string;
  pushoverApiToken?: string;
  webhookUrl?: string;
}

export function toDaemonPushConfig(config: RemotePushConfig): DaemonPushConfig | null {
  if (!config.enabled || config.provider === "none") return null;

  if (config.provider === "pushover") {
    const pushoverUserKey = config.pushoverUserKey.trim();
    const pushoverApiToken = config.pushoverApiToken.trim();
    if (!pushoverUserKey || !pushoverApiToken) return null;
    return {
      enabled: true,
      provider: "pushover",
      pushoverUserKey,
      pushoverApiToken,
    };
  }

  const webhookUrl = config.webhookUrl.trim();
  if (!webhookUrl) return null;
  return {
    enabled: true,
    provider: "webhook",
    webhookUrl,
  };
}
