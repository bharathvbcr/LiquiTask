/**
 * Local API adapter — Multica `packages/core/api` seam for LiquiTask.
 * Backed by Tauri `invoke` + event listeners instead of REST/WS.
 * Phase 0 stub; expanded in Phase 1+ as agentd JSON-RPC bridge lands.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AgentSshConfig } from '../../../types';
import { FEATURE_FLAGS } from '../../constants';
import { isTauri } from '../../runtime/runtimeEnvironment';

export type LocalApiEventChannel =
  | 'agent-run-event'
  | 'agentd-run-event'
  | 'agentd-feedback-event'
  | 'agentd-scheduler-event'
  | 'agent-run-finished'
  | 'inbox-event'
  | 'runtime-health'
  | 'agentd-health';

export interface LocalApiInvokeOptions {
  /** Skip Tauri guard and return undefined (web/dev fallback). */
  allowWebFallback?: boolean;
}

async function guardedInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: LocalApiInvokeOptions
): Promise<T | undefined> {
  if (!isTauri()) {
    return options?.allowWebFallback
      ? undefined
      : Promise.reject(new Error('localApi requires Tauri'));
  }
  return invoke<T>(command, args);
}

/** Subscribe to a Tauri event channel. No-op on web builds. */
export async function subscribeLocalEvent<T>(
  channel: LocalApiEventChannel | string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => undefined;
  }
  return listen<T>(channel, event => handler(event.payload));
}

type RuntimeDetection =
  | Array<{
      id: string;
      name: string;
      binary: string;
      path?: string;
      version?: string;
      ready: boolean;
    }>
  | Array<{ name: string; available: boolean; path?: string }>
  | undefined;

// Runtime detection shells out to every known agent binary (`--version` × 14),
// which takes seconds — cache it so surfaces open instantly on revisit.
let runtimeDetectionCache: { at: number; value: RuntimeDetection } | null = null;
let runtimeDetectionInFlight: Promise<RuntimeDetection> | null = null;

export const localApi = {
  /** Detect installed agent CLIs — routes to agentd when sidecar flag is on. */
  async detectRuntimes() {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<
        Array<{
          id: string;
          name: string;
          binary: string;
          path?: string;
          version?: string;
          ready: boolean;
        }>
      >('agentd_detect', undefined, { allowWebFallback: true });
    }
    return guardedInvoke<Array<{ name: string; available: boolean; path?: string }>>(
      'agent_detect_clis',
      undefined,
      { allowWebFallback: true }
    );
  },

  /**
   * Cached `detectRuntimes` — returns the last result when it's fresh enough
   * and dedupes concurrent calls, so the Agents surface and settings open
   * without re-running the (slow) binary scan every time.
   */
  async detectRuntimesCached(maxAgeMs = 5 * 60_000): Promise<RuntimeDetection> {
    if (runtimeDetectionCache && Date.now() - runtimeDetectionCache.at < maxAgeMs) {
      return runtimeDetectionCache.value;
    }
    if (!runtimeDetectionInFlight) {
      runtimeDetectionInFlight = this.detectRuntimes()
        .then(value => {
          runtimeDetectionCache = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          runtimeDetectionInFlight = null;
        });
    }
    return runtimeDetectionInFlight;
  },

  async ensureAgentd() {
    return guardedInvoke<boolean>('agentd_ensure', undefined, { allowWebFallback: true });
  },

  async stopAgentd() {
    return guardedInvoke<boolean>('agentd_stop', undefined, { allowWebFallback: true });
  },

  async queueList() {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      activeByAgent: Record<string, string>;
      queue: Array<{ taskId: string; agentId: string; runId?: string; enqueuedAtMs?: number }>;
    }>('agentd_queue_list', undefined, { allowWebFallback: true });
  },

  async queueEnqueue(taskId: string, agentId: string, runId?: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<number>('agentd_queue_enqueue', { taskId, agentId, runId });
  },

  async queueRemove(params: { taskId?: string; agentId?: string; runId?: string }) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<boolean>('agentd_queue_remove', params);
  },

  async queueAcquire(agentId: string, runId: string, maxConcurrentRuns?: number) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<boolean>('agentd_queue_acquire', {
      agentId,
      runId,
      maxConcurrentRuns: maxConcurrentRuns && maxConcurrentRuns > 0 ? maxConcurrentRuns : undefined,
    });
  },

  async queueRelease(agentId: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      taskId: string;
      agentId: string;
      runId?: string;
    } | null>('agentd_queue_release', { agentId });
  },

  async reservationList() {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      active: Array<{
        runId: string;
        taskId: string;
        paths: string[];
        claimedAtMs?: number;
      }>;
      waiting: Array<{
        runId: string;
        taskId: string;
        paths: string[];
        enqueuedAtMs?: number;
      }>;
    }>('agentd_reservation_list', undefined, { allowWebFallback: true });
  },

  async reservationClaim(
    runId: string,
    taskId: string,
    paths: string[],
    queueOnConflict = true,
  ) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      ok: boolean;
      conflict?: {
        runId: string;
        taskId: string;
        paths: string[];
        overlap: string[];
      };
      waitPosition?: number;
    }>('agentd_reservation_claim', { runId, taskId, paths, queueOnConflict });
  },

  async reservationRelease(runId: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      runId: string;
      taskId: string;
      paths: string[];
      enqueuedAtMs?: number;
    } | null>('agentd_reservation_release', { runId });
  },

  /** Start an agent run. Routes to agentd when `FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED`. */
  async runStart(params: {
    taskId: string;
    localRunId?: string;
    agentId?: string;
    runtime: string;
    model?: string;
    advisorModel?: string;
    cwd?: string;
    prompt: string;
    scope?: string[];
    mcpConfig?: string;
    thinkingLevel?: string;
    resumeSessionId?: string;
    permissionMode?: string;
    timeoutMs?: number;
    autoApprove?: boolean;
    toolPolicy?: Record<string, string>;
    sandboxMode?: string;
    containerImage?: string;
    host?: 'local' | 'ssh';
    ssh?: AgentSshConfig;
    localBasePath?: string;
    dailyCostCapUsd?: number | null;
    maxRunsPerDay?: number | null;
    perRunCostCapUsd?: number | null;
    todaySpendUsd?: number;
    todayRunCount?: number;
  }) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      const args: Record<string, unknown> = {
        taskId: params.taskId,
        localRunId: params.localRunId,
        agentId: params.agentId,
        runtime: params.runtime,
        prompt: params.prompt,
        cwd: params.cwd,
        model: params.model,
        resumeSessionId: params.resumeSessionId,
        thinkingLevel: params.thinkingLevel,
        mcpConfig: params.mcpConfig,
        permissionMode: params.permissionMode,
      };
      if (params.advisorModel?.trim()) {
        args.advisorModel = params.advisorModel.trim();
      }
      if (params.timeoutMs !== undefined) args.timeoutMs = params.timeoutMs;
      if (params.autoApprove !== undefined) args.autoApprove = params.autoApprove;
      if (params.toolPolicy !== undefined) args.toolPolicy = params.toolPolicy;
      if (params.sandboxMode !== undefined && params.sandboxMode !== 'none') {
        args.sandboxMode = params.sandboxMode;
      }
      if (params.containerImage) {
        args.containerImage = params.containerImage;
      }
      if (params.host === 'ssh') {
        args.host = 'ssh';
      }
      if (params.ssh?.target?.trim()) {
        args.ssh = {
          target: params.ssh.target.trim(),
          port: params.ssh.port,
          identityFile: params.ssh.identityFile?.trim() || undefined,
          remoteBasePath: params.ssh.remotePath?.trim() || undefined,
          fallbackToLocal: params.ssh.fallbackToLocal !== false,
        };
      }
      if (params.localBasePath) {
        args.localBasePath = params.localBasePath;
      }
      if (params.scope?.length) {
        args.scope = params.scope;
      }
      if (params.dailyCostCapUsd != null && params.dailyCostCapUsd > 0) {
        args.dailyCostCapUsd = params.dailyCostCapUsd;
      }
      if (params.maxRunsPerDay != null && params.maxRunsPerDay > 0) {
        args.maxRunsPerDay = params.maxRunsPerDay;
      }
      if (params.perRunCostCapUsd != null && params.perRunCostCapUsd > 0) {
        args.perRunCostCapUsd = params.perRunCostCapUsd;
      }
      if (params.todaySpendUsd != null) {
        args.todaySpendUsd = params.todaySpendUsd;
      }
      if (params.todayRunCount != null) {
        args.todayRunCount = params.todayRunCount;
      }
      return guardedInvoke<string>('agentd_run_start', args);
    }
    return guardedInvoke<string>('agent_run_start', params as Record<string, unknown>);
  },

  async runCancel(runId: string) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>('agentd_run_cancel', { runId });
    }
    return guardedInvoke<void>('agent_run_cancel', { runId });
  },

  async runPause(runId: string) {
    return guardedInvoke<void>('agentd_run_pause', { runId });
  },

  async runResume(runId: string) {
    return guardedInvoke<void>('agentd_run_resume', { runId });
  },

  async runInject(runId: string, guidance: string) {
    return guardedInvoke<void>('agentd_run_inject', { runId, guidance });
  },

  async mcpAppendGuidance(runId: string, message: string) {
    return guardedInvoke<void>('agent_mcp_append_guidance', { runId, message });
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
      >('agentd_run_reattach', undefined, { allowWebFallback: true });
    }
    return guardedInvoke<
      Array<{
        runId: string;
        alive: boolean;
        status: string;
        sessionId?: string;
      }>
    >('agent_runs_reattach', undefined, { allowWebFallback: true });
  },

  /** Scan on-disk agent sessions not started by LiquiTask (agentd-only). */
  async sessionsDiscover(knownSessionIds: string[] = []) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      sessions: Array<{
        sessionId: string;
        runtime: string;
        projectPath: string;
        sessionPath: string;
        gitBranch?: string;
        preview?: string;
        modifiedAtMs: number;
      }>;
    }>('agentd_sessions_discover', { knownSessionIds }, { allowWebFallback: true });
  },

  /** Copy-and-truncate a Claude/Codex on-disk session (agentd-only). */
  async sessionsFork(
    runtime: string,
    sessionId: string,
    projectPath?: string,
    messageIndex?: number,
  ) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      newSessionId: string;
      sessionPath: string;
      messageIndex: number;
    }>(
      'agentd_sessions_fork',
      { runtime, sessionId, projectPath, messageIndex },
      { allowWebFallback: true },
    );
  },

  /** Truncate a session file to a message index (agentd-only). */
  async sessionsTruncate(
    runtime: string,
    sessionId: string,
    messageIndex: number,
    projectPath?: string,
  ) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      sessionPath: string;
      messageIndex: number;
    }>(
      'agentd_sessions_truncate',
      { runtime, sessionId, messageIndex, projectPath },
      { allowWebFallback: true },
    );
  },

  /** Count JSONL messages in a session file (agentd-only). */
  async sessionsMessageCount(runtime: string, sessionId: string, projectPath?: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<{
      sessionPath: string;
      messageIndex: number;
    }>(
      'agentd_sessions_message_count',
      { runtime, sessionId, projectPath },
      { allowWebFallback: true },
    );
  },

  /** Respond to an inline permission prompt — agentd-only (no legacy equivalent). */
  async permissionRespond(
    runId: string,
    requestId: string,
    decision: 'allow' | 'deny' | 'always',
    inputDigest?: string,
  ) {
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
      return guardedInvoke<void>('agentd_permission_respond', { runId, requestId, decision, inputDigest });
    }
    return undefined;
  },

  /** Preflight SSH connectivity for remote agent execution (agentd-only). */
  async sshHealthCheck(config: AgentSshConfig) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return false;
    return guardedInvoke<boolean>('agentd_ssh_health', {
      target: config.target,
      port: config.port,
      identityFile: config.identityFile,
      remotePath: config.remotePath,
      fallbackToLocal: config.fallbackToLocal !== false,
    });
  },

  /**
   * Installed skill FILES discovered on disk (~/.claude/skills, ~/.agents/skills,
   * etc.) — distinct from agentSkillsService's captured-run-history skills.
   * agentd-only (no legacy equivalent); `provider` empty sweeps every supported
   * runtime's skill root plus the universal fallback.
   */
  async listSkills(provider?: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<
      Array<{
        key: string;
        name: string;
        description?: string;
        source_path: string;
        provider: string;
        root?: string;
        file_count: number;
      }>
    >('agentd_skills_list', { provider }, { allowWebFallback: true });
  },

  /** Read a locally-installed skill's SKILL.md body for prompt inlining. */
  async readSkillBody(sourcePath: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<string>('agentd_skill_read', { sourcePath }, { allowWebFallback: true });
  },

  async feedbackWatch(
    runs: Array<{
      runId: string;
      taskId: string;
      prUrl: string;
      repoDir?: string;
      gitBranch?: string;
      status?: string;
    }>,
  ) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<number>('agentd_feedback_watch', { runs });
  },

  /** Register a dispatch intent with the daemon scheduler (authoritative queue owner). */
  async schedulerIntentSet(intent: {
    runId: string;
    localRunId?: string;
    taskId: string;
    agentId: string;
    runtime?: string;
    cwd?: string;
    prompt?: string;
    model?: string;
    resumeSessionId?: string;
    devCouncilVerify?: boolean;
    maxRetries?: number;
    autoRepairCi?: boolean;
    autoRepairReview?: boolean;
    autoRepairMax?: number;
    prUrl?: string;
    repoDir?: string;
    gitBranch?: string;
    sessionId?: string;
    startParams?: Record<string, unknown>;
  }) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<boolean>('agentd_scheduler_intent_set', intent);
  },

  async schedulerConfigSet(params: {
    maxConcurrentRuns?: number;
    defaultMaxRetries?: number;
  }) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<boolean>('agentd_scheduler_config_set', params);
  },

  /** Tail stored run events (reviewer gate polling fallback). */
  async listRunEvents(runId: string) {
    if (!FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return undefined;
    return guardedInvoke<Array<{ kind: string; text?: string }>>(
      'agentd_store_list_run_events',
      { runId, limit: 50 },
      { allowWebFallback: true },
    );
  },

  subscribe: subscribeLocalEvent,
} as const;

export type LocalApi = typeof localApi;
