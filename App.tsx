import { Loader2, Sparkles } from 'lucide-react';
import type React from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Toast } from './components/Toast';
import logo from './src/assets/logo.png';
// Power User Features
import type { CommandAction } from './src/components/CommandPalette';
import { ViewTransition } from './src/components/ViewTransition';
import { STORAGE_KEYS } from './src/constants';
import { useConfirmation } from './src/contexts/ConfirmationContext';
import { useAiKeyboardShortcuts } from './src/hooks/useAiKeyboardShortcuts';
import { useAppInitialization } from './src/hooks/useAppInitialization';
import { useGlobalKeyboardShortcuts } from './src/hooks/useGlobalKeyboardShortcuts';
import { useTaskAssistant } from './src/hooks/useTaskAssistant';
import { useProjectController } from './src/hooks/useProjectController';
import useSavedViews from './src/hooks/useSavedViews';
import { useSearchHistory } from './src/hooks/useSearchHistory';
// Hooks
import { useTaskController } from './src/hooks/useTaskController';
import { getRuntimeState } from './src/runtime/runtimeEnvironment';
import { aiService } from './src/services/aiService';
import { indexedDBService } from './src/services/indexedDBService';
import storageService from './src/services/storageService';
import type { FilterGroup } from './src/types/queryTypes';
import { debounce } from './src/utils/debounce';
import { filterTasksBySearch } from './src/utils/taskSearch';
import type {
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
  ToastMessage,
  ToastType,
} from './types';

// Initial fallbacks
const defaultColumns: BoardColumn[] = [
  { id: 'Pending', title: 'Pending', color: '#64748b', wipLimit: 0 },
  { id: 'InProgress', title: 'In Progress', color: '#3b82f6', wipLimit: 10 },
  {
    id: 'Completed',
    title: 'Completed',
    color: '#10b981',
    isCompleted: true,
    wipLimit: 0,
  },
  { id: 'Delivered', title: 'Delivered', color: '#a855f7', wipLimit: 0 },
];

const defaultProjectTypes: ProjectType[] = [
  { id: 'folder', label: 'General', icon: 'folder' },
  { id: 'dev', label: 'Development', icon: 'code' },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone' },
  { id: 'mobile', label: 'Mobile App', icon: 'smartphone' },
  { id: 'inventory', label: 'Inventory', icon: 'box' },
];

const defaultPriorities: PriorityDefinition[] = [
  { id: 'high', label: 'High', color: '#ef4444', level: 1, icon: 'flame' },
  { id: 'medium', label: 'Medium', color: '#eab308', level: 2, icon: 'clock' },
  { id: 'low', label: 'Low', color: '#10b981', level: 3, icon: 'arrow-down' },
];

// Lazy Components
const TaskFormModal = lazy(() =>
  import('./components/TaskFormModal').then(module => ({
    default: module.TaskFormModal,
  }))
);
const ProjectModal = lazy(() =>
  import('./components/ProjectModal').then(module => ({
    default: module.ProjectModal,
  }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then(module => ({
    default: module.SettingsModal,
  }))
);
const Sidebar = lazy(() =>
  import('./components/Sidebar').then(module => ({
    default: module.Sidebar,
  }))
);
const Dashboard = lazy(() =>
  import('./components/Dashboard').then(module => ({
    default: module.Dashboard,
  }))
);
const GanttView = lazy(() => import('./src/components/GanttView'));
const ProjectBoard = lazy(() => import('./src/components/ProjectBoard'));
const CommandPalette = lazy(() =>
  import('./src/components/CommandPalette').then(module => ({
    default: module.CommandPalette,
  }))
);
const AppHeader = lazy(() =>
  import('./src/components/AppHeader').then(module => ({
    default: module.AppHeader,
  }))
);
const AIInsightsPanel = lazy(() =>
  import('./src/components/AIInsightsPanel').then(module => ({
    default: module.AIInsightsPanel,
  }))
);
const BulkAIOperationsModal = lazy(() =>
  import('./src/components/BulkAIOperationsModal').then(module => ({
    default: module.BulkAIOperationsModal,
  }))
);

const AIMergeDuplicatesModal = lazy(() =>
  import('./src/components/AIMergeDuplicatesModal').then(module => ({
    default: module.AIMergeDuplicatesModal,
  }))
);

const AIReorganizeModal = lazy(() =>
  import('./src/components/AIReorganizeModal').then(module => ({
    default: module.AIReorganizeModal,
  }))
);

const AISubtaskSuggestionsModal = lazy(() =>
  import('./src/components/AISubtaskSuggestionsModal').then(module => ({
    default: module.AISubtaskSuggestionsModal,
  }))
);

const AIProjectAssignmentModal = lazy(() =>
  import('./src/components/AIProjectAssignmentModal').then(module => ({
    default: module.AIProjectAssignmentModal,
  }))
);

const AIHealthDashboard = lazy(() =>
  import('./src/components/AIHealthDashboard').then(module => ({
    default: module.AIHealthDashboard,
  }))
);

const MobileNavDrawer = lazy(() =>
  import('./src/components/MobileNavDrawer').then(module => ({
    default: module.MobileNavDrawer,
  }))
);
const AutoOrganizePanel = lazy(() =>
  import('./src/components/AutoOrganizePanel').then(module => ({
    default: module.AutoOrganizePanel,
  }))
);
const TaskAssistantSidebar = lazy(() =>
  import('./src/components/TaskAssistantSidebar').then(module => ({
    default: module.TaskAssistantSidebar,
  }))
);

const SIDEBAR_EXPANDED_WIDTH = 320;
const SIDEBAR_COLLAPSED_WIDTH = 80;
const SIDEBAR_OFFSET_DELTA = SIDEBAR_EXPANDED_WIDTH - SIDEBAR_COLLAPSED_WIDTH;
const _CONTENT_LEFT_OFFSET = 112;

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
    className="fixed top-14 z-50 hidden h-16 rounded-3xl border border-white/5 liquid-glass shadow-xl md:block md:left-[112px] md:right-6"
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
  startPeriodicCheck: (getTasks: () => unknown[], intervalMs?: number) => void;
  stopPeriodicCheck: () => void;
};

type RecurringTaskServiceHandle = {
  start: (tasks: Task[]) => void;
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
    newValue?: unknown
  ) => unknown;
  logChange: (task: Task, changes: Partial<Task>, activityType?: ActivityType) => Task;
};

type SearchIndexServiceHandle = {
  buildIndex: (tasks: Task[]) => void;
  updateTask: (task: Task, previousTask?: Task) => void;
  removeTask: (task: Task) => void;
  search: (query: string) => string[];
};

type AutomationServiceHandle = {
  loadRules: (rules: unknown) => void;
  processTaskEvent: (
    event: string,
    context: { previousTask?: Task; newTask: Task },
    allTasks: Task[],
    options?: { onNotify?: (message: string) => void }
  ) => Partial<Task> | null;
};

type TemplateServiceHandle = {
  loadTemplates: (templates: unknown[]) => void;
  getAllTemplates: () => unknown[];
};

type AdvancedFilterExecutor = (tasks: Task[], group: FilterGroup) => Task[];

const App: React.FC = () => {
  const { confirm } = useConfirmation();
  const searchHistory = useSearchHistory();

  // --- Base State ---
  const [isLoaded, setIsLoaded] = useState(false);
  const [columns, setColumns] = useState<BoardColumn[]>(defaultColumns);
  const [customFields, setCustomFields] = useState<CustomFieldDefinition[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [boardGrouping, setBoardGrouping] = useState<GroupingOption>('none');
  const [isCompactView, setIsCompactView] = useState<boolean>(false);
  const [showSubWorkspaceTasks, setShowSubWorkspaceTasks] = useState<boolean>(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<'project' | 'dashboard' | 'gantt'>('project');
  const [viewMode, setViewMode] = useState<'board' | 'gantt' | 'stats' | 'calendar'>('board');
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [creatingSubProjectFor, setCreatingSubProjectFor] = useState<string | undefined>(undefined);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
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

  const {
    messages: assistantMessages,
    sendMessage: handleSendAssistantMessage,
    isLoading: isAssistantLoading,
    clearChat: handleClearAssistantChat,
  } = useTaskAssistant();

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
    assignee: '',
    dateRange: null,
    startDate: '',
    endDate: '',
    tags: '',
  });
  const [activeFilterGroup, setActiveFilterGroup] = useState<FilterGroup>({
    id: 'root',
    operator: 'AND',
    rules: [],
  });
  const [notificationPermission, setNotificationPermission] = useState<
    'granted' | 'denied' | 'default'
  >('default');
  const [commandUsageHistory, setCommandUsageHistory] = useState<Record<string, number>>({});
  // Refs for services
  const notificationServiceRef = useRef<NotificationServiceHandle | null>(null);
  const recurringTaskServiceRef = useRef<RecurringTaskServiceHandle | null>(null);
  const searchIndexServiceRef = useRef<SearchIndexServiceHandle | null>(null);
  const automationServiceRef = useRef<AutomationServiceHandle | null>(null);
  const templateServiceRef = useRef<TemplateServiceHandle | null>(null);
  const activityServiceRef = useRef<ActivityServiceHandle | null>(null);
  const advancedFilterExecutorRef = useRef<AdvancedFilterExecutor | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
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
    automationServiceRef: automationServiceRef as any,
    activityServiceRef: activityServiceRef as any,
    recurringTaskServiceRef: recurringTaskServiceRef as any,
    searchIndexServiceRef: searchIndexServiceRef as any,
    aiServiceRef: { current: aiService } as any,
  });

  // Initialization
  useAppInitialization({
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
    searchIndexServiceRef: searchIndexServiceRef as any,
    automationServiceRef: automationServiceRef as any,
    templateServiceRef: templateServiceRef as any,
    activityServiceRef: activityServiceRef as any,
    advancedFilterExecutorRef: advancedFilterExecutorRef as any,
    notificationServiceRef: notificationServiceRef as any,
    recurringTaskServiceRef: recurringTaskServiceRef as any,
    tasks,
    addToast,
    pushUndo,
  });

  // Keyboard Shortcuts
  useGlobalKeyboardShortcuts({
    handleUndo,
    setIsCommandPaletteOpen,
    setIsSidebarCollapsed,
    setIsAssistantOpen,
    setIsTaskModalOpen,
    setEditingTask,
    searchInputRef,
    tasks,
    projects,
    addToast,
    isCommandPaletteOpen,
  });

  // Saved Views
  const { views, activeViewId, createView, applyView, deleteView } = useSavedViews();

  // Task Filtering (needed by AI handlers)
  // Pre-calculate project hierarchy for fast filtering (Optimization similar to Pydantic V2 indexing)
  const descendantProjectsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    
    // Helper to get all descendants for a project
    const getDescendants = (id: string): Set<string> => {
      if (map.has(id)) return map.get(id)!;
      
      const descendants = new Set<string>();
      const children = projects.filter(p => p.parentId === id);
      
      for (const child of children) {
        descendants.add(child.id);
        const childDescendants = getDescendants(child.id);
        for (const dId of childDescendants) {
          descendants.add(dId);
        }
      }
      
      map.set(id, descendants);
      return descendants;
    };

    for (const project of projects) {
      getDescendants(project.id);
    }
    
    return map;
  }, [projects]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (searchQuery.trim()) {
      result = filterTasksBySearch(
        tasks,
        searchQuery,
        searchIndexServiceRef.current as { search: (query: string) => string[] }
      );
    }
    if (filters.assignee)
      result = result.filter(t =>
        t.assignee.toLowerCase().includes(filters.assignee.toLowerCase())
      );
    if (activeFilterGroup.rules.length > 0) {
      result = advancedFilterExecutorRef.current
        ? advancedFilterExecutorRef.current(result, activeFilterGroup)
        : result;
    }
    return result;
  }, [tasks, searchQuery, filters, activeFilterGroup]);

  const currentProjectTasks = useMemo(() => {
    if (showSubWorkspaceTasks) {
      const descendants = descendantProjectsMap.get(activeProjectId) || new Set<string>();
      return filteredTasks.filter(t => t.projectId === activeProjectId || descendants.has(t.projectId));
    }
    return filteredTasks.filter(t => t.projectId === activeProjectId);
  }, [filteredTasks, activeProjectId, showSubWorkspaceTasks, descendantProjectsMap]);

  // AI Handlers
  const handleAiInsights = useCallback(() => {
    setIsAiInsightsOpen(true);
  }, []);

  const handleNaturalLanguageSearch = useCallback(
    async (query: string) => {
      try {
        const { aiService } = await import('./src/services/aiService');
        const context: AIContext = {
          activeProjectId,
          projects,
          priorities,
        };
        const result = (await aiService.parseNaturalQuery(query, context)) as any;
        if (result.filterGroup && result.filterGroup.rules && result.filterGroup.rules.length > 0) {
          setActiveFilterGroup(result.filterGroup);
          addToast(`AI Search: ${result.explanation}`, 'info');
        } else {
          addToast('AI could not parse that query. Try standard search.', 'info');
        }
      } catch (e: unknown) {
        addToast(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [activeProjectId, projects, priorities, addToast]
  );

  const handleAiPrioritize = useCallback(async () => {
    if (isAiPrioritizing) return;
    setIsAiPrioritizing(true);
    try {
      const { aiService } = await import('./src/services/aiService');
      const context: AIContext = {
        activeProjectId,
        projects,
        priorities,
      };
      const suggestions = await aiService.suggestPriorities(currentProjectTasks, context);
      if (suggestions.length === 0) {
        addToast('No priority suggestions available', 'info');
        return;
      }
      let applied = 0;
      for (const suggestion of suggestions) {
        if (suggestion.confidence >= 0.7) {
          const task = currentProjectTasks.find(t => t.id === suggestion.taskId);
          if (task && task.priority !== suggestion.suggestedValue) {
            handleUpdateTask(suggestion.taskId, {
              priority: suggestion.suggestedValue as string,
            });
            applied++;
          }
        }
      }
      if (applied > 0) {
        addToast(`AI applied ${applied} priority adjustment${applied > 1 ? 's' : ''}`, 'success');
      } else {
        addToast('AI reviewed priorities - no changes needed', 'info');
      }
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : String(e), 'error');
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
    addToast('AI is identifying your next task...', 'info');
    try {
      const { aiService } = await import('./src/services/aiService');
      const context: AIContext = {
        activeProjectId,
        projects,
        priorities,
      };
      const suggestion = await aiService.suggestNextTask(currentProjectTasks, context);
      if (suggestion) {
        setNextTaskSuggestion(suggestion);
        addToast('AI found a recommendation for you', 'success');
      } else {
        addToast('AI reviewed tasks - everything is on track!', 'info');
      }
    } catch (e: unknown) {
      addToast(e instanceof Error ? e.message : String(e), 'error');
    }
  }, [currentProjectTasks, activeProjectId, projects, priorities, addToast]);

  const handleUndoAiChanges = useCallback(() => {
    if (aiChangesUndoStack.length === 0) {
      addToast('No AI changes to undo', 'info');
      return;
    }
    const lastChange = aiChangesUndoStack[aiChangesUndoStack.length - 1];
    handleUpdateTask(lastChange.taskId, lastChange.previous as Partial<Task>);
    setAiChangesUndoStack(prev => prev.slice(0, -1));
    addToast('Undid last AI change', 'info');
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
          id: 'root',
          operator: 'AND',
          rules: [],
        }
      );
      addToast(`View "${view.name}" applied`, 'info');
    }
  };

  const handleCreateView = (name?: string) => {
    const finalName = name || prompt('Enter a name for this view:');
    if (finalName) {
      createView(finalName, filters, boardGrouping, activeFilterGroup);
      addToast(`View "${finalName}" saved`, 'success');
    }
  };

  const recordCommandUsage = useCallback((commandId: string) => {
    const now = Date.now();
    setCommandUsageHistory(prev => {
      const next = { ...prev, [commandId]: now };
      storageService.set(STORAGE_KEYS.COMMAND_HISTORY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const storedHistory = storageService.get<Record<string, number>>(
      STORAGE_KEYS.COMMAND_HISTORY,
      {}
    );
    if (storedHistory && typeof storedHistory === 'object' && !Array.isArray(storedHistory)) {
      setCommandUsageHistory(storedHistory as Record<string, number>);
    }
  }, []);

  const commandActions = useMemo(() => {
    const baseActions: CommandAction[] = [
      {
        id: 'action:new-task',
        label: 'Create New Task',
        category: 'action',
        description: 'Open task composer modal',
        keywords: ['add', 'new', 'task', 'todo'],
        aliases: ['create', 'new task', 'quick task'],
        action: () => {
          setEditingTask(null);
          setIsTaskModalOpen(true);
        },
      },
      {
        id: 'action:undo',
        label: 'Undo Last Action',
        category: 'action',
        description: 'Undo the last task change',
        keywords: ['undo', 'revert', 'back'],
        aliases: ['reverse', 'go back'],
        action: handleUndo,
      },
      {
        id: 'action:toggle-assistant',
        label: isAssistantOpen ? 'Close AI Assistant' : 'Open AI Assistant',
        category: 'action',
        description: `${isAssistantOpen ? 'Hide' : 'Reveal'} right conversational AI sidebar`,
        keywords: ['ai', 'assistant', 'chat', 'help', 'bot'],
        aliases: ['toggle assistant', 'chat bot', 'ai chat'],
        action: () => setIsAssistantOpen(prev => !prev),
      },
      {
        id: 'action:toggle-sidebar',
        label: isSidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar',
        category: 'view',
        description: `${isSidebarCollapsed ? 'Reveal' : 'Hide'} left workspace sidebar`,
        keywords: ['sidebar', 'view', 'layout'],
        aliases: ['toggle sidebar', 'left panel'],
        action: () => setIsSidebarCollapsed(prev => !prev),
      },
      {
        id: 'action:compact-view',
        label: isCompactView ? 'Expand Task Cards' : 'Compact Task Cards',
        category: 'view',
        description: 'Toggle compact task card layout',
        keywords: ['compact', 'cards', 'layout'],
        aliases: ['compact mode', 'dense mode'],
        action: () => setIsCompactView(prev => !prev),
      },
      {
        id: 'action:toggle-filter',
        label: isFilterOpen ? 'Close Filter Panel' : 'Open Filter Panel',
        category: 'view',
        description: 'Show or hide global project filters',
        keywords: ['filter', 'query', 'panel'],
        aliases: ['search filter', 'advanced filter'],
        action: () => setIsFilterOpen(prev => !prev),
      },
      {
        id: 'action:open-settings',
        label: 'Open Settings',
        category: 'action',
        description: 'Open settings and import/export tools',
        keywords: ['settings', 'preferences', 'config'],
        aliases: ['preferences', 'options', 'preferences panel'],
        action: () => setIsSettingsModalOpen(true),
      },
      {
        id: 'action:bulk-ai-operations',
        label: 'Bulk AI Operations',
        category: 'action',
        description: 'Run batch AI operations: deduplicate, reprioritize, categorize',
        keywords: ['ai', 'bulk', 'batch', 'cleanup', 'organize'],
        aliases: ['ai cleanup', 'ai organize', 'ai batch'],
        action: () => setIsBulkAIOperationsOpen(true),
      },
      {
        id: 'action:auto-organize',
        label: 'AI Auto-Organize',
        category: 'action',
        description: 'Smart task grouping, merging, deduplication, and categorization',
        keywords: ['ai', 'organize', 'group', 'merge', 'deduplicate', 'cluster', 'auto'],
        aliases: ['ai organize', 'auto organize', 'smart organize', 'ai cleanup'],
        action: () => setIsAutoOrganizeOpen(true),
      },
      {
        id: 'action:ai-health-dashboard',
        label: 'AI Health Dashboard',
        category: 'action',
        description: 'View AI-generated task health metrics and insights',
        keywords: ['ai', 'health', 'dashboard', 'insights', 'metrics', 'analytics'],
        aliases: ['ai insights', 'health check', 'task health'],
        action: () => setIsAiHealthDashboardOpen(true),
      },
      {
        id: 'action:ai-merge-duplicates',
        label: 'Smart Merge Duplicates',
        category: 'action',
        description: 'Find and merge duplicate tasks with AI',
        keywords: ['ai', 'merge', 'duplicates', 'cleanup'],
        aliases: ['merge dupes', 'ai merge'],
        action: () => setIsAiMergeModalOpen(true),
      },
      {
        id: 'action:ai-reorganize',
        label: 'Smart Reorganize',
        category: 'action',
        description: 'AI-powered task clustering and project creation',
        keywords: ['ai', 'reorganize', 'cluster', 'group', 'projects'],
        aliases: ['ai cluster', 'ai group'],
        action: () => setIsAiReorganizeModalOpen(true),
      },
      {
        id: 'action:ai-subtask-conversion',
        label: 'Convert to Subtasks',
        category: 'action',
        description: 'AI suggests tasks that should be subtasks',
        keywords: ['ai', 'subtask', 'convert', 'hierarchy'],
        aliases: ['ai subtasks', 'make subtask'],
        action: () => setIsAiSubtaskModalOpen(true),
      },
      {
        id: 'action:ai-project-assignment',
        label: 'Smart Project Assignment',
        category: 'action',
        description: 'AI suggests optimal project assignments for tasks',
        keywords: ['ai', 'project', 'assignment', 'reassign'],
        aliases: ['ai assign', 'project suggest'],
        action: () => setIsAiProjectAssignmentModalOpen(true),
      },
      {
        id: 'action:ai-prioritize',
        label: 'AI Suggest Priorities',
        category: 'action',
        description: 'AI suggests task priorities based on context',
        keywords: ['ai', 'priority', 'suggest', 'optimization'],
        aliases: ['ai priorities', 'optimize priorities'],
        action: handleAiPrioritize,
      },
      {
        id: 'action:ai-suggest-next',
        label: 'Suggest My Next Task',
        category: 'action',
        description: 'AI recommends the most critical task to work on next',
        keywords: ['ai', 'next', 'suggest', 'priority', 'recommendation'],
        aliases: ['what next', 'ai suggest'],
        action: handleSuggestNextTask,
      },
      {
        id: 'action:ai-insights',
        label: 'AI Insights',
        category: 'action',
        description: 'View AI-generated insights and recommendations',
        keywords: ['ai', 'insights', 'recommendations', 'analysis'],
        aliases: ['ai tips', 'smart insights'],
        action: handleAiInsights,
      },
      {
        id: 'action:ai-report-daily',
        label: 'Generate Daily AI Report',
        category: 'action',
        description: 'Generate and download a daily AI summary report',
        keywords: ['ai', 'report', 'daily', 'summary', 'export'],
        aliases: ['daily report', 'export daily'],
        action: async () => {
          addToast('Generating daily report...', 'info');
          try {
            const { aiSummaryService } = await import('./src/services/aiSummaryService');
            const report = await aiSummaryService.generateDailyReport(tasks);
            aiSummaryService.downloadReport(report);
            addToast('Daily report downloaded!', 'success');
          } catch (e) {
            addToast('Failed to generate daily report', 'error');
          }
        },
      },
      {
        id: 'action:ai-report-weekly',
        label: 'Generate Weekly AI Report',
        category: 'action',
        description: 'Generate and download a weekly AI summary report',
        keywords: ['ai', 'report', 'weekly', 'summary', 'export'],
        aliases: ['weekly report', 'export weekly'],
        action: async () => {
          addToast('Generating weekly report...', 'info');
          try {
            const { aiSummaryService } = await import('./src/services/aiSummaryService');
            const report = await aiSummaryService.generateWeeklyReport(tasks);
            aiSummaryService.downloadReport(report);
            addToast('Weekly report downloaded!', 'success');
          } catch (e) {
            addToast('Failed to generate weekly report', 'error');
          }
        },
      },
      {
        id: 'view:project',
        label: 'Project View',
        category: 'view',
        description: 'Switch to project workspace canvas',
        keywords: ['project', 'board'],
        aliases: ['workspace', 'projects'],
        action: () => setCurrentView('project'),
      },
      {
        id: 'view:dashboard',
        label: 'Dashboard View',
        category: 'view',
        description: 'Switch to executive summary dashboard',
        keywords: ['dashboard', 'analytics', 'overview'],
        aliases: ['insights', 'metrics'],
        action: () => setCurrentView('dashboard'),
      },
      {
        id: 'view:gantt',
        label: 'Gantt View',
        category: 'view',
        description: 'Switch to Gantt timeline',
        keywords: ['gantt', 'timeline'],
        aliases: ['gantt', 'timeline'],
        action: () => {
          setCurrentView('gantt');
          setViewMode('gantt');
        },
      },
      {
        id: 'viewmode:board',
        label: 'Board Mode',
        category: 'view',
        description: 'Show Kanban board layout',
        keywords: ['mode', 'board', 'kanban'],
        aliases: ['kanban', 'cards'],
        action: () => setViewMode('board'),
      },
      {
        id: 'viewmode:stats',
        label: 'Stats Mode',
        category: 'view',
        description: 'Show statistics mode',
        keywords: ['statistics', 'mode', 'report'],
        aliases: ['analytics', 'numbers'],
        action: () => setViewMode('stats'),
      },
      {
        id: 'viewmode:calendar',
        label: 'Calendar Mode',
        category: 'view',
        description: 'Show calendar mode',
        keywords: ['calendar', 'timeline', 'due'],
        aliases: ['schedule', 'dates'],
        action: () => setViewMode('calendar'),
      },
    ];

    const topProjectActions: CommandAction[] = projects
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12)
      .map(project => ({
        id: `project:${project.id}`,
        label: `Project: ${project.name}`,
        category: 'project',
        description: `Switch to ${project.name}`,
        keywords: ['project', project.name.toLowerCase(), project.id.toLowerCase()],
        aliases: [project.name.toLowerCase()],
        action: () => {
          setActiveProjectId(project.id);
          setCurrentView('project');
          setViewMode('board');
          addToast(`Switched to project "${project.name}"`, 'info');
        },
      }));

    return [...topProjectActions, ...baseActions].sort((a, b) => a.label.localeCompare(b.label));
  }, [addToast, handleUndo, isCompactView, isFilterOpen, isSidebarCollapsed, projects]);

  // --- Debounced persistence ---
  const debouncedSaveColumns = useMemo(
    () => debounce((cols: BoardColumn[]) => storageService.set(STORAGE_KEYS.COLUMNS, cols), 500),
    []
  );
  const debouncedSaveProjects = useMemo(
    () => debounce((projs: Project[]) => storageService.set(STORAGE_KEYS.PROJECTS, projs), 500),
    []
  );
  const debouncedSaveTasks = useMemo(
    () => debounce((tsks: Task[]) => storageService.set(STORAGE_KEYS.TASKS, tsks), 500),
    []
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
    if (isLoaded) storageService.set(STORAGE_KEYS.ACTIVE_PROJECT, activeProjectId);
  }, [activeProjectId, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.VIEW_MODE, viewMode);
  }, [viewMode, isLoaded]);
  useEffect(() => {
    if (isLoaded) storageService.set(STORAGE_KEYS.CURRENT_VIEW, currentView);
  }, [currentView, isLoaded]);

  // --- Derived Data ---
  const activeProject: Project = projects.find(p => p.id === activeProjectId) ||
    projects[0] || { name: 'No Project', id: 'temp', type: 'default' };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.assignee) count++;
    if (filters.tags) count++;
    if (filters.dateRange && filters.startDate && filters.endDate) count++;
    if (activeFilterGroup.rules.length > 0) count += activeFilterGroup.rules.length;
    return count;
  }, [filters, activeFilterGroup]);

  const getTasksByContext = (statusId: string, priorityId?: string) => {
    return currentProjectTasks
      .filter(
        task => task.status === statusId && (priorityId ? task.priority === priorityId : true)
      )
      .sort((a, b) => (a.order ?? a.createdAt.getTime()) - (b.order ?? b.createdAt.getTime()));
  };

  const handleUpdateColumns = (newColumns: BoardColumn[]) => {
    if (!Array.isArray(newColumns)) return;
    setColumns(newColumns);
    if (indexedDBService.isAvailable())
      indexedDBService.saveColumns(newColumns).catch(console.error);
  };

  const handleRequestNotificationPermission = useCallback(async () => {
    let granted: boolean | string = false;
    if (notificationServiceRef.current) {
      granted = await notificationServiceRef.current.requestPermission();
    } else {
      const { notificationService } = await import('./src/services/notificationService');
      notificationServiceRef.current = notificationService;
      granted = await notificationService.requestPermission();
    }

    const isGranted = granted === true || String(granted) === 'granted';
    setNotificationPermission(isGranted ? 'granted' : 'denied');
    if (isGranted) {
      notificationServiceRef.current?.show({
        title: 'Notifications Enabled',
        body: 'You will now receive task reminders.',
      });
    }
  }, []);

  const runtimeState = getRuntimeState();
  const sidebarOffset = isSidebarCollapsed ? 0 : SIDEBAR_OFFSET_DELTA;

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <img src={logo} alt="LiquiTask" className="w-16 h-16 object-contain" />
          <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
          <p className="text-slate-400">Loading LiquiTask...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen text-slate-200 font-sans overflow-x-auto scrollbar-hide ${runtimeState.hasCustomWindowControls ? 'pt-14' : ''}`}
    >
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <TitleBar />
      <div className="fixed top-[-30%] right-[-20%] w-[1200px] h-[1200px] bg-red-950/20 rounded-full blur-[150px] pointer-events-none z-0 mix-blend-screen animate-pulse-slow"></div>

      <Suspense fallback={<SidebarLoadingFallback isCollapsed={isSidebarCollapsed} />}>
        <Sidebar
          projects={projects}
          activeProjectId={activeProjectId}
          projectTypes={projectTypes}
          isCollapsed={isSidebarCollapsed}
          toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onSelectProject={id => {
            setActiveProjectId(id);
            setCurrentView('project');
            setViewMode('board');
            setIsSidebarCollapsed(true);
          }}
          onAddProject={pid => {
            setCreatingSubProjectFor(pid);
            setIsProjectModalOpen(true);
          }}
          onDeleteProject={id =>
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
          onSelectProject={id => {
            setActiveProjectId(id);
            setCurrentView('project');
            setViewMode('board');
          }}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          currentView={currentView}
          onChangeView={setCurrentView}
        />
      </Suspense>

      <main id="main-content" className="relative z-10 min-h-screen flex flex-col md:pl-[112px]">
        <Suspense fallback={<HeaderLoadingFallback sidebarOffset={sidebarOffset} />}>
          <AppHeader
            isHeaderExpanded={isHeaderExpanded}
            sidebarOffset={sidebarOffset}
            currentView={currentView}
            viewMode={viewMode}
            currentProjectName={activeProject.name}
            parentProjectName={
              activeProject.parentId
                ? projects.find(p => p.id === activeProject.parentId)?.name
                : undefined
            }
            currentProjectPinned={activeProject.pinned}
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
                assignee: '',
                dateRange: null,
                startDate: '',
                endDate: '',
                tags: '',
              });
              setActiveFilterGroup({ id: 'root', operator: 'AND', rules: [] });
            }}
            onAiPrioritize={handleAiPrioritize}
            onAiInsights={handleAiInsights}
            onNaturalLanguageSearch={handleNaturalLanguageSearch}
            isNaturalLanguageSearch={isNaturalLanguageSearch}
            onToggleNaturalLanguageSearch={() =>
              setIsNaturalLanguageSearch(!isNaturalLanguageSearch)
            }
            onOpenMobileNav={() => setIsMobileNavOpen(true)}
            onToggleAssistant={() => setIsAssistantOpen(prev => !prev)}
          />
        </Suspense>

        <div className="flex-1 pt-24 px-6 md:px-8 pb-6 overflow-x-auto overflow-y-auto scrollbar-hide">
          <ViewTransition
            transitionKey={`${currentView}-${activeProjectId}-${viewMode}`}
            type="fade"
            duration={400}
            className="h-full"
          >
            <Suspense fallback={<ViewLoadingFallback />}>
              {currentView === 'dashboard' ? (
                <Dashboard
                  tasks={filteredTasks}
                  projects={projects}
                  priorities={priorities}
                  columns={columns}
                  boardGrouping={boardGrouping}
                  activeProjectId={activeProjectId}
                  onEditTask={t => {
                    setEditingTask(t);
                    setIsTaskModalOpen(true);
                  }}
                  onDeleteTask={handleDeleteTaskInternal}
                  onMoveTask={moveTask}
                  onUpdateTask={handleUpdateTask}
                  onUpdateColumns={handleUpdateColumns}
                  getTasksByContext={getTasksByContext}
                  isCompact={isCompactView}
                  onCopyTask={msg => addToast(msg, 'success')}
                  onMoveToWorkspace={handleMoveTaskToWorkspace}
                  onUpdateDueDate={handleUpdateTaskDueDate}
                  onCreateTask={d => {
                    setEditingTask({
                      id: `temp-${Date.now()}`,
                      jobId: '',
                      projectId: activeProjectId,
                      title: '',
                      priority: priorities[0]?.id || 'medium',
                      status: columns[0]?.id || 'Pending',
                      createdAt: new Date(),
                      dueDate: d,
                      subtasks: [],
                      attachments: [],
                      tags: [],
                      timeEstimate: 0,
                      timeSpent: 0,
                    } as Task);
                    setIsTaskModalOpen(true);
                  }}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onSuggestNextTask={handleSuggestNextTask}
                  nextTaskSuggestion={nextTaskSuggestion}
                  addToast={addToast}
                />
              ) : viewMode === 'gantt' ? (
                <GanttView
                  tasks={currentProjectTasks}
                  columns={columns}
                  priorities={priorities}
                  onEditTask={t => {
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
                  onMoveTask={moveTask}
                  onEditTask={t => {
                    setEditingTask(t);
                    setIsTaskModalOpen(true);
                  }}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTaskInternal}
                  addToast={addToast}
                  getTasksByContext={getTasksByContext}
                  isCompact={isCompactView}
                  onCopyTask={msg => addToast(msg, 'success')}
                  projectName={activeProject.name}
                  projects={projects}
                  onMoveBlocked={msg => addToast(msg, 'error')}
                  onMoveToWorkspace={handleMoveTaskToWorkspace}
                  canMoveTask={canMoveTask}
                />
              )}
            </Suspense>
          </ViewTransition>
        </div>
      </main>

      <div className="fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map(toast => (
          <Toast key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </div>

      {isTaskModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <TaskFormModal
            isOpen={isTaskModalOpen}
            onClose={() => setIsTaskModalOpen(false)}
            onSubmit={data => handleCreateOrUpdateTask(data, editingTask)}
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
            onImportData={d => {
              if (d.projects) setProjects(d.projects);
              if (d.tasks) setTasks(d.tasks);
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
          />
        </Suspense>
      )}

      {isCommandPaletteOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => setIsCommandPaletteOpen(false)}
            onCreateTask={p =>
              handleCreateOrUpdateTask(
                {
                  title: p.title,
                  priority: p.priority,
                  dueDate: p.dueDate,
                  tags: p.tags,
                },
                null
              )
            }
            actions={commandActions}
            commandUsageHistory={commandUsageHistory}
            onActionExecuted={recordCommandUsage}
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
            onArchiveTask={handleDeleteTaskInternal}
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
            onArchiveTask={handleDeleteTaskInternal}
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
            onArchiveTask={handleDeleteTaskInternal}
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
            onArchiveTask={handleDeleteTaskInternal}
            onMoveTask={handleMoveTaskToWorkspace}
            addToast={addToast}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {isAssistantOpen && (
          <TaskAssistantSidebar
            isOpen={isAssistantOpen}
            onClose={() => setIsAssistantOpen(false)}
            messages={assistantMessages}
            onSendMessage={handleSendAssistantMessage}
            isLoading={isAssistantLoading}
            onClearChat={handleClearAssistantChat}
          />
        )}
      </Suspense>
    </div>
  );
};

export default App;
