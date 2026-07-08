// Storage keys - eliminates magic strings
export const STORAGE_KEYS = {
  COLUMNS: "liquitask-columns",
  PROJECT_TYPES: "liquitask-project-types",
  PRIORITIES: "liquitask-priorities",
  CUSTOM_FIELDS: "liquitask-custom-fields",
  PROJECTS: "liquitask-projects",
  TASKS: "liquitask-tasks",
  ACTIVE_PROJECT: "liquitask-active-project",
  SIDEBAR_COLLAPSED: "liquitask-sidebar-collapsed",
  GROUPING: "liquitask-grouping",
  TASK_TEMPLATES: "liquitask-task-templates",
  SEARCH_HISTORY: "liquitask-search-history",
  COMPACT_VIEW: "liquitask-compact-view",
  SHOW_SUB_WORKSPACE_TASKS: "liquitask-show-sub-workspace-tasks",
  VIEW_MODE: "liquitask-view-mode",
  CURRENT_VIEW: "liquitask-current-view",
  COMMAND_HISTORY: "liquitask-command-history",
  AUTOMATION_RULES: "liquitask-automation-rules",
  // Migration system keys
  DATA_VERSION: "liquitask-data-version",
  BACKUPS: "liquitask-backups",
  MIGRATION_LOG: "liquitask-migration-log",
  AI_CONFIG: "liquitask-ai-config",
  GEMINI_API_KEY: "liquitask-gemini-api-key",
  AI_SEMANTIC_CACHE: "liquitask-ai-semantic-cache",
  AUTO_ORGANIZE_HISTORY: "liquitask-auto-organize-history",
  AI_ORGANIZE_CACHE: "liquitask-ai-organize-cache",
  SAVED_VIEWS: "liquitask-saved-views",
  ARCHIVE_SETTINGS: "liquitask-archive-settings",
  ENCRYPTION_AT_REST: "liquitask-encryption-at-rest",
  WEB_ENCRYPTION_SALT: "liquitask-web-encryption-salt",
  WEB_ENCRYPTION_VERIFIER: "liquitask-web-encryption-verifier",
  AGENTS: "liquitask-agents",
  AGENT_RUNS: "liquitask-agent-runs",
  AGENT_SKILLS: "liquitask-agent-skills",
  /** When true, agent permission prompts are auto-approved without user dialog. */
  AGENT_AUTO_APPROVE_PERMISSIONS: "liquitask-agent-auto-approve-permissions",
  GITHUB_SYNC: "liquitask-github-sync",
  AGENT_STANDUP_DISMISSED: "liquitask-agent-standup-dismissed",
  /** Persistent dead-letter queue for failed agent actions / git operations. */
  DEAD_LETTERS: "liquitask-dead-letters",
  /** Explicit path override for the DevCouncil CLI (Settings → Agents). */
  DEVCOUNCIL_CLI_PATH: "liquitask-devcouncil-cli-path",
  /** Recent quick-add strings for one-click re-apply in TaskFormModal. */
  QUICK_ADD_RECENT: "liquitask-quick-add-recent",
  /** When true, the recent quick-add chips row is hidden in TaskFormModal. */
  QUICK_ADD_RECENT_HIDDEN: "liquitask-quick-add-recent-hidden",
  /** Last-used AI refine preset label in TaskFormModal. */
  QUICK_ADD_REFINE_PRESET: "liquitask-quick-add-refine-preset",
  /** When true, the Quick Add Guide panel is expanded in TaskFormModal. */
  QUICK_ADD_GUIDE_OPEN: "liquitask-quick-add-guide-open",
  /** Feature-usage flags for rotating quick-add tips (no telemetry). */
  QUICK_ADD_USAGE_FLAGS: "liquitask-quick-add-usage-flags",
} as const;

export const FEATURE_FLAGS = {
  AI_ASSISTANT_SIDEBAR_ENABLED: false,
  /** Route non-claude agent runs through the liquitask-agentd sidecar. */
  AGENTD_SIDECAR_ENABLED: true,
  /** Use v3 four-surface shell (Inbox/Board/Agents/Run). */
  V3_SHELL_ENABLED: true,
  /** Show hover/focus tooltips on controls. */
  TOOLTIPS_ENABLED: false,
} as const;

// Default column configuration — the agentic four-stage board:
//   Task        backlog; assigning/dropping a card on an agent starts a run
//   In Progress an agent (or human) is actively working the card
//   Completed   the agent finished + gates passed; awaiting human review/commit
//   Commit      work committed/merged back into the repo (terminal)
export const DEFAULT_COLUMNS = [
  { id: "Task", title: "Task", color: "#64748b", wipLimit: 0 },
  { id: "InProgress", title: "In Progress", color: "#3b82f6", wipLimit: 10 },
  { id: "Completed", title: "Completed", color: "#10b981", wipLimit: 0 },
  {
    id: "Commit",
    title: "Commit",
    color: "#a855f7",
    isCompleted: true,
    wipLimit: 0,
  },
] as const;

// Default project types
export const DEFAULT_PROJECT_TYPES = [
  { id: "folder", label: "General", icon: "folder" },
  { id: "dev", label: "Development", icon: "code" },
  { id: "marketing", label: "Marketing", icon: "megaphone" },
  { id: "mobile", label: "Mobile App", icon: "smartphone" },
  { id: "inventory", label: "Inventory", icon: "box" },
] as const;

// Default priorities
export const DEFAULT_PRIORITIES = [
  { id: "high", label: "High", color: "#ef4444", level: 1, icon: "flame" },
  { id: "medium", label: "Medium", color: "#eab308", level: 2, icon: "clock" },
  { id: "low", label: "Low", color: "#10b981", level: 3, icon: "arrow-down" },
] as const;

// Default projects
export const DEFAULT_PROJECTS = [] as const;

// Column status constants (agentic four-stage board).
export const COLUMN_STATUS = {
  /** Backlog column — auto-pickup only triggers from here. */
  TASK: "Task",
  IN_PROGRESS: "InProgress",
  /** Agent finished; awaiting human review + commit. */
  COMPLETED: "Completed",
  /** Terminal — worktree committed/merged into the repo. */
  COMMIT: "Commit",
} as const;

/**
 * Pre-v1.1.0 column ids → agentic board ids. Used by the v1.1.0 data
 * migration and by imports of older exports/backups.
 */
export const LEGACY_COLUMN_MIGRATION: Record<string, string> = {
  Pending: COLUMN_STATUS.TASK,
  InProgress: COLUMN_STATUS.IN_PROGRESS,
  Review: COLUMN_STATUS.COMPLETED,
  Completed: COLUMN_STATUS.COMMIT,
  Delivered: COLUMN_STATUS.COMMIT,
};

// Link types
export const LINK_TYPES = {
  BLOCKS: "blocks",
  BLOCKED_BY: "blocked-by",
  RELATES_TO: "relates-to",
  DUPLICATES: "duplicates",
} as const;
