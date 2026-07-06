import { STORAGE_KEYS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";
import storageService from "../storageService";
import { buildCouncilGoal, buildTaskPrompt } from "./agentPrompt";
import {
  isNativeBackend,
  nativeBuildCouncilGoal,
  nativeBuildTaskPrompt,
  nativeParseCouncilReport,
  nativeParseStreamLine,
} from "../nativeBridge";
import agentMcpService from "./agentMcpService";
import agentScopeService from "./agentScopeService";
import agentSkillsService from "./agentSkillsService";
import {
  checkAgentBudget,
  getAgentDailyStats,
  resolveAgentModel,
} from "./agentPolicyService";
import { parseClaudeStreamLine, parseCouncilReport } from "./agentStreamParser";
import type {
  AgentProfile,
  AgentRun,
  AgentRunEvent,
  AgentRunEventKind,
  Task,
} from "../../../types";

/** Payload emitted by the Rust agent runner on `agent-run-event`. */
interface AgentRunNativeEvent {
  runId: string;
  stream: "stdout" | "stderr" | "exit" | "error";
  line?: string;
  code?: number;
}

/**
 * One entry returned by `agent_runs_reattach` on relaunch (Runtime v2 headless
 * runs). `alive` means the agent process is still running detached; otherwise
 * `status` is the outcome reconciled from the run's durable stdout log.
 */
interface RunReattachInfo {
  runId: string;
  alive: boolean;
  status: "running" | "completed" | "failed" | "cancelled";
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
const PERMISSION_PROMPT_TOOL = "mcp__liquitask__permission_prompt";

function permissionPromptToolFor(agent: AgentProfile, mcpConfig: string | null): string | null {
  if (!mcpConfig || agent.sandbox === "container" || agent.permissionMode === "bypassPermissions") {
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
  private unlisten: (() => void) | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  /** Run ids finalized from the journal on relaunch, awaiting board retro-drive. */
  private pendingBoardSync: string[] = [];

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized || !isTauri()) return;
    this.initialized = true;

    const persisted = storageService.get<AgentRun[]>(STORAGE_KEYS.AGENT_RUNS, []);
    const revived = (persisted ?? []).map((raw) => this.reviveRun(raw));
    for (const run of revived) {
      this.runs.set(run.id, run);
    }

    try {
      // Attach the event bridge *before* reattaching so that events for runs
      // that are still alive headless aren't dropped in the gap.
      const { listen } = await import("@tauri-apps/api/event");
      this.unlisten = await listen<AgentRunNativeEvent>("agent-run-event", (event) => {
        this.handleNativeEvent(event.payload);
      });
    } catch (err) {
      // Partial Tauri environments (tests, degraded webviews) can expose the
      // runtime marker without the event bridge — stay inert instead of throwing.
      this.initialized = false;
      console.warn("Agent run event listener unavailable:", err);
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
      (r) => r.status === "running" || r.status === "queued" || r.status === "verifying",
    );
    if (active.length === 0) return;

    let infos: RunReattachInfo[] = [];
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      infos = await invoke<RunReattachInfo[]>("agent_runs_reattach");
    } catch (err) {
      console.warn("Run reattach unavailable:", err);
    }
    const byId = new Map(infos.map((i) => [i.runId, i]));

    for (const run of active) {
      const info = byId.get(run.id);
      if (!info) {
        run.status = "failed";
        run.error = "Interrupted by app restart";
        run.finishedAt = run.finishedAt ?? new Date();
      } else if (info.alive) {
        // Still working detached — native events will resume the live stream.
        run.status = "running";
        run.finishedAt = undefined;
        run.isPaused = info.paused ?? false;
        if (info.sessionId && !run.sessionId) run.sessionId = info.sessionId;
        this.pushEvent(run, "info", "Reattached to headless run after relaunch — still working.");
      } else {
        // Finished while the app was closed — finalize with the real outcome.
        if (info.sessionId && !run.sessionId) run.sessionId = info.sessionId;
        if (info.summary && !run.summary) run.summary = info.summary;
        run.status =
          info.status === "completed"
            ? "completed"
            : info.status === "cancelled"
              ? "cancelled"
              : "failed";
        run.finishedAt = run.finishedAt ?? new Date();
        if (run.status === "failed" && !run.error) {
          run.error = "Agent run ended while the app was closed.";
        }
        this.pushEvent(
          run,
          run.status === "completed" ? "result" : "info",
          run.status === "completed"
            ? `Completed while the app was closed.${run.summary ? ` ${run.summary.slice(0, 300)}` : ""}`
            : "Run ended while the app was closed.",
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
    resolve: (run: AgentRun) => { task: Task; agent: AgentProfile } | null,
  ): void {
    for (const run of this.runs.values()) {
      if (run.status !== "running" && run.status !== "verifying") continue;
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
    this.initialized = false;
  }

  setTaskHooks(hooks: AgentRunTaskHooks): void {
    this.hooks = hooks;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getRuns(): AgentRun[] {
    return [...this.runs.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  getRunsForTask(taskId: string): AgentRun[] {
    return this.getRuns().filter((r) => r.taskId === taskId);
  }

  getActiveRunForTask(taskId: string): AgentRun | undefined {
    return this.getRuns().find(
      (r) =>
        r.taskId === taskId &&
        (r.status === "running" || r.status === "verifying" || r.status === "queued"),
    );
  }

  hasActiveRuns(): boolean {
    return this.activeByAgent.size > 0;
  }

  async detectClis(): Promise<AgentCliStatus[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<AgentCliStatus[]>("agent_detect_clis");
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Queue a run; starts immediately when the agent is idle. */
  async assign(task: Task, agent: AgentProfile): Promise<AgentRun | null> {
    if (!isTauri()) return null;
    if (this.getActiveRunForTask(task.id)) return null;

    if (this.activeByAgent.has(agent.id)) {
      this.queue.push({ task, agent });
      const run = this.createRun(task, agent, "queued");
      this.upsert(run);
      return run;
    }
    return this.startRun(task, agent);
  }

  async cancel(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;

    agentMcpService.denyAllForRun(runId);

    if (run.status === "queued") {
      this.queue = this.queue.filter((q) => q.task.id !== run.taskId);
      run.status = "cancelled";
      run.finishedAt = new Date();
      run.isPaused = false;
      this.upsert(run);
      return;
    }

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<boolean>("agent_run_cancel", { runId });
    run.status = "cancelled";
    run.finishedAt = new Date();
    run.isPaused = false;
    this.upsert(run);
  }

  /** Pause a running agent process (SIGSTOP on Unix, thread suspend on Windows). */
  async pause(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") {
      throw new Error("Only running agents can be paused.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<boolean>("agent_runner_pause", { runId });
    run.isPaused = true;
    this.pushEvent(run, "info", "Run paused by user.");
    this.upsert(run);
  }

  /** Resume a paused agent process. */
  async resume(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") {
      throw new Error("Only running agents can be resumed.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<boolean>("agent_runner_resume", { runId });
    run.isPaused = false;
    this.pushEvent(run, "info", "Run resumed.");
    this.upsert(run);
  }

  /**
   * Inject mid-run guidance without cancel/restart. The message is queued for
   * Claude Code to fetch via MCP `get_user_guidance`; auto-resumes if paused.
   */
  async injectGuidance(runId: string, message: string, resumeIfPaused = true): Promise<void> {
    const run = this.runs.get(runId);
    if (!run || (run.status !== "running" && run.status !== "verifying")) {
      throw new Error("Guidance can only be injected into active runs.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<boolean>("agent_runner_inject_guidance", {
      runId,
      message,
      resumeIfPaused,
    });
    if (resumeIfPaused) run.isPaused = false;
    this.pushEvent(run, "info", `Guidance injected: ${message.slice(0, 200)}`);
    this.upsert(run);
  }

  /** Hand the session over to Terminal.app (`claude --resume <sessionId>`). */
  async openInTerminal(run: AgentRun, agent: AgentProfile): Promise<void> {
    if (!run.sessionId) throw new Error("No resumable session for this run.");
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("agent_open_in_terminal", {
      workingDir: run.worktreePath ?? agent.workingDir,
      sessionId: run.sessionId,
    });
  }

  /** Headless follow-up on a finished run — streams into the same run log. */
  async followUp(runId: string, message: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run?.sessionId) throw new Error("No resumable session for this run.");
    const context = this.runContext.get(runId);
    if (!context) throw new Error("Run context missing.");

    this.ensureBudgetAllows(context.agent);

    run.status = "running";
    run.finishedAt = undefined;
    this.activeByAgent.set(context.agent.id, run.id);
    this.pushEvent(run, "info", `Follow-up: ${message.slice(0, 200)}`);
    this.upsert(run);

    const { invoke } = await import("@tauri-apps/api/core");
    const followUpWorkingDir = run.worktreePath ?? context.agent.workingDir;
    const mcpConfig = await agentMcpService.prepareMcpConfig(run.id, run.taskId, followUpWorkingDir);
    await invoke("agent_run_start", {
      runId: run.id,
      mode: "claude-resume",
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
      modelRouting: "fixed",
      taskPriority: null,
      taskTimeEstimateMin: null,
    });
  }

  /** Merge the run's worktree branch into the repo and remove the worktree. */
  async mergeWorktree(run: AgentRun): Promise<void> {
    const context = this.runContext.get(run.id);
    if (!run.worktreePath || !run.gitBranch || !context) {
      throw new Error("No worktree to merge.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const message = await invoke<string>("agent_git_merge_worktree", {
      repoDir: context.agent.workingDir,
      worktreePath: run.worktreePath,
      branch: run.gitBranch,
    });
    run.worktreePath = undefined;
    this.pushEvent(run, "info", message);
    this.upsert(run);
  }

  /** Remove the run's worktree and delete its branch without merging. */
  async discardWorktree(run: AgentRun): Promise<void> {
    const context = this.runContext.get(run.id);
    if (!run.worktreePath || !run.gitBranch || !context) {
      throw new Error("No worktree to discard.");
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("agent_git_discard_worktree", {
      repoDir: context.agent.workingDir,
      worktreePath: run.worktreePath,
      branch: run.gitBranch,
    });
    run.worktreePath = undefined;
    this.pushEvent(run, "info", `Discarded branch ${run.gitBranch}`);
    this.upsert(run);
  }

  /** Reject review — re-run agent with feedback via claude --resume. */
  async rejectWithFeedback(runId: string, feedback: string): Promise<void> {
    const prompt = [
      "The reviewer rejected your previous work. Address this feedback and update the implementation:",
      feedback,
    ].join("\n\n");
    await this.followUp(runId, prompt);
  }

  /** Persist human review outcome on a run (approval duration or rejection feedback). */
  recordReviewOutcome(
    runId: string,
    data: {
      outcome: "approved" | "rejected";
      feedback?: string;
      actualMinutes?: number;
    },
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.reviewOutcome = data.outcome;
    if (data.feedback?.trim()) {
      run.reviewFeedback = data.feedback.trim();
      this.pushEvent(run, "info", `Reviewer feedback: ${data.feedback.trim().slice(0, 500)}`);
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
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ url?: string }>("agent_git_create_pr", {
      workingDir: context.agent.workingDir,
      title: taskTitle,
      body: run.summary ?? "Agent teammate run",
      headBranch: run.gitBranch,
    });
    if (result.url) {
      run.prUrl = result.url;
      this.upsert(run);
    }
    return result.url ?? null;
  }

  private async startRun(
    task: Task,
    agent: AgentProfile,
    options?: { promptOverride?: string; resumeSessionId?: string },
  ): Promise<AgentRun> {
    this.ensureBudgetAllows(agent);

    const resolvedModel = options?.resumeSessionId
      ? agent.model || undefined
      : resolveAgentModel(agent, task);

    // Reuse the queued placeholder if one exists for this task.
    const existing = this.getRunsForTask(task.id).find((r) => r.status === "queued");
    const run = existing ?? this.createRun(task, agent, "queued");
    const council = (agent.runMode ?? "direct") === "council";

    run.status = "running";
    run.startedAt = new Date();
    this.activeByAgent.set(agent.id, run.id);
    this.runContext.set(run.id, { task, agent });
    if (council) this.councilBuffers.set(run.id, []);
    const pickupNote = council
      ? `Agent "${agent.name}" picked up ${task.jobId || task.id} (DevCouncil pipeline)`
      : `Agent "${agent.name}" picked up ${task.jobId || task.id}`;
    this.pushEvent(run, "info", pickupNote);
    if (resolvedModel && !council) {
      this.pushEvent(
        run,
        "info",
        `Model: ${resolvedModel}${(agent.modelRouting ?? "fixed") === "auto" ? " (auto-routed)" : ""}`,
      );
    }
    this.upsert(run);
    this.hooks.onRunStarted?.(task.id, run);

    let workingDir = agent.workingDir;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const policy = this.spawnPolicyParams(agent, task);

      if (agent.gitWorktree && !options?.resumeSessionId) {
        try {
          const wt = await invoke<{ branch: string; worktreePath: string }>(
            "agent_git_create_worktree",
            { workingDir: agent.workingDir, runId: run.id, taskTitle: task.title },
          );
          run.gitBranch = wt.branch;
          run.worktreePath = wt.worktreePath;
          workingDir = wt.worktreePath;
          this.pushEvent(run, "info", `Git worktree: ${wt.branch}`);
          this.upsert(run);
        } catch (err) {
          this.pushEvent(
            run,
            "info",
            `Git worktree skipped: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const mcpConfig = await agentMcpService.prepareMcpConfig(run.id, task.id, workingDir);
      const permissionPromptTool = permissionPromptToolFor(agent, mcpConfig);
      const skills = agentSkillsService.getSkillsForWorkingDir(agent.workingDir);
      const taskPrompt =
        options?.promptOverride ??
        (isNativeBackend()
          ? await nativeBuildTaskPrompt(task, skills)
          : buildTaskPrompt(task, skills));
      const councilGoal = isNativeBackend()
        ? await nativeBuildCouncilGoal(task)
        : buildCouncilGoal(task);

      if (council) {
        await invoke("agent_run_start", {
          runId: run.id,
          mode: "devcouncil-e2e",
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
        await invoke("agent_run_start", {
          runId: run.id,
          mode: "claude-resume",
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
          modelRouting: "fixed",
          taskPriority: null,
          taskTimeEstimateMin: null,
        });
      } else {
        await invoke("agent_run_start", {
          runId: run.id,
          mode: agent.sandbox === "container" ? "claude-container" : "claude",
          prompt: taskPrompt,
          workingDir,
          model: resolvedModel ?? null,
          permissionMode: agent.sandbox === "container" ? null : agent.permissionMode,
          maxTurns: agent.maxTurns ?? null,
          containerImage: agent.containerImage || null,
          sessionId: null,
          mcpConfigPath: mcpConfig,
          permissionPromptTool,
          ...policy,
        });
      }
    } catch (err) {
      this.finishRun(run, "failed", err instanceof Error ? err.message : String(err));
    }
    return run;
  }

  // -------------------------------------------------------------------------
  // Native event handling
  // -------------------------------------------------------------------------

  private handleNativeEvent(payload: AgentRunNativeEvent): void {
    const run = this.runs.get(payload.runId);
    if (!run) return;

    if (payload.stream === "stderr" && payload.line) {
      this.pushEvent(run, "stderr", payload.line);
      this.upsert(run);
      return;
    }

    if (payload.stream === "stdout" && payload.line) {
      if (run.status === "verifying") {
        this.appendBuffer(this.verifyBuffers, run.id, payload.line);
      } else if (this.councilBuffers.has(run.id)) {
        this.appendBuffer(this.councilBuffers, run.id, payload.line);
        this.pushEvent(run, "info", payload.line.slice(0, 400));
      } else {
        void this.consumeClaudeStreamLine(run, payload.line).finally(() => this.upsert(run));
        return;
      }
      this.upsert(run);
      return;
    }

    if (payload.stream === "exit") {
      void this.handleExit(run, payload.code ?? -1);
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
        run.error = parsed.result.summary ?? "Claude Code reported an error result";
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
    if (run.status === "cancelled") {
      this.councilBuffers.delete(run.id);
      this.verifyBuffers.delete(run.id);
      this.releaseAgent(run);
      return;
    }

    // DevCouncil verify gate finished.
    if (run.status === "verifying") {
      const raw = (this.verifyBuffers.get(run.id) ?? []).join("\n");
      this.verifyBuffers.delete(run.id);
      const verdict = await this.parseCouncilVerdict(raw);
      run.verification = {
        passed: verdict.passed,
        blockingGaps: verdict.blockingGaps,
        raw: verdict.raw,
      };
      this.pushEvent(
        run,
        "verify",
        verdict.passed
          ? "DevCouncil gate passed — no blocking gaps."
          : `DevCouncil gate found ${verdict.blockingGaps.length} blocking gap(s).`,
      );
      this.finishRun(run, verdict.passed && !run.error ? "completed" : "failed", run.error);
      return;
    }

    // Full council pipeline finished.
    if (this.councilBuffers.has(run.id)) {
      const raw = (this.councilBuffers.get(run.id) ?? []).join("\n");
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
        "verify",
        passed
          ? "DevCouncil pipeline completed with all gates passing."
          : `DevCouncil pipeline ended with ${verdict.blockingGaps.length} blocking gap(s) (exit ${code}).`,
      );
      this.finishRun(
        run,
        passed ? "completed" : "failed",
        passed ? undefined : (run.error ?? "DevCouncil pipeline did not pass"),
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
      failed ? "failed" : "completed",
      failed ? (run.error ?? `Process exited with code ${code}`) : undefined,
    );
  }

  private async startVerification(run: AgentRun, agent: AgentProfile): Promise<void> {
    run.status = "verifying";
    this.verifyBuffers.set(run.id, []);
    this.pushEvent(run, "verify", "Running DevCouncil verification gate (dev check --verify)…");
    this.upsert(run);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const context = this.runContext.get(run.id);
      const verifyDir = run.worktreePath ?? context?.agent.workingDir ?? agent.workingDir;
      await invoke("agent_run_start", {
        runId: run.id,
        mode: "devcouncil-verify",
        prompt: "verify",
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
        "verify",
        `DevCouncil gate skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.finishRun(run, run.error ? "failed" : "completed", run.error);
    }
  }

  private spawnPolicyParams(agent: AgentProfile, task?: Task) {
    const stats = getAgentDailyStats(agent.id, this.getRuns());
    return {
      dailyCostCapUsd: agent.dailyCostCapUsd ?? null,
      maxRunsPerDay: agent.maxRunsPerDay ?? null,
      todaySpendUsd: stats.spendUsd,
      todayRunCount: stats.runCount,
      modelRouting: agent.modelRouting ?? "fixed",
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

  private createRun(task: Task, agent: AgentProfile, status: AgentRun["status"]): AgentRun {
    const run: AgentRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      agentId: agent.id,
      status,
      createdAt: new Date(),
      events: [],
    };
    this.runContext.set(run.id, { task, agent });
    agentScopeService.bindTaskScopeToRun(run.id, task.id);
    return run;
  }

  private finishRun(run: AgentRun, status: AgentRun["status"], error?: string): void {
    run.status = status;
    run.error = error;
    run.isPaused = false;
    run.finishedAt = new Date();
    void agentMcpService.cleanup(run.id);
    void this.refreshGitDiff(run);
    this.upsert(run);
    this.releaseAgent(run);

    const context = this.runContext.get(run.id);
    if (context) {
      // Compound a skill from every successful run (fire-and-forget).
      if (status === "completed") {
        void agentSkillsService.captureFromRun(run, context.task, context.agent.workingDir);
      }
      this.hooks.onRunFinished?.(context.task.id, run);
    }
  }

  private async refreshGitDiff(run: AgentRun): Promise<void> {
    if (!run.worktreePath || !isTauri()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const diff = await invoke<{ diff: string }>("agent_git_diff", {
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

    const nextIndex = this.queue.findIndex((q) => q.agent.id === agentId);
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
    this.listeners.forEach((l) => l(snapshot));
    if (isTauri()) {
      const active = snapshot.filter(
        (r) => r.status === "queued" || r.status === "running" || r.status === "verifying",
      ).length;
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("tray_update_active_runs", { count: active }))
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
      events: (raw.events ?? []).map((e) => ({ ...e, ts: new Date(e.ts) })),
    };
  }
}

export const agentRunService = new AgentRunService();
export default agentRunService;
