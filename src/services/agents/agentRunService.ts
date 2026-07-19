import { FEATURE_FLAGS, STORAGE_KEYS } from '../../constants';
import { localApi, subscribeLocalEvent } from '../../core/api/localApi';
import taskEventStore from '../../core/events/taskEventStore';
import { isTauri } from '../../runtime/runtimeEnvironment';
import {
  getMaxConcurrentAgentRuns,
  isConcurrentRunCapReached,
} from '../../utils/agentRunLimits';
import storageService from '../storageService';
import { buildCouncilGoal, buildTaskPrompt, withRepoContext, withRepoFileIndex } from './agentPrompt';
import devcouncilService from './devcouncilService';
import {
  isNativeBackend,
  nativeBuildCouncilGoal,
  nativeBuildTaskPrompt,
  nativeParseCouncilReport,
  nativeParseStreamLine,
} from '../nativeBridge';
import agentMcpService from './agentMcpService';
import agentScopeService from './agentScopeService';
import agentReservationService from './agentReservationService';
import { declarePlannedScope } from './scopeHeuristic';
import agentSkillsService from './agentSkillsService';
import { mergeSkillCatalog, type InstalledSkill } from '../../core/skills';
import {
  catalogEntryToSkill,
  selectRunSkills as pinAndRankRunSkills,
} from './skillSelection';
import {
  autoRepairMaxAttempts,
  checkAgentBudget,
  checkAutoRepairAllowed,
  getAgentDailyStats,
  isAutoRepairEnabled,
  resolveAgentModel,
} from './agentPolicyService';
import { parseClaudeStreamLine, parseCouncilReport } from './agentStreamParser';
import deadLetterService from '../deadLetterService';
import { estimateCostUsdFromUsage } from './agentdCost';
import { resolveAgentWorkspace, type WorkspaceResolution } from './resolveAgentWorkspace';
import {
  agentdStartTimeoutMs,
  evaluateRunLimits,
  exceededCostCap,
  resolveRunLimits,
  type RunAbortReason,
  type RunLimitDefaults,
} from './runLimits';
import { describeProcessExit } from '../../utils/runProgress';
import type {
  AgentProfile,
  AgentRun,
  AgentRunEvent,
  AgentRunEventKind,
  AgentSkill,
  AgentToolPolicyAction,
  SessionCheckpoint,
  Task,
} from '../../../types';

/** Payload emitted by the Rust agent runner on `agent-run-event`. */
interface AgentRunNativeEvent {
  runId: string;
  stream: 'stdout' | 'stderr' | 'exit' | 'error';
  line?: string;
  code?: number;
}

interface AgentdRunEvent {
  runId: string;
  kind:
    | 'message'
    | 'tool_use'
    | 'tool_result'
    | 'thinking'
    | 'status'
    | 'log'
    | 'permission_request'
    | 'result'
    | 'error';
  text?: string;
  tool?: string;
  callId?: string;
  input?: Record<string, unknown>;
  output?: string;
  status?: string;
  level?: string;
  sessionId?: string;
  error?: string;
  code?: number;
  durationMs?: number;
  usage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  >;
  costUsd?: number;
}

/** Payload emitted by the daemon scheduler on `agentd-scheduler-event`. */
interface SchedulerEvent {
  kind: string;
  runId: string;
  localRunId?: string;
  taskId: string;
  agentId: string;
  status?: string;
  sessionId?: string;
  error?: string;
  payload?: Record<string, unknown>;
}

/** agentd runtime id for a profile provider (only "claude-code" differs). */
function providerToRuntime(provider: AgentProfile['provider']): string {
  return provider === 'claude-code' ? 'claude' : provider;
}

/**
 * One entry returned by `agent_runs_reattach` on relaunch (Runtime v2 headless
 * runs). `alive` means the agent process is still running detached; otherwise
 * `status` is the outcome reconciled from the run's durable stdout log.
 */
interface RunReattachInfo {
  runId: string;
  alive: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  sessionId?: string;
  summary?: string;
  exitCode?: number;
  paused?: boolean;
}

export interface AgentCliStatus {
  name: string;
  available: boolean;
  path?: string;
}

/** An installed IDE / editor launcher discovered on PATH or as a macOS app. */
export interface IdeToolStatus {
  /** Stable id (e.g. "vscode"). */
  id: string;
  /** Human label (e.g. "Visual Studio Code"). */
  name: string;
  /** Preferred PATH binary (e.g. "code"); may be unusable when launch="bundle". */
  binary: string;
  available: boolean;
  /** Resolved location — PATH binary or `.app` bundle path. */
  path?: string;
  /** Grouping hint; currently always "ide". */
  kind: string;
  /** Launch strategy: "path" (PATH launcher), "bundle" (macOS .app), or "none". */
  launch?: 'path' | 'bundle' | 'none';
  /** macOS app display name for bundle launches (when launch="bundle"). */
  appName?: string;
}

/** Hooks the app layer registers so runs can move cards / write activity. */
export interface AgentRunTaskHooks {
  onRunStarted?: (taskId: string, run: AgentRun) => void;
  onRunFinished?: (taskId: string, run: AgentRun) => void;
  /** Called when a run needs git diff refresh (after exit). */
  onGitDiffReady?: (taskId: string, run: AgentRun) => void;
  /**
   * A run died without a reviewable result — killed/terminated (`crashed`) or
   * stopped by a guardrail (`timeout` / `stall`). The app layer uses this to
   * auto-recover (return the card to the board, optionally retry).
   */
  onRunAborted?: (taskId: string, run: AgentRun, reason: RunAbortReason | 'crashed') => void;
}

/**
 * Guardrail defaults when an agent doesn't override them. Timeout is opt-in
 * (long runs can be legitimate); stall defaults on with a generous window
 * because a coding agent silent for this long is almost always wedged, and an
 * active run keeps resetting it by streaming events.
 */
const DEFAULT_RUN_LIMITS: RunLimitDefaults = {
  timeoutMinutes: 0,
  stallMinutes: 25,
  perRunCostCapUsd: 0,
};

const RUN_LIMIT_POLL_MS = 30_000;

type Listener = (runs: AgentRun[]) => void;

const MAX_EVENTS_PER_RUN = 300;
const MAX_PERSISTED_RUNS = 100;
const PERMISSION_PROMPT_TOOL = 'mcp__liquitask__permission_prompt';

/** Blocks assign until journal reconcile + app rehydration complete. */
function createReadyGate() {
  let resolved = false;
  let resolveReady!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveReady = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
  });
  return {
    promise,
    resolve: resolveReady,
    isReady: () => resolved,
  };
}

function permissionPromptToolFor(agent: AgentProfile, mcpConfig: string | null): string | null {
  if (!mcpConfig || agent.permissionMode === 'bypassPermissions') {
    return null;
  }
  return PERMISSION_PROMPT_TOOL;
}

function agentSandboxMode(agent: AgentProfile): 'none' | 'os' {
  if (agent.sandbox === 'container') return 'none';
  return agent.sandboxMode === 'os' ? 'os' : 'none';
}

const DEFAULT_CONTAINER_IMAGE = 'liquitask-agent:latest';

function agentContainerImage(agent: AgentProfile): string | undefined {
  if (agent.sandbox !== 'container') return undefined;
  const image = agent.containerImage?.trim();
  return image || DEFAULT_CONTAINER_IMAGE;
}

/** Remote SSH execution params forwarded to agentd `run.start`. */
function agentdSSHStartParams(agent: AgentProfile): {
  host?: 'local' | 'ssh';
  ssh?: AgentProfile['ssh'];
  localBasePath?: string;
} {
  if ((agent.host ?? 'local') !== 'ssh' || !agent.ssh?.target?.trim()) {
    return {};
  }
  return {
    host: 'ssh',
    ssh: agent.ssh,
    localBasePath: agent.workingDir,
  };
}

/** Guardrails and permission policy forwarded to agentd `run.start`. */
function agentdProfileStartParams(agent: AgentProfile): {
  timeoutMs?: number;
  autoApprove?: boolean;
  toolPolicy?: Record<string, AgentToolPolicyAction>;
  advisorModel?: string;
} {
  const params: {
    timeoutMs?: number;
    autoApprove?: boolean;
    toolPolicy?: Record<string, AgentToolPolicyAction>;
    advisorModel?: string;
  } = {};
  const timeoutMs = agentdStartTimeoutMs(agent, DEFAULT_RUN_LIMITS);
  if (timeoutMs > 0) params.timeoutMs = timeoutMs;
  if (agent.autoApprove === true) params.autoApprove = true;
  const policy = agent.toolPolicy;
  if (policy && Object.keys(policy).length > 0) params.toolPolicy = policy;
  const advisor = resolveAdvisorModel(agent);
  if (advisor) params.advisorModel = advisor;
  return params;
}

/**
 * Claude Code advisor model for coding runs. Planner role never uses advisor;
 * non-Claude providers ignore the field.
 */
export function resolveAdvisorModel(agent: AgentProfile): string | undefined {
  if ((agent.role ?? 'default') === 'planner') return undefined;
  if (agent.provider !== 'claude-code') return undefined;
  const trimmed = agent.advisorModel?.trim();
  return trimmed || undefined;
}

type QueueCacheEntry = { taskId: string; agentId: string; runId?: string };

/**
 * Orchestrates the Multica-style agent run lifecycle:
 * queued -> running -> (verifying) -> completed | failed | cancelled.
 *
 * Direct runs execute via liquitask-agentd (including claude-code); council mode
 * and the post-run verify gate use the slim Rust DevCouncil runner.
 * - `runMode: "council"` routes the whole run through `dev e2e --executor claude`
 * - `devCouncilVerify` runs `dev check --verify --json` after direct runs
 */
class AgentRunService {
  private runs = new Map<string, AgentRun>();
  /** Cached supervisor queue snapshot (daemon-backed when sidecar is enabled). */
  private queueCache: QueueCacheEntry[] = [];
  private activeByAgent = new Map<string, string>();
  private runContext = new Map<string, { task: Task; agent: AgentProfile }>();
  private councilBuffers = new Map<string, string[]>();
  private verifyBuffers = new Map<string, string[]>();
  private listeners = new Set<Listener>();
  private hooks: AgentRunTaskHooks = {};
  /**
   * Resolves the working directory for a run from the task's project workspace.
   * Injected by the app layer (which owns projects); when unset the service
   * keeps the agent's own `workingDir` (legacy behaviour, used by tests).
   */
  private workspaceResolver?: (task: Task, agent: AgentProfile) => WorkspaceResolution;
  private unlisten: (() => void) | null = null;
  private unlistenAgentd: (() => void) | null = null;
  private unlistenScheduler: (() => void) | null = null;
  /** sidecar runId -> local run id, for routing inbound agentd-run-events. */
  private agentdIdMap = new Map<string, string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** macOS caffeinate -i child while any run is active. */
  private sleepPreventionActive = false;
  /** Guardrail watchdog: polls active runs for timeout/stall breaches. */
  private runLimitTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  /**
   * workingDir -> DevCouncil-enabled probe. Cached for the app session for the
   * same reason as agentMcpService's devCliAvailableCache: whether a repo has
   * been `dev init`-ed doesn't change mid-session, so run starts shouldn't
   * re-hit the disk for it.
   */
  private devcouncilDirCache = new Map<string, Promise<boolean>>();
  /** Run ids finalized from the journal on relaunch, awaiting board retro-drive. */
  private pendingBoardSync: string[] = [];
  /** Per-key async mutex — prevents assign TOCTOU double-starts. */
  private assignLocks = new Map<string, Promise<void>>();
  /** Runs with an in-flight mergeWorktree — blocks followUp reclaim. */
  private mergingRuns = new Set<string>();
  /** User-cancelled merges — mergeWorktree checks and aborts. */
  private mergeAbortRequested = new Set<string>();
  /** Resolved after journal reconcile and app-layer rehydration (see signalReady). */
  private readyGate = createReadyGate();

  private usesDaemonQueue(): boolean {
    return FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED && isTauri();
  }

  private applyQueueSnapshot(
    activeByAgent: Record<string, string> | undefined,
    queue: QueueCacheEntry[] | undefined,
  ): void {
    this.activeByAgent = new Map(Object.entries(activeByAgent ?? {}));
    this.queueCache = queue ?? [];
  }

  private async refreshQueueCache(): Promise<void> {
    if (!this.usesDaemonQueue()) return;
    try {
      const state = await localApi.queueList();
      if (!state) return;
      this.applyQueueSnapshot(state.activeByAgent, state.queue);
    } catch (err) {
      console.warn('agentd queue.list unavailable:', err);
    }
  }

  private async daemonEnqueue(taskId: string, agentId: string, runId: string): Promise<void> {
    if (!this.usesDaemonQueue()) {
      if (!this.queueCache.some((q) => q.taskId === taskId && q.agentId === agentId)) {
        this.queueCache.push({ taskId, agentId, runId });
      }
      return;
    }
    await localApi.queueEnqueue(taskId, agentId, runId);
    await this.refreshQueueCache();
  }

  private async daemonRemoveQueued(taskId: string): Promise<void> {
    if (!this.usesDaemonQueue()) {
      this.queueCache = this.queueCache.filter((q) => q.taskId !== taskId);
      return;
    }
    await localApi.queueRemove({ taskId });
    await this.refreshQueueCache();
  }

  private async daemonAcquire(agentId: string, runId: string): Promise<void> {
    const maxConcurrent = getMaxConcurrentAgentRuns();
    if (!this.usesDaemonQueue()) {
      if (isConcurrentRunCapReached(this.activeByAgent.size)) {
        throw new Error(
          maxConcurrent > 0
            ? `Max concurrent agent runs (${maxConcurrent}) reached — task queued.`
            : 'Unable to acquire agent run slot.',
        );
      }
      this.activeByAgent.set(agentId, runId);
      return;
    }
    await localApi.queueAcquire(agentId, runId, maxConcurrent);
    await this.refreshQueueCache();
  }

  private async daemonRelease(agentId: string): Promise<QueueCacheEntry | null> {
    if (!this.usesDaemonQueue()) {
      this.activeByAgent.delete(agentId);
      const idx = this.queueCache.findIndex((q) => q.agentId === agentId);
      let localNext: QueueCacheEntry | null = null;
      if (idx >= 0) {
        localNext = this.queueCache[idx] ?? null;
        this.queueCache.splice(idx, 1);
      }
      return localNext;
    }
    const next = (await localApi.queueRelease(agentId)) ?? null;
    await this.refreshQueueCache();
    return next;
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  /** True once reconcile + rehydrate have finished on relaunch. */
  isReady(): boolean {
    return !isTauri() || this.readyGate.isReady();
  }

  /** Wait until run reconcile/rehydrate completes before starting new runs. */
  whenReady(): Promise<void> {
    if (!isTauri()) return Promise.resolve();
    return this.readyGate.promise;
  }

  /**
   * Called by the app layer after `rehydrateActiveRuns` and `flushPendingBoardSync`
   * so assign/auto-pickup cannot race headless reattach.
   */
  signalReady(): void {
    this.readyGate.resolve();
  }

  async initialize(): Promise<void> {
    if (this.initialized || !isTauri()) return;
    this.initialized = true;

    const persisted = storageService.get<AgentRun[]>(STORAGE_KEYS.AGENT_RUNS, []);
    const revived = (persisted ?? []).map(raw => this.reviveRun(raw));
    for (const run of revived) {
      this.runs.set(run.id, run);
      if (run.agentdRunId) this.agentdIdMap.set(run.agentdRunId, run.id);
    }

    try {
      // Attach the event bridge *before* reattaching so that events for runs
      // that are still alive headless aren't dropped in the gap.
      const { listen } = await import('@tauri-apps/api/event');
      this.unlisten = await listen<AgentRunNativeEvent>('agent-run-event', event => {
        this.handleNativeEvent(event.payload);
      });
      if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
        this.unlistenAgentd = await subscribeLocalEvent<AgentdRunEvent>(
          'agentd-run-event',
          payload => this.handleAgentdEvent(payload)
        );
        this.unlistenScheduler = await subscribeLocalEvent<SchedulerEvent>(
          'agentd-scheduler-event',
          payload => this.handleSchedulerEvent(payload),
        );
        void localApi.schedulerConfigSet({
          maxConcurrentRuns: getMaxConcurrentAgentRuns(),
          defaultMaxRetries: 2,
        });
      }
    } catch (err) {
      // Partial Tauri environments (tests, degraded webviews) can expose the
      // runtime marker without the event bridge — stay inert instead of throwing.
      this.initialized = false;
      console.warn('Agent run event listener unavailable:', err);
    }

    // Runtime v2: reconcile previously-active runs against the durable Rust
    // journal instead of blanket-failing them. Runs still executing headless
    // keep streaming; runs that finished while the app was closed are finalized
    // from their durable log.
    await this.reconcileWithJournal(revived);
    for (const run of this.getRuns()) {
      if (
        run.boardSynced !== true &&
        (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled')
      ) {
        this.pendingBoardSync.push(run.id);
      }
    }
    await this.refreshQueueCache();
    void agentReservationService.refresh();

    const needsRehydrate = revived.some(
      (r) => r.status === 'running' || r.status === 'queued' || r.status === 'verifying',
    );
    if (!needsRehydrate) {
      this.signalReady();
    }

    // Start the guardrail watchdog (timeout / stall enforcement).
    if (!this.runLimitTimer) {
      this.runLimitTimer = setInterval(() => this.enforceRunLimits(), RUN_LIMIT_POLL_MS);
    }
  }

  /**
   * Reattach to the durable run journal on relaunch. Only runs that claimed to
   * be active in the persisted store are reconciled; everything the journal
   * doesn't recognise (older runs, or the non-unix fallback) is treated as
   * interrupted, preserving the previous behaviour.
   */
  private async reconcileWithJournal(revived: AgentRun[]): Promise<void> {
    const active = revived.filter(
      r => r.status === 'running' || r.status === 'queued' || r.status === 'verifying'
    );
    if (active.length === 0) return;

    let infos: RunReattachInfo[] = [];
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      infos = await invoke<RunReattachInfo[]>('agent_runs_reattach');
    } catch (err) {
      console.warn('Run reattach unavailable:', err);
    }
    // agentd runs reattach through the sidecar's own journal; translate its
    // entries (keyed by sidecar id) into the same RunReattachInfo shape so the
    // reconcile loop below stays engine-agnostic.
    if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED && active.some(r => r.engine === 'agentd')) {
      try {
        const agentdInfos = (await localApi.runReattach()) ?? [];
        for (const info of agentdInfos) {
          if (info.status === 'queued') {
            const localRun = this.getRuns().find(
              (r) => r.taskId === info.taskId && r.status === 'queued',
            );
            if (localRun) {
              infos.push({ runId: localRun.id, alive: false, status: 'queued' });
            }
            continue;
          }
          const localId = this.agentdIdMap.get(info.runId);
          if (!localId) continue;
          infos.push({
            runId: localId,
            alive: info.alive,
            status:
              info.status === 'completed' || info.status === 'cancelled' || info.status === 'failed'
                ? info.status
                : info.status === 'verifying'
                  ? 'verifying'
                  : info.alive
                    ? 'running'
                    : 'failed',
          });
        }
      } catch (err) {
        console.warn('agentd reattach unavailable:', err);
      }
    }
    const byId = new Map(infos.map(i => [i.runId, i]));

    for (const run of active) {
      const info = byId.get(run.id);
      if (!info) {
        // Queued runs never touch the process journal — keep them queued for
        // rehydrateActiveRuns to rebuild the wait line.
        if (run.status === 'queued') continue;
        run.status = 'failed';
        run.error = 'Interrupted by app restart';
        run.finishedAt = run.finishedAt ?? new Date();
        run.boardSynced = true;
      } else if (info.alive) {
        // Still working detached — native events will resume the live stream.
        run.status = run.status === 'verifying' ? 'verifying' : 'running';
        run.finishedAt = undefined;
        run.isPaused = info.paused ?? false;
        if (info.sessionId && !run.sessionId) run.sessionId = info.sessionId;
        this.pushEvent(run, 'info', 'Reattached to headless run after relaunch — still working.');
      } else {
        // Finished while the app was closed — finalize with the real outcome.
        if (info.sessionId && !run.sessionId) run.sessionId = info.sessionId;
        if (info.summary && !run.summary) run.summary = info.summary;
        run.status =
          info.status === 'completed'
            ? 'completed'
            : info.status === 'cancelled'
              ? 'cancelled'
              : 'failed';
        run.finishedAt = run.finishedAt ?? new Date();
        if (run.status === 'failed' && !run.error) {
          run.error = 'Agent run ended while the app was closed.';
        }
        this.pushEvent(
          run,
          run.status === 'completed' ? 'result' : 'info',
          run.status === 'completed'
            ? `Completed while the app was closed.${run.summary ? ` ${run.summary.slice(0, 300)}` : ''}`
            : 'Run ended while the app was closed.'
        );
        // Retro-drive the board on relaunch (card move, activity, notify).
        run.boardSynced = false;
        this.pendingBoardSync.push(run.id);
      }
      this.upsert(run);
    }
  }

  /**
   * Re-establish run context (task + agent) for runs still live after a
   * relaunch, rebuild the per-agent queue, and finalize ghost runs whose task
   * or agent no longer exists. The service has no board access, so the app
   * layer supplies lookups.
   */
  rehydrateActiveRuns(
    resolve: (run: AgentRun) => { task: Task; agent: AgentProfile } | null,
    _resolveRefs?: (
      taskId: string,
      agentId: string,
    ) => { task: Task; agent: AgentProfile } | null,
  ): void {
    for (const run of this.runs.values()) {
      if (run.status !== 'running' && run.status !== 'verifying' && run.status !== 'queued') {
        continue;
      }

      const context = resolve(run);
      if (!context) {
        if (run.status === 'queued') {
          void this.daemonRemoveQueued(run.taskId);
        }
        if (this.activeByAgent.get(run.agentId) === run.id) {
          this.activeByAgent.delete(run.agentId);
        }
        this.runContext.delete(run.id);
        this.finishRun(
          run,
          'failed',
          run.status === 'queued'
            ? 'Queued run could not be restored — task or agent was removed.'
            : 'Active run could not be restored — task or agent was removed.',
        );
        continue;
      }

      this.runContext.set(run.id, context);
      agentScopeService.bindTaskScopeToRun(run.id, run.taskId);
      const runRoot = run.worktreePath ?? run.repoDir ?? context.agent.workingDir;
      if (runRoot) agentScopeService.setRunRoot(run.id, runRoot);

      if (run.status === 'queued') {
        if (!this.queueCache.some((q) => q.taskId === run.taskId)) {
          this.queueCache.push({ taskId: run.taskId, agentId: context.agent.id, runId: run.id });
          void this.daemonEnqueue(run.taskId, context.agent.id, run.id);
        }
        continue;
      }

      this.activeByAgent.set(context.agent.id, run.id);
      void this.daemonAcquire(context.agent.id, run.id);
    }

    void this.refreshQueueCache();
  }

  /**
   * Drive the board for runs the journal finalized while the app was closed:
   * replays the registered `onRunFinished` hook so their cards move to Review,
   * activity/error logs are written, and the user is notified on relaunch. Runs
   * still live at reattach are excluded — they finish through the normal stream.
   * The app layer must call this after `setTaskHooks`/`rehydrateActiveRuns`.
   */
  flushPendingBoardSync(): void {
    const ids = this.pendingBoardSync;
    this.pendingBoardSync = [];
    for (const id of ids) {
      const run = this.runs.get(id);
      if (!run || run.boardSynced === true) continue;
      this.hooks.onRunFinished?.(run.taskId, run);
      run.boardSynced = true;
      this.upsert(run);
    }
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.unlistenAgentd?.();
    this.unlistenAgentd = null;
    this.unlistenScheduler?.();
    this.unlistenScheduler = null;
    if (this.runLimitTimer) {
      clearInterval(this.runLimitTimer);
      this.runLimitTimer = null;
    }
    this.initialized = false;
    this.readyGate = createReadyGate();
    this.runs.clear();
    this.queueCache = [];
    this.activeByAgent.clear();
    this.runContext.clear();
    this.councilBuffers.clear();
    this.verifyBuffers.clear();
    this.agentdIdMap.clear();
  }

  /**
   * Watchdog tick: stop any active run that has breached its wall-clock timeout
   * or gone silent (stalled). Runs with no live context (agent unknown) are
   * skipped. Returns the ids it aborted — surfaced for tests. Safe to call
   * directly (the interval does).
   */
  enforceRunLimits(nowMs: number = Date.now()): string[] {
    const aborted: string[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== 'running' && run.status !== 'verifying') continue;
      const agent = this.runContext.get(run.id)?.agent;
      if (!agent) continue;
      const verdict = evaluateRunLimits(run, resolveRunLimits(agent, DEFAULT_RUN_LIMITS), nowMs);
      if (verdict) {
        aborted.push(run.id);
        void this.abortRun(run, verdict.reason, verdict.message);
      }
    }
    return aborted;
  }

  /**
   * Force-stop a run that breached a guardrail: kill the process, finalize it as
   * failed with the reason, and signal auto-recovery. Best-effort — the process
   * may already be gone.
   */
  private async abortRun(run: AgentRun, reason: RunAbortReason, message: string): Promise<void> {
    if (run.status !== 'running' && run.status !== 'verifying') return;
    run.failureKind = reason;
    this.pushEvent(run, 'stderr', message);
    try {
      if (run.engine === 'agentd' && run.agentdRunId) {
        await localApi.runCancel(run.agentdRunId);
      } else if (this.usesCouncilRunner(run) || run.status === 'verifying') {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke<boolean>('agent_run_cancel', { runId: run.id });
      }
    } catch {
      // The process may already have exited or been reaped — proceed to finalize.
    }
    const taskId = this.runContext.get(run.id)?.task.id ?? run.taskId;
    this.finishRun(run, 'failed', message);
    this.hooks.onRunAborted?.(taskId, run, reason);
  }

  setTaskHooks(hooks: AgentRunTaskHooks): void {
    this.hooks = hooks;
  }

  /**
   * Provide the project-workspace resolver (see {@link resolveAgentWorkspace}).
   * The app layer owns projects, so it supplies the lookup — the run service
   * stays project-agnostic, matching how task hooks are injected.
   */
  setWorkspaceResolver(
    resolver: (task: Task, agent: AgentProfile) => WorkspaceResolution,
  ): void {
    this.workspaceResolver = resolver;
  }

  /**
   * Bind a run to the correct working directory. Returns a *clone* of the agent
   * with its `workingDir` set to the task's project workspace so every
   * downstream path (worktree creation, cwd, and the eventual merge target) uses
   * it. Throws — and records a dead-letter for Inbox visibility — when the
   * project has no workspace folder linked (policy: never run in the wrong repo).
   */
  private resolveRunAgent(
    task: Task,
    agent: AgentProfile,
  ): { agent: AgentProfile; note?: string } {
    if (!this.workspaceResolver) return { agent };
    const resolution = this.workspaceResolver(task, agent);
    if (!resolution.ok) {
      deadLetterService.record({
        kind: 'run',
        title: `Can't run "${task.title}"`,
        detail: resolution.reason,
        taskId: task.id,
      });
      throw new Error(resolution.reason);
    }
    if (!resolution.overrodeAgentDir || resolution.workingDir === agent.workingDir) {
      return { agent };
    }
    return {
      agent: { ...agent, workingDir: resolution.workingDir },
      note: `Running in project workspace ${resolution.workingDir}${
        resolution.projectName ? ` (${resolution.projectName})` : ''
      } — the agent's configured folder (${agent.workingDir || 'unset'}) is outside this project.`,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getRuns(): AgentRun[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getRunsForTask(taskId: string): AgentRun[] {
    return this.getRuns().filter(r => r.taskId === taskId);
  }

  getActiveRunForTask(taskId: string): AgentRun | undefined {
    return this.getRuns().find(
      r =>
        r.taskId === taskId &&
        (r.status === 'running' || r.status === 'verifying' || r.status === 'queued')
    );
  }

  hasActiveRuns(): boolean {
    return this.activeByAgent.size > 0;
  }

  private updateSleepPrevention(activeCount: number): void {
    if (!isTauri()) return;
    const shouldPrevent = activeCount > 0;
    if (shouldPrevent === this.sleepPreventionActive) return;
    this.sleepPreventionActive = shouldPrevent;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) =>
        invoke('sleep_prevention_set_active', { active: shouldPrevent }),
      )
      .catch(() => undefined);
  }

  /** Whether the agent currently has a running (non-queued) run. */
  isAgentBusy(agentId: string): boolean {
    return this.activeByAgent.has(agentId);
  }

  /** 1-based position of a task in its agent's wait line, or null when not queued. */
  getQueuePosition(taskId: string): number | null {
    const entry = this.queueCache.find((q) => q.taskId === taskId);
    if (!entry) return null;
    const line = this.queueCache.filter((q) => q.agentId === entry.agentId);
    const index = line.findIndex((q) => q.taskId === taskId);
    return index >= 0 ? index + 1 : null;
  }

  /** Number of tasks waiting in an agent's queue (excludes the running task). */
  getQueueLengthForAgent(agentId: string): number {
    return this.queueCache.filter((q) => q.agentId === agentId).length;
  }

  /** Cached CLI detection — the scan shells out per binary, so reuse results for a while. */
  private cliDetection: { at: number; value: AgentCliStatus[] } | null = null;
  private cliDetectionInFlight: Promise<AgentCliStatus[]> | null = null;

  async detectClis(options?: { force?: boolean; maxAgeMs?: number }): Promise<AgentCliStatus[]> {
    if (!isTauri()) return [];
    const maxAgeMs = options?.maxAgeMs ?? 5 * 60_000;
    if (!options?.force && this.cliDetection && Date.now() - this.cliDetection.at < maxAgeMs) {
      return this.cliDetection.value;
    }
    if (!this.cliDetectionInFlight) {
      this.cliDetectionInFlight = (async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const value = await invoke<AgentCliStatus[]>('agent_detect_clis');
        this.cliDetection = { at: Date.now(), value };
        return value;
      })().finally(() => {
        this.cliDetectionInFlight = null;
      });
    }
    return this.cliDetectionInFlight;
  }

  /**
   * Detect installed IDE / editor launchers (VS Code, Cursor, Windsurf, Zed, …)
   * on the host PATH. Returns one entry per known editor with `available`
   * reflecting whether its launcher was found.
   */
  async detectIdeTools(): Promise<IdeToolStatus[]> {
    if (!isTauri()) return [];
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<IdeToolStatus[]>('agent_detect_ide_tools');
  }

  /**
   * Launch a detected agent CLI or IDE in an authorised workspace directory.
   * `mode: "app"` opens a GUI editor on the folder; `mode: "terminal"` opens a
   * Terminal at the folder running the tool (macOS only). Throws the backend
   * error message on failure so callers can surface it in a toast.
   */
  async openInTool(
    tool: string,
    workingDir: string,
    mode: 'app' | 'terminal' | 'bundle'
  ): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('agent_open_in_tool', { tool, workingDir, mode });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Queue a run; starts immediately when the agent is idle. */
  async assign(task: Task, agent: AgentProfile): Promise<AgentRun | null> {
    if (!isTauri()) return null;
    if (!this.initialized) await this.initialize();
    await this.whenReady();
    return this.withAssignLock(`task:${task.id}`, () =>
      this.withAssignLock(`agent:${agent.id}`, () => this.assignInner(task, agent)),
    );
  }

  private async withAssignLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.assignLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.assignLocks.set(
      key,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.assignLocks.get(key) === gate) {
        this.assignLocks.delete(key);
      }
    }
  }

  private async assignInner(task: Task, agent: AgentProfile): Promise<AgentRun | null> {
    if (this.getActiveRunForTask(task.id)) return null;

    // Bind the run to the task's project workspace (throws if blocked). The
    // resolved agent clone flows into both the immediate and queued paths, so
    // the worktree/cwd/merge all target the right repository.
    const { agent: runAgent, note } = this.resolveRunAgent(task, agent);

    if (this.activeByAgent.has(runAgent.id)) {
      const run = this.createRun(task, runAgent, 'queued');
      this.runContext.set(run.id, { task, agent: runAgent });
      await this.bindScopeReservation(run, task);
      await this.registerSchedulerIntent(run, task, runAgent);
      await this.daemonEnqueue(task.id, runAgent.id, run.id);
      if (note) this.pushEvent(run, 'info', note);
      this.upsert(run);
      void import('../notificationService').then(({ notificationService }) => {
        notificationService.notifyRunWaiting(
          runAgent.name,
          this.getQueueLengthForAgent(runAgent.id),
        );
      });
      return run;
    }
    if (isConcurrentRunCapReached(this.activeByAgent.size)) {
      const run = this.createRun(task, runAgent, 'queued');
      this.runContext.set(run.id, { task, agent: runAgent });
      await this.bindScopeReservation(run, task);
      await this.registerSchedulerIntent(run, task, runAgent);
      await this.daemonEnqueue(task.id, runAgent.id, run.id);
      const cap = getMaxConcurrentAgentRuns();
      this.pushEvent(
        run,
        'info',
        `Queued — max concurrent agent runs (${cap}) reached.`,
      );
      if (note) this.pushEvent(run, 'info', note);
      this.upsert(run);
      void import('../notificationService').then(({ notificationService }) => {
        notificationService.notifyRunWaiting(
          runAgent.name,
          this.getQueueLengthForAgent(runAgent.id),
        );
      });
      return run;
    }
    const run = await this.startRun(task, runAgent);
    if (note) this.pushEvent(run, 'info', note);
    return run;
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    agentMcpService.denyAllForRun(runId);

    if (this.mergingRuns.has(runId)) {
      this.mergeAbortRequested.add(runId);
      this.mergingRuns.delete(runId);
      this.pushEvent(run, 'info', 'Merge cancelled by user.');
      this.upsert(run);
      this.finishRun(run, 'cancelled');
      return;
    }

    if (run.status === 'queued') {
      await this.daemonRemoveQueued(run.taskId);
      this.finishRun(run, 'cancelled');
      return;
    }

    if (run.status !== 'running' && run.status !== 'verifying') return;

    try {
      if (run.engine === 'agentd' && run.agentdRunId) {
        await localApi.runCancel(run.agentdRunId);
      } else if (this.usesCouncilRunner(run) || run.status === 'verifying') {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke<boolean>('agent_run_cancel', { runId });
      }
    } catch {
      // Process may already be gone — finalize anyway.
    }
    this.finishRun(run, 'cancelled');
  }

  /** True once a run has reached a terminal state and can be safely removed. */
  private isTerminal(run: AgentRun): boolean {
    return (
      run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
    );
  }

  /**
   * Drop every internal reference to a run. Keeps the run store's side tables
   * (context, agentd id map, agent-busy map) from leaking or mis-routing a late
   * event to a run that no longer exists.
   */
  private forgetRun(run: AgentRun): void {
    this.runContext.delete(run.id);
    if (run.agentdRunId) this.agentdIdMap.delete(run.agentdRunId);
    if (this.activeByAgent.get(run.agentId) === run.id) {
      this.activeByAgent.delete(run.agentId);
    }
  }

  /**
   * Remove a single run from the store. Refuses while the run is still active or
   * has an un-reconciled git worktree (Merge/Discard first) so we never orphan a
   * branch. Returns true when the run was removed.
   */
  removeRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || !this.isTerminal(run) || run.worktreePath) return false;
    this.runs.delete(runId);
    this.forgetRun(run);
    // NB: do NOT call upsert() here — it re-inserts the run we just removed.
    this.notify();
    this.schedulePersist();
    return true;
  }

  /**
   * Bulk-clear terminal runs (completed / failed / cancelled) from the store.
   * Runs with a pending worktree are kept so their Merge/Discard actions remain
   * available. Returns the number of runs cleared.
   */
  clearFinishedRuns(): number {
    let cleared = 0;
    for (const [id, run] of this.runs) {
      if (!this.isTerminal(run) || run.worktreePath) continue;
      this.runs.delete(id);
      this.forgetRun(run);
      cleared += 1;
    }
    if (cleared > 0) {
      this.notify();
      this.schedulePersist();
    }
    return cleared;
  }

  /**
   * Re-insert runs previously removed by {@link clearFinishedRuns} / {@link removeRun}
   * — the Undo path behind the "Cleared N · Undo" affordance. Only terminal runs
   * that aren't already present are restored, so an undo can never clobber a live
   * run or duplicate an existing card. Returns the number of runs restored.
   */
  restoreRuns(runs: AgentRun[]): number {
    let restored = 0;
    for (const run of runs) {
      if (!this.isTerminal(run) || this.runs.has(run.id)) continue;
      this.runs.set(run.id, run);
      restored += 1;
    }
    if (restored > 0) {
      this.notify();
      this.schedulePersist();
    }
    return restored;
  }

  /** Pause a running agent process (SIGSTOP on Unix, thread suspend on Windows). */
  async pause(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') {
      throw new Error('Only running agents can be paused.');
    }
    if (run.engine === 'agentd' && run.agentdRunId) {
      await localApi.runPause(run.agentdRunId);
    } else if (this.usesCouncilRunner(run)) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_council_pause', { runId });
    } else {
      throw new Error('Run is not pausable.');
    }
    run.isPaused = true;
    run.pausedAt = Date.now();
    this.pushEvent(run, 'info', 'Run paused by user.');
    this.upsert(run);
  }

  /** Resume a paused agent process. */
  async resume(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== 'running') {
      throw new Error('Only running agents can be resumed.');
    }
    if (run.engine === 'agentd' && run.agentdRunId) {
      await localApi.runResume(run.agentdRunId);
    } else if (this.usesCouncilRunner(run)) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_council_resume', { runId });
    } else {
      throw new Error('Run is not resumable.');
    }
    run.isPaused = false;
    // Bank the paused duration so it doesn't count against the run timeout.
    if (run.pausedAt) {
      run.pausedMs = (run.pausedMs ?? 0) + Math.max(0, Date.now() - run.pausedAt);
      run.pausedAt = undefined;
    }
    this.pushEvent(run, 'info', 'Run resumed.');
    this.upsert(run);
  }

  /**
   * Inject mid-run guidance without cancel/restart. The message is queued for
   * Claude Code to fetch via MCP `get_user_guidance`; auto-resumes if paused.
   */
  async injectGuidance(runId: string, message: string, resumeIfPaused = true): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || (run.status !== 'running' && run.status !== 'verifying')) {
      throw new Error('Guidance can only be injected into active runs.');
    }
    // MCP bridge reads guidance.jsonl from the per-run MCP dir.
    await localApi.mcpAppendGuidance(runId, message);
    if (run.engine === 'agentd' && run.agentdRunId) {
      await localApi.runInject(run.agentdRunId, message);
      if (resumeIfPaused && run.isPaused) await localApi.runResume(run.agentdRunId);
    } else {
      throw new Error('Guidance injection requires an agentd run.');
    }
    if (resumeIfPaused) run.isPaused = false;
    this.pushEvent(run, 'info', `Guidance injected: ${message.slice(0, 200)}`);
    this.upsert(run);
  }

  /** Hand the session over to Terminal.app (`claude --resume <sessionId>`). */
  async openInTerminal(run: AgentRun, agent: AgentProfile): Promise<void> {
    if (!run.sessionId) throw new Error('No resumable session for this run.');
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('agent_open_in_terminal', {
      workingDir: run.worktreePath ?? this.runRepoDir(run) ?? agent.workingDir,
      sessionId: run.sessionId,
    });
  }

  /** Backfill sessionId on an existing run when discovery reconciles a match. */
  linkExternalSession(runId: string, sessionId: string): void {
    const run = this.runs.get(runId);
    if (!run || run.sessionId === sessionId) return;
    if (run.sessionId) return;
    run.sessionId = sessionId;
    this.pushEvent(run, 'info', `Linked external session ${sessionId.slice(0, 8)}…`);
    this.upsert(run);
  }

  /** Append a session checkpoint marker (Claude/Codex JSONL rewind). */
  addCheckpoint(runId: string, checkpoint: SessionCheckpoint): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run not found.');
    run.checkpoints = [...(run.checkpoints ?? []), checkpoint];
    this.pushEvent(run, 'info', `Checkpoint saved: ${checkpoint.label ?? checkpoint.messageIndex}`);
    this.upsert(run);
  }

  /** Record a rewind and trim later checkpoints past the rewind point. */
  noteRewind(runId: string, checkpoint: SessionCheckpoint): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error('Run not found.');
    run.checkpoints = (run.checkpoints ?? []).filter((c) => c.messageIndex <= checkpoint.messageIndex);
    this.pushEvent(
      run,
      'info',
      `Rewound session to ${checkpoint.label ?? `message ${checkpoint.messageIndex}`}`,
    );
    this.upsert(run);
  }

  /** Persist run mutations from companion services (fork metadata, etc.). */
  persistRun(run: AgentRun): void {
    this.upsert(run);
  }

  /** Info event helper for companion services. */
  logInfo(runId: string, text: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.pushEvent(run, 'info', text);
    this.upsert(run);
  }

  /**
   * Register an adopted external session as a completed run so followUp can
   * resume via `resumeSessionId`.
   */
  adoptExternalSession(params: {
    task: Task;
    agent: AgentProfile;
    sessionId: string;
    repoDir: string;
    worktreePath?: string;
    gitBranch?: string;
    preview?: string;
    runtime: string;
  }): AgentRun {
    const run: AgentRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: params.task.id,
      agentId: params.agent.id,
      status: 'completed',
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
      events: [],
      sessionId: params.sessionId,
      repoDir: params.repoDir,
      worktreePath: params.worktreePath,
      gitBranch: params.gitBranch,
      summary: params.preview,
      engine: 'agentd',
    };
    this.runContext.set(run.id, { task: params.task, agent: params.agent });
    agentScopeService.bindTaskScopeToRun(run.id, params.task.id);
    this.pushEvent(
      run,
      'info',
      `Adopted external ${params.runtime} session ${params.sessionId.slice(0, 8)}…`,
    );
    this.upsert(run);
    return run;
  }

  /** Headless follow-up on a finished run — streams into the same run log. */
  async followUp(runId: string, message: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run?.sessionId) throw new Error('No resumable session for this run.');
    if (this.mergingRuns.has(runId)) {
      throw new Error('Cannot follow up while a merge is in progress for this run.');
    }
    const context = this.runContext.get(runId);
    if (!context) throw new Error('Run context missing.');

    this.ensureBudgetAllows(context.agent);
    await this.daemonAcquire(context.agent.id, run.id);

    run.status = 'running';
    run.finishedAt = undefined;
    this.pushEvent(run, 'info', `Follow-up: ${message.slice(0, 200)}`);
    this.upsert(run);

    try {
      const followUpCwd = run.worktreePath ?? this.runRepoDir(run) ?? context.agent.workingDir;
      const mcpConfig = await this.buildAgentdMcpConfig(run.id, run.taskId, followUpCwd);
      const policy = this.spawnPolicyParams(context.agent, context.task);
      const startParams = {
        taskId: run.taskId,
        localRunId: run.id,
        agentId: context.agent.id,
        runtime: providerToRuntime(context.agent.provider),
        prompt: message,
        cwd: followUpCwd,
        model: context.agent.model || undefined,
        resumeSessionId: run.sessionId,
        permissionMode: context.agent.permissionMode,
        mcpConfig,
        sandboxMode: agentSandboxMode(context.agent),
        containerImage: agentContainerImage(context.agent),
        scope: declarePlannedScope(context.task),
        ...agentdProfileStartParams(context.agent),
        ...agentdSSHStartParams(context.agent),
        ...policy,
      };
      await this.registerSchedulerIntent(run, context.task, context.agent, {
        prompt: message,
        cwd: followUpCwd,
        startParams,
      });
      const sidecarId = await localApi.runStart(startParams);
      if (!sidecarId) throw new Error('agentd did not return a run id for follow-up');
      run.agentdRunId = sidecarId;
      this.agentdIdMap.set(sidecarId, run.id);
      this.upsert(run);
    } catch (err) {
      this.activeByAgent.delete(context.agent.id);
      void this.daemonRelease(context.agent.id);
      run.status = 'completed';
      run.finishedAt = new Date();
      this.upsert(run);
      throw err;
    }
  }

  /**
   * Commit stage: runs the TRANSACTIONAL merge pipeline (verify gate →
   * repo-locked --no-ff merge with pre-merge SHA capture and rollback →
   * worktree prune). Failures are dead-lettered by the pipeline; the thrown
   * error keeps the card in Completed.
   */
  async mergeWorktree(run: AgentRun, options?: { verify?: boolean }): Promise<string> {
    if (this.mergingRuns.has(run.id)) {
      throw new Error('A merge is already in progress for this run.');
    }
    this.mergingRuns.add(run.id);
    const context = this.runContext.get(run.id);
    const repoDir = this.runRepoDir(run);
    if (!run.worktreePath || !run.gitBranch || !repoDir) {
      this.mergingRuns.delete(run.id);
      throw new Error('No worktree to merge.');
    }
    if (this.mergeAbortRequested.has(run.id)) {
      this.mergingRuns.delete(run.id);
      this.mergeAbortRequested.delete(run.id);
      throw new Error('Merge cancelled.');
    }
    try {
      const { mergePipelineService } = await import('./mergePipelineService');
      const task = context?.task ?? ({ id: run.taskId, title: run.gitBranch } as unknown as Task);
      const { result } = await mergePipelineService.run({
        task,
        run,
        repoDir,
        verify: options?.verify ?? context?.agent.devCouncilVerify ?? false,
        llmReview: context?.agent.llmReviewGate ?? false,
        commitStage: context?.agent.commitStage ?? 'merge',
        commitMessage: this.worktreeCommitMessage(run),
      });
      run.worktreePath = undefined;
      this.pushEvent(run, 'info', result.message);
      this.upsert(run);
      return result.message;
    } finally {
      this.mergingRuns.delete(run.id);
      this.mergeAbortRequested.delete(run.id);
    }
  }

  /**
   * Reap worktrees whose runs are gone. Keeps every worktree still referenced
   * by a live or reviewable run; anything else under `.worktrees/` (crashed
   * runs, force-quit sessions) is removed along with its branch.
   */
  async pruneStaleWorktrees(agents: AgentProfile[]): Promise<void> {
    if (!isTauri()) return;
    const keepByRepo = new Map<string, Set<string>>();
    const repoFor = (run: AgentRun): string | undefined => this.runRepoDir(run);
    for (const run of this.getRuns()) {
      if (!run.worktreePath) continue;
      const repo = repoFor(run);
      if (!repo) continue;
      if (!keepByRepo.has(repo)) keepByRepo.set(repo, new Set());
      keepByRepo.get(repo)?.add(run.id);
    }
    // Journal/reattach-alive runs must stay in the keep-set even when the
    // persisted run store lost them (crash) or porcelain is clean.
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const infos = await invoke<RunReattachInfo[]>('agent_runs_reattach');
      for (const info of infos) {
        if (!info.alive && info.status !== 'running' && info.status !== 'queued') continue;
        const run = this.getRuns().find((r) => r.id === info.runId);
        const repo = run ? repoFor(run) : undefined;
        if (!repo && run?.worktreePath) {
          const derived = this.repoDirForRun(run);
          if (derived) {
            if (!keepByRepo.has(derived)) keepByRepo.set(derived, new Set());
            keepByRepo.get(derived)?.add(info.runId);
          }
          continue;
        }
        if (repo) keepByRepo.get(repo)?.add(info.runId);
      }
      if (FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) {
        const agentdInfos = (await localApi.runReattach()) ?? [];
        for (const info of agentdInfos) {
          if (!info.alive && info.status !== 'running' && info.status !== 'queued') continue;
          const localRun = this.getRuns().find(
            (r) => r.id === this.agentdIdMap.get(info.runId) || r.agentdRunId === info.runId,
          );
          const repo = localRun ? repoFor(localRun) : undefined;
          if (repo && localRun) keepByRepo.get(repo)?.add(localRun.id);
        }
      }
    } catch (err) {
      console.warn('[agentRunService] reattach keep-set probe failed:', err);
    }
    const repos = new Set<string>([
      ...keepByRepo.keys(),
      ...agents.map(a => a.workingDir).filter(Boolean),
    ]);
    const { invoke } = await import('@tauri-apps/api/core');
    for (const repoDir of repos) {
      try {
        const keepRunIds = [...(keepByRepo.get(repoDir) ?? [])];
        const reaped = await invoke<number>('agent_git_prune_worktrees', {
          repoDir,
          keepRunIds,
          confirmPruneAll: keepRunIds.length === 0,
        });
        if (reaped > 0) {
          console.info(`[agentRunService] pruned ${reaped} stale worktree(s) in ${repoDir}`);
        }
      } catch (err) {
        // Locked repo (merge in flight) or unauthorized dir — skip quietly.
        console.warn(`[agentRunService] worktree prune skipped for ${repoDir}:`, err);
      }
    }
  }

  /** Commit worktree changes on the run branch without merging (PR flow). */
  async commitWorktree(run: AgentRun, message?: string): Promise<string> {
    const repoDir = this.runRepoDir(run);
    if (!run.worktreePath || !repoDir) {
      throw new Error('No worktree to commit.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<string>('agent_git_commit_worktree', {
      repoDir,
      worktreePath: run.worktreePath,
      message: message ?? this.worktreeCommitMessage(run),
    });
    this.pushEvent(run, 'info', result);
    void this.refreshGitDiff(run);
    this.upsert(run);
    return result;
  }

  /**
   * Recover the repo root for runs whose in-memory context was lost (e.g.
   * approved after an app relaunch): worktrees always live under
   * `<repo>/.worktrees/<runId>`.
   */
  private repoDirForRun(run: AgentRun): string | undefined {
    const wt = run.worktreePath;
    if (!wt) return undefined;
    for (const marker of ['/.worktrees/', '\\.worktrees\\']) {
      const idx = wt.indexOf(marker);
      if (idx > 0) return wt.slice(0, idx);
    }
    return undefined;
  }

  /**
   * Authoritative base repo dir for a run. Prefers the dir the run resolved to
   * at start (`run.repoDir`, persisted), then the live in-session context, then
   * a worktree-derived guess. This is what merge/discard/prune/terminal must use
   * instead of the agent profile's `workingDir`, which can be stale or
   * re-supplied from the roster after a relaunch.
   */
  private runRepoDir(run: AgentRun): string | undefined {
    return (
      run.repoDir ?? this.runContext.get(run.id)?.agent.workingDir ?? this.repoDirForRun(run)
    );
  }

  private worktreeCommitMessage(run: AgentRun): string {
    const context = this.runContext.get(run.id);
    const title = context?.task.title ?? 'agent task';
    const jobId = context?.task.jobId;
    return `feat(agent): ${jobId ? `${jobId} — ` : ''}${title}`.slice(0, 200);
  }

  /** Remove the run's worktree and delete its branch without merging. */
  async discardWorktree(run: AgentRun): Promise<void> {
    const repoDir = this.runRepoDir(run);
    if (!run.worktreePath || !run.gitBranch || !repoDir) {
      throw new Error('No worktree to discard.');
    }
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('agent_git_discard_worktree', {
      repoDir,
      worktreePath: run.worktreePath,
      branch: run.gitBranch,
    });
    void taskEventStore.appendSafe([
      {
        streamId: run.taskId,
        type: 'worktree.discarded',
        payload: { branch: run.gitBranch },
        actor: 'user',
        runId: run.id,
      },
    ]);
    run.worktreePath = undefined;
    this.pushEvent(run, 'info', `Discarded branch ${run.gitBranch}`);
    this.upsert(run);
  }

  /** Reject review — re-run agent with feedback via claude --resume. */
  async rejectWithFeedback(runId: string, feedback: string): Promise<void> {
    const prompt = [
      'The reviewer rejected your previous work. Address this feedback and update the implementation:',
      feedback,
    ].join('\n\n');
    await this.followUp(runId, prompt);
  }

  /** Persist human review outcome on a run (approval duration or rejection feedback). */
  recordReviewOutcome(
    runId: string,
    data: {
      outcome: 'approved' | 'rejected';
      feedback?: string;
      actualMinutes?: number;
    }
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.reviewOutcome = data.outcome;
    if (data.feedback?.trim()) {
      run.reviewFeedback = data.feedback.trim();
      this.pushEvent(run, 'info', `Reviewer feedback: ${data.feedback.trim().slice(0, 500)}`);
    }
    if (data.actualMinutes != null) {
      run.actualMinutes = data.actualMinutes;
    }
    this.upsert(run);
  }

  /** Persist prUrl after push+PR commit pipeline. */
  setPrUrl(runId: string, prUrl: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.prUrl = prUrl;
    this.upsert(run);
  }

  /** Open a GitHub PR for the run's branch (requires `gh` CLI). */
  async openPullRequest(run: AgentRun, taskTitle: string): Promise<string | null> {
    if (!run.gitBranch) return null;
    const repoDir = this.runRepoDir(run);
    if (!repoDir) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ url?: string }>('agent_git_create_pr', {
      workingDir: repoDir,
      title: taskTitle,
      body: run.summary ?? 'Agent teammate run',
      headBranch: run.gitBranch,
    });
    if (result.url) {
      run.prUrl = result.url;
      this.upsert(run);
    }
    return result.url ?? null;
  }

  /**
   * Choose the skills injected into a run's prompt: the agent's pinned skills
   * always lead, followed by captured repo skills plus any installed skill packs
   * that match the task, relevance-ranked. Degrades to captured skills alone when
   * the installed-skills sidecar call is unavailable, so a run is never blocked on
   * skill discovery.
   */
  private async selectRunSkills(task: Task, agent: AgentProfile): Promise<AgentSkill[]> {
    const captured = agentSkillsService.getSkillsForWorkingDir(agent.workingDir);
    let installed: InstalledSkill[] | undefined;
    try {
      installed = await localApi.listSkills();
    } catch {
      installed = undefined;
    }
    const catalog = mergeSkillCatalog(captured, installed);
    // The agent's pinned skills always lead; the rest are task-ranked.
    const ranked = pinAndRankRunSkills(task, catalog, agent.skills ?? []);
    // Enrich selected installed skills with their real SKILL.md body so the
    // prompt carries actual guidance, not just the one-line description.
    const enriched = await Promise.all(
      ranked.map(async (entry) => {
        if (entry.origin !== 'installed' || !entry.sourcePath) return entry;
        try {
          const body = await localApi.readSkillBody(entry.sourcePath);
          return body?.trim() ? { ...entry, summary: body.trim() } : entry;
        } catch {
          return entry;
        }
      }),
    );
    return enriched.map(catalogEntryToSkill);
  }

  private async startRun(
    task: Task,
    agent: AgentProfile,
    options?: { promptOverride?: string; resumeSessionId?: string }
  ): Promise<AgentRun> {
    this.ensureBudgetAllows(agent);

    const resolvedModel = options?.resumeSessionId
      ? agent.model || undefined
      : resolveAgentModel(agent, task);

    // Reuse the queued placeholder if one exists for this task.
    const existing = this.getRunsForTask(task.id).find(r => r.status === 'queued');
    const run = existing ?? this.createRun(task, agent, 'queued');
    const council = (agent.runMode ?? 'direct') === 'council';

    run.status = 'running';
    run.startedAt = new Date();
    const scopeClaim = await this.bindScopeReservation(run, task);
    if (!scopeClaim.ok) {
      run.status = 'queued';
      run.startedAt = undefined;
      run.scopeBlocked = true;
      run.scopeWaitPosition = scopeClaim.waitPosition;
      this.runContext.set(run.id, { task, agent });
      await this.registerSchedulerIntent(run, task, agent);
      await this.daemonEnqueue(task.id, agent.id, run.id);
      const holder = scopeClaim.conflict?.runId ?? 'another run';
      this.pushEvent(
        run,
        'info',
        scopeClaim.waitPosition
          ? `Scope queued (#${scopeClaim.waitPosition}) — overlaps ${holder}.`
          : `Scope held by ${holder} — waiting for release.`,
      );
      this.upsert(run);
      return run;
    }
    try {
      await this.daemonAcquire(agent.id, run.id);
    } catch (err) {
      run.status = 'queued';
      run.startedAt = undefined;
      this.runContext.set(run.id, { task, agent });
      await this.registerSchedulerIntent(run, task, agent);
      await this.daemonEnqueue(task.id, agent.id, run.id);
      this.pushEvent(
        run,
        'info',
        err instanceof Error ? err.message : String(err),
      );
      this.upsert(run);
      return run;
    }
    this.runContext.set(run.id, { task, agent });
    if (council) this.councilBuffers.set(run.id, []);
    const pickupNote = council
      ? `Agent "${agent.name}" picked up ${task.jobId || task.id} (DevCouncil pipeline)`
      : `Agent "${agent.name}" picked up ${task.jobId || task.id}`;
    this.pushEvent(run, 'info', pickupNote);
    if (resolvedModel && !council) {
      this.pushEvent(
        run,
        'info',
        `Model: ${resolvedModel}${(agent.modelRouting ?? 'fixed') === 'auto' ? ' (auto-routed)' : ''}`
      );
    }
    const advisorModel = resolveAdvisorModel(agent);
    if (advisorModel) {
      this.pushEvent(run, 'info', `Advisor: ${advisorModel}`);
    }
    this.upsert(run);
    this.hooks.onRunStarted?.(task.id, run);
    void taskEventStore.appendSafe([
      {
        streamId: task.id,
        type: 'run.started',
        payload: { agentId: agent.id, agentName: agent.name, provider: agent.provider },
        actor: 'system',
        runId: run.id,
      },
    ]);

    let workingDir = agent.workingDir;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const policy = this.spawnPolicyParams(agent, task);

      // Concurrent task isolation: every run gets its own worktree/branch by
      // default (profiles can still opt out with gitWorktree: false). Without
      // this, parallel agents would contaminate each other on the main
      // checkout — the exact race the four-stage board exists to prevent.
      if (agent.gitWorktree !== false && !options?.resumeSessionId) {
        try {
          const wt = await invoke<{ branch: string; worktreePath: string }>(
            'agent_git_create_worktree',
            {
              workingDir: agent.workingDir,
              runId: run.id,
              taskTitle: task.title,
              taskId: task.id,
            }
          );
          run.gitBranch = wt.branch;
          run.worktreePath = wt.worktreePath;
          workingDir = wt.worktreePath;
          agentScopeService.setRunRoot(run.id, workingDir);
          this.pushEvent(run, 'info', `Git worktree: ${wt.branch}`);
          this.upsert(run);
          void taskEventStore.appendSafe([
            {
              streamId: task.id,
              type: 'worktree.provisioned',
              payload: { branch: wt.branch, worktreePath: wt.worktreePath },
              actor: 'system',
              runId: run.id,
            },
          ]);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (agent.allowMainCheckout) {
            this.pushEvent(run, 'info', `Git worktree skipped: ${message}`);
          } else {
            const detail = `Git worktree required but could not be created: ${message}`;
            deadLetterService.record({
              kind: 'run',
              taskId: task.id,
              runId: run.id,
              title: `Worktree failed: ${task.title.slice(0, 80)}`,
              detail: message,
              payload: {
                taskId: task.id,
                runId: run.id,
                agentId: agent.id,
                workingDir: agent.workingDir,
              },
            });
            this.finishRun(run, 'failed', detail);
            return run;
          }
        }
      }
      agentScopeService.setRunRoot(run.id, workingDir);

      // Context-injection pipeline: keep the DevCouncil repo map fresh in the
      // background so the next run's prompt orientation isn't stale.
      devcouncilService.ensureFreshMap(agent.workingDir);

      // Direct runs (including claude-code) execute through liquitask-agentd.
      // Council mode is excluded — the DevCouncil pipeline drives its own executor.
      if (this.usesAgentd(agent)) {
        run.engine = 'agentd';
        const agentdSkills = await this.selectRunSkills(task, agent);
        const agentdPrompt =
          options?.promptOverride ??
          withRepoFileIndex(
            withRepoContext(
              isNativeBackend()
                ? await nativeBuildTaskPrompt(task, agentdSkills)
                : buildTaskPrompt(task, agentdSkills),
              await devcouncilService.getRepoMapContext(agent.workingDir)
            ),
            await devcouncilService.getRepoFiles(agent.workingDir)
          );
        const mcpConfig = await this.buildAgentdMcpConfig(run.id, task.id, workingDir);
        const policy = this.spawnPolicyParams(agent, task);
        const startParams = {
          taskId: task.id,
          localRunId: run.id,
          agentId: agent.id,
          runtime: providerToRuntime(agent.provider),
          prompt: agentdPrompt,
          cwd: workingDir,
          model: resolvedModel,
          resumeSessionId: options?.resumeSessionId,
          permissionMode: agent.permissionMode,
          mcpConfig,
          sandboxMode: agentSandboxMode(agent),
          containerImage: agentContainerImage(agent),
          scope: declarePlannedScope(task),
          ...agentdProfileStartParams(agent),
          ...agentdSSHStartParams(agent),
          ...policy,
        };
        await this.registerSchedulerIntent(run, task, agent, {
          prompt: agentdPrompt,
          cwd: workingDir,
          startParams,
        });
        const sidecarId = await localApi.runStart(startParams);
        if (!sidecarId) {
          throw new Error('agentd did not return a run id (is the sidecar running?)');
        }
        run.agentdRunId = sidecarId;
        this.agentdIdMap.set(sidecarId, run.id);
        this.pushEvent(run, 'info', `Dispatched to ${agent.provider} via agentd`);
        this.upsert(run);
        return run;
      }

      if (council) {
        run.engine = 'council';
        const mcpConfig = await agentMcpService.prepareMcpConfig(run.id, task.id, workingDir);
        const councilGoal = isNativeBackend()
          ? await nativeBuildCouncilGoal(task)
          : buildCouncilGoal(task);
        await invoke('agent_run_start', {
          runId: run.id,
          mode: 'devcouncil-e2e',
          prompt: councilGoal,
          workingDir,
          model: resolvedModel ?? null,
          permissionMode: null,
          maxTurns: null,
          containerImage: agentContainerImage(agent),
          sessionId: null,
          mcpConfigPath: mcpConfig,
          permissionPromptTool: permissionPromptToolFor(agent, mcpConfig),
          sandboxMode: agentSandboxMode(agent) === 'os' ? 'os' : null,
          advisorModel: resolveAdvisorModel(agent) ?? null,
          ...policy,
        });
      } else {
        throw new Error(`Unsupported run configuration for agent ${agent.name}.`);
      }
    } catch (err) {
      this.finishRun(run, 'failed', err instanceof Error ? err.message : String(err));
    }
    return run;
  }

  // -------------------------------------------------------------------------
  // Native event handling
  // -------------------------------------------------------------------------

  private handleNativeEvent(payload: AgentRunNativeEvent): void {
    const run = this.runs.get(payload.runId);
    if (!run) return;

    if (payload.stream === 'stderr' && payload.line) {
      this.pushEvent(run, 'stderr', payload.line);
      this.upsert(run);
      return;
    }

    if (payload.stream === 'stdout' && payload.line) {
      if (run.status === 'verifying') {
        this.appendBuffer(this.verifyBuffers, run.id, payload.line);
      } else if (this.councilBuffers.has(run.id)) {
        this.appendBuffer(this.councilBuffers, run.id, payload.line);
        this.pushEvent(run, 'info', payload.line.slice(0, 400));
      } else {
        void this.consumeClaudeStreamLine(run, payload.line).finally(() => this.upsert(run));
        return;
      }
      this.upsert(run);
      return;
    }

    if (payload.stream === 'exit') {
      void this.handleExit(run, payload.code ?? -1);
    }
  }

  private async registerSchedulerIntent(
    run: AgentRun,
    task: Task,
    agent: AgentProfile,
    options?: {
      prompt?: string;
      cwd?: string;
      startParams?: Record<string, unknown>;
    },
  ): Promise<void> {
    if (!this.usesDaemonQueue()) return;
    const repair = agent.autoRepair;
    await localApi.schedulerIntentSet({
      runId: run.id,
      localRunId: run.id,
      taskId: task.id,
      agentId: agent.id,
      runtime: providerToRuntime(agent.provider),
      cwd: options?.cwd ?? run.worktreePath ?? run.repoDir ?? agent.workingDir,
      prompt: options?.prompt,
      model: agent.model || undefined,
      resumeSessionId: run.sessionId,
      devCouncilVerify: agent.devCouncilVerify,
      maxRetries: 2,
      autoRepairCi: repair?.ci ?? false,
      autoRepairReview: repair?.review ?? false,
      autoRepairMax: autoRepairMaxAttempts(agent),
      prUrl: run.prUrl,
      repoDir: run.repoDir,
      gitBranch: run.gitBranch,
      sessionId: run.sessionId,
      startParams: options?.startParams,
    });
  }

  private handleSchedulerEvent(payload: SchedulerEvent): void {
    const localId = payload.localRunId ?? payload.runId;
    const run = this.runs.get(localId);
    const kind = payload.kind.replace(/^scheduler\./, '');

    if (kind === 'dequeued') {
      void this.handleSchedulerDequeued(payload);
      return;
    }

    if (!run) return;

    if (kind === 'gate.passed' || kind === 'gate.failed') {
      const verification = payload.payload?.verification as
        | { passed?: boolean; blockingGaps?: string[]; raw?: string }
        | undefined;
      if (verification) {
        run.verification = {
          passed: verification.passed === true,
          blockingGaps: verification.blockingGaps ?? [],
          raw: verification.raw,
        };
        this.pushEvent(
          run,
          'verify',
          verification.passed
            ? 'DevCouncil gate passed — no blocking gaps.'
            : `DevCouncil gate found ${(verification.blockingGaps ?? []).length} blocking gap(s).`,
        );
        this.upsert(run);
      }
      return;
    }

    if (kind === 'follow_up.started') {
      const agentdRunId = payload.payload?.agentdRunId;
      if (typeof agentdRunId === 'string') {
        run.agentdRunId = agentdRunId;
        this.agentdIdMap.set(agentdRunId, run.id);
      }
      run.status = 'running';
      run.finishedAt = undefined;
      this.pushEvent(run, 'info', 'Scheduler started auto-repair follow-up.');
      this.upsert(run);
      return;
    }

    if (kind === 'retry.scheduled') {
      run.status = 'queued';
      run.finishedAt = undefined;
      this.pushEvent(run, 'info', 'Scheduler scheduled a retry after failure.');
      this.upsert(run);
      void this.refreshQueueCache();
      return;
    }

    if (kind === 'run.finished') {
      const status = (payload.status ?? 'failed') as AgentRun['status'];
      const error = payload.error;
      if (payload.sessionId && !run.sessionId) run.sessionId = payload.sessionId;
      this.finishRun(
        run,
        status,
        status === 'failed' ? (error ?? run.error) : undefined,
      );
    }
  }

  private async handleSchedulerDequeued(payload: SchedulerEvent): Promise<void> {
    await this.refreshQueueCache();
    const localId = payload.localRunId ?? payload.runId;
    const run =
      this.runs.get(localId) ??
      this.getRuns().find(
        (r) => r.taskId === payload.taskId && r.agentId === payload.agentId && r.status === 'queued',
      );
    const ctx = run ? this.runContext.get(run.id) : undefined;
    if (!run || !ctx || run.status !== 'queued' || run.scopeBlocked) return;
    try {
      await this.startRun(ctx.task, ctx.agent);
    } catch (err) {
      this.finishRun(run, 'failed', err instanceof Error ? err.message : String(err));
    }
  }

  /** True when this profile's runs execute via the liquitask-agentd sidecar. */
  private usesAgentd(agent: AgentProfile): boolean {
    return (
      FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED &&
      (agent.runMode ?? 'direct') !== 'council'
    );
  }

  /** True when this run is owned by the slim DevCouncil Rust runner. */
  private usesCouncilRunner(run: AgentRun): boolean {
    return run.engine === 'council' || this.councilBuffers.has(run.id);
  }

  /**
   * True when `workingDir` is a DevCouncil-initialised project. Probes for
   * `.devcouncil/config.yaml` — the same file AgentSettings' preflight checks —
   * through the existing `workspace_read_file` command, so no new Rust surface
   * is needed. Any failure (missing file, unauthorised dir) means "not enabled".
   */
  private isDevCouncilDir(workingDir: string): Promise<boolean> {
    let probe = this.devcouncilDirCache.get(workingDir);
    if (!probe) {
      probe = (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke<string>('workspace_read_file', {
            filePath: `${workingDir}/.devcouncil/config.yaml`,
            scopePaths: [workingDir],
          });
          return true;
        } catch {
          return false;
        }
      })();
      this.devcouncilDirCache.set(workingDir, probe);
    }
    return probe;
  }

  /**
   * MCP config JSON injected into agentd runs: the LiquiTask board bridge
   * (get_task / update_status / complete_task / post_comment / …) for every
   * runtime — this is how agents report progress from in-progress to
   * completed on the board — plus DevCouncil's MCP server (Rework Plan §3.4
   * item 5) when the working dir is DevCouncil-initialised. The sidecar's
   * execenv renders this into each runtime's native MCP config format.
   */
  private async buildAgentdMcpConfig(
    runId: string,
    taskId: string,
    workingDir: string
  ): Promise<string | undefined> {
    const devcouncilDir =
      workingDir && (await this.isDevCouncilDir(workingDir)) ? workingDir : undefined;
    return agentMcpService.prepareAgentdMcpConfig(runId, taskId, devcouncilDir);
  }

  /**
   * Consume one sidecar `run.events` notification. Kind mapping into the
   * legacy AgentRunEventKind vocabulary keeps every downstream consumer
   * (RunView transcript, inbox derivation, persistence) engine-agnostic.
   */
  private handleAgentdEvent(payload: AgentdRunEvent): void {
    const localId = this.agentdIdMap.get(payload.runId);
    const run = localId ? this.runs.get(localId) : undefined;
    if (!run) return;
    // Ignore late sidecar events for an already-finalized run (e.g. one aborted
    // by a guardrail) — otherwise a trailing `result` would re-finish it.
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return;
    }

    this.mergeRunUsage(run, payload);

    switch (payload.kind) {
      case 'message':
        if (payload.text) this.pushEvent(run, 'assistant', payload.text);
        break;
      case 'thinking':
        if (payload.text) this.pushEvent(run, 'info', `Thinking: ${payload.text.slice(0, 300)}`);
        break;
      case 'tool_use': {
        const input = payload.input ? JSON.stringify(payload.input) : '';
        this.pushEvent(run, 'tool', `${payload.tool ?? 'tool'}(${input.slice(0, 300)})`);
        void import('./runTraceService').then(({ recordAgentdTraceEvent }) =>
          recordAgentdTraceEvent(run.id, 'tool_use', {
            tool: payload.tool,
            input: payload.input,
          }),
        );
        break;
      }
      case 'tool_result':
        if (payload.output) {
          this.pushEvent(run, 'tool', `→ ${payload.output.slice(0, 300)}`);
        }
        break;
      case 'status':
      case 'log':
        if (payload.status === 'pty_takeover') {
          run.isPaused = true;
        }
        if (payload.text) {
          this.pushEvent(run, 'info', payload.text);
          if (payload.status === 'ssh_fallback') {
            deadLetterService.record({
              kind: 'run',
              taskId: run.taskId,
              runId: run.id,
              title: 'Remote SSH unavailable — ran locally',
              detail: payload.text,
              payload: { runId: run.id, taskId: run.taskId, fallback: true },
            });
          }
        }
        break;
      case 'permission_request':
        // Surface through the same pending-permission store the MCP bridge
        // uses, so RunView/Inbox render agentd prompts identically. The
        // response is routed back over JSON-RPC instead of the file bridge.
        agentMcpService.registerAgentdPermission({
          runId: run.id,
          taskId: run.taskId,
          requestId: payload.callId ?? `${payload.runId}-${Date.now()}`,
          agentdRunId: payload.runId,
          toolName: payload.tool ?? 'unknown',
          input: payload.input ?? {},
          inputDigest: typeof payload.inputDigest === 'string' ? payload.inputDigest : undefined,
        });
        this.pushEvent(run, 'info', `Permission requested: ${payload.tool ?? 'unknown'}`);
        void import('./runTraceService').then(({ recordAgentdTraceEvent }) =>
          recordAgentdTraceEvent(run.id, 'permission_request', { tool: payload.tool }),
        );
        break;
      case 'error':
        run.error = payload.error ?? payload.text ?? 'agentd reported an error';
        this.pushEvent(run, 'stderr', run.error);
        break;
      case 'result': {
        if (payload.sessionId) run.sessionId = payload.sessionId;
        if (payload.text && !run.summary) run.summary = payload.text.slice(0, 2000);
        const failed = payload.status !== 'completed' || Boolean(run.error ?? payload.error);
        if (payload.error && !run.error) run.error = payload.error;
        if (this.usesDaemonQueue()) {
          // Daemon scheduler owns verify, dequeue, and terminal finish events.
          this.upsert(run);
          return;
        }
        const context = this.runContext.get(run.id);
        void this.finalizeAgentdResult(run, payload, failed, context);
        return;
      }
    }
    this.upsert(run);
  }

  /** Merge usage payloads from streamed agentd events into the run for live cost UI. */
  private mergeRunUsage(run: AgentRun, payload: AgentdRunEvent): void {
    if (!payload.usage || Object.keys(payload.usage).length === 0) {
      if (typeof payload.costUsd === 'number') run.costUsd = payload.costUsd;
      return;
    }
    const merged: NonNullable<AgentRun['usage']> = { ...(run.usage ?? {}) };
    for (const [model, entry] of Object.entries(payload.usage)) {
      const prev = merged[model] ?? {};
      merged[model] = {
        inputTokens: Math.max(prev.inputTokens ?? 0, entry.inputTokens ?? 0),
        outputTokens: Math.max(prev.outputTokens ?? 0, entry.outputTokens ?? 0),
        cacheReadTokens: Math.max(prev.cacheReadTokens ?? 0, entry.cacheReadTokens ?? 0),
        cacheWriteTokens: Math.max(prev.cacheWriteTokens ?? 0, entry.cacheWriteTokens ?? 0),
      };
    }
    run.usage = merged;
    if (typeof payload.costUsd === 'number') {
      run.costUsd = payload.costUsd;
    } else {
      const est = estimateCostUsdFromUsage(merged);
      if (est !== undefined) run.costUsd = est;
    }
  }

  private async finalizeAgentdResult(
    run: AgentRun,
    payload: AgentdRunEvent,
    failed: boolean,
    context?: { task: Task; agent: AgentProfile },
  ): Promise<void> {
    const cost = await this.resolveAgentdCostUsd(run, payload);
    if (cost !== undefined) run.costUsd = cost;

    if (payload.status === 'cancelled') {
      this.finishRun(run, 'cancelled');
    } else if (!failed && context?.agent.devCouncilVerify) {
      void this.startVerification(run, context.agent);
    } else {
      this.finishRun(
        run,
        failed ? 'failed' : 'completed',
        failed ? (run.error ?? `agentd run ${payload.status ?? 'failed'}`) : undefined,
      );
    }
    this.upsert(run);
  }

  /** Resolve run cost from the result payload or agentd_store (Rust persists usage). */
  private async resolveAgentdCostUsd(
    run: AgentRun,
    payload: AgentdRunEvent,
  ): Promise<number | undefined> {
    if (typeof payload.costUsd === 'number') return payload.costUsd;
    const fromUsage = estimateCostUsdFromUsage(payload.usage);
    if (fromUsage !== undefined) return fromUsage;
    if (!run.agentdRunId || !isTauri()) return undefined;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const stored = await invoke<Array<{ runId: string; costUsd?: number }>>(
        'agentd_store_list_runs',
        { limit: 100 },
      );
      return stored.find(r => r.runId === run.agentdRunId)?.costUsd;
    } catch {
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private appendBuffer(buffers: Map<string, string[]>, runId: string, line: string): void {
    const buffer = buffers.get(runId) ?? [];
    buffer.push(line);
    buffers.set(runId, buffer);
  }

  private async consumeClaudeStreamLine(run: AgentRun, line: string): Promise<void> {
    const parsed = isNativeBackend()
      ? await nativeParseStreamLine(line).catch(() => parseClaudeStreamLine(line))
      : parseClaudeStreamLine(line);
    if (parsed.sessionId) run.sessionId = parsed.sessionId;
    for (const event of parsed.events) {
      this.pushEvent(run, event.kind, event.text);
    }
    if (parsed.result) {
      run.summary = parsed.result.summary;
      run.numTurns = parsed.result.numTurns;
      run.costUsd = parsed.result.costUsd;
      if (parsed.result.isError) {
        run.error = parsed.result.summary ?? 'Claude Code reported an error result';
      }
    }
  }

  private async parseCouncilVerdict(raw: string) {
    if (isNativeBackend()) {
      try {
        return await nativeParseCouncilReport(raw);
      } catch {
        return parseCouncilReport(raw);
      }
    }
    return parseCouncilReport(raw);
  }

  private async handleExit(run: AgentRun, code: number): Promise<void> {
    // Idempotent: a run already finalized (cancelled by the user, or failed via
    // a guardrail abort) will still emit a process-exit event when its process
    // is reaped. Re-processing it would double-fire onRunFinished / auto-repair.
    if (run.status === 'cancelled' || run.status === 'failed' || run.status === 'completed') {
      this.councilBuffers.delete(run.id);
      this.verifyBuffers.delete(run.id);
      this.releaseAgent(run);
      return;
    }

    // DevCouncil verify gate finished.
    if (run.status === 'verifying') {
      const raw = (this.verifyBuffers.get(run.id) ?? []).join('\n');
      this.verifyBuffers.delete(run.id);
      const verdict = await this.parseCouncilVerdict(raw);
      run.verification = {
        passed: verdict.passed,
        blockingGaps: verdict.blockingGaps,
        raw: verdict.raw,
      };
      this.pushEvent(
        run,
        'verify',
        verdict.passed
          ? 'DevCouncil gate passed — no blocking gaps.'
          : `DevCouncil gate found ${verdict.blockingGaps.length} blocking gap(s).`
      );
      this.finishRun(
        run,
        code === 0 && verdict.passed && !run.error ? 'completed' : 'failed',
        run.error,
      );
      return;
    }

    // Full council pipeline finished.
    if (this.councilBuffers.has(run.id)) {
      const raw = (this.councilBuffers.get(run.id) ?? []).join('\n');
      this.councilBuffers.delete(run.id);
      const verdict = await this.parseCouncilVerdict(raw);
      run.verification = {
        passed: verdict.passed,
        blockingGaps: verdict.blockingGaps,
        raw: verdict.raw,
      };
      if (!run.summary) run.summary = verdict.summary;
      const passed = code === 0 && verdict.passed;
      this.pushEvent(
        run,
        'verify',
        passed
          ? 'DevCouncil pipeline completed with all gates passing.'
          : `DevCouncil pipeline ended with ${verdict.blockingGaps.length} blocking gap(s) (exit ${code}).`
      );
      this.finishRun(
        run,
        passed ? 'completed' : 'failed',
        passed ? undefined : (run.error ?? 'DevCouncil pipeline did not pass')
      );
      return;
    }

    const failed = code !== 0 || Boolean(run.error);
    const context = this.runContext.get(run.id);

    if (!failed && context?.agent.devCouncilVerify) {
      await this.startVerification(run, context.agent);
      return;
    }

    this.flagOverspend(run, context?.agent);

    // A "termination" (killed by signal / no exit code, encoded as -1 or
    // 128+signal) with no reviewable error means the process *died* rather than
    // reporting a failure — a crash we can auto-recover from.
    const terminated = code < 0 || (code > 128 && code < 193);
    const crashed = failed && terminated && !run.error;
    if (crashed) run.failureKind = 'crashed';

    this.finishRun(
      run,
      failed ? 'failed' : 'completed',
      failed ? (run.error ?? describeProcessExit(code, run)) : undefined
    );

    if (crashed) {
      this.hooks.onRunAborted?.(context?.task.id ?? run.taskId, run, 'crashed');
    }
  }

  /** Post-run per-run cost cap: flag (not block — cost is only known at the end). */
  private flagOverspend(run: AgentRun, agent?: AgentProfile): void {
    if (!agent) return;
    const limits = resolveRunLimits(agent, DEFAULT_RUN_LIMITS);
    if (exceededCostCap(run, limits)) {
      this.pushEvent(
        run,
        'info',
        `⚠ This run cost $${run.costUsd?.toFixed(2)}, above the per-run cap of $${limits.perRunCostCapUsd.toFixed(2)}.`
      );
    }
  }

  private async startVerification(run: AgentRun, agent: AgentProfile): Promise<void> {
    run.status = 'verifying';
    this.verifyBuffers.set(run.id, []);
    this.pushEvent(run, 'verify', 'Running DevCouncil verification gate (dev check --verify)…');
    this.upsert(run);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const context = this.runContext.get(run.id);
      const verifyDir = run.worktreePath ?? context?.agent.workingDir ?? agent.workingDir;
      const mcpConfig = await agentMcpService.prepareMcpConfig(run.id, run.taskId, verifyDir);
      await invoke('agent_run_start', {
        runId: run.id,
        mode: 'devcouncil-verify',
        prompt: 'verify',
        workingDir: verifyDir,
        model: null,
        permissionMode: null,
        maxTurns: null,
        containerImage: agentContainerImage(agent),
        sessionId: null,
        mcpConfigPath: mcpConfig,
        permissionPromptTool: permissionPromptToolFor(agent, mcpConfig),
        sandboxMode: agentSandboxMode(agent) === 'os' ? 'os' : null,
      });
    } catch (err) {
      // DevCouncil unavailable — degrade gracefully, don't fail the run.
      this.pushEvent(
        run,
        'verify',
        `DevCouncil gate skipped: ${err instanceof Error ? err.message : String(err)}`
      );
      this.finishRun(run, run.error ? 'failed' : 'completed', run.error);
    }
  }

  private spawnPolicyParams(agent: AgentProfile, task?: Task) {
    const stats = getAgentDailyStats(agent.id, this.getRuns());
    return {
      dailyCostCapUsd: agent.dailyCostCapUsd ?? null,
      maxRunsPerDay: agent.maxRunsPerDay ?? null,
      perRunCostCapUsd: agent.perRunCostCapUsd ?? null,
      todaySpendUsd: stats.spendUsd,
      todayRunCount: stats.runCount,
      modelRouting: agent.modelRouting ?? 'fixed',
      taskPriority: task?.priority ?? null,
      taskTimeEstimateMin: task?.timeEstimate ?? null,
      profileModel: agent.model ?? null,
    };
  }

  private ensureBudgetAllows(agent: AgentProfile): void {
    const stats = getAgentDailyStats(agent.id, this.getRuns());
    const blocked = checkAgentBudget(agent, stats);
    if (blocked) throw new Error(blocked);
  }

  private createRun(task: Task, agent: AgentProfile, status: AgentRun['status']): AgentRun {
    const run: AgentRun = {
      id: `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      taskId: task.id,
      agentId: agent.id,
      status,
      createdAt: new Date(),
      events: [],
      // `agent` here is already the workspace-resolved clone (see assign()), so
      // this captures the project-correct repo dir and persists it with the run.
      repoDir: agent.workingDir || undefined,
    };
    this.runContext.set(run.id, { task, agent });
    agentScopeService.bindTaskScopeToRun(run.id, task.id);
    return run;
  }

  private async bindScopeReservation(
    run: AgentRun,
    task: Task,
  ): Promise<Awaited<ReturnType<typeof agentReservationService.claim>>> {
    const claim = await agentReservationService.claim(run.id, task);
    run.reservedPaths = claim.paths;
    if (claim.ok) {
      run.scopeBlocked = false;
      run.scopeWaitPosition = undefined;
    } else {
      run.scopeBlocked = true;
      run.scopeWaitPosition = claim.waitPosition;
    }
    this.upsert(run);
    return claim;
  }

  private async releaseScopeReservation(runId: string): Promise<void> {
    const next = await agentReservationService.release(runId);
    if (!next) return;
    const run = this.runs.get(next.runId);
    const ctx = run ? this.runContext.get(run.id) : undefined;
    if (!run || !ctx || run.status !== 'queued' || !run.scopeBlocked) return;
    const claim = await agentReservationService.claim(run.id, ctx.task);
    run.reservedPaths = claim.paths;
    if (!claim.ok) return;
    run.scopeBlocked = false;
    run.scopeWaitPosition = undefined;
    this.upsert(run);
    if (!this.activeByAgent.has(run.agentId) && !isConcurrentRunCapReached(this.activeByAgent.size)) {
      void this.startRun(ctx.task, ctx.agent).catch((err) => {
        this.finishRun(run, 'failed', err instanceof Error ? err.message : String(err));
      });
    }
  }

  private finishRun(run: AgentRun, status: AgentRun['status'], error?: string): void {
    const terminal: AgentRun['status'][] = ['completed', 'failed', 'cancelled'];
    if (run.finishedAt && terminal.includes(run.status)) {
      return;
    }
    run.status = status;
    run.error = error;
    run.isPaused = false;
    run.finishedAt = new Date();
    // Drop the sidecar-id routing entry: the run is done, so no more inbound
    // agentd events should resolve to it. Prevents a slow per-run map leak.
    if (run.agentdRunId) this.agentdIdMap.delete(run.agentdRunId);
    void agentMcpService.cleanup(run.id);
    void this.releaseScopeReservation(run.id);
    void this.refreshGitDiff(run);
    // Persist boardSynced=false before hooks so a crash mid-sync requeues on boot.
    run.boardSynced = false;
    this.upsert(run);
    this.releaseAgent(run);
    void taskEventStore.appendSafe([
      {
        streamId: run.taskId,
        type: 'run.finished',
        payload: {
          status,
          error: error?.slice(0, 500),
          costUsd: run.costUsd,
          numTurns: run.numTurns,
          verificationPassed: run.verification?.passed,
        },
        actor: 'system',
        runId: run.id,
      },
    ]);

    const context = this.runContext.get(run.id);
    const taskId = context?.task.id ?? run.taskId;
    if (context) {
      // Compound a skill from every successful run (fire-and-forget). Key it by
      // the run's resolved repo dir so it's findable on the next run in the same
      // project (not the agent profile's possibly-stale folder).
      if (status === 'completed') {
        void agentSkillsService.captureFromRun(
          run,
          context.task,
          this.runRepoDir(run) ?? context.agent.workingDir,
        );
      }
    }
    this.hooks.onRunFinished?.(taskId, run);
    run.boardSynced = true;
    this.upsert(run);
  }

  private async refreshGitDiff(run: AgentRun): Promise<void> {
    if (!run.worktreePath || !isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const diff = await invoke<{ diff: string }>('agent_git_diff', {
        workingDir: run.worktreePath,
        baseRef: null,
      });
      run.gitDiff = diff.diff;
      this.upsert(run);
      this.hooks.onGitDiffReady?.(run.taskId, run);
    } catch {
      // Non-fatal
    }
  }

  /** Free the agent and start its next queued task, if any. */
  private releaseAgent(run: AgentRun): void {
    if (run.engine === 'agentd' && this.usesDaemonQueue()) {
      void this.refreshQueueCache();
      return;
    }
    const context = [...this.activeByAgent.entries()].find(([, id]) => id === run.id);
    if (!context) return;
    const [agentId] = context;
    void this.dequeueNext(agentId).then(() => this.wakeGlobalQueue());
  }

  /** Start queued runs on idle agents when a global concurrency slot opens. */
  private async wakeGlobalQueue(): Promise<void> {
    if (this.usesDaemonQueue()) return;
    const max = getMaxConcurrentAgentRuns();
    if (max <= 0) return;
    while (!isConcurrentRunCapReached(this.activeByAgent.size)) {
      const queued = this.getRuns().find(
        (r) =>
          r.status === 'queued' &&
          !r.scopeBlocked &&
          !this.activeByAgent.has(r.agentId),
      );
      if (!queued) break;
      const ctx = this.runContext.get(queued.id);
      if (!ctx) break;
      try {
        await this.startRun(ctx.task, ctx.agent);
      } catch {
        break;
      }
    }
  }

  /**
   * Start the next queued run for a freed agent. If it can't start (e.g. the
   * agent hit its budget between enqueue and now), the stuck `queued` placeholder
   * is finalized as failed and the next queued run is tried — instead of leaving
   * a card stuck in the queue behind an unhandled promise rejection.
   */
  private async dequeueNext(agentId: string): Promise<void> {
    if (this.usesDaemonQueue()) return;
    const next = await this.daemonRelease(agentId);
    if (!next) return;
    const run =
      (next.runId ? this.runs.get(next.runId) : undefined) ??
      this.getRuns().find((r) => r.taskId === next.taskId && r.agentId === next.agentId);
    const ctx = run ? this.runContext.get(run.id) : undefined;
    if (!run || !ctx) return;
    void this.startRun(ctx.task, ctx.agent).catch((err) => {
      const queued = this.getRunsForTask(next.taskId).find((r) => r.status === 'queued');
      if (queued) {
        this.finishRun(queued, 'failed', err instanceof Error ? err.message : String(err));
      }
      void this.dequeueNext(agentId);
    });
  }

  private pushEvent(run: AgentRun, kind: AgentRunEventKind, text: string): void {
    const event: AgentRunEvent = { ts: new Date(), kind, text };
    run.events.push(event);
    if (run.events.length > MAX_EVENTS_PER_RUN) {
      run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
    }
  }

  private upsert(run: AgentRun): void {
    this.runs.set(run.id, run);
    this.notify();
    this.schedulePersist();
  }

  private notify(): void {
    const snapshot = this.getRuns();
    this.listeners.forEach(l => {
      l(snapshot);
    });
    if (isTauri()) {
      const active = snapshot.filter(
        r => r.status === 'queued' || r.status === 'running' || r.status === 'verifying'
      ).length;
      this.updateSleepPrevention(active);
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('tray_update_active_runs', { count: active }))
        .catch(() => {});
    }
  }

  /**
   * Runs with an active worktree are always persisted — trimming them would drop
   * their ids from the prune keep-set and risk deleting in-flight branches.
   */
  private runsForPersist(): AgentRun[] {
    const all = this.getRuns();
    const withWorktree = all.filter((r) => !!r.worktreePath);
    const withoutWorktree = all.filter((r) => !r.worktreePath);
    const extraSlots = Math.max(0, MAX_PERSISTED_RUNS - withWorktree.length);
    return [...withWorktree, ...withoutWorktree.slice(0, extraSlots)];
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void storageService.set(STORAGE_KEYS.AGENT_RUNS, this.runsForPersist());
    }, 1000);
  }

  private reviveRun(raw: AgentRun): AgentRun {
    return {
      ...raw,
      createdAt: new Date(raw.createdAt),
      startedAt: raw.startedAt ? new Date(raw.startedAt) : undefined,
      finishedAt: raw.finishedAt ? new Date(raw.finishedAt) : undefined,
      events: (raw.events ?? []).map(e => ({ ...e, ts: new Date(e.ts) })),
      checkpoints: (raw.checkpoints ?? []).map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt),
      })),
      traceSteps: (raw.traceSteps ?? []).map((s) => ({
        ...s,
        ts: new Date(s.ts),
      })),
    };
  }
}

export const agentRunService = new AgentRunService();
export default agentRunService;
