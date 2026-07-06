/**
 * Local API adapter — Multica `packages/core/api` seam for LiquiTask.
 * Backed by Tauri `invoke` + event listeners instead of REST/WS.
 * Phase 0 stub; expanded in Phase 1+ as agentd JSON-RPC bridge lands.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FEATURE_FLAGS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";

export type LocalApiEventChannel =
  | "agent-run-event"
  | "agentd-run-event"
  | "agent-run-finished"
  | "inbox-event"
  | "runtime-health"
  | "agentd-health";

export interface LocalApiInvokeOptions {
  /** Skip Tauri guard and return undefined (web/dev fallback). */
  allowWebFallback?: boolean;
}

async function guardedInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: LocalApiInvokeOptions,
): Promise<T | undefined> {
  if (!isTauri()) {
    return options?.allowWebFallback ? undefined : Promise.reject(new Error("localApi requires Tauri"));
  }
  return invoke<T>(command, args);
}

/** Subscribe to a Tauri event channel. No-op on web builds. */
export async function subscribeLocalEvent<T>(
  channel: LocalApiEventChannel | string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<T>(channel, (event) => handler(event.payload));
}

export const localApi = {
  /** Detect installed agent CLIs — routes to agentd when sidecar flag is on. */
  async detectRuntimes() {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<
        Array<{ id: string; name: string; binary: string; path?: string; version?: string; ready: boolean }>
      >("agentd_detect", undefined, { allowWebFallback: true });
    }
    return guardedInvoke<Array<{ name: string; available: boolean; path?: string }>>(
      "agent_detect_clis",
      undefined,
      { allowWebFallback: true },
    );
  },

  async ensureAgentd() {
    return guardedInvoke<boolean>("agentd_ensure", undefined, { allowWebFallback: true });
  },

  /** Start an agent run. Routes to agentd when `FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED`. */
  async runStart(params: {
    taskId: string;
    runtime: string;
    model?: string;
    cwd?: string;
    prompt: string;
    scope?: string[];
    mcpConfig?: string;
    thinkingLevel?: string;
    resumeSessionId?: string;
  }) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<string>("agentd_run_start", {
        taskId: params.taskId,
        runtime: params.runtime,
        prompt: params.prompt,
        cwd: params.cwd,
        model: params.model,
        resumeSessionId: params.resumeSessionId,
        thinkingLevel: params.thinkingLevel,
        mcpConfig: params.mcpConfig,
      });
    }
    return guardedInvoke<string>("agent_run_start", params as Record<string, unknown>);
  },

  async runCancel(runId: string) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>("agentd_run_cancel", { runId });
    }
    return guardedInvoke<void>("agent_run_cancel", { runId });
  },

  async runPause(runId: string) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>("agentd_run_pause", { runId });
    }
    return guardedInvoke<void>("agent_runner_pause", { runId });
  },

  async runResume(runId: string) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>("agentd_run_resume", { runId });
    }
    return guardedInvoke<void>("agent_runner_resume", { runId });
  },

  async runInject(runId: string, guidance: string) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>("agentd_run_inject", { runId, guidance });
    }
    return guardedInvoke<void>("agent_runner_inject_guidance", { runId, guidance });
  },

  async runReattach() {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<
        Array<{
          runId: string;
          taskId: string;
          runtime: string;
          alive: boolean;
          status: string;
        }>
      >("agentd_run_reattach", undefined, { allowWebFallback: true });
    }
    return guardedInvoke<
      Array<{
        runId: string;
        alive: boolean;
        status: string;
        sessionId?: string;
      }>
    >("agent_runs_reattach", undefined, { allowWebFallback: true });
  },

  /** Respond to an inline permission prompt — agentd-only (no legacy equivalent). */
  async permissionRespond(runId: string, requestId: string, decision: "allow" | "deny" | "always") {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>("agentd_permission_respond", { runId, requestId, decision });
    }
    return undefined;
  },

  subscribe: subscribeLocalEvent,
} as const;

export type LocalApi = typeof localApi;
