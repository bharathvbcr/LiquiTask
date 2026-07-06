import { STORAGE_KEYS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";
import storageService from "../storageService";
import type { ActivityItem, BoardColumn, Task } from "../../../types";
import { generateTaskId } from "../../utils/taskUtils";

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
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  createTask: (task: Partial<Task> & { title: string; projectId: string }) => Task | null;
}

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

  const filePath = obj.file_path ?? obj.filePath;
  if (filePath) {
    const path = String(filePath);
    return {
      summary: `${toolName}: ${path}`,
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

  setHooks(hooks: AgentMcpHooks): void {
    this.hooks = hooks;
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

  async prepareMcpConfig(runId: string, taskId: string): Promise<string | null> {
    if (!isTauri()) return null;
    const mcpDir = await this.initForRun(runId, taskId);
    if (!mcpDir) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    const bridgePath = await invoke<string>("agent_mcp_resolve_bridge");
    const config = {
      mcpServers: {
        liquitask: {
          command: "node",
          args: [bridgePath],
          env: {
            LIQUITASK_MCP_DIR: mcpDir,
            LIQUITASK_TASK_ID: taskId,
            LIQUITASK_RUN_ID: runId,
          },
        },
      },
    };
    return invoke<string>("agent_mcp_write_config", {
      mcpDir,
      configJson: JSON.stringify(config, null, 2),
    });
  }

  async cleanup(runId: string): Promise<void> {
    this.denyAllForRun(runId);
    this.removePendingForRun(runId);
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
      const requests = await invoke<McpToolRequest[]>("agent_mcp_list_requests", { mcpDir });
      for (const req of requests) {
        if (req.tool === "permission_prompt") {
          void this.processPermissionPrompt(mcpDir, req);
        } else {
          const response = this.handleTool(req);
          await invoke("agent_mcp_write_response", {
            mcpDir,
            requestId: req.requestId,
            response,
          });
        }
      }
    }
  }

  private handleTool(req: McpToolRequest): { content?: unknown; error?: string } {
    if (!this.hooks) return { error: "MCP hooks not configured" };
    const task = this.hooks.getTask(req.taskId);
    if (!task) return { error: `Task ${req.taskId} not found` };

    try {
      switch (req.tool) {
        case "update_status":
          return this.toolUpdateStatus(task, req.args);
        case "post_comment":
          return this.toolPostComment(task, req.args);
        case "create_subtask":
          return this.toolCreateSubtask(task, req.args);
        case "report_blocker":
          return this.toolReportBlocker(task, req.args);
        default:
          return { error: `Unknown tool: ${req.tool}` };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async processPermissionPrompt(mcpDir: string, req: McpToolRequest): Promise<void> {
    if (this.processingRuns.has(req.requestId)) return;
    this.processingRuns.add(req.requestId);

    const toolUseId = String(req.args.tool_use_id ?? req.args.toolUseId ?? "");
    const toolName = String(req.args.tool_name ?? req.args.toolName ?? "unknown");
    const input = req.args.input ?? req.args;

    const runAlreadyDenied = this.deniedRuns.has(req.runId);
    const autoApprove = !runAlreadyDenied && this.isAutoApproveEnabled();

    const pending: AgentPermissionRequest = {
      requestId: req.requestId,
      runId: req.runId,
      taskId: req.taskId,
      toolUseId,
      toolName,
      input,
      receivedAt: new Date(),
    };
    if (!runAlreadyDenied && !autoApprove) {
      this.pendingPermissions.push(pending);
      if (this.pendingPermissions.length > 50) {
        this.pendingPermissions.splice(0, this.pendingPermissions.length - 50);
      }
      this.notifyPermissionListeners();
    }

    const approved = runAlreadyDenied
      ? false
      : autoApprove
        ? true
        : await this.waitForUserDecision(req.requestId);

    this.removePending(req.requestId);
    this.notifyPermissionListeners();

    const response = buildPermissionResponse(approved, input);
    const { summary } = describePermissionInput(toolName, input);

    const task = this.hooks?.getTask(req.taskId);
    if (task) {
      const verb = runAlreadyDenied
        ? "denied (run ended)"
        : autoApprove
          ? "auto-approved"
          : approved
            ? "approved"
            : "denied";
      this.hooks!.updateTask(task.id, {
        activity: [
          ...(task.activity ?? []),
          activity("agent-permission", `${verb} ${toolName}: ${summary.slice(0, 200)}`),
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
    this.permissionListeners.forEach((l) => l(snapshot));
  }

  private toolUpdateStatus(task: Task, args: Record<string, unknown>): { content: unknown } {
    const statusInput = String(args.status ?? "").trim();
    if (!statusInput) throw new Error("status is required");
    const columns = this.hooks!.getColumns();
    const col =
      columns.find((c) => c.id === statusInput) ??
      columns.find((c) => c.title.toLowerCase() === statusInput.toLowerCase());
    if (!col) throw new Error(`Column not found: ${statusInput}`);
    this.hooks!.updateTask(task.id, {
      status: col.id,
      activity: [
        ...(task.activity ?? []),
        activity("agent-mcp", `moved card to ${col.title} via MCP`),
      ],
    });
    return { content: [{ type: "text", text: `Status updated to ${col.title}` }] };
  }

  private toolPostComment(task: Task, args: Record<string, unknown>): { content: unknown } {
    const comment = String(args.comment ?? "").trim();
    if (!comment) throw new Error("comment is required");
    this.hooks!.updateTask(task.id, {
      activity: [...(task.activity ?? []), activity("agent-mcp", comment)],
    });
    return { content: [{ type: "text", text: "Comment posted" }] };
  }

  private toolCreateSubtask(task: Task, args: Record<string, unknown>): { content: unknown } {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const subtask = { id: generateTaskId(), title, completed: false };
    this.hooks!.updateTask(task.id, {
      subtasks: [...(task.subtasks ?? []), subtask],
      activity: [...(task.activity ?? []), activity("agent-mcp", `added subtask: ${title}`)],
    });
    return { content: [{ type: "text", text: `Subtask created: ${title}` }] };
  }

  private toolReportBlocker(task: Task, args: Record<string, unknown>): { content: unknown } {
    const title = String(args.title ?? "").trim();
    if (!title) throw new Error("title is required");
    const description = String(args.description ?? "").trim();
    const created = this.hooks!.createTask({
      title,
      summary: description || `Blocker reported while working ${task.jobId || task.id}`,
      projectId: task.projectId,
      assignee: task.assignee,
      priority: task.priority,
      links: [{ targetTaskId: task.id, type: "blocked-by" }],
      tags: [...(task.tags ?? []), "blocker"],
    });
    if (!created) throw new Error("Failed to create blocker task");
    this.hooks!.updateTask(task.id, {
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
