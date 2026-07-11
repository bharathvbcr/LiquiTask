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
  /** PR/CI/review metadata populated by the feedback loop (In Review stage). */
  prState?: TaskPrState;
}

/** Pull-request lifecycle metadata shown on In Review cards. */
export interface TaskPrState {
  url?: string;
  prNumber?: number;
  /** draft | open | merged | closed */
  state?: string;
  isDraft?: boolean;
  ci?: {
    passed: number;
    failed: number;
    pending: number;
    allPassed?: boolean;
  };
  review?: {
    /** approved | changes_requested | commented | pending */
    decision?: string;
    unresolvedThreads?: number;
  };
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Agents-as-teammates (Multica-inspired)
// ---------------------------------------------------------------------------

/**
 * Which engine executes the agent's work. Every provider value maps to a
 * liquitask-agentd runtime id (claude-code → `claude`) and executes via the
 * Go sidecar when `FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED` is on. Council mode
 * uses the slim Rust DevCouncil runner instead.
 */
export type AgentProvider =
  | "claude-code"
  | "codex"
  | "cursor"
  | "grok"
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

/** Opt-in OS-level sandbox wrapping for agent spawns (sandbox-exec / bwrap). */
export type AgentSandboxMode = "none" | "os";

/** Claude Code permission mode used for host runs. */
export type AgentPermissionMode = "default" | "plan" | "acceptEdits" | "bypassPermissions";

/** Per-tool permission policy forwarded to agentd (unlisted tools default to ask). */
export type AgentToolPolicyAction = "allow" | "ask" | "deny";

/**
 * How a run executes:
 * - `direct`  — Claude Code works the task straight away.
 * - `council` — the full DevCouncil pipeline (`dev e2e --executor claude`):
 *   multi-agent debate planning, permission hooks, evidence gates.
 */
export type AgentRunMode = "direct" | "council";

/**
 * Agent role:
 * - `default` / `coder` — executes implementation work.
 * - `planner` — decomposes epics via DevCouncil `dev plan`.
 * - `reviewer` — read-only diff review gate (Completed → InReview → Commit).
 */
export type AgentRole = "default" | "coder" | "planner" | "reviewer";

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
  /**
   * Auto-approve tool prompts without user confirmation. Explicit opt-in only;
   * `permissionMode: "bypassPermissions"` is a separate bypass path.
   */
  autoApprove?: boolean;
  /** Per-tool allow/ask/deny policy forwarded to agentd `run.start`. */
  toolPolicy?: Record<string, AgentToolPolicyAction>;
  sandbox: AgentSandbox;
  /** Opt-in OS sandbox wrapper (sandbox-exec on macOS, bwrap on Linux). Default `none`. */
  sandboxMode?: AgentSandboxMode;
  /** Defaults to `direct` when unset. */
  runMode?: AgentRunMode;
  /** `planner` runs `dev plan` on epic drop instead of a coding run. */
  role?: AgentRole;
  /** Run inside a Linux VM (macOS 26+, image: `liquitask-agent:latest`). */
  containerImage?: string;
  /** Create a git worktree per run for isolated parallel work. */
  gitWorktree?: boolean;
  /**
   * When worktree creation fails, run on the main checkout instead of failing
   * the run. Defaults to false (fail closed + dead-letter).
   */
  allowMainCheckout?: boolean;
  /** Assigning a task starts the run immediately (Multica-style autonomy). */
  autoPickup: boolean;
  /** When a recurring instance lands on this agent, start a run automatically. */
  runsOnRecurrence: boolean;
  /** Run `dev check --verify --json` (DevCouncil) as a quality gate after runs. */
  devCouncilVerify: boolean;
  /** Run an LLM diff review as a merge gate (alternative to DevCouncil verify). */
  llmReviewGate?: boolean;
  /** Commit stage strategy: merge locally (default) or push branch + open PR. */
  commitStage?: 'merge' | 'pushPr';
  /** Run a dedicated reviewer agent (read-only) as the merge gate. */
  reviewerAgentGate?: boolean;
  /** Agent profile id to use as the reviewer when reviewerAgentGate is on. */
  reviewerAgentId?: string;
  maxTurns?: number;
  /** Daily spend cap in USD; 0 or unset = unlimited. */
  dailyCostCapUsd?: number;
  /** Max agent runs started per calendar day; 0 or unset = unlimited. */
  maxRunsPerDay?: number;
  /** Wall-clock cap per run in minutes; the run is stopped past it. 0/unset = unlimited. */
  runTimeoutMinutes?: number;
  /** Minutes with no output before a run is treated as stalled and stopped. 0/unset = off. */
  stallTimeoutMinutes?: number;
  /** Per-run USD ceiling; overspend is flagged after the run. 0/unset = off. */
  perRunCostCapUsd?: number;
  /**
   * Auto-recovery: when a run dies (killed/terminated) or is stopped by a
   * guardrail, return its task to the board automatically. Defaults to true.
   */
  autoRecover?: boolean;
  /** Auto-retry a crashed/stalled run once before giving up. Defaults to false. */
  autoRetryOnCrash?: boolean;
  /** `fixed` uses `model`; `auto` routes by task priority / time estimate. */
  modelRouting?: "fixed" | "auto";
  /**
   * Opt-in autonomous feedback loop: route CI failures, review comments, and
   * merge conflicts back to the agent automatically (bounded by maxAttempts).
   */
  autoRepair?: {
    ciFailures?: boolean;
    reviewComments?: boolean;
    mergeConflicts?: boolean;
    /** Max automatic follow-up attempts per failure kind before Inbox escalation. */
    maxAttempts?: number;
  };
  /** Pinned skills always injected into this agent's runs. */
  skills?: string[];
  /** Execution host: local machine or remote via SSH. Default `local`. */
  host?: AgentExecutionHost;
  /** SSH settings when `host` is `ssh`. */
  ssh?: AgentSshConfig;
  createdAt: Date;
}

/** Where agent CLI processes execute. */
export type AgentExecutionHost = "local" | "ssh";

/** Remote execution settings (OpenSSH on unix hosts). */
export interface AgentSshConfig {
  /** SSH target (`user@host` or `host`). */
  target: string;
  /** SSH port (default 22). */
  port?: number;
  /** Optional identity file path. */
  identityFile?: string;
  /**
   * Remote base path matching the agent's local `workingDir`. Required when
   * Mutagen sync is not detected for the workspace.
   */
  remotePath?: string;
  /** Fall back to local execution when SSH is unreachable. Default true. */
  fallbackToLocal?: boolean;
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

/** Message-index marker for session rewind (Claude/Codex JSONL sessions). */
export interface SessionCheckpoint {
  id: string;
  label?: string;
  messageIndex: number;
  createdAt: Date;
}

/** Kind of step in a unified run trace (journal + git + session). */
export type RunTraceStepKind =
  | "tool"
  | "permission"
  | "file_write"
  | "session"
  | "git_checkpoint"
  | "devcouncil";

/** One reversible step in a run trace — anchored to git and/or session state. */
export interface RunTraceStep {
  id: string;
  index: number;
  kind: RunTraceStepKind;
  label: string;
  ts: Date;
  gitCommitSha?: string;
  sessionMessageIndex?: number;
  sessionCheckpointId?: string;
  toolName?: string;
  permissionDecision?: "allow" | "deny" | "always";
}

/** Ordered reversible trace for one run. */
export interface RunTrace {
  runId: string;
  steps: RunTraceStep[];
}

/** Structured reviewer verdict (approve / request-changes). */
export interface ReviewVerdict {
  verdict: "approve" | "request-changes";
  passed: boolean;
  blockingIssues: string[];
  summary: string;
  fileComments?: Array<{ path: string; line?: number; comment: string }>;
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
  /** Live per-model token tallies from agentd `run.events` usage payloads. */
  usage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    }
  >;
  sessionId?: string;
  /**
   * Base repository directory this run resolved to at start (the task's project
   * workspace). Authoritative over the agent profile's `workingDir`, which can
   * be stale or re-supplied from the roster after a relaunch. Consumers needing
   * the run's repo (worktree create, merge target, terminal, prune) prefer this.
   * Unset on runs created before this field existed.
   */
  repoDir?: string;
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
  /**
   * Why a failed run died, when it wasn't a normal error result: `crashed`
   * (process killed/terminated), `timeout` or `stall` (stopped by a guardrail).
   * Drives auto-recovery and lets the UI explain the failure.
   */
  failureKind?: "crashed" | "timeout" | "stall";
  /** True while the agent process is paused mid-run (SIGSTOP / suspend). */
  isPaused?: boolean;
  /** Epoch ms when the current pause began (unset while running). */
  pausedAt?: number;
  /** Accumulated paused time in ms, excluded from the run-timeout guardrail. */
  pausedMs?: number;
  /** Human review outcome — feeds estimate learning. */
  reviewOutcome?: "approved" | "rejected";
  /** Reviewer feedback persisted when work is rejected. */
  reviewFeedback?: string;
  /** Actual run duration in minutes (set on approval). */
  actualMinutes?: number;
  /**
   * Which execution engine owns this run: liquitask-agentd for direct runs,
   * or the slim Rust DevCouncil runner for council mode. Unset on runs
   * persisted before v3 — treated as council when a council buffer is active.
   */
  engine?: "agentd" | "council";
  /** Sidecar-assigned run id. agentd generates its own ids on run.start, so
   * lifecycle calls (cancel/pause/resume/inject) and inbound run.events are
   * keyed by this id while the UI keeps using the local `id`.
   */
  agentdRunId?: string;
  /** Message-index rewind markers (Claude/Codex session files only). */
  checkpoints?: SessionCheckpoint[];
  /** Unified reversible trace steps (tool/permission/git/session). */
  traceSteps?: RunTraceStep[];
  /** Run id of the reviewer gate spawned for this work (local merge path). */
  reviewerRunId?: string;
  /** Source run when this run was created via session fork. */
  forkedFromRunId?: string;
  /** File/subsystem paths reserved in the daemon scope table for this run. */
  reservedPaths?: string[];
  /** Queued because another run holds overlapping scope. */
  scopeBlocked?: boolean;
  /** 1-based position in the scope wait queue. */
  scopeWaitPosition?: number;
  /** False when the run finished while the app was away and board hooks have not replayed. */
  boardSynced?: boolean;
}

export interface BoardColumn {
  id: string;
  title: string;
  color: string;
  isCompleted?: boolean;
  /** When true, the column is omitted from the board until a task enters it. */
  hidden?: boolean;
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
export type AIProviderId = "gemini" | "ollama" | "claude-code";

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

/** User-defined MCP server merged into agent run configs (Settings → Agents). */
export interface UserMcpServer {
  id: string;
  /** MCP server key in the injected config (alphanumeric + hyphens). */
  name: string;
  transport: "stdio" | "http";
  /** Stdio: executable on PATH. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** HTTP/SSE transport URL. */
  url?: string;
  enabled: boolean;
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
  /** Claude Code model id passed to `claude --model` (desktop only). */
  claudeCodeModel?: string;
  semanticLayer?: SemanticLayerSettings;
  // AI Management settings
  autoDetectDuplicates?: boolean;
  autoSuggestPriorities?: boolean;
  autoSuggestTags?: boolean;
  cleanupOnCreate?: boolean;
  insightsFrequency?: "daily" | "weekly" | "manual";
  /** Fuzzy duplicate-title threshold for quick-add warnings (0–1). Default 0.68. */
  similarTitleThreshold?: number;
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
