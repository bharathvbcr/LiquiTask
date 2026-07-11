import { STORAGE_KEYS } from "../../constants";
import { localApi } from "../../core/api/localApi";
import { validateTransition } from "../../core/board/boardStateMachine";
import { isTauri } from "../../runtime/runtimeEnvironment";
import deadLetterService from "../deadLetterService";
import storageService from "../storageService";
import type { ActivityItem, AgentRun, BoardColumn, Task } from "../../../types";
import { asString } from "../../utils/coerce";
import { generateTaskId } from "../../utils/taskUtils";
import agentRunService from "./agentRunService";
import agentScopeService from "./agentScopeService";
import agentService from "./agentService";
import userMcpConfigService from "./userMcpConfigService";

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
  /** Sidecar run id — set for agentd prompts; used when routing `permission.respond`. */
  agentdRunId?: string;
  /** Binds user approval to the exact tool input (SEC-11). */
  inputDigest?: string;
}

export type PermissionResponseDecision = "allow" | "deny" | "always";

type PermissionListener = (requests: AgentPermissionRequest[]) => void;
type DecisionWaiter = (decision: PermissionResponseDecision) => void;

export interface AgentMcpHooks {
  getTask: (taskId: string) => Task | undefined;
  getTasks?: () => Task[];
  getColumns: () => BoardColumn[];
  updateTask: (
    taskId: string,
    updates: Partial<Task>,
    options?: { actorLabel?: string },
  ) => void;
  createTask: (task: Partial<Task> & { title: string; projectId: string }) => Task | null;
  /** Runs for a task (newest last) — powers worktree state + completion checks. */
  getRunsForTask?: (taskId: string) => AgentRun[];
  /** Dispatch a task to an agent (meta-agent orchestration). */
  dispatchTask?: (taskId: string, agentName: string) => Promise<string>;
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
 *
 * Bash/shell commands without an explicit file path are treated as mutating so
 * they always surface through the permission prompt when scope is active.
 */
export function isMutatingToolCall(
  toolName: string,
  filePath: string | undefined,
  input?: unknown,
): boolean {
  const lower = toolName.toLowerCase();
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const hasShellCommand = isShellTool(toolName, input);
  return (
    Boolean(filePath) ||
    hasShellCommand ||
    lower.includes("write") ||
    lower.includes("edit") ||
    lower.includes("delete")
  );
}

/** Dummy file_path values must not bypass the shell-must-prompt rule. */
export function isCredibleFilePathForShellBypass(filePath: string | undefined): boolean {
  if (!filePath) return false;
  const p = filePath.trim();
  if (p.length < 2) return false;
  const lower = p.toLowerCase();
  if ([".", "..", "n/a", "none", "null", "undefined", "/tmp", "tmp"].includes(lower)) {
    return false;
  }
  return p.includes("/") || p.includes("\\") || p.startsWith(".");
}

/** Shell/Bash tool calls that may bypass file-path scope unless gated. */
export function isShellTool(toolName: string, input?: unknown): boolean {
  const lower = toolName.toLowerCase();
  const obj =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return lower.includes("bash") || "command" in obj || "cmd" in obj;
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
  private activeBindings = new Map<
    string,
    { mcpDir: string; taskId: string; runId: string }
  >();
  private activeRuns = new Set<string>();
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
    this.loadPendingPermissions();
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
      if (this.isMcpActionAlreadyApplied(p)) return;
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

  /** User approved, denied, or always-allowed a pending permission request. */
  respondToPermission(requestId: string, decision: PermissionResponseDecision): void {
    if (decision === "always") {
      const pending = this.pendingPermissions.find((p) => p.requestId === requestId);
      if (pending) {
        void this.persistAlwaysToolPolicy(pending.runId, pending.toolName);
      }
    }

    const waiter = this.decisionWaiters.get(requestId);
    if (!waiter) return;
    this.decisionWaiters.delete(requestId);
    waiter(decision);
  }

  /** Approve, deny, or always-allow multiple permission requests in one action. */
  respondToPermissions(requestIds: string[], decision: PermissionResponseDecision): void {
    for (const requestId of requestIds) {
      this.respondToPermission(requestId, decision);
    }
  }

  /** Approve, deny, or always-allow every pending permission across all runs. */
  respondToAllPending(decision: PermissionResponseDecision): void {
    const ids = this.pendingPermissions.map((p) => p.requestId);
    this.respondToPermissions(ids, decision);
  }

  /** Deny all pending permission prompts for a run (cancel / cleanup). */
  denyAllForRun(runId: string): void {
    this.deniedRuns.add(runId);
    for (const pending of this.pendingPermissions.filter((p) => p.runId === runId)) {
      this.respondToPermission(pending.requestId, "deny");
    }
    for (const [requestId] of this.decisionWaiters) {
      const pending = this.pendingPermissions.find((p) => p.requestId === requestId);
      if (pending?.runId === runId) {
        this.respondToPermission(requestId, "deny");
      }
    }
  }

  async initForRun(runId: string, taskId: string): Promise<string | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    const init = await invoke<{ mcpDir: string }>("agent_mcp_init", {
      runId,
      taskId,
    });
    this.activeBindings.set(runId, {
      mcpDir: init.mcpDir,
      taskId,
      runId,
    });
    this.activeRuns.add(runId);
    this.ensurePolling();
    return init.mcpDir;
  }

  /** Ignore request-supplied ids — bridge dirs are bound at init time. */
  private bindRequest(mcpDir: string, req: McpToolRequest): McpToolRequest | null {
    for (const binding of this.activeBindings.values()) {
      if (binding.mcpDir === mcpDir) {
        return { ...req, taskId: binding.taskId, runId: binding.runId };
      }
    }
    return null;
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
    if (!this.activeRuns.has(runId)) return null;
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
      const { invoke } = await import("@tauri-apps/api/core");
      const devCliPath = await invoke<string | null>("agent_resolve_dev_cli_path");
      const command = devCliPath?.trim() || "devcouncil";
      mcpServers.devcouncil = {
        command,
        args: ["mcp-server"],
        env: {
          DEVCOUNCIL_PROJECT_ROOT: workingDir,
        },
      };
    }

    for (const userServer of userMcpConfigService.getEnabledUserMcpServers()) {
      mcpServers[userServer.name] = userMcpConfigService.userMcpServerToConfigEntry(userServer);
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
    const mcpDir = this.activeBindings.get(runId)?.mcpDir;
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
   * all 15 runtimes get the board bridge, not just Claude Code.
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
    const binding = this.activeBindings.get(runId);
    this.activeBindings.delete(runId);
    this.activeRuns.delete(runId);
    if (!binding?.mcpDir || !isTauri()) {
      this.deniedRuns.delete(runId);
      if (this.activeBindings.size === 0) this.stopPolling();
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("agent_mcp_cleanup", { mcpDir: binding.mcpDir }).catch(() => undefined);
    this.deniedRuns.delete(runId);
    if (this.activeBindings.size === 0) this.stopPolling();
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
    for (const [, binding] of this.activeBindings) {
      try {
        const requests = await invoke<McpToolRequest[]>("agent_mcp_list_requests", {
          mcpDir: binding.mcpDir,
        });
        for (const rawReq of requests ?? []) {
          const req = this.bindRequest(binding.mcpDir, rawReq);
          if (!req) continue;
          if (req.tool === "permission_prompt") {
            void this.processPermissionPrompt(binding.mcpDir, req);
          } else {
            const response = await this.handleTool(req);
            await invoke("agent_mcp_write_response", {
              mcpDir: binding.mcpDir,
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
        case "board_list":
          return this.toolBoardList(req.args);
        case "board_show":
          return this.toolBoardShow(req.args);
        case "board_create":
          return this.toolBoardCreate(req.args);
        case "board_assign":
          return this.toolBoardAssign(req.args);
        case "board_dispatch":
          return await this.toolBoardDispatch(req.args);
        case "board_reservations":
          return await this.toolBoardReservations();
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
    const filePath = extractFilePath(input);

    const runAlreadyDenied = this.deniedRuns.has(req.runId);
    const shellWithoutPath =
      isShellTool(toolName, input) &&
      !isCredibleFilePathForShellBypass(filePath);
    const autoApprove =
      !runAlreadyDenied && !shellWithoutPath && this.isAutoApproveEnabled();

    // DevCouncil scope enforcement: an additive safety net on top of the
    // approve/deny decision above. A run with no registered scope (i.e. the
    // task was never DevCouncil-planned) is always in-scope, so this is a
    // no-op for the vast majority of runs.
    let scopeDenialReason: string | undefined;
    if (isMutatingToolCall(toolName, filePath, input) && filePath) {
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
      ? ("deny" as PermissionResponseDecision)
      : scopeDenialReason
        ? ("deny" as PermissionResponseDecision)
        : autoApprove
          ? ("allow" as PermissionResponseDecision)
          : await this.waitForUserDecision(req.requestId);

    // Scope denial overrides any approval, including auto-approve — it is
    // enforced unconditionally regardless of how the decision above resolved.
    const approved = scopeDenialReason ? false : decided !== "deny";

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
            : decided === "always"
              ? "always allowed"
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
    inputDigest?: string;
  }): void {
    if (this.processingRuns.has(req.requestId)) return;
    this.processingRuns.add(req.requestId);

    const runAlreadyDenied = this.deniedRuns.has(req.runId);
    const filePath = extractFilePath(req.input);
    const shellWithoutPath = isShellTool(req.toolName, req.input) && !filePath;
    const autoApprove =
      !runAlreadyDenied && !shellWithoutPath && this.isAutoApproveEnabled();

    let scopeDenialReason: string | undefined;
    if (isMutatingToolCall(req.toolName, filePath, req.input) && filePath) {
      const operation = req.toolName.toLowerCase().includes("delete") ? "delete" : "write";
      const scopeCheck = agentScopeService.checkPath(req.runId, filePath, operation);
      if (!scopeCheck.inScope) {
        scopeDenialReason = scopeCheck.reason ?? `${filePath} is outside the planned file scope.`;
      }
    }

    const respond = (decision: PermissionResponseDecision) => {
      this.removePending(req.requestId);
      this.notifyPermissionListeners();
      this.processingRuns.delete(req.requestId);
      void localApi
        .permissionRespond(
          req.agentdRunId,
          req.requestId,
          decision === "deny" ? "deny" : decision === "always" ? "always" : "allow",
          req.inputDigest,
        )
        .catch(() => undefined);
    };

    if (runAlreadyDenied || scopeDenialReason) {
      respond("deny");
      return;
    }
    if (autoApprove) {
      respond("allow");
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
      agentdRunId: req.agentdRunId,
      inputDigest: req.inputDigest,
    });
    if (this.pendingPermissions.length > 50) {
      this.pendingPermissions.splice(0, this.pendingPermissions.length - 50);
    }
    this.decisionWaiters.set(req.requestId, respond);
    this.notifyPermissionListeners();
  }

  private waitForUserDecision(requestId: string): Promise<PermissionResponseDecision> {
    return new Promise((resolve) => {
      this.decisionWaiters.set(requestId, resolve);
    });
  }

  /** Persist an always-allow decision into the owning agent's toolPolicy. */
  private async persistAlwaysToolPolicy(runId: string, toolName: string): Promise<void> {
    const trimmed = toolName.trim();
    if (!trimmed) return;
    const run = agentRunService.getRuns().find((r) => r.id === runId);
    if (!run) return;
    const agent = agentService.getAgentById(run.agentId);
    if (!agent) return;
    const nextPolicy = { ...(agent.toolPolicy ?? {}), [trimmed]: "allow" as const };
    await agentService.saveAgent({ ...agent, toolPolicy: nextPolicy });
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

  private loadPendingPermissions(): void {
    const stored =
      storageService.get<
        Array<Omit<AgentPermissionRequest, "receivedAt"> & { receivedAt: string }>
      >(STORAGE_KEYS.AGENT_PENDING_PERMISSIONS, []) ?? [];
    this.pendingPermissions = stored.map((entry) => ({
      ...entry,
      receivedAt: new Date(entry.receivedAt),
    }));
  }

  private schedulePersistPermissions(): void {
    void storageService.set(
      STORAGE_KEYS.AGENT_PENDING_PERMISSIONS,
      this.pendingPermissions.map((entry) => ({
        ...entry,
        receivedAt: entry.receivedAt.toISOString(),
      })),
    );
  }

  private notifyPermissionListeners(): void {
    const snapshot = this.getPendingPermissions();
    this.permissionListeners.forEach((l) => {
      l(snapshot);
    });
    this.schedulePersistPermissions();
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
        title: asString(s.title),
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
    return this.resolveColumnForHooks(statusInput);
  }

  /** DLQ retry idempotency: skip board mutations already applied. */
  private isMcpActionAlreadyApplied(p: {
    tool?: string;
    args?: Record<string, unknown>;
    taskId?: string;
  }): boolean {
    if (!p.tool || !p.taskId || !this.hooks) return false;
    const task = this.hooks.getTask(p.taskId);
    if (!task) return false;
    if (p.tool === "complete_task") {
      const columns = this.hooks.getColumns();
      const completedCol =
        columns.find((c) => c.id === "Completed" && !c.isCompleted) ??
        columns.find((c) => !c.isCompleted && c.title.toLowerCase() === "completed");
      const commitCol =
        columns.find((c) => c.id === "Commit") ?? columns.find((c) => c.isCompleted);
      if (completedCol && task.status === completedCol.id) return true;
      if (commitCol && task.status === commitCol.id) return true;
    }
    if (p.tool === "update_status") {
      const statusInput = String(p.args?.status ?? "").trim();
      if (!statusInput) return false;
      const col = this.resolveColumnForHooks(statusInput);
      if (col && task.status === col.id) return true;
    }
    return false;
  }

  private resolveColumnForHooks(statusInput: string) {
    if (!this.hooks) return undefined;
    const columns = this.hooks.getColumns();
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
            .map((s) => asString(s.title))
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
    // Coerce the title: a subtask persisted with a non-string title (e.g. an
    // AI-generated `{ title }` object) would otherwise crash `.toLowerCase()`
    // and fail the whole agent action.
    const target = (task.subtasks ?? []).find(
      (s) => s.id === needle || asString(s?.title).toLowerCase() === lower,
    );
    if (!target) throw new Error(`Subtask not found: ${needle}`);
    const targetTitle = asString(target.title);
    const completed = args.completed === undefined ? !target.completed : Boolean(args.completed);
    this.requireHooks.updateTask(task.id, {
      subtasks: (task.subtasks ?? []).map((s) =>
        s.id === target.id ? { ...s, completed } : s,
      ),
      activity: [
        ...(task.activity ?? []),
        activity("agent-mcp", `${completed ? "checked off" : "reopened"} subtask: ${targetTitle}`),
      ],
    });
    return {
      content: [{ type: "text", text: `Subtask "${targetTitle}" ${completed ? "completed" : "reopened"}` }],
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

  private toolBoardList(args: Record<string, unknown>): { content: unknown } {
    const column = String(args.column ?? args.status ?? "").trim();
    const tasks = this.requireHooks.getTasks?.() ?? [];
    const columns = this.requireHooks.getColumns();
    const filtered = column
      ? tasks.filter((t) => {
          if (t.status === column) return true;
          const col = columns.find(
            (c) => c.id === t.status && c.title.toLowerCase() === column.toLowerCase(),
          );
          return Boolean(col);
        })
      : tasks;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            filtered.map((t) => ({
              id: t.id,
              jobId: t.jobId,
              title: t.title,
              status: t.status,
              assignee: t.assignee,
            })),
            null,
            2,
          ),
        },
      ],
    };
  }

  private toolBoardShow(args: Record<string, unknown>): { content: unknown } {
    const ref = String(args.task ?? args.taskId ?? args.jobId ?? "").trim();
    const tasks = this.requireHooks.getTasks?.() ?? [];
    const task =
      tasks.find((t) => t.id === ref || t.jobId === ref) ??
      tasks.find((t) => t.title.toLowerCase().startsWith(ref.toLowerCase()));
    if (!task) throw new Error(`Task not found: ${ref}`);
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  }

  private toolBoardCreate(args: Record<string, unknown>): { content: unknown } {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const projectId = String(args.projectId ?? args.project_id ?? "").trim();
    if (!projectId) throw new Error("projectId is required");
    const created = this.requireHooks.createTask({
      title,
      summary: String(args.summary ?? title),
      projectId,
      assignee: String(args.assignee ?? "Unassigned"),
      status: String(args.status ?? "Task"),
      priority: String(args.priority ?? "medium"),
    });
    if (!created) throw new Error("Failed to create task");
    return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
  }

  private toolBoardAssign(args: Record<string, unknown>): { content: unknown } {
    const ref = String(args.task ?? args.taskId ?? "").trim();
    const assignee = String(args.assignee ?? args.agent ?? "").trim();
    if (!ref || !assignee) throw new Error("task and assignee are required");
    const tasks = this.requireHooks.getTasks?.() ?? [];
    const task = tasks.find((t) => t.id === ref || t.jobId === ref);
    if (!task) throw new Error(`Task not found: ${ref}`);
    this.requireHooks.updateTask(task.id, {
      assignee,
      activity: [...(task.activity ?? []), activity("agent-mcp", `assigned to ${assignee}`)],
    });
    return { content: [{ type: "text", text: `Assigned ${task.jobId} to ${assignee}` }] };
  }

  private async toolBoardDispatch(args: Record<string, unknown>): Promise<{ content: unknown }> {
    const ref = String(args.task ?? args.taskId ?? "").trim();
    const agentName = String(args.agent ?? args.assignee ?? "").trim();
    if (!this.requireHooks.dispatchTask) {
      throw new Error("board_dispatch is not available in this context");
    }
    const tasks = this.requireHooks.getTasks?.() ?? [];
    const task = tasks.find((t) => t.id === ref || t.jobId === ref);
    if (!task) throw new Error(`Task not found: ${ref}`);
    const targetAgent = agentName || task.assignee;
    const runId = await this.requireHooks.dispatchTask(task.id, targetAgent);
    return { content: [{ type: "text", text: `Dispatched run ${runId} for ${task.jobId}` }] };
  }

  private async toolBoardReservations(): Promise<{ content: unknown }> {
    if (!isTauri()) {
      return { content: [{ type: "text", text: "[]" }] };
    }
    const state = await localApi.reservationList();
    return {
      content: [{ type: "text", text: JSON.stringify(state?.active ?? [], null, 2) }],
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
