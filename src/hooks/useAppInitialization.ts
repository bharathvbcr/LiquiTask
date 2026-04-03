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
import type { AutomationRule, AutomationTrigger, TaskContext } from "../services/automationService";
import { indexedDBService } from "../services/indexedDBService";
import type { RecurringTaskService } from "../services/recurringTaskService";
import type { SearchIndexService } from "../services/searchIndexService";
import storageService from "../services/storageService";
import type { TemplateService } from "../services/templateService";
import type { FilterGroup } from "../types/queryTypes";

type CurrentView = "project" | "dashboard" | "gantt";
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
  startPeriodicCheck: (getTasks: () => NotificationTask[], intervalMs?: number) => void;
  stopPeriodicCheck: () => void;
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

type PushUndoAction = { type: "task-create"; taskId: string };

interface InitializationProps {
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
  searchIndexServiceRef: MutableRefObject<SearchIndexService | null>;
  automationServiceRef: MutableRefObject<AutomationServiceLike | null>;
  templateServiceRef: MutableRefObject<TemplateService | null>;
  activityServiceRef: MutableRefObject<ActivityServiceLike | null>;
  advancedFilterExecutorRef: MutableRefObject<AdvancedFilterExecutor | null>;
  notificationServiceRef: MutableRefObject<NotificationServiceLike | null>;
  recurringTaskServiceRef: MutableRefObject<RecurringTaskService | null>;
  tasks: Task[];
  addToast: (msg: string, type?: ToastType) => void;
  pushUndo: (action: PushUndoAction) => void;
}

export const useAppInitialization = ({
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
  addToast,
  pushUndo,
}: InitializationProps) => {
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const loadData = async () => {
      try {
        await indexedDBService.initialize();
      } catch (error) {
        console.warn("[Storage] IndexedDB initialization failed:", error);
      }

      const { archiveService } = await import("../services/archiveService");
      await archiveService.initialize();
      await storageService.initialize();
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
      if (data.tasks) {
        setTasks(data.tasks);
        import("../services/searchIndexService").then(({ searchIndexService }) => {
          searchIndexServiceRef.current = searchIndexService;
          searchIndexService.buildIndex(data.tasks);
        });
        if (indexedDBService.isAvailable())
          indexedDBService.saveTasks(data.tasks).catch(console.error);
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

      import("../services/automationService").then(({ automationService }) => {
        automationServiceRef.current = automationService;
        automationService.loadRules(storageService.get("liquitask-automation-rules", []));
      });
      import("../services/templateService").then(({ templateService }) => {
        templateServiceRef.current = templateService;
        templateService.loadTemplates(
          storageService.get("liquitask-templates", []) as TaskTemplate[],
        );
      });
      import("../services/activityService").then(({ activityService }) => {
        activityServiceRef.current = activityService;
      });
      import("../utils/queryEngine").then(({ executeAdvancedFilter }) => {
        advancedFilterExecutorRef.current = executeAdvancedFilter;
      });
      setIsLoaded(true);
    };

    void loadData();
    // The initialization flow intentionally runs once on mount and populates stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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
      notificationService.startPeriodicCheck(() => tasksRef.current, 60000);
    });

    return () => {
      isActive = false;
      notificationServiceInstance?.stopPeriodicCheck();
    };
    // Ref is populated once as part of a mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationServiceRef]);

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
              addToast(`Recurring task "${newTask.title}" created`, "info");
            },
            onUpdateTask: (taskId: string, updates: Partial<Task>) => {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId ? { ...t, ...updates, updatedAt: new Date() } : t,
                ),
              );
            },
          });
          service = getRecurringTaskService();
        }

        recurringTaskServiceRef.current = service;
        service?.start(tasksRef.current);
      },
    );

    return () => {
      isActive = false;
      recurringTaskServiceRef.current?.stop();
    };
  }, [addToast, pushUndo, setTasks, recurringTaskServiceRef]);
};
