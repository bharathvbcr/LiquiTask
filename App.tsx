import { Loader2, Sparkles } from "lucide-react";
import type React from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./src/components/TitleBar";
import { Toast } from "./src/components/Toast";
import logo from "./src/assets/logo.png";
// Power User Features
import type { CommandAction } from "./src/components/CommandPalette";
import { ViewTransition } from "./src/components/ViewTransition";
import { COLUMN_STATUS, FEATURE_FLAGS, STORAGE_KEYS } from "./src/constants";
import { useConfirmation } from "./src/contexts/ConfirmationContext";
import { AgentRunsDock } from "./src/components/agents/AgentRunsDock";
import { AgentStandupCard } from "./src/components/agents/AgentStandupCard";
import { WarRoom } from "./src/components/agents/WarRoom";
import agentMcpService, { type AgentPermissionRequest } from "./src/services/agents/agentMcpService";
import { localApi } from "./src/core/api/localApi";
import { useAgentStandupDigest } from "./src/hooks/useAgentStandupDigest";
import { useAgentTeammates } from "./src/hooks/useAgentTeammates";
import { useGitHubSync } from "./src/hooks/useGitHubSync";
import { useAiKeyboardShortcuts } from "./src/hooks/useAiKeyboardShortcuts";
import { useAppInitialization } from "./src/hooks/useAppInitialization";
import { useAutoArchive } from "./src/hooks/useAutoArchive";
import { useGlobalKeyboardShortcuts } from "./src/hooks/useGlobalKeyboardShortcuts";
import { useProjectController } from "./src/hooks/useProjectController";
import useSavedViews from "./src/hooks/useSavedViews";
import { useSearchHistory } from "./src/hooks/useSearchHistory";
import { useTaskAssistant } from "./src/hooks/useTaskAssistant";
// Hooks
import { useTaskController } from "./src/hooks/useTaskController";
import { getRuntimeState, isTauri } from "./src/runtime/runtimeEnvironment";
import { aiService } from "./src/services/aiService";
import agentRunService from "./src/services/agents/agentRunService";
import agentService from "./src/services/agents/agentService";
import { archiveService } from "./src/services/archiveService";
import {
  activateEncryptionAtRest,
  deactivateEncryptionAtRest,
  type EncryptionChangeReason,
  needsDesktopEncryptionUnlock,
  needsWebEncryptionUnlock,
} from "./src/services/encryptionSetup";
import { DesktopEncryptionGate } from "./src/components/DesktopEncryptionGate";
import { WebEncryptionGate } from "./src/components/WebEncryptionGate";
import { indexedDBService } from "./src/services/indexedDBService";
import storageService from "./src/services/storageService";
import type { FilterGroup } from "./src/types/queryTypes";
import { debounce } from "./src/utils/debounce";
import { buildTaskContextIndex, getTasksFromContextIndex } from "./src/utils/taskContextIndex";
import { filterTasksBySearch } from "./src/utils/taskSearch";
import { getBacklogColumnId } from "./src/utils/taskUtils";
import { persistStorageQuiet } from "./src/utils/persistStorage";
import type {
  ActivityItem,
  ActivityType,
  AIConfig,
  AIContext,
  AISuggestion,
  BoardColumn,
  CustomFieldDefinition,
  FilterState,
  GroupingOption,
  PriorityDefinition,
  Project,
  ProjectType,
  RecurringConfig,
  Task,
  TaskTemplate,
  ToastMessage,
  ToastType,
} from "./types";

// Initial fallbacks
const defaultColumns: BoardColumn[] = [
  { id: "Pending", title: "Pending", color: "#64748b", wipLimit: 0 },
  { id: "InProgress", title: "In Progress", color: "#3b82f6", wipLimit: 10 },
  {
    id: "Completed",
    title: "Completed",
    color: "#10b981",
    isCompleted: true,
    wipLimit: 0,
  },
  { id: "Delivered", title: "Delivered", color: "#a855f7", wipLimit: 0 },
];

const defaultProjectTypes: ProjectType[] = [
  { id: "folder", label: "General", icon: "folder" },
  { id: "dev", label: "Development", icon: "code" },
  { id: "marketing", label: "Marketing", icon: "megaphone" },
  { id: "mobile", label: "Mobile App", icon: "smartphone" },
  { id: "inventory", label: "Inventory", icon: "box" },
];

const defaultPriorities: PriorityDefinition[] = [
  { id: "high", label: "High", color: "#ef4444", level: 1, icon: "flame" },
  { id: "medium", label: "Medium", color: "#eab308", level: 2, icon: "clock" },
  { id: "low", label: "Low", color: "#10b981", level: 3, icon: "arrow-down" },
];

// Lazy Components
const TaskFormModal = lazy(() =>
  import("./src/components/TaskFormModal").then((module) => ({
    default: module.TaskFormModal,
  })),
);
const ProjectModal = lazy(() =>
  import("./src/components/ProjectModal").then((module) => ({
    default: module.ProjectModal,
  })),
);
const SettingsModal = lazy(() =>
  import("./src/components/SettingsModal").then((module) => ({
    default: module.SettingsModal,
  })),
);
const Sidebar = lazy(() =>
  import("./src/components/Sidebar").then((module) => ({
    default: module.Sidebar,
  })),
);
const Dashboard = lazy(() =>
  import("./src/components/Dashboard").then((module) => ({
    default: module.Dashboard,
  })),
);
const GanttView = lazy(() => import("./src/views/board/GanttView"));
const ProjectBoard = lazy(() => import("./src/views/board/ProjectBoard"));
const ArchiveView = lazy(() =>
  import("./src/views/board/ArchiveView").then((module) => ({
    default: module.ArchiveView,
  })),
);
const QuickAddBar = lazy(() =>
  import("./src/components/QuickAddBar").then((module) => ({
    default: module.QuickAddBar,
  })),
);
const CommandPalette = lazy(() =>
  import("./src/components/CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const KeyboardShortcutsModal = lazy(() =>
  import("./src/components/KeyboardShortcutsModal").then((module) => ({
    default: module.KeyboardShortcutsModal,
  })),
);
const AppHeader = lazy(() =>
  import("./src/components/AppHeader").then((module) => ({
    default: module.AppHeader,
  })),
);
const AIInsightsPanel = lazy(() =>
  import("./src/components/AIInsightsPanel").then((module) => ({
    default: module.AIInsightsPanel,
  })),
);
const BulkAIOperationsModal = lazy(() =>
  import("./src/components/BulkAIOperationsModal").then((module) => ({
    default: module.BulkAIOperationsModal,
  })),
);

const AIMergeDuplicatesModal = lazy(() =>
  import("./src/components/AIMergeDuplicatesModal").then((module) => ({
    default: module.AIMergeDuplicatesModal,
  })),
);

const AIReorganizeModal = lazy(() =>
  import("./src/components/AIReorganizeModal").then((module) => ({
    default: module.AIReorganizeModal,
  })),
);

const AISubtaskSuggestionsModal = lazy(() =>
  import("./src/components/AISubtaskSuggestionsModal").then((module) => ({
    default: module.AISubtaskSuggestionsModal,
  })),
);

const AIProjectAssignmentModal = lazy(() =>
  import("./src/components/AIProjectAssignmentModal").then((module) => ({
    default: module.AIProjectAssignmentModal,
  })),
);

const AIHealthDashboard = lazy(() =>
  import("./src/components/AIHealthDashboard").then((module) => ({
    default: module.AIHealthDashboard,
  })),
);

const MobileNavDrawer = lazy(() =>
  import("./src/components/MobileNavDrawer").then((module) => ({
    default: module.MobileNavDrawer,
  })),
);
const AutoOrganizePanel = lazy(() =>
  import("./src/components/AutoOrganizePanel").then((module) => ({
    default: module.AutoOrganizePanel,
  })),
);
const TaskAssistantSidebar = lazy(() =>
  import("./src/components/TaskAssistantSidebar").then((module) => ({
    default: module.TaskAssistantSidebar,
  })),
);

const AIRightRail = lazy(() =>
  import("./src/components/AIRightRail").then((module) => ({
    default: module.AIRightRail,
  })),
);

// v3 four-surface shell (Inbox/Board/Agents/Run) — lazy, only rendered when
// FEATURE_FLAGS.V3_SHELL_ENABLED is on. The legacy tree above stays untouched.
const InboxView = lazy(() =>
  import("./src/views/inbox/InboxView").then((module) => ({ default: module.InboxView })),
);
const AgentsView = lazy(() =>
  import("./src/views/agents/AgentsView").then((module) => ({ default: module.AgentsView })),
);
const RunView = lazy(() =>
  import("./src/views/run/RunView").then((module) => ({ default: module.RunView })),
);

const SIDEBAR_EXPANDED_WIDTH = 320;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_OFFSET_DELTA = SIDEBAR_EXPANDED_WIDTH - SIDEBAR_COLLAPSED_WIDTH;
const _CONTENT_LEFT_OFFSET = 104;
const isAiAssistantSidebarEnabled = FEATURE_FLAGS.AI_ASSISTANT_SIDEBAR_ENABLED;

const ViewLoadingFallback: React.FC = () => (
  <div className="h-full w-full flex items-center justify-center text-slate-500">
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">Loading view...</span>
    </div>
  </div>
);

const ModalLoadingFallback: React.FC = () => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0a0e17] px-4 py-3 text-slate-300">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-sm">Loading...</span>
    </div>
  </div>
);

const SidebarLoadingFallback: React.FC<{ isCollapsed: boolean }> = ({ isCollapsed }) => (
  <div className="fixed left-4 top-14 z-20 hidden h-[calc(100vh-4.5rem)] md:block">
    <div
      className="h-full rounded-[28px] border border-white/5 bg-black/20 shadow-2xl backdrop-blur-md transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{
        width: SIDEBAR_EXPANDED_WIDTH,
        transform: `translateX(${isCollapsed ? -SIDEBAR_OFFSET_DELTA : 0}px)`,
      }}
    />
  </div>
);

const HeaderLoadingFallback: React.FC<{ sidebarOffset: number }> = ({ sidebarOffset }) => (
  <div
    className="sticky top-0 z-50 mb-4 hidden h-16 rounded-3xl border border-white/5 liquid-glass shadow-xl md:block md:mr-[72px]"
    style={{ transform: `translateX(${sidebarOffset}px)` }}
  />
);

type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  silent?: boolean;
  onClick?: () => void;
};

type NotificationServiceHandle = {
  requestPermission: () => Promise<boolean>;
  show: (payload: NotificationPayload) => void;
  startPeriodicCheck: (
    getTasks: () => Array<{
      id: string;
      title: string;
      dueDate?: Date;
      status?: string;
      completedAt?: Date;
    }>,
    intervalMs?: number,
    options?: { getCompletedColumnIds?: () => Set<string> },
  ) => void;
  stopPeriodicCheck: () => void;
  scheduleTaskReminder: (taskId: string, taskTitle: string, dueDate: Date) => void;
  cancelTaskReminder: (taskId: string) => void;
  clearOverdueNotification: (taskId: string) => void;
};

type RecurringTaskServiceHandle = {
  start: (getTasks: () => Task[]) => void;
  stop: () => void;
  updateNextOccurrence: (task: Task) => void;
  calculateNextOccurrence: (config: RecurringConfig, fromDate?: Date) => Date;
  generateNow: (task: Task) => void;
  isRunning: boolean;
};

type ActivityServiceHandle = {
  createActivity: (
    type: ActivityType,
    details: string,
    field?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ) => ActivityItem;
  logChange: (task: Task, changes: Partial<Task>, activityType?: ActivityType) => Task;
};

type SearchIndexServiceHandle = {
  buildIndex: (tasks: Task[]) => void;
  updateTask?: (task: Task, previousTask?: Task) => void;
  removeTask?: (task: Task) => void;
  search: (query: string) => string[];
  augmentTaskSemantically?: (
    task: Task,
    aiServiceHandle: {
      generateSemanticKeywords: (task: Task, context: AIContext) => Promise<string[]>;
    },
    context: AIContext,
  ) => Promise<void>;
};

type AutomationServiceHandle = {
  loadRules: (
    rules: import("./src/services/automationService").AutomationRule[] | undefined | null,
  ) => void;
  processTaskEvent: (
    event: import("./src/services/automationService").AutomationTrigger,
    context: import("./src/services/automationService").TaskContext,
    allTasks: Task[],
    options?: { onNotify?: (message: string) => void; columns?: BoardColumn[] },
  ) => Partial<Task> | null;
  configureSchedulerContext: (context: {
    getAllTasks: () => Task[];
    applyTaskUpdates: (taskId: string, updates: Partial<Task>) => void;
    notify?: (message: string) => void;
    getColumns?: () => BoardColumn[];
  }) => void;
  clearSchedulerContext: () => void;
};

type TemplateServiceHandle = {
  loadTemplates: (templates: TaskTemplate[]) => void;
  getAllTemplates?: () => TaskTemplate[];
  createFromTemplate?: (templateId: string, variables?: Record<string, string>) => Partial<Task>;
};

type AdvancedFilterExecutor = (tasks: Task[], group: FilterGroup) => Task[];
type AppView = "project" | "dashboard" | "gantt" | "archive";
/** v3 shell surfaces (FEATURE_FLAGS.V3_SHELL_ENABLED). Run is an overlay, not a tab. */
type AppSurface = "inbox" | "board" | "agents";

const App: React.FC = () => {
  const [webEncryptionBlocked, setWebEncryptionBlocked] = useState<boolean | null>(null);
  const [desktopEncryptionBlocked, setDesktopEncryptionBlocked] = useState<boolean | null>(null);
  // Bumped when the user unlocks web encryption so data (re)loads with the
  // in-memory key, instead of reloading the page and discarding that key.
  const [encryptionEpoch, setEncryptionEpoch] = useState(0);

  useEffect(() => {
    const checkEncryptionGate = async () => {
      try {
        if (isTauri()) {
          const needsUnlock = await needsDesktopEncryptionUnlock();
          setDesktopEncryptionBlocked(needsUnlock);
          setWebEncryptionBlocked(false);
          return;
        }

        const needsUnlock = await needsWebEncryptionUnlock();
        if (needsUnlock) {
          setWebEncryptionBlocked(true);
          setDesktopEncryptionBlocked(false);
          return;
        }

        setWebEncryptionBlocked(false);
        setDesktopEncryptionBlocked(false);
      } catch (error) {
        console.error("[Encryption] Failed to check encryption gate:", error);
        setWebEncryptionBlocked(false);
        setDesktopEncryptionBlocked(false);
      }
    };

    void checkEncryptionGate();
  }, []);

  const { confirm } = useConfirmation();
  const searchHistory = useSearchHistory();

  // --- Base State ---
  const [isLoaded, setIsLoaded] = useState(false);
  const [columns, setColumns] = useState<BoardColumn[]>(defaultColumns);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [boardGrouping, setBoardGrouping] = useState<GroupingOption>("none");
  const [isCompactView, setIsCompactView] = useState<boolean>(false);
  const [showSubWorkspaceTasks, setShowSubWorkspaceTasks] = useState<boolean>(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<AppView>("project");
  const [viewMode, setViewMode] = useState<"board" | "gantt" | "stats" | "calendar">("board");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [creatingSubProjectFor, setCreatingSubProjectFor] = useState<string | undefined>(undefined);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isWarRoomOpen, setIsWarRoomOpen] = useState(false);
  // v3 shell (FEATURE_FLAGS.V3_SHELL_ENABLED) — inert while the flag is off.
  const [activeSurface, setActiveSurface] = useState<AppSurface>("inbox");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runtimeHealth, setRuntimeHealth] = useState<
    Array<{ id: string; name: string; binary: string; path?: string; version?: string; ready: boolean }> | undefined
  >(undefined);
  const [shellPendingPermissions, setShellPendingPermissions] = useState<AgentPermissionRequest[]>([]);
  const handleEncryptionChange = useCallback((change: EncryptionChangeReason) => {
    setIsSettingsModalOpen(false);

    if (change === "locked") {
      setIsLoaded(false);
      if (isTauri()) {
        setDesktopEncryptionBlocked(true);
        setWebEncryptionBlocked(false);
      } else {
        setWebEncryptionBlocked(true);
        setDesktopEncryptionBlocked(false);
      }
      return;
    }

    setDesktopEncryptionBlocked(false);
    setWebEncryptionBlocked(false);
    setIsLoaded(false);
    setEncryptionEpoch((epoch) => epoch + 1);
  }, []);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAiInsightsOpen, setIsAiInsightsOpen] = useState(false);
  const [isAiPrioritizing, setIsAiPrioritizing] = useState(false);
  const [isNaturalLanguageSearch, setIsNaturalLanguageSearch] = useState(false);
  const [isBulkAIOperationsOpen, setIsBulkAIOperationsOpen] = useState(false);
  const [isAiMergeModalOpen, setIsAiMergeModalOpen] = useState(false);
  const [isAiReorganizeModalOpen, setIsAiReorganizeModalOpen] = useState(false);
  const [isAiSubtaskModalOpen, setIsAiSubtaskModalOpen] = useState(false);
  const [isAiProjectAssignmentModalOpen, setIsAiProjectAssignmentModalOpen] = useState(false);
  const [isAiHealthDashboardOpen, setIsAiHealthDashboardOpen] = useState(false);
  const [isAutoOrganizeOpen, setIsAutoOrganizeOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [nextTaskSuggestion, setNextTaskSuggestion] = useState<AISuggestion | null>(null);

  // isAiAssistantSidebarEnabled is a module-level constant (not reactive), so an
  // empty dependency list keeps this callback stable across renders.
  const setAiAssistantOpen = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    if (!isAiAssistantSidebarEnabled) return;
    setIsAssistantOpen(value);
  }, []);

  // AI Settings
  const [aiSettings, setAiSettings] = useState({
    autoDetectDuplicates: false,
    autoSuggestPriorities: false,
    autoSuggestTags: false,
    cleanupOnCreate: false,
  });

  // Load AI settings
  useEffect(() => {
    const savedConfig = storageService.get<AIConfig | null>(STORAGE_KEYS.AI_CONFIG, null);
    if (savedConfig) {
      setAiSettings({
        autoDetectDuplicates: savedConfig.autoDetectDuplicates ?? false,
        autoSuggestPriorities: savedConfig.autoSuggestPriorities ?? false,
        autoSuggestTags: savedConfig.autoSuggestTags ?? false,
        cleanupOnCreate: savedConfig.cleanupOnCreate ?? false,
      });
    }
  }, []);
  const [aiChangesUndoStack, setAiChangesUndoStack] = useState<
    Array<{
      taskId: string;
      previous: Record<string, unknown>;
      updated: Record<string, unknown>;
    }>
  >([]);
  const [filters, setFilters] = useState<FilterState>({
    assignee: "",
    dateRange: null,
    startDate: "",
    endDate: "",
    tags: "",
  });
  const [activeFilterGroup, setActiveFilterGroup] = useState<FilterGroup>({
    id: "root",
    operator: "AND",
    rules: [],
  });
  const [notificationPermission, setNotificationPermission] = useState<
    "granted" | "denied" | "default"
  >("default");
  const [commandUsageHistory, setCommandUsageHistory] = useState<Record<string, number>>({});
  // Refs for services
  const notificationServiceRef = useRef<NotificationServiceHandle | null>(null);
  const recurringTaskServiceRef = useRef<RecurringTaskServiceHandle | null>(null);
  const searchIndexServiceRef = useRef<SearchIndexServiceHandle | null>(null);
  const automationServiceRef = useRef<AutomationServiceHandle | null>(null);
  const assignToAgentRef = useRef<((taskId: string, agentId: string) => void) | null>(null);
  const templateServiceRef = useRef<TemplateServiceHandle | null>(null);
  const activityServiceRef = useRef<ActivityServiceHandle | null>(null);
  const advancedFilterExecutorRef = useRef<AdvancedFilterExecutor | null>(null);
  const aiServiceRef = useRef(aiService);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Controllers
  const {
    projects,
    setProjects,
    projectTypes,
    setProjectTypes,
    handleCreateProject,
    handleDeleteProject,
    handleTogglePin,
    handleMoveProject,
    handleEditProject,
  } = useProjectController({
    initialProjects: [],
    initialProjectTypes: defaultProjectTypes,
    addToast,
    confirm,
  });

  const [priorities, setPriorities] = useState<PriorityDefinition[]>(defaultPriorities);

  const {
    tasks,
    setTasks,
    canUndo,
    canMoveTask,
    handleUndo,
    handleUpdateTask,
    handleUpdateTaskDueDate,
    handleMoveTaskToWorkspace,
    handleCreateOrUpdateTask,
    handleBulkCreateTasks,
    handleDeleteTaskInternal,
    moveTask,
    pushUndo,
  } = useTaskController({
    initialTasks: [],
    columns,
    projects,
    priorities,
    activeProjectId,
    addToast,
    automationServiceRef,
    activityServiceRef,
    recurringTaskServiceRef,
    searchIndexServiceRef,
    aiServiceRef,
    assignToAgentRef,
  });

  // Initialization
  useAppInitialization({
    isLoaded,
    setIsLoaded,
    setColumns,
    setProjectTypes,
    setPriorities,
    setCustomFields,
    setProjects,
    setTasks,
    setActiveProjectId,
    setIsSidebarCollapsed,
    setBoardGrouping,
    setIsCompactView,
    setShowSubWorkspaceTasks,
    setViewMode,
    setCurrentView,
    searchIndexServiceRef,
    automationServiceRef,
    templateServiceRef,
    activityServiceRef,
    advancedFilterExecutorRef,
    notificationServiceRef,
    recurringTaskServiceRef,
    tasks,
    columns,
    addToast,
    pushUndo,
    encryptionEpoch,
  });

  const { runAutoArchive } = useAutoArchive({
    isLoaded,
    tasks,
    columns,
    setTasks,
    searchIndexServiceRef,
    addToast,
  });

  // Agent teammates (Multica-style): assign tasks to Claude Code agents.
  const {
    agents,
    agentRuns,
    refreshAgents,
    startAgentRun,
    cancelAgentRun,
    openRunInTerminal,
    assignTaskToAgent,
    followUpRun,
    pauseAgentRun,
    resumeAgentRun,
    injectGuidance,
    approveAgentWork,
    rejectAgentWork,
    mergeWorktree,
    discardWorktree,
  } = useAgentTeammates({
    isLoaded,
    tasks,
    columns,
    handleUpdateTask,
    handleCreateTask: (partial) => {
      handleCreateOrUpdateTask(partial, null);
    },
    addToast,
  });

  /**
   * Board move + agent kickoff: dropping an agent-assigned task into
   * In Progress starts a coding run (unless one is already active).
   */
  const handleMoveTask = useCallback(
    async (taskId: string, newStatus: string, newPriority?: string, newOrder?: number) => {
      const prevStatus = tasks.find((t) => t.id === taskId)?.status;
      const moved = await moveTask(taskId, newStatus, newPriority, newOrder);
      if (!moved || !isTauri()) return;
      if (newStatus !== COLUMN_STATUS.IN_PROGRESS || prevStatus === newStatus) return;

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const agent = agentService.getAgentByAssignee(task.assignee);
      if (!agent) return;
      if (agentRunService.getActiveRunForTask(taskId)) return;

      addToast(`${agent.name} is starting work on "${task.title}"…`, "info");
      void startAgentRun({ ...task, status: newStatus });
    },
    [tasks, moveTask, startAgentRun, addToast],
  );

  useGitHubSync(tasks, columns, isLoaded);

  const [standupDismissed, setStandupDismissed] = useState(false);
  const agentStandup = useAgentStandupDigest(tasks, {
    notifyOnLoad: isTauri() && isLoaded,
    hours: 12,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      void listen("tray-cancel-all", () => {
        for (const run of agentRunService.getRuns()) {
          if (run.status === "queued" || run.status === "running" || run.status === "verifying") {
            void cancelAgentRun(run.id);
          }
        }
      }).then((u) => unsubs.push(u));
      void listen("tray-view-runs", () => {
        addToast("Agent runs dock is at the bottom-right", "info");
      }).then((u) => unsubs.push(u));
    });
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [cancelAgentRun, addToast]);

  // v3 shell: feed RunView's inline permission prompts (same source AgentRunsDock uses).
  useEffect(() => {
    if (!FEATURE_FLAGS.V3_SHELL_ENABLED) return;
    return agentMcpService.subscribePermissions(setShellPendingPermissions);
  }, []);

  // v3 shell: populate the Agents surface's runtime-health strip when the sidecar is on,
  // refreshing each time the user switches to that surface.
  useEffect(() => {
    if (!FEATURE_FLAGS.V3_SHELL_ENABLED || !FEATURE_FLAGS.AGENTD_SIDECAR_ENABLED) return;
    if (activeSurface !== "agents") return;
    let cancelled = false;
    void localApi.detectRuntimes().then((runtimes) => {
      // detectRuntimes() returns the agentd shape only when the sidecar flag (checked
      // above) is on; narrow defensively rather than trusting the union return type.
      const agentdShaped = runtimes?.filter(
        (r): r is { id: string; name: string; binary: string; path?: string; version?: string; ready: boolean } =>
          "id" in r && "binary" in r && "ready" in r,
      );
      if (!cancelled && agentdShaped) setRuntimeHealth(agentdShaped);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSurface]);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  useEffect(() => {
    assignToAgentRef.current = (taskId, agentId) => {
      const task = tasksRef.current.find((t) => t.id === taskId);
      if (task) void assignTaskToAgent(task, agentId);
    };
  }, [assignTaskToAgent]);

  useEffect(() => {
    if (!isLoaded) return;
    const service = automationServiceRef.current;
    if (!service) return;

    service.configureSchedulerContext({
      getAllTasks: () => tasksRef.current,
      applyTaskUpdates: (taskId, updates) => {
        handleUpdateTask(taskId, updates);
      },
      notify: (message) => addToast(message, "info"),
      getColumns: () => columnsRef.current,
    });

    return () => {
      service.clearSchedulerContext();
    };
  }, [isLoaded, addToast, handleUpdateTask]);

  const handleUpdateProjectPaths = useCallback(
    (projectId: string, paths: string[]) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, workspacePaths: paths } : p)),
      );
    },
    [setProjects],
  );

  const {
    messages: assistantMessages,
    sendMessage: handleSendAssistantMessage,
    isLoading: isAssistantLoading,
    isSearching: isAssistantSearching,
    activeTool: assistantActiveTool,
    clearChat: handleClearAssistantChat,
    globalWorkspacePaths: assistantGlobalPaths,
    setGlobalWorkspacePaths: setAssistantGlobalPaths,
  } = useTaskAssistant({
    context: {
      activeProjectId,
      projects,
      priorities,
      customFields,
      workspacePaths: projects.find((p) => p.id === activeProjectId)?.workspacePaths ?? [],
    },
    allTasks: tasks,
    addTask: (task) => handleCreateOrUpdateTask(task, null),
    updateTask: (id, updates) => handleUpdateTask(id, updates),
    searchTasks: (query) => searchIndexServiceRef.current?.search(query) || [],
  });

  // Keyboard Shortcuts
  useGlobalKeyboardShortcuts({
    handleUndo,
    setIsCommandPaletteOpen,
    setIsSidebarCollapsed,
    setIsAssistantOpen: setAiAssistantOpen,
    setIsTaskModalOpen,
    setEditingTask,
    searchInputRef,
    tasks,
    projects,
    addToast,
    isCommandPaletteOpen,
  });

  useEffect(() => {
    const handleShortcutHelp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

      if (event.key === "?" && !isTextInput) {
        event.preventDefault();
        setIsKeyboardShortcutsOpen(true);
      }
    };

    window.addEventListener("keydown", handleShortcutHelp);
    return () => window.removeEventListener("keydown", handleShortcutHelp);
  }, []);

  // Saved Views
  const { views, activeViewId, createView, applyView, deleteView } = useSavedViews(isLoaded);

  // Task Filtering (needed by AI handlers)
  // Pre-calculate project hierarchy for fast workspace filtering.
  const descendantProjectsMap = useMemo(() => {
    const descendantsByProject = new Map<string, Set<string>>();
    const childrenByParent = new Map<string, Project[]>();

    for (const project of projects) {
      if (!project.parentId) continue;
      const siblings = childrenByParent.get(project.parentId);
      if (siblings) {
        siblings.push(project);
      } else {
        childrenByParent.set(project.parentId, [project]);
      }
    }

    const getDescendants = (id: string): Set<string> => {
      const existingDescendants = descendantsByProject.get(id);
      if (existingDescendants) return existingDescendants;

      const descendants = new Set<string>();
      const children = childrenByParent.get(id) ?? [];

      for (const child of children) {
        descendants.add(child.id);
        const childDescendants = getDescendants(child.id);
        for (const dId of childDescendants) {
          descendants.add(dId);
        }
      }

      descendantsByProject.set(id, descendants);
      return descendants;
    };

    for (const project of projects) {
      getDescendants(project.id);
    }

    return descendantsByProject;
  }, [projects]);

  // Debounce search query to avoid blocking the main thread on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (debouncedSearchQuery.trim()) {
      result = filterTasksBySearch(tasks, debouncedSearchQuery, searchIndexServiceRef.current);
    }
    if (filters.assignee)
      result = result.filter((t) =>
        t.assignee.toLowerCase().includes(filters.assignee.toLowerCase()),
      );
    if (activeFilterGroup.rules.length > 0) {
      result = advancedFilterExecutorRef.current
        ? advancedFilterExecutorRef.current(result, activeFilterGroup)
        : result;
    }
    return result;
  }, [tasks, debouncedSearchQuery, filters, activeFilterGroup]);

  const currentProjectTasks = useMemo(() => {
    if (showSubWorkspaceTasks) {
      const descendants = descendantProjectsMap.get(activeProjectId) || new Set<string>();
      return filteredTasks.filter(
        (t) => t.projectId === activeProjectId || descendants.has(t.projectId),
      );
    }
    return filteredTasks.filter((t) => t.projectId === activeProjectId);
  }, [filteredTasks, activeProjectId, showSubWorkspaceTasks, descendantProjectsMap]);

  // AI Handlers
  const handleAiInsights = useCallback(() => {
    setIsAiInsightsOpen(true);
  }, []);

  const handleNaturalLanguageSearch = useCallback(
    async (query: string) => {
      try {
        const context: AIContext = {
          activeProjectId,
          projects,
          priorities,
        };
        const result = await aiService.parseNaturalQuery(query, context);
        if ((result.filterGroup.rules?.length ?? 0) > 0) {
          setActiveFilterGroup(result.filterGroup);
          addToast(`AI Search: ${result.explanation}`, "info");
        } else {
          addToast("AI could not parse that query. Try standard search.", "info");
        }
      } catch (e: unknown) {
        addToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [activeProjectId, projects, priorities, addToast],
  );

  const handleAiPrioritize = useCallback(async () => {
    if (isAiPrioritizing) return;
    setIsAiPrioritizing(true);
    try {
      const context: AIContext = {
        activeProjectId,
        projects,
        priorities,
      };
      const suggestions = await aiService.suggestPriorities(currentProjectTasks, context);
      if (suggestions.length === 0) {
        addToast("No priority suggestions available", "info");
        return;
      }
      let applied = 0;
      for (const suggestion of suggestions) {
        if (suggestion.confidence >= 0.7) {
          const task = currentProjectTasks.find((t) => t.id === suggestion.taskId);
          if (task && task.priority !== suggestion.suggestedValue) {
            handleUpdateTask(suggestion.taskId, {
              priority: suggestion.suggestedValue as string,
            });
            applied++;
          }
        }
      }
      if (applied > 0) {
        addToast(`AI applied ${applied} priority adjustment${applied > 1 ? "s" : ""}`, "success");
      } else {
        addToast("AI reviewed priorities - no changes needed", "info");
      }
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setIsAiPrioritizing(false);
    }
  }, [
    isAiPrioritizing,
    currentProjectTasks,
    activeProjectId,
    projects,
    priorities,
    handleUpdateTask,
    addToast,
  ]);

  const handleSuggestNextTask = useCallback(async () => {
    addToast("AI is identifying your next task...", "info");
    try {
      const context: AIContext = {
        activeProjectId,
        projects,
        priorities,
      };
      const suggestion = await aiService.suggestNextTask(currentProjectTasks, context);
      if (suggestion) {
        setNextTaskSuggestion(suggestion);
        addToast("AI found a recommendation for you", "success");
      } else {
        addToast("AI reviewed tasks - everything is on track!", "info");
      }
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [currentProjectTasks, activeProjectId, projects, priorities, addToast]);

  const handleUndoAiChanges = useCallback(() => {
    if (aiChangesUndoStack.length === 0) {
      addToast("No AI changes to undo", "info");
      return;
    }
    const lastChange = aiChangesUndoStack[aiChangesUndoStack.length - 1];
    handleUpdateTask(lastChange.taskId, lastChange.previous as Partial<Task>);
    setAiChangesUndoStack((prev) => prev.slice(0, -1));
    addToast("Undid last AI change", "info");
  }, [aiChangesUndoStack, handleUpdateTask, addToast]);

  // AI Keyboard Shortcuts
  useAiKeyboardShortcuts({
    onAiPrioritize: handleAiPrioritize,
    onAiInsights: handleAiInsights,
    onToggleNaturalLanguageSearch: () => setIsNaturalLanguageSearch(!isNaturalLanguageSearch),
    onBulkAIOperations: () => setIsBulkAIOperationsOpen(true),
    onAutoOrganize: () => setIsAutoOrganizeOpen(true),
    onUndoAiChanges: handleUndoAiChanges,
    isModalOpen:
      isTaskModalOpen ||
      isSettingsModalOpen ||
      isCommandPaletteOpen ||
      isKeyboardShortcutsOpen ||
      isAiInsightsOpen ||
      isBulkAIOperationsOpen ||
      isAiMergeModalOpen ||
      isAiReorganizeModalOpen ||
      isAiSubtaskModalOpen ||
      isAiProjectAssignmentModalOpen ||
      isAutoOrganizeOpen,
  });

  const handleApplyView = (id: string) => {
    const view = applyView(id);
    if (view) {
      setFilters(view.filters);
      setBoardGrouping(view.grouping);
      setActiveFilterGroup(
        (view.advancedFilter as FilterGroup) || {
          id: "root",
          operator: "AND",
          rules: [],
        },
      );
      addToast(`View "${view.name}" applied`, "info");
    }
  };

  const handleCreateView = (name?: string) => {
    const finalName = name || prompt("Enter a name for this view:");
    if (finalName) {
      createView(finalName, filters, boardGrouping, activeFilterGroup);
      addToast(`View "${finalName}" saved`, "success");
    }
  };

  const recordCommandUsage = useCallback((commandId: string) => {
    const now = Date.now();
    setCommandUsageHistory((prev) => {
      const next = { ...prev, [commandId]: now };
      persistStorageQuiet(STORAGE_KEYS.COMMAND_HISTORY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const storedHistory = storageService.get<Record<string, number>>(
      STORAGE_KEYS.COMMAND_HISTORY,
      {},
    );
    if (storedHistory && typeof storedHistory === "object" && !Array.isArray(storedHistory)) {
      setCommandUsageHistory(storedHistory as Record<string, number>);
    }
  }, []);

  const commandActions = useMemo(() => {
    const baseActions: CommandAction[] = [
      {
        id: "action:new-task",
        label: "Create New Task",
        category: "action",
        description: "Open task composer modal",
        keywords: ["add", "new", "task", "todo"],
        aliases: ["create", "new task", "quick task"],
        action: () => {
          setEditingTask(null);
          setIsTaskModalOpen(true);
        },
      },
      {
        id: "action:quick-add",
        label: "Quick Add Task",
        category: "action",
        description: "Open natural language quick task entry",
        keywords: ["add", "quick", "task", "capture"],
        aliases: ["quick add", "capture task"],
        action: () => setIsQuickAddOpen(true),
      },
      {
        id: "action:undo",
        label: "Undo Last Action",
        category: "action",
        description: "Undo the last task change",
        keywords: ["undo", "revert", "back"],
        aliases: ["reverse", "go back"],
        action: handleUndo,
      },
      ...(isAiAssistantSidebarEnabled
        ? ([
            {
              id: "action:toggle-assistant",
              label: isAssistantOpen ? "Close AI Assistant" : "Open AI Assistant",
              category: "action",
              description: `${isAssistantOpen ? "Hide" : "Reveal"} right conversational AI sidebar`,
              keywords: ["ai", "assistant", "chat", "help", "bot"],
              aliases: ["toggle assistant", "chat bot", "ai chat"],
              action: () => setAiAssistantOpen((prev) => !prev),
            } as CommandAction,
          ] as CommandAction[])
        : []),
      {
        id: "action:toggle-sidebar",
        label: isSidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
        category: "view",
        description: `${isSidebarCollapsed ? "Reveal" : "Hide"} left workspace sidebar`,
        keywords: ["sidebar", "view", "layout"],
        aliases: ["toggle sidebar", "left panel"],
        action: () => setIsSidebarCollapsed((prev) => !prev),
      },
      {
        id: "action:compact-view",
        label: isCompactView ? "Expand Task Cards" : "Compact Task Cards",
        category: "view",
        description: "Toggle compact task card layout",
        keywords: ["compact", "cards", "layout"],
        aliases: ["compact mode", "dense mode"],
        action: () => setIsCompactView((prev) => !prev),
      },
      {
        id: "action:toggle-filter",
        label: isFilterOpen ? "Close Filter Panel" : "Open Filter Panel",
        category: "view",
        description: "Show or hide global project filters",
        keywords: ["filter", "query", "panel"],
        aliases: ["search filter", "advanced filter"],
        action: () => setIsFilterOpen((prev) => !prev),
      },
      ...(isTauri()
        ? ([
            {
              id: "action:open-war-room",
              label: isWarRoomOpen ? "Close War Room" : "Open War Room",
              category: "action",
              description: "Launch a multi-agent campaign on an epic (DevCouncil planning + worker dispatch)",
              keywords: ["agent", "campaign", "war", "room", "epic", "devcouncil", "orchestrate"],
              aliases: ["war room", "campaign", "muster", "agents"],
              action: () => setIsWarRoomOpen((prev) => !prev),
            } as CommandAction,
          ] as CommandAction[])
        : []),
      {
        id: "action:open-settings",
        label: "Open Settings",
        category: "action",
        description: "Open settings and import/export tools",
        keywords: ["settings", "preferences", "config"],
        aliases: ["preferences", "options", "preferences panel"],
        action: () => setIsSettingsModalOpen(true),
      },
      {
        id: "action:keyboard-shortcuts",
        label: "Keyboard Shortcuts",
        category: "action",
        description: "Show available keyboard shortcuts",
        keywords: ["keyboard", "shortcuts", "help", "keys"],
        aliases: ["shortcuts", "help"],
        action: () => setIsKeyboardShortcutsOpen(true),
      },
      {
        id: "action:export-time-csv",
        label: "Export Time Report CSV",
        category: "action",
        description: "Download task time estimates and actuals as CSV",
        keywords: ["time", "report", "csv", "export", "spent", "estimate"],
        aliases: ["time csv", "export time"],
        action: async () => {
          const { timeReportingService } = await import("./src/services/timeReportingService");
          const csv = timeReportingService.exportTimeDataToCSV(tasks, projects);
          const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "liquitask-time-report.csv";
          link.click();
          URL.revokeObjectURL(url);
          addToast("Exported time report CSV", "success");
        },
      },
      {
        id: "action:export-time-json",
        label: "Export Time Report JSON",
        category: "action",
        description: "Download grouped task time report as JSON",
        keywords: ["time", "report", "json", "export", "analytics"],
        aliases: ["time json", "export time json"],
        action: async () => {
          const { timeReportingService } = await import("./src/services/timeReportingService");
          const report = timeReportingService.generateTimeReport(
            tasks,
            { groupBy: "project" },
            projects,
          );
          const json = timeReportingService.exportTimeDataToJSON(report);
          const url = URL.createObjectURL(
            new Blob([json], { type: "application/json;charset=utf-8" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "liquitask-time-report.json";
          link.click();
          URL.revokeObjectURL(url);
          addToast("Exported time report JSON", "success");
        },
      },
      {
        id: "action:bulk-ai-operations",
        label: "Bulk AI Operations",
        category: "action",
        description: "Run batch AI operations: deduplicate, reprioritize, categorize",
        keywords: ["ai", "bulk", "batch", "cleanup", "organize"],
        aliases: ["ai cleanup", "ai organize", "ai batch"],
        action: () => setIsBulkAIOperationsOpen(true),
      },
      {
        id: "action:auto-organize",
        label: "AI Auto-Organize",
        category: "action",
        description: "Smart task grouping, merging, deduplication, and categorization",
        keywords: ["ai", "organize", "group", "merge", "deduplicate", "cluster", "auto"],
        aliases: ["ai organize", "auto organize", "smart organize", "ai cleanup"],
        action: () => setIsAutoOrganizeOpen(true),
      },
      {
        id: "action:ai-health-dashboard",
        label: "AI Health Dashboard",
        category: "action",
        description: "View AI-generated task health metrics and insights",
        keywords: ["ai", "health", "dashboard", "insights", "metrics", "analytics"],
        aliases: ["ai insights", "health check", "task health"],
        action: () => setIsAiHealthDashboardOpen(true),
      },
      {
        id: "action:ai-merge-duplicates",
        label: "Smart Merge Duplicates",
        category: "action",
        description: "Find and merge duplicate tasks with AI",
        keywords: ["ai", "merge", "duplicates", "cleanup"],
        aliases: ["merge dupes", "ai merge"],
        action: () => setIsAiMergeModalOpen(true),
      },
      {
        id: "action:ai-reorganize",
        label: "Smart Reorganize",
        category: "action",
        description: "AI-powered task clustering and project creation",
        keywords: ["ai", "reorganize", "cluster", "group", "projects"],
        aliases: ["ai cluster", "ai group"],
        action: () => setIsAiReorganizeModalOpen(true),
      },
      {
        id: "action:ai-subtask-conversion",
        label: "Convert to Subtasks",
        category: "action",
        description: "AI suggests tasks that should be subtasks",
        keywords: ["ai", "subtask", "convert", "hierarchy"],
        aliases: ["ai subtasks", "make subtask"],
        action: () => setIsAiSubtaskModalOpen(true),
      },
      {
        id: "action:ai-project-assignment",
        label: "Smart Project Assignment",
        category: "action",
        description: "AI suggests optimal project assignments for tasks",
        keywords: ["ai", "project", "assignment", "reassign"],
        aliases: ["ai assign", "project suggest"],
        action: () => setIsAiProjectAssignmentModalOpen(true),
      },
      {
        id: "action:ai-prioritize",
        label: "AI Suggest Priorities",
        category: "action",
        description: "AI suggests task priorities based on context",
        keywords: ["ai", "priority", "suggest", "optimization"],
        aliases: ["ai priorities", "optimize priorities"],
        action: handleAiPrioritize,
      },
      {
        id: "action:ai-suggest-next",
        label: "Suggest My Next Task",
        category: "action",
        description: "AI recommends the most critical task to work on next",
        keywords: ["ai", "next", "suggest", "priority", "recommendation"],
        aliases: ["what next", "ai suggest"],
        action: handleSuggestNextTask,
      },
      {
        id: "action:ai-insights",
        label: "AI Insights",
        category: "action",
        description: "View AI-generated insights and recommendations",
        keywords: ["ai", "insights", "recommendations", "analysis"],
        aliases: ["ai tips", "smart insights"],
        action: handleAiInsights,
      },
      {
        id: "action:ai-report-daily",
        label: "Generate Daily AI Report",
        category: "action",
        description: "Generate and download a daily AI summary report",
        keywords: ["ai", "report", "daily", "summary", "export"],
        aliases: ["daily report", "export daily"],
        action: async () => {
          addToast("Generating daily report...", "info");
          try {
            const { aiSummaryService } = await import("./src/services/aiSummaryService");
            const report = await aiSummaryService.generateDailyReport(tasks);
            aiSummaryService.downloadReport(report);
            addToast("Daily report downloaded!", "success");
          } catch {
            addToast("Failed to generate daily report", "error");
          }
        },
      },
      {
        id: "action:ai-report-weekly",
        label: "Generate Weekly AI Report",
        category: "action",
        description: "Generate and download a weekly AI summary report",
        keywords: ["ai", "report", "weekly", "summary", "export"],
        aliases: ["weekly report", "export weekly"],
        action: async () => {
          addToast("Generating weekly report...", "info");
          try {
            const { aiSummaryService } = await import("./src/services/aiSummaryService");
            const report = await aiSummaryService.generateWeeklyReport(tasks);
            aiSummaryService.downloadReport(report);
            addToast("Weekly report downloaded!", "success");
          } catch {
            addToast("Failed to generate weekly report", "error");
          }
        },
      },
      {
        id: "view:project",
        label: "Project View",
        category: "view",
        description: "Switch to project workspace canvas",
        keywords: ["project", "board"],
        aliases: ["workspace", "projects"],
        action: () => setCurrentView("project"),
      },
      {
        id: "view:dashboard",
        label: "Dashboard View",
        category: "view",
        description: "Switch to executive summary dashboard",
        keywords: ["dashboard", "analytics", "overview"],
        aliases: ["insights", "metrics"],
        action: () => setCurrentView("dashboard"),
      },
      {
        id: "view:gantt",
        label: "Gantt View",
        category: "view",
        description: "Switch to Gantt timeline",
        keywords: ["gantt", "timeline"],
        aliases: ["gantt", "timeline"],
        action: () => {
          setCurrentView("gantt");
          setViewMode("gantt");
        },
      },
      {
        id: "view:archive",
        label: "Archive View",
        category: "view",
        description: "Browse and restore archived tasks",
        keywords: ["archive", "archived", "restore", "deleted"],
        aliases: ["archived tasks", "restore tasks"],
        action: () => setCurrentView("archive"),
      },
      {
        id: "viewmode:board",
        label: "Board Mode",
        category: "view",
        description: "Show Kanban board layout",
        keywords: ["mode", "board", "kanban"],
        aliases: ["kanban", "cards"],
        action: () => setViewMode("board"),
      },
      {
        id: "viewmode:stats",
        label: "Stats Mode",
        category: "view",
        description: "Show statistics mode",
        keywords: ["statistics", "mode", "report"],
        aliases: ["analytics", "numbers"],
        action: () => setViewMode("stats"),
      },
      {
        id: "viewmode:calendar",
        label: "Calendar Mode",
        category: "view",
        description: "Show calendar mode",
        keywords: ["calendar", "timeline", "due"],
        aliases: ["schedule", "dates"],
        action: () => setViewMode("calendar"),
      },
    ];

    const topProjectActions: CommandAction[] = projects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12)
      .map((project) => ({
        id: `project:${project.id}`,
        label: `Project: ${project.name}`,
        category: "project",
        description: `Switch to ${project.name}`,
        keywords: ["project", project.name.toLowerCase(), project.id.toLowerCase()],
        aliases: [project.name.toLowerCase()],
        action: () => {
          setActiveProjectId(project.id);
          setCurrentView("project");
          setViewMode("board");
          addToast(`Switched to project "${project.name}"`, "info");
        },
      }));

    const templateActions: CommandAction[] = (templateServiceRef.current?.getAllTemplates?.() ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12)
      .map((template) => ({
        id: `template:${template.id}`,
        label: `Template: ${template.name}`,
        category: "action",
        description: template.description || "Create a task from a saved template",
        keywords: ["template", "create", "task", template.name.toLowerCase()],
        aliases: [template.name.toLowerCase(), `template ${template.name.toLowerCase()}`],
        action: () => {
          try {
            const draft = templateServiceRef.current?.createFromTemplate?.(template.id) ?? {};
            handleCreateOrUpdateTask({ ...draft, projectId: activeProjectId }, null);
            addToast(`Created task from "${template.name}"`, "success");
          } catch (error) {
            addToast(error instanceof Error ? error.message : "Failed to apply template", "error");
          }
        },
      }));

    return [...topProjectActions, ...templateActions, ...baseActions].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [
    activeProjectId,
    addToast,
    handleCreateOrUpdateTask,
    handleAiInsights,
    handleAiPrioritize,
    handleSuggestNextTask,
    handleUndo,
    isAssistantOpen,
    isCompactView,
    isFilterOpen,
    isSidebarCollapsed,
    isWarRoomOpen,
    projects,
    setAiAssistantOpen,
    tasks,
  ]);

  // --- Debounced persistence ---
  const persistWithToast = useCallback(
    (key: string, value: unknown, label: string) => {
      persistStorageQuiet(key, value, (message) => {
        addToast(`Failed to save ${label}: ${message}`, "error");
      });
    },
    [addToast],
  );

  const debouncedSaveColumns = useMemo(
    () => debounce((cols: BoardColumn[]) => persistWithToast(STORAGE_KEYS.COLUMNS, cols, "columns"), 500),
    [persistWithToast],
  );
  const debouncedSaveProjects = useMemo(
    () => debounce((projs: Project[]) => persistWithToast(STORAGE_KEYS.PROJECTS, projs, "projects"), 500),
    [persistWithToast],
  );
  const debouncedSaveTasks = useMemo(
    () => debounce((tsks: Task[]) => persistWithToast(STORAGE_KEYS.TASKS, tsks, "tasks"), 500),
    [persistWithToast],
  );

  useEffect(() => {
    if (isLoaded) debouncedSaveColumns(columns);
  }, [columns, debouncedSaveColumns, isLoaded]);
  useEffect(() => {
    if (isLoaded) debouncedSaveProjects(projects);
  }, [projects, debouncedSaveProjects, isLoaded]);
  useEffect(() => {
    if (isLoaded) debouncedSaveTasks(tasks);
  }, [tasks, debouncedSaveTasks, isLoaded]);
  useEffect(() => {
    const flushPending = () => {
      debouncedSaveColumns.flush();
      debouncedSaveProjects.flush();
      debouncedSaveTasks.flush();
    };
    window.addEventListener("beforeunload", flushPending);
    return () => {
      window.removeEventListener("beforeunload", flushPending);
      flushPending();
    };
  }, [debouncedSaveColumns, debouncedSaveProjects, debouncedSaveTasks]);
  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.ACTIVE_PROJECT, activeProjectId, "active project");
    }
  }, [activeProjectId, isLoaded, persistWithToast]);
  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.VIEW_MODE, viewMode, "view mode");
    }
  }, [viewMode, isLoaded, persistWithToast]);
  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.CURRENT_VIEW, currentView, "current view");
    }
  }, [currentView, isLoaded, persistWithToast]);

  useEffect(() => {
    if (!isLoaded) return;
    persistWithToast(STORAGE_KEYS.PRIORITIES, priorities, "priorities");
    if (indexedDBService.isAvailable()) {
      indexedDBService.savePriorities(priorities).catch(console.error);
    }
  }, [priorities, isLoaded, persistWithToast]);

  useEffect(() => {
    if (!isLoaded) return;
    persistWithToast(STORAGE_KEYS.CUSTOM_FIELDS, customFields, "custom fields");
    if (indexedDBService.isAvailable()) {
      indexedDBService.saveCustomFields(customFields).catch(console.error);
    }
  }, [customFields, isLoaded, persistWithToast]);

  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.PROJECT_TYPES, projectTypes, "project types");
    }
  }, [projectTypes, isLoaded, persistWithToast]);

  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.GROUPING, boardGrouping, "grouping");
    }
  }, [boardGrouping, isLoaded, persistWithToast]);

  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.COMPACT_VIEW, isCompactView, "compact view");
    }
  }, [isCompactView, isLoaded, persistWithToast]);

  useEffect(() => {
    if (isLoaded) {
      persistWithToast(
        STORAGE_KEYS.SHOW_SUB_WORKSPACE_TASKS,
        showSubWorkspaceTasks,
        "sub-workspace tasks",
      );
    }
  }, [showSubWorkspaceTasks, isLoaded, persistWithToast]);

  useEffect(() => {
    if (isLoaded) {
      persistWithToast(STORAGE_KEYS.SIDEBAR_COLLAPSED, isSidebarCollapsed, "sidebar state");
    }
  }, [isSidebarCollapsed, isLoaded, persistWithToast]);

  // --- Derived Data ---
  const activeProject: Project = projects.find((p) => p.id === activeProjectId) ||
    projects[0] || { name: "No Project", id: "temp", type: "default" };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.assignee) count++;
    if (filters.tags) count++;
    if (filters.dateRange && filters.startDate && filters.endDate) count++;
    if (activeFilterGroup.rules.length > 0) count += activeFilterGroup.rules.length;
    return count;
  }, [filters, activeFilterGroup]);

  const taskContextIndex = useMemo(
    () => buildTaskContextIndex(currentProjectTasks),
    [currentProjectTasks],
  );

  const getTasksByContext = useCallback(
    (statusId: string, priorityId?: string) =>
      getTasksFromContextIndex(taskContextIndex, statusId, priorityId),
    [taskContextIndex],
  );

  const handleUpdateColumns = (newColumns: BoardColumn[]) => {
    if (!Array.isArray(newColumns)) return;
    setColumns(newColumns);
    if (indexedDBService.isAvailable())
      indexedDBService.saveColumns(newColumns).catch(console.error);
  };

  const handleArchiveTaskInternal = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      await archiveService.archiveTask(task);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      searchIndexServiceRef.current?.removeTask?.(task);
      if (indexedDBService.isAvailable()) {
        indexedDBService.deleteTask(taskId).catch(console.error);
      }
      addToast(`Archived "${task.title}"`, "info");
    },
    [tasks, addToast, setTasks],
  );

  const handleRequestNotificationPermission = useCallback(async () => {
    let granted: boolean | string = false;
    if (notificationServiceRef.current) {
      granted = await notificationServiceRef.current.requestPermission();
    } else {
      const { notificationService } = await import("./src/services/notificationService");
      notificationServiceRef.current = notificationService;
      granted = await notificationService.requestPermission();
    }

    const isGranted = granted === true || String(granted) === "granted";
    setNotificationPermission(isGranted ? "granted" : "denied");
    if (isGranted) {
      notificationServiceRef.current?.show({
        title: "Notifications Enabled",
        body: "You will now receive task reminders.",
      });
    }
  }, []);

  const runtimeState = getRuntimeState();
  const sidebarOffset = isSidebarCollapsed ? 0 : SIDEBAR_OFFSET_DELTA;

  // v3 shell: the run currently open in the RunView drawer, if any.
  const selectedRun = selectedRunId ? (agentRuns.find((r) => r.id === selectedRunId) ?? null) : null;
  const selectedRunAgent = selectedRun
    ? agents.find((a) => a.id === selectedRun.agentId)
    : undefined;
  const selectedRunTask = selectedRun ? tasks.find((t) => t.id === selectedRun.taskId) : undefined;

  // The existing view/viewMode lens content (Archive/Dashboard/Gantt/Kanban board), shared
  // verbatim between the legacy shell and the v3 shell's "Board" surface — nothing about
  // this logic changes with the shell rework, only where it's mounted.
  const boardLensContent =
    currentView === "archive" ? (
      <ArchiveView
        onUnarchive={(restoredTasks) => {
          setTasks((prev) => [...prev, ...restoredTasks]);
          restoredTasks.forEach((task) => {
            searchIndexServiceRef.current?.updateTask?.(task);
            if (indexedDBService.isAvailable()) {
              indexedDBService.saveTask(task).catch(console.error);
            }
          });
          addToast(`Restored ${restoredTasks.length} task(s)`, "success");
        }}
        onDelete={(taskIds) => {
          addToast(`Deleted ${taskIds.length} archived task(s)`, "info");
        }}
      />
    ) : currentView === "dashboard" ? (
      <Dashboard
        tasks={filteredTasks}
        projects={projects}
        priorities={priorities}
        columns={columns}
        boardGrouping={boardGrouping}
        activeProjectId={activeProjectId}
        onEditTask={(t) => {
          setEditingTask(t);
          setIsTaskModalOpen(true);
        }}
        onDeleteTask={handleDeleteTaskInternal}
        onArchiveTask={handleArchiveTaskInternal}
        onMoveTask={handleMoveTask}
        onUpdateTask={handleUpdateTask}
        onUpdateColumns={handleUpdateColumns}
        getTasksByContext={getTasksByContext}
        isCompact={isCompactView}
        onCopyTask={(msg) => addToast(msg, "success")}
        onMoveToWorkspace={handleMoveTaskToWorkspace}
        onUpdateDueDate={handleUpdateTaskDueDate}
        onCreateTask={(d) => {
          setEditingTask({
            id: `temp-${Date.now()}`,
            jobId: "",
            projectId: activeProjectId,
            title: "",
            subtitle: "",
            summary: "",
            assignee: "",
            priority: priorities[0]?.id || "medium",
            status: getBacklogColumnId(columns),
            createdAt: new Date(),
            dueDate: d,
            subtasks: [],
            attachments: [],
            tags: [],
            timeEstimate: 0,
            timeSpent: 0,
          });
          setIsTaskModalOpen(true);
        }}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onSuggestNextTask={handleSuggestNextTask}
        nextTaskSuggestion={nextTaskSuggestion}
        addToast={addToast}
      />
    ) : viewMode === "gantt" ? (
      <GanttView
        tasks={currentProjectTasks}
        columns={columns}
        priorities={priorities}
        onEditTask={(t) => {
          setEditingTask(t);
          setIsTaskModalOpen(true);
        }}
        onUpdateTask={handleUpdateTask}
      />
    ) : (
      <ProjectBoard
        columns={columns}
        priorities={priorities}
        tasks={currentProjectTasks}
        allTasks={tasks}
        boardGrouping={boardGrouping}
        onUpdateColumns={handleUpdateColumns}
        onMoveTask={handleMoveTask}
        onEditTask={(t) => {
          setEditingTask(t);
          setIsTaskModalOpen(true);
        }}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTaskInternal}
        onArchiveTask={handleArchiveTaskInternal}
        addToast={addToast}
        getTasksByContext={getTasksByContext}
        isCompact={isCompactView}
        onCopyTask={(msg) => addToast(msg, "success")}
        projectName={activeProject.name}
        projects={projects}
        onMoveBlocked={(msg) => addToast(msg, "error")}
        onMoveToWorkspace={handleMoveTaskToWorkspace}
        canMoveTask={canMoveTask}
        agents={agents}
        onAssignTaskToAgent={(task, agentId) => void assignTaskToAgent(task, agentId)}
        onApproveAgentWork={(task, run) => void approveAgentWork(task, run)}
        onRejectAgentWork={(task, run, feedback) => void rejectAgentWork(task, run, feedback)}
      />
    );

  if (desktopEncryptionBlocked === true) {
    return (
      <DesktopEncryptionGate
        onUnlocked={() => {
          setIsLoaded(false);
          setEncryptionEpoch((epoch) => epoch + 1);
          setDesktopEncryptionBlocked(false);
        }}
      />
    );
  }

  if (webEncryptionBlocked === true) {
    return (
      <WebEncryptionGate
        onUnlocked={() => {
          setIsLoaded(false);
          setEncryptionEpoch((epoch) => epoch + 1);
          setWebEncryptionBlocked(false);
        }}
      />
    );
  }

  if (webEncryptionBlocked === null || desktopEncryptionBlocked === null || !isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white" role="status" aria-live="polite" aria-busy="true">
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-16 h-16 object-contain animate-pulse" />
          <Loader2 className="w-10 h-10 text-red-500 animate-spin" aria-hidden="true" />
          <p className="text-slate-400">Loading LiquiTask...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen text-slate-200 font-sans overflow-x-auto scrollbar-hide ${runtimeState.hasCustomWindowControls ? "pt-14" : ""}`}
    >
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <TitleBar />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-gradient-to-br from-red-950/30 via-slate-950 to-slate-950"
      />

      <Suspense fallback={<SidebarLoadingFallback isCollapsed={isSidebarCollapsed} />}>
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          projectTypes={projectTypes}
          isCollapsed={isSidebarCollapsed}
          toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onSelectProject={(id) => {
            setActiveProjectId(id);
            setCurrentView("project");
            setViewMode("board");
            setIsSidebarCollapsed(true);
          }}
          onAddProject={(pid) => {
            setCreatingSubProjectFor(pid);
            setIsProjectModalOpen(true);
          }}
          onDeleteProject={(id) =>
            handleDeleteProject(id, activeProjectId, setActiveProjectId, setTasks)
          }
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          currentView={currentView}
          onChangeView={setCurrentView}
          onTogglePin={handleTogglePin}
          onMoveProject={handleMoveProject}
          onEditProject={handleEditProject}
        />
      </Suspense>

      <Suspense fallback={null}>
        <MobileNavDrawer
          isOpen={isMobileNavOpen}
          onClose={() => setIsMobileNavOpen(false)}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(id) => {
            setActiveProjectId(id);
            setCurrentView("project");
            setViewMode("board");
          }}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          currentView={currentView}
          onChangeView={setCurrentView}
        />
      </Suspense>

      <main id="main-content" className="relative z-10 min-h-screen flex flex-col md:pl-[104px]">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto scrollbar-hide">
          <div className="px-6 md:px-8 pt-4">
            <Suspense fallback={<HeaderLoadingFallback sidebarOffset={sidebarOffset} />}>
              <AppHeader
              isHeaderExpanded={isHeaderExpanded}
              sidebarOffset={sidebarOffset}
              currentView={currentView}
              viewMode={viewMode}
              currentProjectName={activeProject.name}
              parentProjectName={
                activeProject.parentId
                  ? projects.find((p) => p.id === activeProject.parentId)?.name
                  : undefined
              }
              currentProjectPinned={activeProject.pinned ?? false}
              currentProjectTaskCount={currentProjectTasks.length}
              canUndo={canUndo}
              isCompactView={isCompactView}
              isFilterOpen={isFilterOpen}
              hasActiveFilters={activeFilterCount > 0}
              activeFilterCount={activeFilterCount}
              notificationPermission={notificationPermission}
              searchQuery={searchQuery}
              isSearchFocused={isSearchFocused}
              filters={filters}
              activeFilterGroup={activeFilterGroup}
              customFields={customFields}
              views={views}
              activeViewId={activeViewId}
              searchInputRef={searchInputRef}
              searchHistory={searchHistory}
              onHeaderExpand={setIsHeaderExpanded}
              onViewModeChange={setViewMode}
              onUndo={handleUndo}
              onToggleCompactView={() => setIsCompactView(!isCompactView)}
              onToggleFilter={() => setIsFilterOpen(!isFilterOpen)}
              onRequestNotificationPermission={handleRequestNotificationPermission}
              onOpenTaskModal={() => {
                setEditingTask(null);
                setIsTaskModalOpen(true);
              }}
              onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
              onSearchQueryChange={setSearchQuery}
              onSearchFocusChange={setIsSearchFocused}
              onApplyView={handleApplyView}
              onCreateView={handleCreateView}
              onDeleteView={deleteView}
              onFiltersChange={setFilters}
              onAdvancedFilterChange={setActiveFilterGroup}
              onClearFilters={() => {
                setFilters({
                  assignee: "",
                  dateRange: null,
                  startDate: "",
                  endDate: "",
                  tags: "",
                });
                setActiveFilterGroup({ id: "root", operator: "AND", rules: [] });
              }}
              onAiPrioritize={handleAiPrioritize}
              onAiInsights={handleAiInsights}
              onNaturalLanguageSearch={handleNaturalLanguageSearch}
              isNaturalLanguageSearch={isNaturalLanguageSearch}
              onToggleNaturalLanguageSearch={() =>
                setIsNaturalLanguageSearch(!isNaturalLanguageSearch)
              }
              onOpenMobileNav={() => setIsMobileNavOpen(true)}
              onToggleAssistant={
                isAiAssistantSidebarEnabled ? () => setAiAssistantOpen((prev) => !prev) : undefined
              }
              />
            </Suspense>
          </div>

          <div className="px-6 md:px-8 pb-6">
          {FEATURE_FLAGS.V3_SHELL_ENABLED && (
            <div className="flex items-center gap-1 mb-4 rounded-xl border border-white/10 bg-black/20 p-1 w-fit">
              {(["inbox", "board", "agents"] as const).map((surface) => (
                <button
                  key={surface}
                  type="button"
                  onClick={() => setActiveSurface(surface)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                    activeSurface === surface
                      ? "bg-red-500/20 text-red-200"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {surface}
                </button>
              ))}
            </div>
          )}
          {isTauri() && !standupDismissed && !FEATURE_FLAGS.V3_SHELL_ENABLED && currentView === "dashboard" && (
            <AgentStandupCard
              digest={agentStandup}
              onDismiss={() => setStandupDismissed(true)}
            />
          )}
          <ViewTransition
            transitionKey={
              FEATURE_FLAGS.V3_SHELL_ENABLED
                ? `${activeSurface}-${activeProjectId}-${viewMode}`
                : `${currentView}-${activeProjectId}-${viewMode}`
            }
            type="fade"
            duration={400}
            className="h-full"
          >
            <Suspense fallback={<ViewLoadingFallback />}>
              {FEATURE_FLAGS.V3_SHELL_ENABLED ? (
                activeSurface === "inbox" ? (
                  <InboxView
                    agentRuns={agentRuns}
                    agents={agents}
                    tasks={tasks}
                    standupDigest={agentStandup}
                    onOpenRun={setSelectedRunId}
                    onApprove={(task, run) => void approveAgentWork(task, run)}
                    onReject={(task, run, feedback) => void rejectAgentWork(task, run, feedback)}
                    onDismissStandup={() => setStandupDismissed(true)}
                  />
                ) : activeSurface === "agents" ? (
                  <AgentsView
                    agents={agents}
                    agentRuns={agentRuns}
                    runtimeHealth={runtimeHealth}
                    onOpenRun={setSelectedRunId}
                  />
                ) : (
                  boardLensContent
                )
              ) : (
                boardLensContent
              )}
            </Suspense>
          </ViewTransition>
          </div>
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>

      {isQuickAddOpen && (
        <Suspense fallback={null}>
          <QuickAddBar
            isVisible={isQuickAddOpen}
            onClose={() => setIsQuickAddOpen(false)}
            projects={projects}
            addToast={addToast}
            onAddTask={(title, options) => {
              const targetProject = options?.projectId
                ? projects.find((project) => project.id === options.projectId)
                : undefined;
              handleCreateOrUpdateTask(
                {
                  title,
                  projectId: targetProject?.id ?? activeProjectId,
                  priority: options?.priority,
                  dueDate: options?.dueDate,
                  timeEstimate: options?.timeEstimate,
                  tags: options?.tags,
                  summary: options?.summary,
                  assignee: options?.assignee,
                },
                null,
              );
              if (options?.assignee && agentService.getAgentByAssignee(options.assignee)) {
                addToast(`Assigned to agent ${options.assignee} — will pick up per agent settings.`, "info");
              }
            }}
          />
        </Suspense>
      )}

      {isTaskModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <TaskFormModal
            isOpen={isTaskModalOpen}
            onClose={() => setIsTaskModalOpen(false)}
            onSubmit={(data) => handleCreateOrUpdateTask(data, editingTask)}
            onBulkCreateTasks={handleBulkCreateTasks}
            initialData={editingTask}
            projectId={activeProjectId}
            priorities={priorities}
            customFields={customFields}
            availableTasks={tasks}
            columns={columns}
            allProjects={projects}
            aiSettings={aiSettings}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isProjectModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <ProjectModal
            isOpen={isProjectModalOpen}
            onClose={() => setIsProjectModalOpen(false)}
            onSubmit={handleCreateProject}
            projects={projects}
            initialParentId={creatingSubProjectFor}
          />
        </Suspense>
      )}

      {isSettingsModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <SettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            appData={{
              projects,
              tasks,
              columns,
              projectTypes,
              priorities,
              customFields,
            }}
            onImportData={(d) => {
              if (d.columns) handleUpdateColumns(d.columns);
              if (d.projectTypes) {
                setProjectTypes(d.projectTypes);
                persistWithToast(STORAGE_KEYS.PROJECT_TYPES, d.projectTypes, "project types");
              }
              if (d.priorities) {
                setPriorities(d.priorities);
                if (indexedDBService.isAvailable()) {
                  indexedDBService.savePriorities(d.priorities).catch(console.error);
                }
                persistWithToast(STORAGE_KEYS.PRIORITIES, d.priorities, "priorities");
              }
              if (d.customFields) {
                setCustomFields(d.customFields);
                if (indexedDBService.isAvailable()) {
                  indexedDBService.saveCustomFields(d.customFields).catch(console.error);
                }
                persistWithToast(STORAGE_KEYS.CUSTOM_FIELDS, d.customFields, "custom fields");
              }
              if (d.projects) {
                setProjects(d.projects);
                if (indexedDBService.isAvailable()) {
                  Promise.all(d.projects.map((p) => indexedDBService.saveProject(p))).catch(
                    console.error,
                  );
                }
                persistWithToast(STORAGE_KEYS.PROJECTS, d.projects, "projects");
              }
              if (d.tasks) {
                setTasks(d.tasks);
                searchIndexServiceRef.current?.buildIndex(d.tasks);
                if (indexedDBService.isAvailable()) {
                  indexedDBService.saveTasks(d.tasks).catch(console.error);
                }
                persistWithToast(STORAGE_KEYS.TASKS, d.tasks, "tasks");
              }
              if (d.activeProjectId) {
                setActiveProjectId(d.activeProjectId);
                persistWithToast(STORAGE_KEYS.ACTIVE_PROJECT, d.activeProjectId, "active project");
              }
              if (d.grouping) {
                setBoardGrouping(d.grouping);
                persistWithToast(STORAGE_KEYS.GROUPING, d.grouping, "grouping");
              }
              if (d.sidebarCollapsed !== undefined) {
                setIsSidebarCollapsed(d.sidebarCollapsed);
                persistWithToast(
                  STORAGE_KEYS.SIDEBAR_COLLAPSED,
                  d.sidebarCollapsed,
                  "sidebar state",
                );
              }
            }}
            onUpdateColumns={handleUpdateColumns}
            onUpdateProjectTypes={setProjectTypes}
            onUpdatePriorities={setPriorities}
            onUpdateCustomFields={setCustomFields}
            grouping={boardGrouping}
            onUpdateGrouping={setBoardGrouping}
            addToast={addToast}
            onBulkCreateTasks={handleBulkCreateTasks}
            showSubWorkspaceTasks={showSubWorkspaceTasks}
            onUpdateShowSubWorkspaceTasks={setShowSubWorkspaceTasks}
            onOpenMergeModal={() => setIsAiMergeModalOpen(true)}
            onOpenReorganizeModal={() => setIsAiReorganizeModalOpen(true)}
            onOpenSubtaskModal={() => setIsAiSubtaskModalOpen(true)}
            onOpenProjectAssignmentModal={() => setIsAiProjectAssignmentModalOpen(true)}
            onOpenHealthDashboard={() => setIsAiHealthDashboardOpen(true)}
            onOpenBulkOperations={() => setIsBulkAIOperationsOpen(true)}
            onOpenAutoOrganize={() => setIsAutoOrganizeOpen(true)}
            onOpenInsights={() => setIsAiInsightsOpen(true)}
            onRunAutoArchive={runAutoArchive}
            onEnableEncryption={activateEncryptionAtRest}
            onDisableEncryption={deactivateEncryptionAtRest}
            onEncryptionChanged={handleEncryptionChange}
            onAgentsChanged={refreshAgents}
            activeProjectId={activeProjectId}
            onImportGitHubTasks={(newTasks) => {
              setTasks((prev) => [...prev, ...newTasks]);
              newTasks.forEach((t) => searchIndexServiceRef.current?.updateTask?.(t));
              if (indexedDBService.isAvailable()) {
                indexedDBService.saveTasks(newTasks).catch(console.error);
              }
              addToast(`Added ${newTasks.length} task(s) from GitHub`, "success");
            }}
          />
        </Suspense>
      )}

      {isTauri() && (
        <WarRoom
          open={isWarRoomOpen}
          onOpenChange={setIsWarRoomOpen}
          tasks={tasks}
          columns={columns}
          agents={agents}
          onCreateTasks={(newTasks) => {
            setTasks((prev) => [...prev, ...newTasks]);
            newTasks.forEach((t) => searchIndexServiceRef.current?.updateTask?.(t));
            if (indexedDBService.isAvailable()) {
              indexedDBService.saveTasks(newTasks).catch(console.error);
            }
          }}
          addToast={addToast}
        />
      )}

      {isTauri() && !FEATURE_FLAGS.V3_SHELL_ENABLED && (
        <AgentRunsDock
          tasks={tasks}
          columns={columns}
          agents={agents}
          runs={agentRuns}
          onStart={(task) => void startAgentRun(task)}
          onCancel={(runId) => void cancelAgentRun(runId)}
          onPause={(runId) => void pauseAgentRun(runId)}
          onResume={(runId) => void resumeAgentRun(runId)}
          onInjectGuidance={(runId, msg) => void injectGuidance(runId, msg)}
          onOpenTerminal={(run) => void openRunInTerminal(run)}
          onFollowUp={(runId, msg) => void followUpRun(runId, msg)}
          onApprove={(task, run) => void approveAgentWork(task, run)}
          onReject={(task, run, feedback) => void rejectAgentWork(task, run, feedback)}
          onMergeWorktree={(run) => void mergeWorktree(run)}
          onDiscardWorktree={(run) => void discardWorktree(run)}
        />
      )}

      {isTauri() && FEATURE_FLAGS.V3_SHELL_ENABLED && (
        <Suspense fallback={null}>
          <RunView
            run={selectedRun}
            agent={selectedRunAgent}
            task={selectedRunTask}
            isOpen={selectedRunId !== null}
            onClose={() => setSelectedRunId(null)}
            onCancel={(runId) => void cancelAgentRun(runId)}
            onPause={(runId) => void pauseAgentRun(runId)}
            onResume={(runId) => void resumeAgentRun(runId)}
            onInjectGuidance={(runId, msg) => void injectGuidance(runId, msg)}
            onFollowUp={(runId, msg) => void followUpRun(runId, msg)}
            onApprove={(task, run) => void approveAgentWork(task, run)}
            onReject={(task, run, feedback) => void rejectAgentWork(task, run, feedback)}
            onOpenTerminal={(run) => void openRunInTerminal(run)}
            onMergeWorktree={(run) => void mergeWorktree(run)}
            onDiscardWorktree={(run) => void discardWorktree(run)}
            permissionRequests={shellPendingPermissions}
          />
        </Suspense>
      )}

      {isCommandPaletteOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            onCreateTask={(p) =>
              handleCreateOrUpdateTask(
                {
                  title: p.title,
                  priority: p.priority,
                  dueDate: p.dueDate,
                  tags: p.tags,
                },
                null,
              )
            }
            actions={commandActions}
            commandUsageHistory={commandUsageHistory}
            onActionExecuted={recordCommandUsage}
          />
        </Suspense>
      )}

      {isKeyboardShortcutsOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <KeyboardShortcutsModal
            isOpen={isKeyboardShortcutsOpen}
            onClose={() => setIsKeyboardShortcutsOpen(false)}
          />
        </Suspense>
      )}

      {isAiMergeModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AIMergeDuplicatesModal
            isOpen={isAiMergeModalOpen}
            onClose={() => setIsAiMergeModalOpen(false)}
            allTasks={tasks}
            onUpdateTask={handleUpdateTask}
            onArchiveTask={handleArchiveTaskInternal}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiReorganizeModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AIReorganizeModal
            isOpen={isAiReorganizeModalOpen}
            onClose={() => setIsAiReorganizeModalOpen(false)}
            allTasks={tasks}
            onCreateProject={(p) => handleCreateProject(p)}
            onMoveTask={(taskId, projectId) => handleUpdateTask(taskId, { projectId })}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiSubtaskModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AISubtaskSuggestionsModal
            isOpen={isAiSubtaskModalOpen}
            onClose={() => setIsAiSubtaskModalOpen(false)}
            allTasks={tasks}
            onUpdateTask={handleUpdateTask}
            onArchiveTask={handleArchiveTaskInternal}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiProjectAssignmentModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AIProjectAssignmentModal
            isOpen={isAiProjectAssignmentModalOpen}
            onClose={() => setIsAiProjectAssignmentModalOpen(false)}
            allTasks={tasks}
            projects={projects}
            onUpdateTask={handleUpdateTask}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiHealthDashboardOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AIHealthDashboard
            isOpen={isAiHealthDashboardOpen}
            onClose={() => setIsAiHealthDashboardOpen(false)}
            allTasks={tasks}
            projects={projects}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiInsightsOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AIInsightsPanel
            allTasks={currentProjectTasks}
            isOpen={isAiInsightsOpen}
            onClose={() => setIsAiInsightsOpen(false)}
          />
        </Suspense>
      )}

      {isAiPrioritizing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-slate-900/90 px-8 py-6 shadow-2xl">
            <Sparkles size={32} className="text-cyan-400 animate-pulse" />
            <p className="text-sm font-medium text-white">AI is analyzing task priorities...</p>
            <p className="text-xs text-slate-400">This may take a moment</p>
          </div>
        </div>
      )}

      {isBulkAIOperationsOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <BulkAIOperationsModal
            isOpen={isBulkAIOperationsOpen}
            onClose={() => setIsBulkAIOperationsOpen(false)}
            allTasks={tasks}
            onUpdateTask={handleUpdateTask}
            onArchiveTask={handleArchiveTaskInternal}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAutoOrganizeOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <AutoOrganizePanel
            isOpen={isAutoOrganizeOpen}
            onClose={() => setIsAutoOrganizeOpen(false)}
            allTasks={tasks}
            onUpdateTask={handleUpdateTask}
            onArchiveTask={handleArchiveTaskInternal}
            onMoveTask={handleMoveTaskToWorkspace}
            addToast={addToast}
          />
        </Suspense>
      )}

      {isAiAssistantSidebarEnabled && (
        <Suspense fallback={null}>
          <AIRightRail
            isOpen={isAssistantOpen}
            onToggle={() => setAiAssistantOpen((prev) => !prev)}
            isLoading={isAssistantLoading}
          />
          {isAssistantOpen && (
            <TaskAssistantSidebar
              isOpen={isAssistantOpen}
              onClose={() => setAiAssistantOpen(false)}
              messages={assistantMessages}
              onSendMessage={handleSendAssistantMessage}
              isLoading={isAssistantLoading}
              isSearching={isAssistantSearching}
              activeTool={assistantActiveTool}
              onClearChat={handleClearAssistantChat}
              activeProject={activeProject}
              onUpdateProjectPaths={handleUpdateProjectPaths}
              globalPaths={assistantGlobalPaths}
              onGlobalPathsChange={setAssistantGlobalPaths}
            />
          )}
        </Suspense>
      )}
    </div>
  );
};

export default App;
