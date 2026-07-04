import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import type {
  ActivityType,
  BoardColumn,
  CustomFieldDefinition,
  GroupingOption,
  PriorityDefinition,
  Project,
  ProjectType,
  Task,
  TaskTemplate,
  ToastType,
} from "../../types";
import { STORAGE_KEYS } from "../constants";
import { archiveService, loadArchiveSettings } from "../services/archiveService";
import { bootstrapEncryptionAtRest } from "../services/encryptionSetup";
import type { AutomationRule, AutomationTrigger, TaskContext } from "../services/automationService";
import { indexedDBService } from "../services/indexedDBService";
import storageService from "../services/storageService";
import { getBacklogColumnId, getCompletedColumnIds, isTaskComplete } from "../utils/taskUtils";
import type { FilterGroup } from "../types/queryTypes";

type CurrentView = "project" | "dashboard" | "gantt" | "archive";
type ViewMode = "board" | "gantt" | "stats" | "calendar";

type NotificationTask = {
  id: string;
  title: string;
  dueDate?: Date;
  status?: string;
  completedAt?: Date;
};

type NotificationServiceLike = {
  requestPermission: () => Promise<boolean>;
  show: (options: {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    silent?: boolean;
    onClick?: () => void;
  }) => void;
  startPeriodicCheck: (
    getTasks: () => NotificationTask[],
    intervalMs?: number,
    options?: { getCompletedColumnIds?: () => Set<string> },
  ) => void;
  stopPeriodicCheck: () => void;
  scheduleTaskReminder: (taskId: string, taskTitle: string, dueDate: Date) => void;
  cancelTaskReminder: (taskId: string) => void;
  clearOverdueNotification: (taskId: string) => void;
};

type ActivityServiceLike = {
  createActivity: (
    type: ActivityType,
    details: string,
    field?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ) => unknown;
  logChange: (task: Task, changes: Partial<Task>, activityType?: ActivityType) => Task;
};

type AutomationServiceLike = {
  loadRules: (rules: AutomationRule[] | undefined | null) => void;
  processTaskEvent: (
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: { onNotify?: (message: string) => void },
  ) => Partial<Task> | null;
};

type AdvancedFilterExecutor = (tasks: Task[], group: FilterGroup) => Task[];

type SearchIndexServiceLike = {
  buildIndex: (tasks: Task[]) => void;
  updateTask?: (task: Task, previousTask?: Task) => void;
  removeTask?: (task: Task) => void;
  search: (query: string) => string[];
};

type TemplateServiceLike = {
  loadTemplates: (templates: TaskTemplate[]) => void;
  getAllTemplates?: () => TaskTemplate[];
  createFromTemplate?: (templateId: string, variables?: Record<string, string>) => Partial<Task>;
};

type RecurringTaskServiceLike = {
  start: (getTasks: () => Task[]) => void;
  stop: () => void;
};

type PushUndoAction = { type: "task-create"; taskId: string };

interface InitializationProps {
  isLoaded: boolean;
  setIsLoaded: (val: boolean) => void;
  setColumns: (cols: BoardColumn[]) => void;
  setProjectTypes: (types: ProjectType[]) => void;
  setPriorities: (prios: PriorityDefinition[]) => void;
  setCustomFields: (fields: CustomFieldDefinition[]) => void;
  setProjects: (projs: Project[]) => void;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  setActiveProjectId: (id: string) => void;
  setIsSidebarCollapsed: (val: boolean) => void;
  setBoardGrouping: (val: GroupingOption) => void;
  setIsCompactView: (val: boolean) => void;
  setShowSubWorkspaceTasks: (val: boolean) => void;
  setViewMode: (val: ViewMode) => void;
  setCurrentView: (val: CurrentView) => void;
  searchIndexServiceRef: MutableRefObject<SearchIndexServiceLike | null>;
  automationServiceRef: MutableRefObject<AutomationServiceLike | null>;
  templateServiceRef: MutableRefObject<TemplateServiceLike | null>;
  activityServiceRef: MutableRefObject<ActivityServiceLike | null>;
  advancedFilterExecutorRef: MutableRefObject<AdvancedFilterExecutor | null>;
  notificationServiceRef: MutableRefObject<NotificationServiceLike | null>;
  recurringTaskServiceRef: MutableRefObject<RecurringTaskServiceLike | null>;
  tasks: Task[];
  columns: BoardColumn[];
  addToast: (msg: string, type?: ToastType) => void;
  pushUndo: (action: PushUndoAction) => void;
  /**
   * Bumped after the web-encryption passphrase is unlocked so the initial data
   * load re-runs with the in-memory key available (instead of forcing a full
   * page reload, which would discard the derived key and re-lock the app).
   */
  encryptionEpoch?: number;
}

export const useAppInitialization = ({
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
  encryptionEpoch = 0,
}: InitializationProps) => {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const prevReminderTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const loadData = async () => {
      try {
        await indexedDBService.initialize();
      } catch (error) {
        console.warn("[Storage] IndexedDB initialization failed:", error);
      }

      try {
        await storageService.initialize();
      } catch (error) {
        console.warn("[Storage] Storage initialization failed:", error);
      }

      try {
        await bootstrapEncryptionAtRest();
      } catch (error) {
        console.warn("[Storage] Encryption bootstrap failed:", error);
      }

      try {
        await archiveService.initialize();
        if (indexedDBService.isAvailable()) {
          const archiveSettings = loadArchiveSettings();
          indexedDBService
            .purgeOldArchivedTasks(archiveSettings.retentionDays)
            .catch(console.error);
        }
      } catch (err) {
        console.warn('[Storage] Archive service init failed, continuing without archive:', err);
      }

      const data = storageService.getAllData();

      if (data.columns) {
        setColumns(data.columns);
        if (indexedDBService.isAvailable())
          indexedDBService.saveColumns(data.columns).catch(console.error);
      }
      if (data.projectTypes) setProjectTypes(data.projectTypes);
      if (data.priorities) {
        setPriorities(data.priorities);
        if (indexedDBService.isAvailable())
          indexedDBService.savePriorities(data.priorities).catch(console.error);
      }
      if (data.customFields) {
        setCustomFields(data.customFields);
        if (indexedDBService.isAvailable())
          indexedDBService.saveCustomFields(data.customFields).catch(console.error);
      }
      if (data.projects) {
        setProjects(data.projects);
        if (indexedDBService.isAvailable())
          Promise.all(data.projects.map((p) => indexedDBService.saveProject(p))).catch(
            console.error,
          );
      }
      const serviceImports: Promise<void>[] = [];
      if (data.tasks) {
        const loadedTasks = data.tasks;
        setTasks(loadedTasks);
        serviceImports.push(
          import("../services/searchIndexService").then(({ searchIndexService }) => {
            searchIndexServiceRef.current = searchIndexService;
            searchIndexService.buildIndex(loadedTasks);
          })
        );
        if (indexedDBService.isAvailable())
          indexedDBService.saveTasks(loadedTasks).catch(console.error);
      }
      if (data.activeProjectId) setActiveProjectId(data.activeProjectId);
      if (data.sidebarCollapsed !== undefined) setIsSidebarCollapsed(data.sidebarCollapsed);
      if (data.grouping) setBoardGrouping(data.grouping);
      const compactView = storageService.get(STORAGE_KEYS.COMPACT_VIEW, false);
      if (compactView !== undefined) setIsCompactView(compactView);
      const subTasks = storageService.get(STORAGE_KEYS.SHOW_SUB_WORKSPACE_TASKS, false);
      if (subTasks !== undefined) setShowSubWorkspaceTasks(subTasks);
      const savedViewMode = storageService.get(STORAGE_KEYS.VIEW_MODE, "board");
      if (savedViewMode) setViewMode(savedViewMode);
      const savedCurrentView = storageService.get(STORAGE_KEYS.CURRENT_VIEW, "project");
      if (savedCurrentView) setCurrentView(savedCurrentView);

      serviceImports.push(
        import("../services/automationService").then(({ automationService }) => {
          automationServiceRef.current = automationService;
          automationService.loadRules(storageService.get(STORAGE_KEYS.AUTOMATION_RULES, []));
        }),
        import("../services/templateService").then(({ templateService }) => {
          templateServiceRef.current = templateService;
          templateService.loadTemplates(
            storageService.get(STORAGE_KEYS.TASK_TEMPLATES, []) as TaskTemplate[],
          );
        }),
        import("../services/activityService").then(({ activityService }) => {
          activityServiceRef.current = activityService;
        }),
        import("../utils/queryEngine").then(({ executeAdvancedFilter }) => {
          advancedFilterExecutorRef.current = executeAdvancedFilter;
        })
      );
      await Promise.all(serviceImports);
      setIsLoaded(true);
    };

    void loadData();
    // Runs on mount and again whenever encryptionEpoch changes (i.e. after the
    // user unlocks web encryption), so decrypted data loads without a page reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    encryptionEpoch,
    activityServiceRef,
    advancedFilterExecutorRef,
    automationServiceRef,
    searchIndexServiceRef,
    setActiveProjectId,
    setBoardGrouping,
    setColumns,
    setCurrentView,
    setCustomFields,
    setIsCompactView,
    setIsLoaded,
    setIsSidebarCollapsed,
    setPriorities,
    setProjectTypes,
    setProjects,
    setShowSubWorkspaceTasks,
    setTasks,
    setViewMode,
    templateServiceRef,
  ]);

  useEffect(() => {
    let isActive = true;
    let notificationServiceInstance: NotificationServiceLike | null = null;

    import("../services/notificationService").then(({ notificationService }) => {
      if (!isActive) return;
      notificationServiceRef.current = notificationService;
      notificationServiceInstance = notificationService;
      notificationService.startPeriodicCheck(() => tasksRef.current, 60000, {
        getCompletedColumnIds: () => getCompletedColumnIds(columnsRef.current),
      });
    });

    return () => {
      isActive = false;
      notificationServiceInstance?.stopPeriodicCheck();
    };
    // Ref is populated once as part of a mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationServiceRef]);

  // Sync due-date reminder timers whenever tasks or column config change.
  useEffect(() => {
    if (!isLoaded) return;
    const notificationService = notificationServiceRef.current;
    if (!notificationService) return;

    const completedColumnIds = getCompletedColumnIds(columns);
    const activeIds = new Set<string>();
    const currentTasks = tasks;

    for (const task of currentTasks) {
      activeIds.add(task.id);

      if (isTaskComplete(task, completedColumnIds)) {
        notificationService.cancelTaskReminder(task.id);
        notificationService.clearOverdueNotification(task.id);
        continue;
      }

      if (task.dueDate) {
        const dueDate = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate);
        if (!Number.isNaN(dueDate.getTime())) {
          notificationService.scheduleTaskReminder(task.id, task.title, dueDate);
        } else {
          notificationService.cancelTaskReminder(task.id);
        }
      } else {
        notificationService.cancelTaskReminder(task.id);
      }
    }

    for (const id of prevReminderTaskIdsRef.current) {
      if (!activeIds.has(id)) {
        notificationService.cancelTaskReminder(id);
        notificationService.clearOverdueNotification(id);
      }
    }

    prevReminderTaskIdsRef.current = activeIds;
  }, [isLoaded, tasks, columns, notificationServiceRef]);

  useEffect(() => {
    let isActive = true;

    import("../services/recurringTaskService").then(
      ({ initializeRecurringTaskService, getRecurringTaskService }) => {
        if (!isActive) return;

        let service = getRecurringTaskService();
        if (!service) {
          initializeRecurringTaskService({
            onCreateTask: (newTask: Task) => {
              pushUndo({ type: "task-create", taskId: newTask.id });
              setTasks((prev) => [...prev, newTask]);
              searchIndexServiceRef.current?.updateTask?.(newTask);
              if (indexedDBService.isAvailable()) {
                indexedDBService.saveTask(newTask).catch(console.error);
              }
              addToast(`Recurring task "${newTask.title}" created`, "info");
            },
            onUpdateTask: (taskId: string, updates: Partial<Task>) => {
              setTasks((prev) => {
                const next = prev.map((t) =>
                  t.id === taskId ? { ...t, ...updates, updatedAt: new Date() } : t,
                );
                if (indexedDBService.isAvailable()) {
                  const saved = next.find((t) => t.id === taskId);
                  if (saved) {
                    indexedDBService.saveTask(saved).catch(console.error);
                  }
                }
                return next;
              });
            },
            getDefaultStatus: () => getBacklogColumnId(columnsRef.current),
          });
          service = getRecurringTaskService();
        }

        recurringTaskServiceRef.current = service;
        service?.start(() => tasksRef.current);
      },
    );

    return () => {
      isActive = false;
      recurringTaskServiceRef.current?.stop();
    };
  }, [addToast, pushUndo, setTasks, recurringTaskServiceRef, searchIndexServiceRef]);
};
