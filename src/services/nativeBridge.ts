/**
 * Thin TypeScript wrappers over Tauri Rust commands.
 * UI services delegate business logic here when running in the desktop app.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AgentProfile,
  AgentRun,
  AgentRunEventKind,
  AgentSkill,
  RecurringConfig,
  Task,
} from "../../types";
import type { AutomationRule, AutomationTrigger } from "./automationService";
import { isTauri } from "../runtime/runtimeEnvironment";
import { asString, asStringArray } from "../utils/coerce";

export function isNativeBackend(): boolean {
  return isTauri();
}

/**
 * Serialize a Task into the exact shape the native `TaskPromptInput` expects,
 * coercing every field to its wire type. Upstream data (especially
 * AI-generated subtasks/tags) can contain objects where strings are required;
 * without this, serde rejects the payload with `invalid type: map, expected a
 * string` and the whole run dies. Coercing here makes the boundary crash-proof.
 */
function toTaskPromptInput(task: Task, includeSubtasks: boolean) {
  return {
    id: asString(task.id),
    jobId: asString(task.jobId),
    title: asString(task.title),
    subtitle: task.subtitle == null ? undefined : asString(task.subtitle),
    summary: task.summary == null ? undefined : asString(task.summary),
    tags: asStringArray(task.tags),
    subtasks: includeSubtasks
      ? (task.subtasks ?? []).map((s) => ({
          title: asString(s?.title),
          completed: Boolean(s?.completed),
        }))
      : [],
  };
}

export async function nativeBuildTaskPrompt(
  task: Task,
  skills: AgentSkill[] = [],
): Promise<string> {
  return invoke<string>("agent_build_task_prompt", {
    task: toTaskPromptInput(task, true),
    skills: skills.map((s) => ({ title: asString(s.title), summary: asString(s.summary) })),
  });
}

export async function nativeBuildCouncilGoal(task: Task): Promise<string> {
  return invoke<string>("agent_build_council_goal", {
    task: toTaskPromptInput(task, false),
  });
}

export async function nativeParseStreamLine(line: string) {
  return invoke<{
    events: Array<{ kind: AgentRunEventKind; text: string }>;
    sessionId?: string;
    result?: {
      summary?: string;
      numTurns?: number;
      costUsd?: number;
      isError: boolean;
    };
  }>("agent_parse_stream_line", { line });
}

export async function nativeParseCouncilReport(raw: string) {
  return invoke<{
    passed: boolean;
    blockingGaps: string[];
    summary?: string;
    raw: string;
  }>("agent_parse_council_report", { raw });
}

export interface DevCouncilSubtask {
  id: string;
  title: string;
  description: string;
  priority?: string;
  dependsOn: string[];
  sourceGap?: string;
  plannedFiles?: Array<{
    path: string;
    reason: string;
    allowedChange: "create" | "modify" | "delete" | "read_only";
  }>;
}

export interface DevPlanResult {
  success: boolean;
  cliAvailable: boolean;
  tasks: DevCouncilSubtask[];
  requirementsCount: number;
  summary?: string;
  error?: string;
  rawExport?: string;
}

export interface DevRepairResult {
  success: boolean;
  cliAvailable: boolean;
  tasks: DevCouncilSubtask[];
  error?: string;
  rawExport?: string;
}

export async function nativeDevPlan(
  workingDir: string,
  epicContext: string,
): Promise<DevPlanResult> {
  return invoke<DevPlanResult>("agent_dev_plan", { workingDir, epicContext });
}

export async function nativeDevRepair(
  workingDir: string,
  gapContext: string[],
): Promise<DevRepairResult> {
  return invoke<DevRepairResult>("agent_dev_repair", { workingDir, gapContext });
}

export async function nativeDevParseExport(raw: string): Promise<DevCouncilSubtask[]> {
  return invoke<DevCouncilSubtask[]>("agent_dev_parse_export", { raw });
}

/** Cheap PATH-only probe for whether the DevCouncil CLI is installed. */
export async function nativeDevCliAvailable(): Promise<boolean> {
  return invoke<boolean>("agent_dev_cli_available");
}

// Verify gate (`dev verify --json`). Field names are snake_case, matching
// DevCouncil's own JSON wire format directly — deliberately NOT camelCase like
// the plan/repair types above, since this is a pass-through of DevCouncil's
// Gap/NextAction models rather than a Rust-computed response shape.
export interface DevVerifyGap {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  gap_type: string;
  requirement_id?: string;
  task_id?: string;
  description: string;
  evidence: string[];
  recommended_fix: string;
  blocking: boolean;
  file?: string;
  line?: number;
  suggested_command?: string;
}

export interface DevVerifyNextAction {
  gap_id: string;
  gap_type: string;
  category: string;
  severity: string;
  blocking: boolean;
  action: string;
  file?: string;
  line?: number;
  suggested_command?: string;
}

export interface DevVerifyTaskResult {
  task_id: string;
  status: string;
  sandbox?: string;
  gap_count: number;
  blocking_gap_count: number;
  gaps: DevVerifyGap[];
  next_actions: DevVerifyNextAction[];
  advisory_actions: DevVerifyNextAction[];
}

export interface DevVerifyResult {
  ok: boolean;
  cli_available: boolean;
  verified_tasks: number;
  blocked_tasks: number;
  total_gaps: number;
  tasks: DevVerifyTaskResult[];
  error?: string;
}

/** Run DevCouncil's deterministic verify gate: `dev verify --json [taskId]`. */
export async function nativeDevVerify(
  workingDir: string,
  taskId?: string,
): Promise<DevVerifyResult> {
  return invoke<DevVerifyResult>("agent_dev_verify", { workingDir, taskId });
}

// DevCouncil evidence-graph mirror (Requirement -> Task -> Evidence provenance).
// `agent_dev_mirror_evidence` polls DevCouncil's read-only `.devcouncil/state.db`
// and mirrors it into LiquiTask's agentd store; the list commands read those
// mirrored tables back. All degrade to empty/zero when DevCouncil is absent.
export interface DevMirrorSummary {
  requirements: number;
  tasks: number;
  evidence: number;
  gaps: number;
}

export interface DevStoredRequirement {
  id: string;
  title: string;
  description: string;
  priority?: string | null;
  source?: string | null;
}

export interface DevStoredTask {
  id: string;
  title: string;
  description: string;
  status?: string | null;
  requirementIdsJson?: string | null;
  plannedFilesJson?: string | null;
}

export interface DevStoredEvidence {
  id: number;
  kind: string;
  taskId?: string | null;
  requirementId?: string | null;
  dataJson?: string | null;
}

export async function nativeDevMirrorEvidence(workingDir: string): Promise<DevMirrorSummary> {
  return invoke<DevMirrorSummary>("agent_dev_mirror_evidence", { workingDir });
}

export async function nativeListDevcouncilRequirements(): Promise<DevStoredRequirement[]> {
  return invoke<DevStoredRequirement[]>("agentd_store_list_devcouncil_requirements");
}

export async function nativeListDevcouncilTasks(): Promise<DevStoredTask[]> {
  return invoke<DevStoredTask[]>("agentd_store_list_devcouncil_tasks");
}

export async function nativeListDevcouncilEvidence(): Promise<DevStoredEvidence[]> {
  return invoke<DevStoredEvidence[]>("agentd_store_list_devcouncil_evidence");
}

/** Real tracked-file paths from `.devcouncil/repo_map.json` (empty when unmapped). */
export async function nativeDevRepoFiles(workingDir: string): Promise<string[]> {
  return invoke<string[]>("agent_dev_repo_files", { workingDir });
}

export async function nativeCalculateNextOccurrence(
  config: RecurringConfig,
  fromDate?: Date,
): Promise<Date> {
  const fromMs = fromDate?.getTime() ?? Date.now();
  const payload = {
    enabled: config.enabled ?? true,
    frequency: config.frequency,
    interval: config.interval,
    daysOfWeek: config.daysOfWeek ?? null,
    dayOfMonth: config.dayOfMonth ?? null,
    endDate: config.endDate instanceof Date ? config.endDate.getTime() : config.endDate ?? null,
    nextOccurrence:
      config.nextOccurrence instanceof Date
        ? config.nextOccurrence.getTime()
        : config.nextOccurrence ?? null,
  };

  try {
    const millis = await invoke<number>("recurring_next_occurrence", {
      config: payload,
      fromMs,
    });
    return new Date(millis);
  } catch {
    const response = await invoke<{ iso: string; millis: number }>("recurring_calculate_next", {
      config: {
        frequency: config.frequency,
        interval: config.interval,
        daysOfWeek: config.daysOfWeek ?? [],
        dayOfMonth: config.dayOfMonth,
      },
      fromMs,
    });
    return new Date(response.millis);
  }
}

export interface NativeRecurringAdvance {
  nextOccurrence?: number;
  enabled: boolean;
}

export async function nativeRecurringAdvance(
  config: RecurringConfig,
  now: Date = new Date(),
): Promise<{ nextOccurrence?: Date; enabled: boolean }> {
  const result = await invoke<NativeRecurringAdvance>("recurring_advance", {
    config: {
      enabled: config.enabled ?? true,
      frequency: config.frequency,
      interval: config.interval,
      daysOfWeek: config.daysOfWeek ?? null,
      dayOfMonth: config.dayOfMonth ?? null,
      endDate: config.endDate instanceof Date ? config.endDate.getTime() : config.endDate ?? null,
      nextOccurrence:
        config.nextOccurrence instanceof Date
          ? config.nextOccurrence.getTime()
          : config.nextOccurrence ?? null,
    },
    nowMs: now.getTime(),
  });
  return {
    nextOccurrence: result.nextOccurrence != null ? new Date(result.nextOccurrence) : undefined,
    enabled: result.enabled,
  };
}

export interface NativeAutomationResult {
  updates: Record<string, unknown>;
  tagsToAdd: string[];
  tagsToRemove: string[];
  notifications: string[];
  assignToAgentIds: string[];
}

function serializeAutomationRules(rules: AutomationRule[]) {
  return rules.map((rule) => ({
    id: rule.id,
    enabled: rule.enabled,
    trigger: rule.trigger,
    actions: rule.actions.map((action) => {
      if (action.type === "setField") {
        return { type: action.type, field: action.field, value: action.value };
      }
      return { type: action.type, value: action.value };
    }),
  }));
}

export async function nativeProcessAutomationActions(options: {
  event: AutomationTrigger;
  task: Pick<Task, "id" | "tags" | "status" | "priority">;
  rules: AutomationRule[];
  matchedRuleIds: string[];
}): Promise<NativeAutomationResult> {
  const matchedRules = options.rules.filter((r) => options.matchedRuleIds.includes(r.id));
  try {
    const result = await invoke<{
      updates: Record<string, unknown>;
      notifications: string[];
      assignToAgentIds: string[];
    }>("automation_apply_actions", {
      rules: serializeAutomationRules(matchedRules),
      task: {
        id: options.task.id,
        tags: options.task.tags ?? [],
        status: options.task.status,
        priority: options.task.priority,
      },
    });
    return {
      updates: result.updates,
      tagsToAdd: [],
      tagsToRemove: [],
      notifications: result.notifications,
      assignToAgentIds: result.assignToAgentIds,
    };
  } catch {
    return invoke<NativeAutomationResult>("automation_process_actions", {
      request: {
        event: options.event,
        task: {
          id: options.task.id,
          tags: options.task.tags ?? [],
          status: options.task.status,
          priority: options.task.priority,
        },
        rules: serializeAutomationRules(options.rules),
        matchedRuleIds: options.matchedRuleIds,
      },
    });
  }
}

export async function nativeIsRuleDue(rule: AutomationRule, now: Date): Promise<boolean> {
  return invoke<boolean>("automation_is_rule_due", {
    rule,
    nowMs: now.getTime(),
  });
}

const DATE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "dueDate",
  "completedAt",
  "timestamp",
  "nextOccurrence",
  "endDate",
]);

/** Convert Rust-normalized task JSON (dates as millis) back to renderer Task models. */
export function hydrateTaskRecord(raw: Record<string, unknown>): Task {
  const hydrate = (obj: unknown): unknown => {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map((item) => hydrate(item));
    if (typeof obj !== "object") return obj;

    const result: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const value = record[key];
      if (key === "customFieldValues") {
        result[key] = value;
      } else if (DATE_FIELDS.has(key) && (typeof value === "number" || typeof value === "string")) {
        const d = new Date(value as string | number);
        result[key] = Number.isNaN(d.getTime()) ? value : d;
      } else {
        result[key] = hydrate(value);
      }
    }
    return result;
  };

  return hydrate(raw) as Task;
}

export async function nativeParseTasks(data: Record<string, unknown>[]): Promise<Task[]> {
  const parsed = await invoke<Record<string, unknown>[]>("storage_parse_tasks", { raw: data });
  return parsed.map((record) => hydrateTaskRecord(record));
}

export async function nativeSerializeTasks(tasks: Task[]): Promise<Record<string, unknown>[]> {
  const raw = tasks.map((task) => JSON.parse(JSON.stringify(task)) as Record<string, unknown>);
  return invoke<Record<string, unknown>[]>("storage_serialize_tasks", { raw });
}

export type TaskMutateOp = "create" | "update" | "delete" | "bulkUpsert" | "bulkDelete" | "replace";

export async function nativeMutateTasks(options: {
  op: TaskMutateOp;
  tasks: Task[];
  task?: Task;
  taskId?: string;
  taskIds?: string[];
  patch?: Partial<Task>;
  newTasks?: Task[];
}): Promise<Task[]> {
  const toRaw = (items: Task[]) =>
    items.map((t) => JSON.parse(JSON.stringify(t)) as Record<string, unknown>);
  const response = await invoke<{ tasks: Record<string, unknown>[] }>("storage_tasks_mutate", {
    request: {
      op: options.op,
      tasks: toRaw(options.tasks),
      task: options.task ? JSON.parse(JSON.stringify(options.task)) : undefined,
      taskId: options.taskId,
      taskIds: options.taskIds,
      patch: options.patch ? JSON.parse(JSON.stringify(options.patch)) : undefined,
      newTasks: options.newTasks ? toRaw(options.newTasks) : undefined,
    },
  });
  return response.tasks.map((record) => hydrateTaskRecord(record));
}

function skillToNative(skill: AgentSkill) {
  return {
    id: skill.id,
    title: skill.title,
    summary: skill.summary,
    workingDir: skill.workingDir,
    taskId: skill.taskId,
    agentId: skill.agentId,
    createdAt:
      skill.createdAt instanceof Date ? skill.createdAt.getTime() : new Date(skill.createdAt).getTime(),
  };
}

function skillFromNative(record: {
  id: string;
  title: string;
  summary: string;
  workingDir: string;
  taskId: string;
  agentId: string;
  createdAt: number;
}): AgentSkill {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    workingDir: record.workingDir,
    taskId: record.taskId,
    agentId: record.agentId,
    createdAt: new Date(record.createdAt),
  };
}

export async function nativeFilterSkills(workingDir: string, skills: AgentSkill[]): Promise<AgentSkill[]> {
  const filtered = await invoke<
    Array<{
      id: string;
      title: string;
      summary: string;
      workingDir: string;
      taskId: string;
      agentId: string;
      createdAt: number;
    }>
  >("agent_skills_filter", {
    request: {
      skills: skills.map(skillToNative),
      workingDir,
    },
  });
  return filtered.map(skillFromNative);
}

export async function nativeCaptureSkill(
  skills: AgentSkill[],
  run: AgentRun,
  task: Task,
  workingDir: string,
): Promise<AgentSkill[] | null> {
  const response = await invoke<{
    captured: boolean;
    skills: Array<{
      id: string;
      title: string;
      summary: string;
      workingDir: string;
      taskId: string;
      agentId: string;
      createdAt: number;
    }>;
  }>("agent_skills_capture", {
    request: {
      skills: skills.map(skillToNative),
      run: {
        status: run.status,
        summary: run.summary,
        agentId: run.agentId,
      },
      task: { id: task.id, title: task.title },
      workingDir,
      nowMs: Date.now(),
    },
  });
  if (!response.captured) return null;
  return response.skills.map(skillFromNative);
}

export async function nativeDeleteSkill(skills: AgentSkill[], id: string): Promise<AgentSkill[]> {
  const updated = await invoke<
    Array<{
      id: string;
      title: string;
      summary: string;
      workingDir: string;
      taskId: string;
      agentId: string;
      createdAt: number;
    }>
  >("agent_skills_delete", {
    request: { skills: skills.map(skillToNative), id },
  });
  return updated.map(skillFromNative);
}

export interface AgentAnalyticsRow {
  agentId: string;
  agentName: string;
  totalRuns: number;
  completed: number;
  failed: number;
  successRate: number;
  avgCostUsd: number;
  avgTurns: number;
  avgDurationMs: number;
  gatePassRate: number;
}

export async function nativeComputeAgentAnalytics(
  agents: AgentProfile[],
  runs: AgentRun[],
): Promise<AgentAnalyticsRow[]> {
  return invoke<AgentAnalyticsRow[]>("agent_compute_analytics", {
    request: {
      agents: agents.map((a) => ({ id: a.id, name: a.name })),
      runs: runs.map((r) => ({
        agentId: r.agentId,
        status: r.status,
        startedAt: r.startedAt?.getTime(),
        finishedAt: r.finishedAt?.getTime(),
        costUsd: r.costUsd,
        numTurns: r.numTurns,
        verification: r.verification ? { passed: r.verification.passed } : undefined,
      })),
    },
  });
}

export async function nativeOllamaGenerate(options: {
  baseUrl?: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ text: string; latencyMs: number; model: string }> {
  return invoke("ai_ollama_generate", {
    request: {
      baseUrl: options.baseUrl,
      model: options.model,
      prompt: options.prompt,
      system: options.system,
      temperature: options.temperature ?? 0.4,
      maxTokens: options.maxTokens ?? 2048,
    },
  });
}

export async function nativeOllamaChat(options: {
  baseUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  formatJson?: boolean;
}): Promise<{ content: string; latencyMs: number }> {
  return invoke("ai_ollama_chat", {
    request: {
      baseUrl: options.baseUrl,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.4,
      formatJson: options.formatJson ?? false,
    },
  });
}

export async function nativeOllamaHealth(baseUrl?: string): Promise<boolean> {
  const response = await invoke<{ ok: boolean }>("ai_ollama_health", {
    request: { baseUrl },
  });
  return response.ok;
}
