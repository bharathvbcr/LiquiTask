import { FEATURE_FLAGS, STORAGE_KEYS } from '../../constants';
import { localApi, subscribeLocalEvent } from '../../core/api/localApi';
import taskEventStore from '../../core/events/taskEventStore';
import { isTauri } from '../../runtime/runtimeEnvironment';
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
import agentSkillsService from './agentSkillsService';
import { mergeSkillCatalog, type InstalledSkill } from '../../core/skills/mergeSkillCatalog';
import { catalogEntryToSkill, selectSkillsForTask } from './skillSelection';
import { checkAgentBudget, getAgentDailyStats, resolveAgentModel } from './agentPolicyService';
import { parseClaudeStreamLine, parseCouncilReport } from './agentStreamParser';
import deadLetterService from '../deadLetterService';
import { resolveAgentWorkspace, type WorkspaceResolution } from './resolveAgentWorkspace';
import type {
  AgentProfile,
  AgentRun,
  AgentRunEvent,
  AgentRunEventKind,
  AgentSkill,
  Task,
} from '../../../types';

/** Payload emitted by the Rust agent runner on `agent-run-event`. */
interface AgentRunNativeEvent {
  runId: string;
  stream: 'stdout' | 'stderr' | 'exit' | 'error';
  line?: string;
  code?: number;
}

/**
 * Payload emitted by the agentd bridge on `agentd-run-event` — the sidecar's
 * `run.events` notification flattened by agentd.rs (runId here is the
 * SIDECAR id; resolve through `agentdIdMap`). Field set mirrors
 * liquitask-agentd/internal/runner/runner.go's RunEvent.
 */
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
}

type Listener = (runs: AgentRun[]) => void;

const MAX_EVENTS_PER_RUN = 300;
const MAX_PERSISTED_RUNS = 100;
const PERMISSION_PROMPT_TOOL = 'mcp__liquitask__permission_prompt';

function permissionPromptToolFor(agent: AgentProfile, mcpConfig: string | null): string | null {
  if (!mcpConfig || agent.sandbox === 'container' || agent.permissionMode === 'bypassPermissions') {
    return null;
  }
  return PERMISSION_PROMPT_TOOL;
}

/**
 * Orchestrates the Multica-style agent run lifecycle:
 * queued -> running -> (verifying) -> completed | failed | cancelled.
 *
 * Runs execute in the Tauri backend (`agent_runner.rs`); this service consumes
 * the streamed NDJSON, keeps `AgentRun` records, persists them, compounds
 * skills from successful runs, and applies the DevCouncil gates:
 * - `runMode: "council"` routes the whole run through `dev e2e --executor claude`
 * - `devCouncilVerify` runs `dev check --verify --json` after direct runs
 */
class AgentRunService {
  private runs = new Map<string, AgentRun>();
  private queue: { task: Task; agent: AgentProfile }[] = [];
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
  /** sidecar runId -> local run id, for routing inbound agentd-run-events. */
  private agentdIdMap = new Map<string, string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
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

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

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
          const localId = this.agentdIdMap.get(info.runId);
          if (!localId) continue;
          infos.push({
            runId: localId,
            alive: info.alive,
            status:
              info.status === 'completed' || info.status === 'cancelled'
                ? info.status
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
        run.status = 'failed';
        run.error = 'Interrupted by app restart';
        run.finishedAt = run.finishedAt ?? new Date();
      } else if (info.alive) {
        // Still working detached — native events will resume the live stream.
        run.status = 'running';
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
        this.pendingBoardSync.push(run.id);
      }
      this.upsert(run);
    }
  }

  /**
   * Re-establish run context (task + agent) for runs still live after a
   * relaunch, so their eventual completion still moves the card, captures a
   * skill, and advances the agent's queue. The service has no board access, so
   * the app layer supplies the lookup.
   */
  rehydrateActiveRuns(
    resolve: (run: AgentRun) => { task: Task; agent: AgentProfile } | null
  ): void {
    for (const run of this.runs.values()) {
      if (run.status !== 'running' && run.status !== 'verifying') continue;
      if (this.runContext.has(run.id)) continue;
      const context = resolve(run);
      if (!context) continue;
      this.runContext.set(run.id, context);
      this.activeByAgent.set(context.agent.id, run.id);
    }
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
      if (run) this.hooks.onRunFinished?.(run.taskId, run);
    }
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.unlistenAgentd?.();
    this.unlistenAgentd = null;
    this.initialized = false;
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

  /** Whether the agent currently has a running (non-queued) run. */
  isAgentBusy(agentId: string): boolean {
    return this.activeByAgent.has(agentId);
  }

  /** 1-based position of a task in its agent's wait line, or null when not queued. */
  getQueuePosition(taskId: string): number | null {
    const entry = this.queue.find(q => q.task.id === taskId);
    if (!entry) return null;
    const line = this.queue.filter(q => q.agent.id === entry.agent.id);
    const index = line.findIndex(q => q.task.id === taskId);
    return index >= 0 ? index + 1 : null;
  }

  /** Number of tasks waiting in an agent's queue (excludes the running task). */
  getQueueLengthForAgent(agentId: string): number {
    return this.queue.filter(q => q.agent.id === agentId).length;
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
    if (this.getActiveRunForTask(task.id)) return null;

    // Bind the run to the task's project workspace (throws if blocked). The
    // resolved agent clone flows into both the immediate and queued paths, so
    // the worktree/cwd/merge all target the right repository.
    const { agent: runAgent, note } = this.resolveRunAgent(task, agent);

    if (this.activeByAgent.has(runAgent.id)) {
      this.queue.push({ task, agent: runAgent });
      const run = this.createRun(task, runAgent, 'queued');
      if (note) this.pushEvent(run, 'info', note);
      this.upsert(run);
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

    if (run.status === 'queued') {
      this.queue = this.queue.filter(q => q.task.id !== run.taskId);
      run.status = 'cancelled';
      run.finishedAt = new Date();
      run.isPaused = false;
      this.upsert(run);
      return;
    }

    if (run.engine === 'agentd' && run.agentdRunId) {
      await localApi.runCancel(run.agentdRunId);
    } else {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_run_cancel', { runId });
    }
    run.status = 'cancelled';
    run.finishedAt = new Date();
    run.isPaused = false;
    this.upsert(run);
    if (run.engine === 'agentd') this.releaseAgent(run);
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
    } else {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_runner_pause', { runId });
    }
    run.isPaused = true;
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
    } else {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_runner_resume', { runId });
    }
    run.isPaused = false;
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
    if (run.engine === 'agentd' && run.agentdRunId) {
      await localApi.runInject(run.agentdRunId, message);
      if (resumeIfPaused && run.isPaused) await localApi.runResume(run.agentdRunId);
    } else {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke<boolean>('agent_runner_inject_guidance', {
        runId,
        message,
        resumeIfPaused,
      });
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

  /** Headless follow-up on a finished run — streams into the same run log. */
  async followUp(runId: string, message: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run?.sessionId) throw new Error('No resumable session for this run.');
    const context = this.runContext.get(runId);
    if (!context) throw new Error('Run context missing.');

    this.ensureBudgetAllows(context.agent);

    run.status = 'running';
    run.finishedAt = undefined;
    this.activeByAgent.set(context.agent.id, run.id);
    this.pushEvent(run, 'info', `Follow-up: ${message.slice(0, 200)}`);
    this.upsert(run);

    // agentd runs resume through the sidecar with the runtime's own session id.
    if (run.engine === 'agentd') {
      const followUpCwd = run.worktreePath ?? this.runRepoDir(run) ?? context.agent.workingDir;
      const sidecarId = await localApi.runStart({
        taskId: run.taskId,
        runtime: providerToRuntime(context.agent.provider),
        prompt: message,
        cwd: followUpCwd,
        model: context.agent.model || undefined,
        resumeSessionId: run.sessionId,
        // Resumes re-spawn the CLI, so both the board bridge and the
        // DevCouncil server (when the dir is enabled) must be re-injected —
        // repair follow-ups rely on them most.
        mcpConfig: await this.buildAgentdMcpConfig(run.id, run.taskId, followUpCwd),
      });
      if (!sidecarId) throw new Error('agentd did not return a run id for follow-up');
      run.agentdRunId = sidecarId;
      this.agentdIdMap.set(sidecarId, run.id);
      this.upsert(run);
      return;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const followUpWorkingDir = run.worktreePath ?? this.runRepoDir(run) ?? context.agent.workingDir;
    const mcpConfig = await agentMcpService.prepareMcpConfig(
      run.id,
      run.taskId,
      followUpWorkingDir
    );
    await invoke('agent_run_start', {
      runId: run.id,
      mode: 'claude-resume',
      prompt: message,
      workingDir: followUpWorkingDir,
      model: context.agent.model || null,
      permissionMode: context.agent.permissionMode,
      maxTurns: context.agent.maxTurns ?? null,
      containerImage: null,
      sessionId: run.sessionId,
      mcpConfigPath: mcpConfig,
      permissionPromptTool: permissionPromptToolFor(context.agent, mcpConfig),
      ...this.spawnPolicyParams(context.agent),
      modelRouting: 'fixed',
      taskPriority: null,
      taskTimeEstimateMin: null,
    });
  }

  /**
   * Commit stage: runs the TRANSACTIONAL merge pipeline (verify gate →
   * repo-locked --no-ff merge with pre-merge SHA capture and rollback →
   * worktree prune). Failures are dead-lettered by the pipeline; the thrown
   * error keeps the card in Completed.
   */
  async mergeWorktree(run: AgentRun, options?: { verify?: boolean }): Promise<string> {
    const context = this.runContext.get(run.id);
    const repoDir = this.runRepoDir(run);
    if (!run.worktreePath || !run.gitBranch || !repoDir) {
      throw new Error('No worktree to merge.');
    }
    const { mergePipelineService } = await import('./mergePipelineService');
    const task = context?.task ?? ({ id: run.taskId, title: run.gitBranch } as unknown as Task);
    const { result } = await mergePipelineService.run({
      task,
      run,
      repoDir,
      verify: options?.verify ?? context?.agent.devCouncilVerify ?? false,
      commitMessage: this.worktreeCommitMessage(run),
    });
    run.worktreePath = undefined;
    this.pushEvent(run, 'info', result.message);
    this.upsert(run);
    return result.message;
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
    const repos = new Set<string>([
      ...keepByRepo.keys(),
      ...agents.map(a => a.workingDir).filter(Boolean),
    ]);
    const { invoke } = await import('@tauri-apps/api/core');
    for (const repoDir of repos) {
      try {
        const reaped = await invoke<number>('agent_git_prune_worktrees', {
          repoDir,
          keepRunIds: [...(keepByRepo.get(repoDir) ?? [])],
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

  /** Open a GitHub PR for the run's branch (requires `gh` CLI). */
  async openPullRequest(run: AgentRun, taskTitle: string): Promise<string | null> {
    if (!run.gitBranch) return null;
    const context = this.runContext.get(run.id);
    if (!context) return null;
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<{ url?: string }>('agent_git_create_pr', {
      workingDir: context.agent.workingDir,
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
   * Choose the skills injected into a run's prompt: captured repo skills plus any
   * installed skill packs that match the task, relevance-ranked. Degrades to
   * captured skills alone when the installed-skills sidecar call is unavailable,
   * so a run is never blocked on skill discovery.
   */
  private async selectRunSkills(task: Task, workingDir: string): Promise<AgentSkill[]> {
    const captured = agentSkillsService.getSkillsForWorkingDir(workingDir);
    let installed: InstalledSkill[] | undefined;
    try {
      installed = await localApi.listSkills();
    } catch {
      installed = undefined;
    }
    const catalog = mergeSkillCatalog(captured, installed);
    const ranked = selectSkillsForTask(task, catalog);
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
    this.activeByAgent.set(agent.id, run.id);
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
          this.pushEvent(
            run,
            'info',
            `Git worktree skipped: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      // Context-injection pipeline: keep the DevCouncil repo map fresh in the
      // background so the next run's prompt orientation isn't stale.
      devcouncilService.ensureFreshMap(agent.workingDir);

      // Non-claude providers execute through the liquitask-agentd sidecar
      // (Multica's ported Backend interface). Council mode is excluded — the
      // DevCouncil pipeline drives its own executor and stays on the legacy
      // runner regardless of provider.
      if (this.usesAgentd(agent)) {
        run.engine = 'agentd';
        const agentdSkills = await this.selectRunSkills(task, agent.workingDir);
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
        const sidecarId = await localApi.runStart({
          taskId: task.id,
          runtime: providerToRuntime(agent.provider),
          prompt: agentdPrompt,
          cwd: workingDir,
          model: resolvedModel,
          resumeSessionId: options?.resumeSessionId,
          mcpConfig: await this.buildAgentdMcpConfig(run.id, task.id, workingDir),
        });
        if (!sidecarId) {
          throw new Error('agentd did not return a run id (is the sidecar running?)');
        }
        run.agentdRunId = sidecarId;
        this.agentdIdMap.set(sidecarId, run.id);
        this.pushEvent(run, 'info', `Dispatched to ${agent.provider} via agentd`);
        this.upsert(run);
        return run;
      }

      const mcpConfig = await agentMcpService.prepareMcpConfig(run.id, task.id, workingDir);
      const permissionPromptTool = permissionPromptToolFor(agent, mcpConfig);
      const skills = await this.selectRunSkills(task, agent.workingDir);
      const taskPrompt =
        options?.promptOverride ??
        withRepoFileIndex(
          withRepoContext(
            isNativeBackend()
              ? await nativeBuildTaskPrompt(task, skills)
              : buildTaskPrompt(task, skills),
            await devcouncilService.getRepoMapContext(agent.workingDir)
          ),
          await devcouncilService.getRepoFiles(agent.workingDir)
        );
      const councilGoal = isNativeBackend()
        ? await nativeBuildCouncilGoal(task)
        : buildCouncilGoal(task);

      if (council) {
        await invoke('agent_run_start', {
          runId: run.id,
          mode: 'devcouncil-e2e',
          prompt: councilGoal,
          workingDir,
          model: null,
          permissionMode: null,
          maxTurns: null,
          containerImage: null,
          sessionId: null,
          mcpConfigPath: mcpConfig,
          permissionPromptTool: null,
          ...policy,
        });
      } else if (options?.resumeSessionId) {
        await invoke('agent_run_start', {
          runId: run.id,
          mode: 'claude-resume',
          prompt: options.promptOverride ?? taskPrompt,
          workingDir,
          model: resolvedModel ?? null,
          permissionMode: agent.permissionMode,
          maxTurns: agent.maxTurns ?? null,
          containerImage: null,
          sessionId: options.resumeSessionId,
          mcpConfigPath: mcpConfig,
          permissionPromptTool,
          ...policy,
          modelRouting: 'fixed',
          taskPriority: null,
          taskTimeEstimateMin: null,
        });
      } else {
        await invoke('agent_run_start', {
          runId: run.id,
          mode: agent.sandbox === 'container' ? 'claude-container' : 'claude',
          prompt: taskPrompt,
          workingDir,
          model: resolvedModel ?? null,
          permissionMode: agent.sandbox === 'container' ? null : agent.permissionMode,
          maxTurns: agent.maxTurns ?? null,
          containerImage: agent.containerImage || null,
          sessionId: null,
          mcpConfigPath: mcpConfig,
          permissionPromptTool,
          ...policy,
        });
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

  /** True when this profile's runs execute via the liquitask-agentd sidecar. */
  private usesAgentd(agent: AgentProfile): boolean {
    return (
      FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED &&
      agent.provider !== 'claude-code' &&
      (agent.runMode ?? 'direct') !== 'council'
    );
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
        break;
      }
      case 'tool_result':
        if (payload.output) {
          this.pushEvent(run, 'tool', `→ ${payload.output.slice(0, 300)}`);
        }
        break;
      case 'status':
      case 'log':
        if (payload.text) this.pushEvent(run, 'info', payload.text);
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
        });
        this.pushEvent(run, 'info', `Permission requested: ${payload.tool ?? 'unknown'}`);
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
        const context = this.runContext.get(run.id);
        if (payload.status === 'cancelled') {
          run.status = 'cancelled';
          run.finishedAt = new Date();
          run.isPaused = false;
          this.upsert(run);
          this.releaseAgent(run);
        } else if (!failed && context?.agent.devCouncilVerify) {
          // Same post-run DevCouncil gate the legacy exit path applies.
          void this.startVerification(run, context.agent);
        } else {
          this.finishRun(
            run,
            failed ? 'failed' : 'completed',
            failed ? (run.error ?? `agentd run ${payload.status ?? 'failed'}`) : undefined
          );
        }
        break;
      }
    }
    this.upsert(run);
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
    if (run.status === 'cancelled') {
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
      this.finishRun(run, verdict.passed && !run.error ? 'completed' : 'failed', run.error);
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

    this.finishRun(
      run,
      failed ? 'failed' : 'completed',
      failed ? (run.error ?? `Process exited with code ${code}`) : undefined
    );
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
      await invoke('agent_run_start', {
        runId: run.id,
        mode: 'devcouncil-verify',
        prompt: 'verify',
        workingDir: verifyDir,
        model: null,
        permissionMode: null,
        maxTurns: null,
        containerImage: null,
        sessionId: null,
        mcpConfigPath: null,
        permissionPromptTool: null,
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
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  private finishRun(run: AgentRun, status: AgentRun['status'], error?: string): void {
    run.status = status;
    run.error = error;
    run.isPaused = false;
    run.finishedAt = new Date();
    void agentMcpService.cleanup(run.id);
    void this.refreshGitDiff(run);
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
      this.hooks.onRunFinished?.(context.task.id, run);
    }
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
    const context = [...this.activeByAgent.entries()].find(([, id]) => id === run.id);
    if (!context) return;
    const [agentId] = context;
    this.activeByAgent.delete(agentId);

    const nextIndex = this.queue.findIndex(q => q.agent.id === agentId);
    if (nextIndex >= 0) {
      const [next] = this.queue.splice(nextIndex, 1);
      void this.startRun(next.task, next.agent);
    }
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
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('tray_update_active_runs', { count: active }))
        .catch(() => {});
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const runs = this.getRuns().slice(0, MAX_PERSISTED_RUNS);
      void storageService.set(STORAGE_KEYS.AGENT_RUNS, runs);
    }, 1000);
  }

  private reviveRun(raw: AgentRun): AgentRun {
    return {
      ...raw,
      createdAt: new Date(raw.createdAt),
      startedAt: raw.startedAt ? new Date(raw.startedAt) : undefined,
      finishedAt: raw.finishedAt ? new Date(raw.finishedAt) : undefined,
      events: (raw.events ?? []).map(e => ({ ...e, ts: new Date(e.ts) })),
    };
  }
}

export const agentRunService = new AgentRunService();
export default agentRunService;
