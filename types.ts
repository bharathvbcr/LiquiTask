/** Intentionally `string` — status maps to a user-configurable column ID (e.g. `col-${Date.now()}`), so a literal union would reject valid dynamic columns. */
export type TaskStatus = string;

export type GroupingOption = "none" | "priority";

export interface PriorityDefinition {
  id: string;
  label: string;
  color: string; // Hex code
  level: number; // For sorting (1 is highest)
  icon?: string; // Icon key
}

export enum Priority {
  High = "high",
  Medium = "medium",
  Low = "low",
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: "file" | "link";
}

export interface ProjectType {
  id: string;
  label: string;
  icon: string;
}

export interface Project {
  id: string;
  name: string;
  type: string;
  icon?: string; // Direct icon key, takes precedence over type
  parentId?: string;
  pinned?: boolean;
  order?: number;
  workspacePaths?: string[]; // File paths linked to this project for AI context
}

export type CustomFieldType = "text" | "number" | "dropdown" | "url" | "formula";

export interface CustomFieldDefinition {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[]; // For dropdowns
  formula?: string; // For formula fields (e.g. "{{dueDate}} - {{today}}")
}

export type LinkType = "blocks" | "blocked-by" | "relates-to" | "duplicates";

export interface TaskLink {
  targetTaskId: string;
  type: LinkType;
}

// Recurring task configuration
export interface RecurringConfig {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  interval: number; // e.g., every 2 weeks
  daysOfWeek?: number[]; // 0-6 for weekly
  dayOfMonth?: number; // 1-31 for monthly
  endDate?: Date;
  nextOccurrence?: Date;
}

export interface ErrorLog {
  timestamp: Date;
  message: string;
}

export type ActivityType = "create" | "update" | "move" | "comment" | "delete";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  timestamp: Date;
  userId: string; // 'user' for now
  details: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface Task {
  id: string;
  jobId: string;
  projectId: string;
  title: string;
  subtitle?: string;
  summary: string;
  assignee: string;
  priority: string;
  status: TaskStatus;
  createdAt: Date;
  updatedAt?: Date;
  dueDate?: Date;
  subtasks: Subtask[];
  attachments: Attachment[];
  customFieldValues?: Record<string, string | number>;
  links?: TaskLink[];
  // New fields
  tags: string[];
  timeEstimate: number; // in minutes
  timeSpent: number; // in minutes
  recurring?: RecurringConfig;
  completedAt?: Date;
  errorLogs?: ErrorLog[]; // For tracking errors related to this task
  activity?: ActivityItem[]; // Audit trail
  order?: number; // Position within column (for manual reordering)
  /** Linked GitHub issue when synced via Settings → Agents → GitHub. */
  githubIssue?: {
    owner: string;
    repo: string;
    number: number;
    url: string;
  };
}

// ---------------------------------------------------------------------------
// Agents-as-teammates (Multica-inspired)
// ---------------------------------------------------------------------------

/**
 * Which engine executes the agent's work. `claude-code` runs through the
 * legacy in-process Rust runner (feature-rich: containers, council mode, MCP
 * board bridge); every other value is a liquitask-agentd runtime id (kept in
 * lockstep with liquitask-agentd/internal/detect/detect.go) executed via the
 * Go sidecar when `FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED` is on.
 */
export type AgentProvider =
  | "claude-code"
  | "codex"
  | "cursor"
  | "copilot"
  | "opencode"
  | "openclaw"
  | "hermes"
  | "pi"
  | "kimi"
  | "kiro"
  | "antigravity"
  | "qoder"
  | "codebuddy"
  | "traecli";

/** Where the agent process runs. `container` uses apple/container (macOS 26+). */
export type AgentSandbox = "host" | "container";

/** Claude Code permission mode used for host runs. */
export type AgentPermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions";

/**
 * How a run executes:
 * - `direct`  — Claude Code works the task straight away.
 * - `council` — the full DevCouncil pipeline (`dev e2e --executor claude`):
 *   multi-agent debate planning, permission hooks, evidence gates.
 */
export type AgentRunMode = "direct" | "council";

/** Agent role — planner agents decompose epics via DevCouncil `dev plan`. */
export type AgentRole = "default" | "planner";

/** A reusable skill compounded from a successful agent run (Multica-style). */
export interface AgentSkill {
  id: string;
  title: string;
  summary: string;
  workingDir: string;
  taskId: string;
  agentId: string;
  createdAt: Date;
}

/**
 * An agent profile — a non-human teammate. Agents show up as assignees on the
 * board; assigning a task to one queues (or auto-starts) an execution run.
 */
export interface AgentProfile {
  id: string;
  /** Display name; also the `Task.assignee` value that routes work to it. */
  name: string;
  provider: AgentProvider;
  /** Repo/directory the agent works in. Must be an authorised workspace path. */
  workingDir: string;
  model?: string;
  permissionMode: AgentPermissionMode;
  sandbox: AgentSandbox;
  /** Defaults to `direct` when unset. */
  runMode?: AgentRunMode;
  /** `planner` runs `dev plan` on epic drop instead of a coding run. */
  role?: AgentRole;
  /** Run inside a Linux VM (macOS 26+, image: `liquitask-agent:latest`). */
  containerImage?: string;
  /** Create a git worktree per run for isolated parallel work. */
  gitWorktree?: boolean;
  /** Assigning a task starts the run immediately (Multica-style autonomy). */
  autoPickup: boolean;
  /** When a recurring instance lands on this agent, start a run automatically. */
  runsOnRecurrence: boolean;
  /** Run `dev check --verify --json` (DevCouncil) as a quality gate after runs. */
  devCouncilVerify: boolean;
  maxTurns?: number;
  /** Daily spend cap in USD; 0 or unset = unlimited. */
  dailyCostCapUsd?: number;
  /** Max agent runs started per calendar day; 0 or unset = unlimited. */
  maxRunsPerDay?: number;
  /** `fixed` uses `model`; `auto` routes by task priority / time estimate. */
  modelRouting?: "fixed" | "auto";
  createdAt: Date;
}

export type AgentRunStatus =
  | "queued"
  | "running"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRunEventKind =
  | "system"
  | "assistant"
  | "tool"
  | "result"
  | "stderr"
  | "verify"
  | "info";

export interface AgentRunEvent {
  ts: Date;
  kind: AgentRunEventKind;
  text: string;
}

export interface AgentRunVerification {
  passed: boolean;
  blockingGaps: string[];
  raw?: string;
}

/** One execution of an agent against a task (Multica task lifecycle). */
export interface AgentRun {
  id: string;
  taskId: string;
  agentId: string;
  status: AgentRunStatus;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  /** Rolling window of streamed events (capped to keep storage bounded). */
  events: AgentRunEvent[];
  /** Final result text reported by the agent. */
  summary?: string;
  numTurns?: number;
  costUsd?: number;
  sessionId?: string;
  /** Git branch created for this run (when gitWorktree enabled). */
  gitBranch?: string;
  /** Isolated worktree path (when gitWorktree enabled). */
  worktreePath?: string;
  /** Cached diff stat from the run's worktree. */
  gitDiff?: string;
  /** PR URL if opened on approval. */
  prUrl?: string;
  verification?: AgentRunVerification;
  error?: string;
  /** True while the agent process is paused mid-run (SIGSTOP / suspend). */
  isPaused?: boolean;
  /** Human review outcome — feeds estimate learning. */
  reviewOutcome?: "approved" | "rejected";
  /** Reviewer feedback persisted when work is rejected. */
  reviewFeedback?: string;
  /** Actual run duration in minutes (set on approval). */
  actualMinutes?: number;
  /**
   * Which execution engine owns this run: the legacy Rust runner (claude-*)
   * or the liquitask-agentd sidecar. Unset on runs persisted before v3 —
   * treated as "legacy".
   */
  engine?: "legacy" | "agentd";
  /**
   * Sidecar-assigned run id. agentd generates its own ids on run.start, so
   * lifecycle calls (cancel/pause/resume/inject) and inbound run.events are
   * keyed by this id while the UI keeps using the local `id`.
   */
  agentdRunId?: string;
}

export interface BoardColumn {
  id: string;
  title: string;
  color: string;
  isCompleted?: boolean;
  wipLimit?: number;
}

export interface ColumnData {
  id: string;
  title: string;
  tasks: Task[];
}

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export interface FilterState {
  assignee: string;
  dateRange: "due" | "created" | null;
  startDate: string;
  endDate: string;
  tags: string;
  priority?: string; // Filter by priority level
  status?: string; // Filter by status/column
  showCompleted?: boolean; // Include completed tasks
}

// Saved View for persisting filter configurations
export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
  // Advanced query builder state
  advancedFilter?: import("./src/types/queryTypes").FilterGroup;
  grouping: "none" | "priority";
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  createdAt: Date;
  isDefault?: boolean;
}

// Task Template
export interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  taskData: Partial<Task>;
  subtasks: Subtask[];
  tags: string[];
  customFieldValues: Record<string, string | number>;
  variables?: string[]; // e.g., ['projectName', 'assignee']
}

// AI Task Management & Cleanup Types
export interface DuplicateGroup {
  id: string;
  tasks: Task[];
  confidence: number; // 0-1
  reasons: string[]; // AI-explained reasons
}

export interface MergeSuggestion {
  keepTaskId: string;
  archiveTaskIds: string[];
  mergedFields: Partial<Task>;
  reasoning: string;
}

export interface RedundancyAnalysis {
  taskId: string;
  type: "subset" | "completed-overlap" | "stale" | "blocked-completed";
  relatedTaskId?: string;
  confidence: number;
  reasoning: string;
  suggestedAction: "archive" | "convert-to-subtask" | "update" | "delete";
}

export type AISuggestion =
  | { id: string; type: "priority";   taskId: string; suggestedValue: string;            currentValue: string;            confidence: number; reasoning: string }
  | { id: string; type: "tag";        taskId: string; suggestedValue: string | string[]; currentValue: string | string[]; confidence: number; reasoning: string }
  | { id: string; type: "project";    taskId: string; suggestedValue: string;            currentValue: string;            confidence: number; reasoning: string }
  | { id: string; type: "due-date";   taskId: string; suggestedValue: string | Date;     currentValue: string | Date;     confidence: number; reasoning: string }
  | { id: string; type: "subtask";    taskId: string; suggestedValue: string;            currentValue: string;            confidence: number; reasoning: string }
  | { id: string; type: "assignment"; taskId: string; suggestedValue: string;            currentValue: string | undefined; confidence: number; reasoning: string };

export interface AICategorySuggestion {
  taskId: string;
  suggestedProjectId?: string;
  suggestedTags: string[];
  suggestedPriority?: string;
  confidence: number;
  reasoning: string;
}

export interface AIScheduleSuggestion {
  taskId: string;
  suggestedDueDate?: Date;
  suggestedTimeEstimate?: number;
  conflicts: string[];
  reasoning: string;
}

export interface AIInsight {
  id: string;
  type: "productivity" | "bottleneck" | "estimate-accuracy" | "pattern" | "recommendation";
  title: string;
  description: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

export interface AIAutomationRule {
  id: string;
  naturalLanguage: string;
  trigger: string;
  conditions: string;
  actions: string;
  enabled: boolean;
  createdAt: Date;
}

export interface TaskCluster {
  id: string;
  taskIds: string[];
  theme: string;
  suggestedTags: string[];
  confidence: number;
}

// AI Provider configuration (extended)
export type AIProviderId = "gemini" | "ollama";

export interface AutoOrganizeConfig {
  enabled: boolean;
  autoApplyThreshold: number;
  suggestThreshold: number;
  schedule: "manual" | "onCreate" | "hourly" | "daily" | "weekly";
  lastRunAt?: Date;
  operations: {
    clustering: boolean;
    deduplication: boolean;
    autoTagging: boolean;
    hierarchyDetection: boolean;
    projectAssignment: boolean;
    tagConsolidation: boolean;
  };
  excludedProjectIds: string[];
  maxTasksPerBatch: number;
}

export interface HierarchySuggestion {
  id: string;
  type: "parent-child" | "dependency-chain" | "subtask-promotion";
  parentTaskId: string;
  childTaskIds: string[];
  confidence: number;
  reasoning: string;
}

export interface ProjectAssignment {
  taskId: string;
  currentProjectId: string;
  suggestedProjectId: string;
  confidence: number;
  reasoning: string;
}

export interface TagConsolidationSuggestion {
  id: string;
  tags: string[];
  suggestedTag: string;
  affectedTaskIds: string[];
  confidence: number;
  reasoning: string;
}

export interface AutoOrganizeResult {
  id: string;
  timestamp: Date;
  duration: number;
  tasksAnalyzed: number;
  changes: AutoOrganizeChange[];
  autoApplied: number;
  pendingReview: number;
}

export interface AutoOrganizeChange {
  id: string;
  type: "merge" | "tag" | "cluster" | "hierarchy" | "project-move" | "tag-consolidate";
  taskId: string;
  relatedTaskIds?: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  confidence: number;
  reasoning: string;
  status: "auto-applied" | "pending-review" | "rejected";
  clusterId?: string;
  clusterTheme?: string;
}

export interface SemanticLayerSettings {
  /** Route local Ollama calls through the semantic layer sidecar. */
  enabled?: boolean;
  /** Sidecar base URL (default http://127.0.0.1:8765). */
  serviceUrl?: string;
  /** Try to spawn the Python sidecar on app start (desktop only). */
  autoStart?: boolean;
  /** Semantic cache similarity threshold (0–1). */
  cacheThreshold?: number;
  /** Maximum cached responses. */
  cacheMaxEntries?: number;
  enableCache?: boolean;
  enableCompression?: boolean;
  /** Model tier overrides passed to the router. */
  smallModel?: string;
  mediumModel?: string;
  largeModel?: string;
}

export interface AIConfig {
  provider: AIProviderId;
  geminiApiKey?: string;
  geminiModel?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  semanticLayer?: SemanticLayerSettings;
  // AI Management settings
  autoDetectDuplicates?: boolean;
  autoSuggestPriorities?: boolean;
  autoSuggestTags?: boolean;
  cleanupOnCreate?: boolean;
  insightsFrequency?: "daily" | "weekly" | "manual";
  autoOrganize?: AutoOrganizeConfig;
}

export interface AITaskSchema {
  reasoning?: string; // Step-by-step analysis before final output
  title: string;
  summary: string;
  priority: string;
  dueDate?: string; // ISO string
  tags: string[];
  timeEstimate: number; // in minutes
  subtasks?: string[];
}

export interface AIContext {
  activeProjectId: string;
  projects: Project[];
  priorities: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
  workspacePaths?: string[]; // Active project's linked workspace paths
}

export interface AITestResult {
  ok: boolean;
  stage: "config" | "service" | "model" | "inference";
  message: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  name: string;
  result: unknown;
}

// AI Assistant Types
export interface AssistantMessage {
  id: string;
  role: "user" | "assistant" | "system" | "function";
  content: string;
  timestamp: Date;
  status?: "sending" | "error" | "done";
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface AssistantState {
  messages: AssistantMessage[];
  isOpen: boolean;
  isLoading: boolean;
}

// Migration system types
export interface Migration {
  version: string;
  description: string;
  migrate: (data: MigratableAppData) => MigratableAppData;
}

export interface MigrationResult {
  success: boolean;
  migratedFrom: string;
  migratedTo: string;
  data?: MigratableAppData;
  error?: string;
  backupId?: string;
}

export interface BackupInfo {
  id: string;
  version: string;
  timestamp: Date;
  size: number;
}

// App data structure for migration (mirrors storageService.AppData)
export interface MigratableAppData {
  columns?: BoardColumn[];
  projectTypes?: ProjectType[];
  priorities?: PriorityDefinition[];
  customFields?: CustomFieldDefinition[];
  projects?: Project[];
  tasks?: Task[];
  activeProjectId?: string;
  sidebarCollapsed?: boolean;
  grouping?: "none" | "priority";
  version?: string;
  savedViews?: SavedView[];
  // Allow additional fields for forward compatibility
  [key: string]: unknown;
}
