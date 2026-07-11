/**
 * Bridge to agentd PTY streaming (run.pty notifications via agentd.rs).
 */

import { FEATURE_FLAGS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";
import { subscribeLocalEvent } from "../../core/api/localApi";

export interface AgentPtyEvent {
  runId: string;
  data: string;
}

export interface AgentPtyHistory {
  data: string;
  supportsPty: boolean;
  ptyActive: boolean;
  takenOver: boolean;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const agentPtyService = {
  isAvailable(): boolean {
    return isTauri() && FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED;
  },

  async history(runId: string): Promise<AgentPtyHistory> {
    return invoke<AgentPtyHistory>("agentd_pty_history", { runId });
  },

  async write(runId: string, data: string): Promise<void> {
    await invoke<void>("agentd_pty_write", { runId, data });
  },

  async takeover(runId: string): Promise<void> {
    await invoke<void>("agentd_pty_takeover", { runId });
  },

  async onOutput(handler: (event: AgentPtyEvent) => void): Promise<() => void> {
    return subscribeLocalEvent<AgentPtyEvent>("agentd-run-pty", (payload) => {
      handler({
        runId: payload.runId,
        data: payload.data,
      });
    });
  },
};

export default agentPtyService;
