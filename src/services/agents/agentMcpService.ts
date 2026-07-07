import { STORAGE_KEYS } from "../../constants";
import { localApi } from "../../core/api/localApi";
import { validateTransition } from "../../core/board/boardStateMachine";
import { isTauri } from "../../runtime/runtimeEnvironment";
import deadLetterService from "../deadLetterService";
import storageService from "../storageService";
import type { ActivityItem, AgentRun, BoardColumn, Task } from "../../../types";
import { generateTaskId } from "../../utils/taskUtils";
import agentScopeService from "./agentScopeService";

export interface McpToolRequest {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  taskId: string;
  runId: string;
}

/** Pending permission decision surfaced to the UI. */
export interface AgentPermissionRequest {
  requestId: string;
  runId: string;
  taskId: string;
  toolUseId: string;
  toolName: string;
  input: unknown;
  receivedAt: Date;
}

type PermissionListener = (requests: AgentPermissionRequest[]) => void;
type DecisionWaiter = (approved: boolean) => void;

export interface AgentMcpHooks {
  getTask: (taskId: string) => Task | undefined;
  getColumns: () => BoardColumn[];
  updateTask: (
    taskId: string,
    updates: Partial<Task>,
    options?: { actorLabel?: string },
  ) => void;
  createTask: (task: Partial<Task> & { title: string; projectId: string }) => Task | null;
  /** Runs for a task (newest last) — powers worktree state + completion checks. */
  getRunsForTask?: (taskId: string) => AgentRun[];
}

/**
 * A deliberate rejection (state-machine denial, missing argument, verification
 * failure) — reported to the agent as a tool error but NOT dead-lettered,
 * since retrying the identical call can never succeed.
 */
export class McpDenial extends Error {}

/** Build the JSON payload Claude Code expects from `--permission-prompt-tool`. */
export function buildPermissionResponse(
  approved: boolean,
  input: unknown,
): { content: unknown } {
  const payload = approved
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny" };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

/** Extract a `file_path`/`filePath` string from a tool-call input, if present. */
export function extractFilePath(input: unknown): string | undefined {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const filePath = obj.file_path ?? obj.filePath;
  return filePath ? String(filePath) : undefined;
}

/**
 * Best-effort guess at whether a tool call is a write/edit/delete-style
 * operation that should be checked against DevCouncil's scope whitelist.
 * False-negatives are safer than false-positives here — this is an additive
 * safety net, not the only gate.
 */
export function isMutatingToolCall(toolName: string, filePath: string | undefined): boolean {
  const lower = toolName.toLowerCase();
  return (
    Boolean(filePath) ||
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("delete")
  );
}

/** Human-readable summary for permission UI. */
export function describePermissionInput(
  toolName: string,
  input: unknown,
): { summary: string; detail: string } {
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const lower = toolName.toLowerCase();

  if (lower.includes("bash") || "command" in obj) {
    const cmd = String(obj.command ?? obj.cmd ?? "").trim();
    return {
      summary: cmd.slice(0, 160) || "Shell command",
      detail: cmd || JSON.stringify(input, null, 2),
    };
  }

  const filePath = extractFilePath(input);
  if (filePath) {
    return {
      summary: `${toolName}: ${filePath}`,
      detail: JSON.stringify(obj, null, 2).slice(0, 1200),
    };
  }

  const text = JSON.stringify(input, null, 2);
  return {
    summary: `${toolName} action`,
    detail: text.slice(0, 1200),
  };
}

/**
 * Polls the file-based MCP bridge directory during agent runs and applies
 * board mutations (update_status, post_comment, create_subtask, report_blocker).
 */
class AgentMcpService {
  private hooks: AgentMcpHooks | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeDirs = new Map<string, string>();
  private pendingPermissions: AgentPermissionRequest[] = [];
  private permissionListeners = new Set<PermissionListener>();
  private decisionWaiters = new Map<string, DecisionWaiter>();
  /** Tracks in-flight permission_prompt handlers so cleanup can deny them. */
  private processingRuns = new Set<string>();
  /** Runs cancelled/finished — new permission prompts auto-deny. */
  private deniedRuns = new Set<string>();
  /**
   * In-memory cache for the DevCouncil CLI availability probe. The probe is a
   * cheap PATH lookup, but there is no reason to re-invoke it on every single
   * run start — installation state doesn't change mid-session.
   */
  private devCliAvailableCache: Promise<boolean> | null = null;

  constructor() {
    // DLQ retry strategy for failed board mutations: re-run the tool with the
    // original arguments. `retry-` request ids skip re-dead-lettering so a
    // failed retry updates the existing letter instead of spawning a new one.
    deadLetterService.registerRetryHandler("mcp-action", async (letter) => {
      const p = letter.payload as {
        tool?: string;
        args?: Record<string, unknown>;
        taskId?: string;
        runId?: string;
      };
      if (!p.tool || !p.taskId) throw new Error("Dead letter is missing tool parameters.");
      const response = await this.handleTool({
        requestId: `retry-${letter.id}`,
        tool: p.tool,
        args: p.args ?? {},
        taskId: p.taskId,
        runId: p.runId ?? "",
      });
      if (response.error) throw new Error(response.error);
    });
  }

  setHooks(hooks: AgentMcpHooks): void {
    this.hooks = hooks;
  }

  /** Tool handlers only run after handleTool's `!this.hooks` guard, so this is always set there. */
  private get requireHooks(): AgentMcpHooks {
    if (!this.hooks) throw new Error("MCP hooks not configured");
    return this.hooks;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingPermissions];
  }

  getPendingPermissionsForRun(runId: string): AgentPermissionRequest[] {
    return this.pendingPermissions.filter((p) => p.runId === runId);
  }

  subscribePermissions(listener: PermissionListener): () => void {
    this.permissionListeners.add(listener);
    listener(this.getPendingPermissions());
    return () => this.permissionListeners.delete(listener);
  }

  isAutoApproveEnabled(): boolean {
    return storageService.get<boolean>(STORAGE_KEYS.AGENT_AUTO_APPROVE_PERMISSIONS, false) === true;
  }

  setAutoApproveEnabled(enabled: boolean): void {
    void storageService.set(STORAGE_KEYS.AGENT_AUTO_APPROVE_PERMISSIONS, enabled);
  }

  /** User approved or denied a pending permission request. */
  respondToPermission(requestId: string, approved: boolean): void {
    const waiter = this.decisionWaiters.get(requestId);
    if (!waiter) return;
    this.decisionWaiters.delete(requestId);
    waiter(approved);
  }

  /** Deny all pending permission prompts for a run (cancel / cleanup). */
  denyAllForRun(runId: string): void {
    this.deniedRuns.add(runId);
    for (const pending of this.pendingPermissions.filter((p) => p.runId === runId)) {
      this.respondToPermission(pending.requestId, false);
    }
    for (const [requestId] of this.decisionWaiters) {
      const pending = this.pendingPermissions.find((p) => p.requestId === requestId);
      if (pending?.runId === runId) {
        this.respondToPermission(requestId, false);
      }
    }
  }

  async initForRun(runId: string, taskId: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    const mcpDir = await invoke<string>("agent_mcp_init", { runId, taskId });
    this.activeDirs.set(runId, mcpDir);
    this.ensurePolling();
    return mcpDir;
  }

  /**
   * Build the mcpServers map every agent run gets: the LiquiTask board bridge
   * (update_status / complete_task / post_comment / …) plus, when the CLI is
   * installed, DevCouncil's own MCP server for the checkout→verify→repair loop.
   */
  private async buildMcpServers(
    runId: string,
    taskId: string,
    workingDir?: string,
    probeCliForDevcouncil = true,
  ): Promise<Record<string, unknown> | null> {
    const mcpDir = await this.initForRun(runId, taskId);
    if (!mcpDir) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    const bridgePath = await invoke<string>("agent_mcp_resolve_bridge");
    if (!bridgePath) return null;
    const mcpServers: Record<string, unknown> = {
      liquitask: {
        command: "node",
        args: [bridgePath],
        env: {
          LIQUITASK_MCP_DIR: mcpDir,
          LIQUITASK_TASK_ID: taskId,
          LIQUITASK_RUN_ID: runId,
        },
      },
    };

    // Only self-serve DevCouncil's checkout/verify/repair loop (Rework Plan
    // §3.4 item 5) when the CLI is actually installed — otherwise this would
    // register an MCP server pointing at a binary that doesn't exist, which
    // is a noisy startup failure for users who never touched DevCouncil.
    //
    // Invocation matches DevCouncil's own `claude mcp add` wiring
    // (`_server_args` in devcouncil/integrations/clients/common.py, consumed
    // by claude.py/codex.py/gemini.py alike): the server name/binary is
    // `devcouncil`, args `["mcp-server"]`. `resolve_dev_cli()` on the Rust
    // side accepts either the `dev` or `devcouncil` console-script entry
    // point, but the CLI's own reference client integrations always spawn it
    // as `devcouncil mcp-server`, so we mirror that exactly here.
    if (workingDir && (!probeCliForDevcouncil || (await this.isDevCliAvailable()))) {
      mcpServers.devcouncil = {
        command: "devcouncil",
        args: ["mcp-server"],
        env: {
          DEVCOUNCIL_PROJECT_ROOT: workingDir,
        },
      };
    }

    return mcpServers;
  }

  /** Legacy claude runner path: write the config file and return its path. */
  async prepareMcpConfig(
    runId: string,
    taskId: string,
    workingDir?: string,
  ): Promise<string | null> {
    if (!isTauri()) return null;
    const mcpServers = await this.buildMcpServers(runId, taskId, workingDir);
    if (!mcpServers) return null;
    const mcpDir = this.activeDirs.get(runId);
    if (!mcpDir) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<string>("agent_mcp_write_config", {
      mcpDir,
      configJson: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  /**
   * agentd path: the sidecar takes the config as a JSON string on run.start
   * and renders it into each runtime's native MCP format (Claude flag file,
   * .cursor/mcp.json, Codex config.toml, openclaw wrapper, …) — this is how
   * all 14 runtimes get the board bridge, not just Claude Code.
   */
  async prepareAgentdMcpConfig(
    runId: string,
    taskId: string,
    devcouncilDir?: string,
  ): Promise<string | undefined> {
    if (!isTauri()) return undefined;
    try {
      // devcouncilDir is pre-verified by the caller (.devcouncil/config.yaml
      // probe), so skip the CLI PATH probe — parity with the old agentd path.
      const mcpServers = await this.buildMcpServers(runId, taskId, devcouncilDir, false);
      if (!mcpServers) return undefined;
      return JSON.stringify({ mcpServers });
    } catch (err) {
      console.warn("agentd MCP config unavailable:", err);
      return undefined;
    }
  }

  /**
   * Cheap, cached check for whether the DevCouncil CLI is installed. Result is
   * memoized in-memory for the lifetime of the app session so repeated run
   * starts don't re-probe PATH every time.
   */
  private async isDevCliAvailable(): Promise<boolean> {
    if (!this.devCliAvailableCache) {
      this.devCliAvailableCache = import("../nativeBridge")
        .then(({ nativeDevCliAvailable }) => nativeDevCliAvailable())
        .catch(() => false);
    }
    return this.devCliAvailableCache;
  }

  async cleanup(runId: string): Promise<void> {
    this.denyAllForRun(runId);
    this.removePendingForRun(runId);
    agentScopeService.clearScopeForRun(runId);
    const mcpDir = this.activeDirs.get(runId);
    if (!mcpDir || !isTauri()) {
      this.deniedRuns.delete(runId);
      return;
    }
    this.activeDirs.delete(runId);
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("agent_mcp_cleanup", { mcpDir }).catch(() => undefined);
    this.deniedRuns.delete(runId);
    if (this.activeDirs.size === 0) this.stopPolling();
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.pollAll(), 150);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollAll(): Promise<void> {
    if (!this.hooks || !isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    for (const [, mcpDir] of this.activeDirs) {
      try {
        const requests = await invoke<McpToolRequest[]>("agent_mcp_list_requests", { mcpDir });
        for (const req of requests ?? []) {
          if (req.tool === "permission_prompt") {
            void this.processPermissionPrompt(mcpDir, req);
          } else {
            const response = await this.handleTool(req);
            await invoke("agent_mcp_write_response", {
              mcpDir,
              requestId: req.requestId,
              response,
            });
          }
        }
      } catch {
        // One broken bridge dir must not stall polling for the other runs.
      }
    }
  }

  private async handleTool(req: McpToolRequest): Promise<{ content?: unknown; error?: string }> {
    if (!this.hooks) return { error: "MCP hooks not configured" };
    const task = this.hooks.getTask(req.taskId);
    if (!task) return { error: `Task ${req.taskId} not found` };

    try {
      switch (req.tool) {
        case "get_task":
          return this.toolGetTask(task);
        case "update_status":
          return this.toolUpdateStatus(task, req.args, req.runId);
        case "complete_task":
          return await this.toolCompleteTask(task, req.args, req.runId);
        case "get_worktree_state":
          return await this.toolGetWorktreeState(task);
        case "post_comment":
          return this.toolPostComment(task, req.args);
        case "create_subtask":
          return this.toolCreateSubtask(task, req.args);
        case "toggle_subtask":
          return this.toolToggleSubtask(task, req.args);
        case "report_blocker":
          return this.toolReportBlocker(task, req.args);
        default:
          return { error: `Unknown tool: ${req.tool}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Infrastructure failures on mutating tools are dead-lettered so a
      // broken board write can be retried from the Inbox instead of silently
      // vanishing mid-run. Deliberate denials (McpDenial) are not — retrying
      // an identical rejected call can never succeed.
      if (
        !(err instanceof McpDenial) &&
        !req.requestId.startsWith("retry-") &&
        ["update_status", "complete_task", "create_subtask", "toggle_subtask"].includes(req.tool)
      ) {
        deadLetterService.record({
          kind: "mcp-action",
          taskId: req.taskId,
          runId: req.runId,
          title: `Agent action failed: ${req.tool}`,
          detail: message,
          payload: { tool: req.tool, args: req.args, taskId: req.taskId, runId: req.runId },
        });
      }
      return { error: message };
    }
  }

  /** Latest run for a task that owns a worktree (active first, then newest). */
  private worktreeRunForTask(taskId: string): AgentRun | undefined {
    const runs = this.hooks?.getRunsForTask?.(taskId) ?? [];
    const withWorktree = runs.filter((r) => r.worktreePath && r.gitBranch);
    return (
      withWorktree.find((r) => r.status === "running" || r.status === "verifying") ??
      withWorktree[withWorktree.length - 1]
    );
  }

  /** Derive the repo root from a worktree path (`<repo>/.worktrees/<runId>`). */
  private repoDirFromWorktree(worktreePath: string): string | undefined {
    for (const marker of ["/.worktrees/", "\\.worktrees\\"]) {
      const idx = worktreePath.indexOf(marker);
      if (idx > 0) return worktreePath.slice(0, idx);
    }
    return undefined;
  }

  /**
   * MCP `get_worktree_state`: lets the agent inspect its isolated worktree —
   * branch, dirty files, commits ahead — before claiming completion.
   */
  private async toolGetWorktreeState(task: Task): Promise<{ content: unknown }> {
    const run = this.worktreeRunForTask(task.id);
    if (!run?.worktreePath) {
      return {
        content: [
          {
            type: "text",
            text: "No isolated worktree is attached to this task (the run works directly in the repo).",
          },
        ],
      };
    }
    const repoDir = this.repoDirFromWorktree(run.worktreePath);
    if (!repoDir || !isTauri()) {
      return { content: [{ type: "text", text: "Worktree state unavailable." }] };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const state = await invoke<Record<string, unknown>>("agent_git_worktree_state", {
      repoDir,
      worktreePath: run.worktreePath,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { ...state, runStatus: run.status, board: { taskStatus: task.status } },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async processPermissionPrompt(mcpDir: string, req: McpToolRequest): Promise<void> {
    if (this.processingRuns.has(req.requestId)) return;
    this.processingRuns.add(req.requestId);

    const toolUseId = String(req.args.tool_use_id ?? req.args.toolUseId ?? "");
    const toolName = String(req.args.tool_name ?? req.args.toolName ?? "unknown");
    const input = req.args.input ?? req.args;

    const runAlreadyDenied = this.deniedRuns.has(req.runId);
    const autoApprove = !runAlreadyDenied && this.isAutoApproveEnabled();

    // DevCouncil scope enforcement: an additive safety net on top of the
    // approve/deny decision above. A run with no registered scope (i.e. the
    // task was never DevCouncil-planned) is always in-scope, so this is a
    // no-op for the vast majority of runs.
    const filePath = extractFilePath(input);
    let scopeDenialReason: string | undefined;
    if (isMutatingToolCall(toolName, filePath) && filePath) {
      const operation = toolName.toLowerCase().includes("delete") ? "delete" : "write";
      const scopeCheck = agentScopeService.checkPath(req.runId, filePath, operation);
      if (!scopeCheck.inScope) {
        scopeDenialReason = scopeCheck.reason ?? `${filePath} is outside the planned file scope.`;
      }
    }

    const pending: AgentPermissionRequest = {
      requestId: req.requestId,
      runId: req.runId,
      taskId: req.taskId,
      toolUseId,
      toolName,
      input,
      receivedAt: new Date(),
    };
    if (!runAlreadyDenied && !autoApprove && !scopeDenialReason) {
      this.pendingPermissions.push(pending);
      if (this.pendingPermissions.length > 50) {
        this.pendingPermissions.splice(0, this.pendingPermissions.length - 50);
      }
      this.notifyPermissionListeners();
    }

    const decided = runAlreadyDenied
      ? false
      : scopeDenialReason
        ? false
        : autoApprove
          ? true
          : await this.waitForUserDecision(req.requestId);

    // Scope denial overrides any approval, including auto-approve — it is
    // enforced unconditionally regardless of how the decision above resolved.
    const approved = scopeDenialReason ? false : decided;

    this.removePending(req.requestId);
    this.notifyPermissionListeners();

    const response = buildPermissionResponse(approved, input);
    const { summary } = describePermissionInput(toolName, input);

    const task = this.hooks?.getTask(req.taskId);
    if (task) {
      const verb = scopeDenialReason
        ? "denied (out of DevCouncil scope)"
        : runAlreadyDenied
          ? "denied (run ended)"
          : autoApprove
            ? "auto-approved"
            : approved
              ? "approved"
              : "denied";
      const detail = scopeDenialReason
        ? `${verb} ${toolName}: ${scopeDenialReason.slice(0, 200)}`
        : `${verb} ${toolName}: ${summary.slice(0, 200)}`;
      this.requireHooks.updateTask(task.id, {
        activity: [
          ...(task.activity ?? []),
          activity("agent-permission", detail),
        ],
      });
    }

    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("agent_mcp_write_response", {
          mcpDir,
          requestId: req.requestId,
          response,
        });
      }
    } finally {
      this.processingRuns.delete(req.requestId);
    }
  }

  /**
   * Surface a permission request coming from a liquitask-agentd run through
   * the same pending store / listener pipeline as the file-bridge prompts, so
   * the UI treats both engines identically. The decision is routed back over
   * JSON-RPC (`permission.respond`) instead of the MCP response file, and the
   * same gates apply: denied-run auto-deny, auto-approve setting, and the
   * DevCouncil scope check (which overrides any approval).
   */
  registerAgentdPermission(req: {
    runId: string;
    taskId: string;
    requestId: string;
    /** Sidecar run id — what agentd keys `permission.respond` by. */
    agentdRunId: string;
    toolName: string;
    input: unknown;
  }): void {
    if (this.processingRuns.has(req.requestId)) return;
    this.processingRuns.add(req.requestId);

    const runAlreadyDenied = this.deniedRuns.has(req.runId);
    const autoApprove = !runAlreadyDenied && this.isAutoApproveEnabled();

    const filePath = extractFilePath(req.input);
    let scopeDenialReason: string | undefined;
    if (isMutatingToolCall(req.toolName, filePath) && filePath) {
      const operation = req.toolName.toLowerCase().includes("delete") ? "delete" : "write";
      const scopeCheck = agentScopeService.checkPath(req.runId, filePath, operation);
      if (!scopeCheck.inScope) {
        scopeDenialReason = scopeCheck.reason ?? `${filePath} is outside the planned file scope.`;
      }
    }

    const respond = (approved: boolean) => {
      this.removePending(req.requestId);
      this.notifyPermissionListeners();
      this.processingRuns.delete(req.requestId);
      void localApi
        .permissionRespond(req.agentdRunId, req.requestId, approved ? "allow" : "deny")
        .catch(() => undefined);
    };

    if (runAlreadyDenied || scopeDenialReason) {
      respond(false);
      return;
    }
    if (autoApprove) {
      respond(true);
      return;
    }

    this.pendingPermissions.push({
      requestId: req.requestId,
      runId: req.runId,
      taskId: req.taskId,
      toolUseId: req.requestId,
      toolName: req.toolName,
      input: req.input,
      receivedAt: new Date(),
    });
    if (this.pendingPermissions.length > 50) {
      this.pendingPermissions.splice(0, this.pendingPermissions.length - 50);
    }
    this.decisionWaiters.set(req.requestId, respond);
    this.notifyPermissionListeners();
  }

  private waitForUserDecision(requestId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.decisionWaiters.set(requestId, resolve);
    });
  }

  private removePending(requestId: string): void {
    this.pendingPermissions = this.pendingPermissions.filter((p) => p.requestId !== requestId);
    this.decisionWaiters.delete(requestId);
  }

  private removePendingForRun(runId: string): void {
    const removedIds = this.pendingPermissions
      .filter((p) => p.runId === runId)
      .map((p) => p.requestId);
    this.pendingPermissions = this.pendingPermissions.filter((p) => p.runId !== runId);
    for (const requestId of removedIds) {
      this.decisionWaiters.delete(requestId);
    }
  }

  private notifyPermissionListeners(): void {
    const snapshot = this.getPendingPermissions();
    this.permissionListeners.forEach((l) => {
      l(snapshot);
    });
  }

  /** Board snapshot for the agent: its task, subtasks, and the column layout. */
  private toolGetTask(task: Task): { content: unknown } {
    const columns = this.requireHooks.getColumns();
    const snapshot = {
      id: task.id,
      jobId: task.jobId,
      title: task.title,
      summary: task.summary,
      status: task.status,
      priority: task.priority,
      tags: task.tags,
      subtasks: (task.subtasks ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        completed: s.completed,
      })),
      columns: columns.map((c) => ({
        id: c.id,
        title: c.title,
        terminal: Boolean(c.isCompleted),
      })),
    };
    return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
  }

  private resolveColumn(statusInput: string) {
    const columns = this.requireHooks.getColumns();
    return (
      columns.find((c) => c.id === statusInput) ??
      columns.find((c) => c.title.toLowerCase() === statusInput.toLowerCase())
    );
  }

  private toolUpdateStatus(
    task: Task,
    args: Record<string, unknown>,
    runId?: string,
  ): { content: unknown } {
    const statusInput = String(args.status ?? "").trim();
    if (!statusInput) throw new Error("status is required");
    const col = this.resolveColumn(statusInput);
    if (!col) throw new Error(`Column not found: ${statusInput}`);
    // Agent-actor moves face the git-aligned board state machine directly, so
    // the agent gets the denial REASON back instead of a silent no-op.
    const verdict = validateTransition(task.status, col.id, { actor: "agent" });
    if (!verdict.allowed) {
      throw new McpDenial(
        `${verdict.reason ?? "Move rejected by the board state machine."} Board lifecycle: Task → In Progress → Completed → Commit.`,
      );
    }
    this.requireHooks.updateTask(
      task.id,
      {
        status: col.id,
        activity: [
          ...(task.activity ?? []),
          activity("agent-mcp", `moved card to ${col.title} via MCP`),
        ],
      },
      { actorLabel: runId ? `agent-mcp:${runId}` : "agent-mcp" },
    );
    return { content: [{ type: "text", text: `Status updated to ${col.title}` }] };
  }

  /**
   * Agent signals done — with context-aware verification before the card is
   * allowed into Completed:
   * 1. the board state machine must permit InProgress → Completed for agents;
   * 2. when the run owns an isolated worktree, it must actually CONTAIN work
   *    (dirty files or commits ahead) unless the agent explicitly declares
   *    `no_changes: true`;
   * 3. open subtasks are surfaced back so the agent can finish or justify them.
   */
  private async toolCompleteTask(
    task: Task,
    args: Record<string, unknown>,
    runId?: string,
  ): Promise<{ content: unknown }> {
    const summary = String(args.summary ?? "").trim();
    const noChanges = args.no_changes === true || args.noChanges === true;
    const columns = this.requireHooks.getColumns();
    const completedCol =
      columns.find((c) => c.id === "Completed" && !c.isCompleted) ??
      columns.find((c) => !c.isCompleted && c.title.toLowerCase() === "completed");
    if (!completedCol) throw new Error("No Completed column on this board.");

    const verdict = validateTransition(task.status, completedCol.id, { actor: "agent" });
    if (!verdict.allowed) {
      throw new McpDenial(verdict.reason ?? "Completion rejected by the board state machine.");
    }

    // Context-aware verification: an "empty" completion is usually an agent
    // that lost its way — require an explicit no-changes declaration.
    const run = this.worktreeRunForTask(task.id);
    if (run?.worktreePath && isTauri() && !noChanges) {
      const repoDir = this.repoDirFromWorktree(run.worktreePath);
      if (repoDir) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const state = await invoke<{ dirtyFiles: number; ahead: number; exists: boolean }>(
            "agent_git_worktree_state",
            { repoDir, worktreePath: run.worktreePath },
          );
          if (state.exists && state.dirtyFiles === 0 && state.ahead === 0) {
            throw new McpDenial(
              "Your worktree has no changes (no dirty files, no commits ahead). " +
                "If this task genuinely required no code changes, call complete_task again with no_changes: true and explain why in the summary.",
            );
          }
        } catch (err) {
          if (err instanceof McpDenial) throw err;
          // State probe failed (repo unauthorized etc.) — do not block completion.
        }
      }
    }

    const openSubtasks = (task.subtasks ?? []).filter((s) => !s.completed);
    this.requireHooks.updateTask(
      task.id,
      {
        status: completedCol.id,
        activity: [
          ...(task.activity ?? []),
          activity(
            "agent-mcp",
            summary
              ? `marked the task completed via MCP: ${summary.slice(0, 800)}`
              : "marked the task completed via MCP.",
          ),
        ],
      },
      { actorLabel: runId ? `agent-mcp:${runId}` : "agent-mcp" },
    );
    const subtaskNote =
      openSubtasks.length > 0
        ? ` Note: ${openSubtasks.length} subtask(s) are still open (${openSubtasks
            .slice(0, 3)
            .map((s) => s.title)
            .join(", ")}${openSubtasks.length > 3 ? ", …" : ""}) — the reviewer will see them.`
        : "";
    return {
      content: [
        {
          type: "text",
          text: `Task moved to ${completedCol.title}. A human will review the diff and commit it from the board.${subtaskNote}`,
        },
      ],
    };
  }

  private toolToggleSubtask(task: Task, args: Record<string, unknown>): { content: unknown } {
    const needle = String(args.subtask ?? args.title ?? args.id ?? "").trim();
    if (!needle) throw new Error("subtask (id or title) is required");
    const lower = needle.toLowerCase();
    const target = (task.subtasks ?? []).find(
      (s) => s.id === needle || s.title.toLowerCase() === lower,
    );
    if (!target) throw new Error(`Subtask not found: ${needle}`);
    const completed = args.completed === undefined ? !target.completed : Boolean(args.completed);
    this.requireHooks.updateTask(task.id, {
      subtasks: (task.subtasks ?? []).map((s) =>
        s.id === target.id ? { ...s, completed } : s,
      ),
      activity: [
        ...(task.activity ?? []),
        activity("agent-mcp", `${completed ? "checked off" : "reopened"} subtask: ${target.title}`),
      ],
    });
    return {
      content: [{ type: "text", text: `Subtask "${target.title}" ${completed ? "completed" : "reopened"}` }],
    };
  }

  private toolPostComment(task: Task, args: Record<string, unknown>): { content: unknown } {
    const comment = String(args.comment ?? "").trim();
    if (!comment) throw new Error("comment is required");
    this.requireHooks.updateTask(task.id, {
      activity: [...(task.activity ?? []), activity("agent-mcp", comment)],
    });
    return { content: [{ type: "text", text: "Comment posted" }] };
  }

  private toolCreateSubtask(task: Task, args: Record<string, unknown>): { content: unknown } {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const subtask = { id: generateTaskId(), title, completed: false };
    this.requireHooks.updateTask(task.id, {
      subtasks: [...(task.subtasks ?? []), subtask],
      activity: [...(task.activity ?? []), activity("agent-mcp", `added subtask: ${title}`)],
    });
    return { content: [{ type: "text", text: `Subtask created: ${title}` }] };
  }

  private toolReportBlocker(task: Task, args: Record<string, unknown>): { content: unknown } {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const description = String(args.description ?? "").trim();
    const created = this.requireHooks.createTask({
      title,
      summary: description || `Blocker reported while working ${task.jobId || task.id}`,
      projectId: task.projectId,
      assignee: task.assignee,
      priority: task.priority,
      links: [{ targetTaskId: task.id, type: "blocked-by" }],
      tags: [...(task.tags ?? []), "blocker"],
    });
    if (!created) throw new Error("Failed to create blocker task");
    this.requireHooks.updateTask(task.id, {
      links: [...(task.links ?? []), { targetTaskId: created.id, type: "blocked-by" }],
      activity: [...(task.activity ?? []), activity("agent-mcp", `reported blocker: ${title}`)],
    });
    return {
      content: [{ type: "text", text: `Blocker task created: ${created.jobId || created.id}` }],
    };
  }
}

function activity(userId: string, details: string): ActivityItem {
  return {
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "comment",
    timestamp: new Date(),
    userId,
    details,
  };
}

export const agentMcpService = new AgentMcpService();
export default agentMcpService;
