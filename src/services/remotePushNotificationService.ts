import { FEATURE_FLAGS } from "../constants";
import { isTauri } from "../runtime/runtimeEnvironment";
import {
  type DaemonPushConfig,
  type RemotePushConfig,
  toDaemonPushConfig,
} from "../utils/pushNotificationConfig";

/** Sync remote push credentials to agentd so notifications fire while the app is closed. */
export async function syncRemotePushConfigToDaemon(
  config: RemotePushConfig,
): Promise<void> {
  if (!isTauri() || !FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return;

  const payload = toDaemonPushConfig(config);
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("agentd_notify_config_set", {
    config: payload ?? {
      enabled: false,
      provider: "none",
    },
  });
}

export type { DaemonPushConfig };
