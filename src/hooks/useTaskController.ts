import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActivityItem,
  ActivityType,
  AIContext,
  BoardColumn,
  PriorityDefinition,
  Project,
  RecurringConfig,
  Task,
  TaskPrState,
  ToastType,
} from "../../types";
import { COLUMN_STATUS, STORAGE_KEYS } from "../constants";
import {
  validateTransition,
  type TransitionActor,
  type TransitionContext,
} from "../core/board/boardStateMachine";
import { replayTaskEvents } from "../core/events/taskEventReducer";
import { draftEvent, serializeTask, type TaskEventDraft } from "../core/events/taskEvents";
import taskEventStore, { projectionDeltaFromEvents, revertFailedMutation } from "../core/events/taskEventStore";
import type { AutomationTrigger, TaskContext } from "../services/automationService";
import deadLetterService from "../services/deadLetterService";
import { indexedDBService } from "../services/indexedDBService";
import {
  isNativeBackend,
  nativeMutateTasks,
  nativeSerializeTasks,
  type TaskMutateOp,
} from "../services/nativeBridge";
import { getNativeStorageApi } from "../runtime/runtimeEnvironment";
import { isSqliteTaskStoreActive } from "../services/sqliteTaskStore";
import { generateTaskId, getBacklogColumnId } from "../utils/taskUtils";
import { unhideColumn } from "../utils/boardColumns";
import {
  mapFeedbackToTaskEvent,
  type FeedbackDaemonKind,
} from "../services/agents/feedbackLoopService";

/** Probe injected by the app shell so move validation can see agent-run state. */
export interface AgentRunProbe {
  hasActiveRun: (taskId: string) => boolean;
  hasUnmergedWork: (taskId: string) => boolean;
  hasScopeConflict: (taskId: string) => boolean;
  scopeHeldByLabel: (taskId: string) => string | undefined;
}

/** Options accepted by `moveTask` — the merge pipeline moves cards with `viaMergePipeline`. */
export interface MoveTaskOptions {
  actor?: TransitionActor;
  viaMergePipeline?: boolean;
  reopen?: boolean;
  /** Override PR-open context for In Review transitions. */
  hasPrOpen?: boolean;
  prMerged?: boolean;
  /** Local reviewer-agent stage (Completed → InReview without PR). */
  localReviewerGate?: boolean;
}

interface UndoAction {
  type: "task-create" | "task-update" | "task-delete" | "task-move";
  task?: Task;
  previousState?: Task;
  taskId?: string;
}

type ActivityServiceLike = {
  createActivity: (
    type: ActivityType,
    details: string,
    field?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ) => ActivityItem;
  logChange: (task: Task, changes: Partial<Task>, activityType?: ActivityType) => Task;
};

type AutomationServiceLike = {
  processTaskEvent: (
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: {
      onNotify?: (message: string) => void;
      onAssignToAgent?: (taskId: string, agentId: string) => void;
      columns?: BoardColumn[];
    },
  ) => Partial<Task> | null;
  processTaskEventNative?: (
    event: AutomationTrigger,
    context: TaskContext,
    allTasks: Task[],
    options?: {
      onNotify?: (message: string) => void;
      onAssignToAgent?: (taskId: string, agentId: string) => void;
      columns?: BoardColumn[];
    },
  ) => Promise<Partial<Task> | null>;
};

type AiServiceLike = {
  generateSemanticKeywords: (task: Task, context: AIContext) => Promise<string[]>;
  generateSubtasks: (title: string, description: string) => Promise<string[]>;
};

type RecurringTaskServiceLike = {
  start: (getTasks: () => Task[]) => void;
  stop: () => void;
  updateNextOccurrence: (task: Task) => void;
  calculateNextOccurrence: (config: RecurringConfig, fromDate?: Date) => Date;
};

type SearchIndexServiceLike = {
  buildIndex: (tasks: Task[]) => void;
  updateTask?: (task: Task, previousTask?: Task) => void;
  removeTask?: (task: Task) => void;
  search: (query: string) => string[];
  augmentTaskSemantically?: (
    task: Task,
    aiService: AiServiceLike,
    context: AIContext,
  ) => Promise<void>;
};

const mergeTaskWithUpdates = (task: Task, updates: Partial<Task>, updatedAt: Date): Task => ({
  ...task,
  ...updates,
  id: updates.id ?? task.id,
  jobId: updates.jobId ?? task.jobId,
  projectId: updates.projectId ?? task.projectId,
  title: updates.title ?? task.title,
  subtitle: updates.subtitle ?? task.subtitle,
  summary: updates.summary ?? task.summary,
  assignee: updates.assignee ?? task.assignee,
  priority: updates.priority ?? task.priority,
  status: updates.status ?? task.status,
  createdAt: updates.createdAt ?? task.createdAt,
  updatedAt,
  dueDate: "dueDate" in updates ? updates.dueDate : task.dueDate,
  subtasks: updates.subtasks ?? task.subtasks,
  attachments: updates.attachments ?? task.attachments,
  customFieldValues:
    "customFieldValues" in updates ? updates.customFieldValues : task.customFieldValues,
  links: "links" in updates ? updates.links : task.links,
  tags: updates.tags ?? task.tags,
  timeEstimate: updates.timeEstimate ?? task.timeEstimate,
  timeSpent: updates.timeSpent ?? task.timeSpent,
  recurring: "recurring" in updates ? updates.recurring : task.recurring,
  completedAt: "completedAt" in updates ? updates.completedAt : task.completedAt,
  errorLogs: "errorLogs" in updates ? updates.errorLogs : task.errorLogs,
  activity: "activity" in updates ? updates.activity : task.activity,
  order: "order" in updates ? updates.order : task.order,
});

interface TaskControllerProps {
  initialTasks: Task[];
  columns: BoardColumn[];
  projects: Project[];
  priorities: PriorityDefinition[];
  activeProjectId: string;
  addToast: (message: string, type?: ToastType) => void;
  automationServiceRef: MutableRefObject<AutomationServiceLike | null>;
  activityServiceRef: MutableRefObject<ActivityServiceLike | null>;
  recurringTaskServiceRef: MutableRefObject<RecurringTaskServiceLike | null>;
  searchIndexServiceRef: MutableRefObject<SearchIndexServiceLike | null>;
  aiServiceRef?: MutableRefObject<AiServiceLike | null>;
  assignToAgentRef?: MutableRefObject<((taskId: string, agentId: string) => void) | null>;
  /** Optional agent-run probe (desktop) for state-machine transition guards. */
  agentRunProbeRef?: MutableRefObject<AgentRunProbe | null>;
  /** Persist column config when a hidden lane becomes occupied. */
  onColumnsChange?: (columns: BoardColumn[]) => void;
}

export const useTaskController = ({
  initialTasks,
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
  agentRunProbeRef,
  onColumnsChange,
}: TaskControllerProps) => {
  const automationOpts = useCallback(
    () => ({
      columns,
      onNotify: (message: string) => addToast(message, "info"),
      onAssignToAgent: assignToAgentRef?.current ?? undefined,
    }),
    [columns, addToast, assignToAgentRef],
  );
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const undoStack = useRef<UndoAction[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const MAX_UNDO = 20;
  const autoPilotRunIdsRef = useRef<Map<string, number>>(new Map());
  // Tracks mount status so deferred async resolutions (e.g. auto-pilot subtask
  // generation) do not call setTasks after the host component has unmounted.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const persistLegacyTaskMirrors = useCallback((tasks: Task[]) => {
    if (indexedDBService.isAvailable()) {
      indexedDBService.saveTasks(tasks).catch(console.error);
    }
    if (isNativeBackend()) {
      void nativeSerializeTasks(tasks)
        .then((serialized) => getNativeStorageApi()?.set(STORAGE_KEYS.TASKS, serialized))
        .catch(console.error);
    }
  }, []);

  useEffect(() => {
    deadLetterService.registerRetryHandler("event-log", async (letter) => {
      const events = letter.payload.events as TaskEventDraft[] | undefined;
      if (!Array.isArray(events) || events.length === 0) {
        throw new Error("Dead letter is missing event batch.");
      }
      const staged = events.map((e, i) => ({ ...draftEvent(e), seq: i + 1, v: 1 as const }));
      const projected = replayTaskEvents(staged, tasksRef.current);
      const delta = projectionDeltaFromEvents(events, projected);
      const appended = await taskEventStore.commitMutation(
        events,
        delta.upsertTasks,
        delta.deleteTaskIds,
      );
      if (!isMountedRef.current) return;
      const finalTasks = replayTaskEvents(appended, tasksRef.current);
      setTasks(finalTasks);
      persistLegacyTaskMirrors(finalTasks);
    });
  }, [persistLegacyTaskMirrors]);

  const persistIndexedDB = useCallback(
    (action: { kind: "task"; task: Task } | { kind: "tasks"; tasks: Task[] } | { kind: "delete"; taskId: string }) => {
      if (!indexedDBService.isAvailable()) return;
      if (action.kind === "task") {
        indexedDBService.saveTask(action.task).catch(console.error);
      } else if (action.kind === "tasks") {
        indexedDBService.saveTasks(action.tasks).catch(console.error);
      } else {
        indexedDBService.deleteTask(action.taskId).catch(console.error);
      }
    },
    [],
  );

  /**
   * Event-sourced mutation funnel. The UI updates optimistically, but the
   * durable order is strict: the event batch is appended to the write-ahead
   * log FIRST; only after the log accepts it are the derived stores (SQLite
   * snapshot, IndexedDB/native mirrors) updated. If the append fails the
   * optimistic update is rolled back and the mutation is dead-lettered.
   */
  const commitTaskMutation = useCallback(
    (
      optimisticTasks: Task[],
      nativeRequest: {
        op: TaskMutateOp;
        task?: Task;
        taskId?: string;
        taskIds?: string[];
        patch?: Partial<Task>;
        newTasks?: Task[];
      },
      indexedDBAction?: { kind: "task"; task: Task } | { kind: "tasks"; tasks: Task[] } | { kind: "delete"; taskId: string },
      events?: TaskEventDraft[],
    ) => {
      const prevTasks = tasksRef.current;
      setTasks(optimisticTasks);

      const persistProjections = () => {
        if (isNativeBackend() && !isSqliteTaskStoreActive()) {
          void nativeMutateTasks({ tasks: prevTasks, ...nativeRequest })
            .then((result) => {
              if (isMountedRef.current) setTasks(result);
            })
            .catch((err) => console.error("[useTaskController] nativeMutateTasks failed:", err));
        }
        persistLegacyTaskMirrors(optimisticTasks);
        if (!isNativeBackend() && indexedDBAction) persistIndexedDB(indexedDBAction);
      };

      if (!events || events.length === 0) {
        persistProjections();
        return;
      }

      const { upsertTasks, deleteTaskIds } = projectionDeltaFromEvents(events, optimisticTasks);

      void taskEventStore
        .commitMutation(events, upsertTasks, deleteTaskIds)
        .then(() => persistProjections())
        .catch((err) => {
          if (taskEventStore.isDegraded()) {
            if (events?.length) taskEventStore.journalDegradedMutation(events);
            persistProjections();
            return;
          }
          if (isMountedRef.current) {
            setTasks(revertFailedMutation(tasksRef.current, events ?? [], prevTasks));
          }
          const message = err instanceof Error ? err.message : String(err);
          deadLetterService.record({
            kind: "event-log",
            title: "Board change could not be recorded",
            detail: message,
            taskId: events[0]?.streamId,
            payload: { events },
          });
          addToast("Change rolled back — the task event log rejected the write.", "error");
        });
    },
    [persistIndexedDB, persistLegacyTaskMirrors, addToast],
  );

  /** Build the state-machine context for a proposed column transition. */
  const buildTransitionContext = useCallback(
    (task: Task, newStatus: string, actor: TransitionActor): TransitionContext => {
      const allTasks = tasksRef.current;
      const blockedLinks = task.links?.filter((l) => l.type === "blocked-by") ?? [];
      let blockedByLabel: string | undefined;
      let blockedByOpen = false;
      for (const link of blockedLinks) {
        const blocker = allTasks.find((t) => t.id === link.targetTaskId);
        if (!blocker) continue;
        const blockerCol = columns.find((c) => c.id === blocker.status);
        if (!blockerCol?.isCompleted && blocker.status !== COLUMN_STATUS.COMMIT) {
          blockedByOpen = true;
          blockedByLabel = `task ${blocker.jobId}`;
          break;
        }
      }

      const targetColumn = columns.find((c) => c.id === newStatus);
      let wipExceeded = false;
      if (
        newStatus !== task.status &&
        targetColumn?.wipLimit &&
        targetColumn.wipLimit > 0
      ) {
        const tasksInColumn = allTasks.filter((t) => t.status === newStatus && t.id !== task.id);
        wipExceeded = tasksInColumn.length >= targetColumn.wipLimit;
      }

      const probe = agentRunProbeRef?.current;
      const prState = task.prState;
      const prOpen =
        prState?.state === "open" ||
        prState?.state === "draft" ||
        Boolean(prState?.url && prState.state !== "merged" && prState.state !== "closed");
      return {
        actor,
        blockedByOpen,
        blockedByLabel,
        wipExceeded,
        hasActiveRun: probe?.hasActiveRun(task.id) ?? false,
        hasUnmergedWork: probe?.hasUnmergedWork(task.id) ?? false,
        hasPrOpen: prOpen,
        prMerged: prState?.state === "merged",
        scopeReservationHeld: probe?.hasScopeConflict(task.id) ?? false,
        scopeHeldByLabel: probe?.scopeHeldByLabel(task.id),
      };
    },
    [columns, agentRunProbeRef],
  );

  const resolveAutomationUpdates = useCallback(
    (
      event: AutomationTrigger,
      context: TaskContext,
      allTasks: Task[],
    ): Partial<Task> | null | Promise<Partial<Task> | null> => {
      const service = automationServiceRef.current;
      if (!service) return null;
      if (isNativeBackend() && service.processTaskEventNative) {
        return service.processTaskEventNative(event, context, allTasks, automationOpts());
      }
      return service.processTaskEvent(event, context, allTasks, automationOpts()) ?? null;
    },
    [automationServiceRef, automationOpts],
  );

  /** Strip illegal status transitions from automation-produced updates. */
  const sanitizeAutomationUpdates = useCallback(
    (
      task: Task,
      updates: Partial<Task>,
      actor: TransitionActor = "automation",
    ): Partial<Task> | null => {
      if (!updates.status || updates.status === task.status) return updates;
      const verdict = validateTransition(task.status, updates.status, {
        ...buildTransitionContext(task, updates.status, actor),
      });
      if (verdict.allowed) return updates;
      const { status: _ignored, ...rest } = updates;
      return Object.keys(rest).length > 0 ? rest : null;
    },
    [buildTransitionContext],
  );

  const augmentTaskSemantically = useCallback(
    async (task: Task) => {
      if (!aiServiceRef?.current || !searchIndexServiceRef.current) return;

      const currentAiService = aiServiceRef.current;

      const context: AIContext = {
        activeProjectId,
        projects,
        priorities,
      };

      await searchIndexServiceRef.current.augmentTaskSemantically?.(
        task,
        currentAiService,
        context,
      );
    },
    [activeProjectId, projects, priorities, aiServiceRef, searchIndexServiceRef],
  );

  const pushUndo = useCallback((action: UndoAction) => {
    undoStack.current = [action, ...undoStack.current.slice(0, MAX_UNDO - 1)];
    setCanUndo(undoStack.current.length > 0);
  }, []);

  const handleUndo = useCallback(() => {
    const action = undoStack.current.shift();
    setCanUndo(undoStack.current.length > 0);

    if (!action) {
      addToast("Nothing to undo", "info");
      return;
    }

    switch (action.type) {
      case "task-delete":
        if (action.task) {
          const deletedTask = action.task;
          commitTaskMutation(
            [...tasksRef.current, deletedTask],
            { op: "create", task: deletedTask },
            { kind: "task", task: deletedTask },
            [
              {
                streamId: deletedTask.id,
                type: "task.created",
                payload: { task: serializeTask(deletedTask), changed: ["undo"] },
                actor: "user",
              },
            ],
          );
          searchIndexServiceRef.current?.updateTask?.(deletedTask);
          addToast(`Restored "${deletedTask.title}"`, "success");
        }
        break;
      case "task-update":
        if (action.previousState) {
          const previousState = action.previousState;
          commitTaskMutation(
            tasksRef.current.map((t) => (t.id === previousState.id ? previousState : t)),
            { op: "update", taskId: previousState.id, patch: previousState },
            { kind: "task", task: previousState },
            [
              {
                streamId: previousState.id,
                type: "task.updated",
                payload: { task: serializeTask(previousState), changed: ["undo"] },
                actor: "user",
              },
            ],
          );
          searchIndexServiceRef.current?.updateTask?.(previousState, action.task);
          addToast("Change undone", "info");
        }
        break;
      case "task-create":
        if (action.taskId) {
          const undoTaskId = action.taskId;
          const createdTask = tasksRef.current.find((t) => t.id === undoTaskId);
          if (createdTask) {
            searchIndexServiceRef.current?.removeTask?.(createdTask);
          }
          commitTaskMutation(
            tasksRef.current.filter((t) => t.id !== undoTaskId),
            { op: "delete", taskId: undoTaskId },
            { kind: "delete", taskId: undoTaskId },
            [
              {
                streamId: undoTaskId,
                type: "task.deleted",
                payload: { changed: ["undo"] },
                actor: "user",
              },
            ],
          );
          addToast("Task creation undone", "info");
        }
        break;
      case "task-move":
        if (action.previousState) {
          const previousState = action.previousState;
          commitTaskMutation(
            tasksRef.current.map((t) => (t.id === previousState.id ? previousState : t)),
            { op: "update", taskId: previousState.id, patch: previousState },
            { kind: "task", task: previousState },
            [
              {
                streamId: previousState.id,
                type: "task.moved",
                payload: {
                  task: serializeTask(previousState),
                  changed: ["undo"],
                  from: action.task?.status,
                  to: previousState.status,
                },
                actor: "user",
              },
            ],
          );
          searchIndexServiceRef.current?.updateTask?.(previousState, action.task);
          addToast("Move undone", "info");
        }
        break;
    }
  }, [addToast, searchIndexServiceRef, commitTaskMutation]);

  const handleUpdateTask = useCallback(
    (
      taskOrId: Task | string,
      updates?: Partial<Task>,
      options?: {
        actor?: TransitionActor;
        /** Event-log attribution, e.g. "agent:Codey". Defaults to `actor`. */
        actorLabel?: string;
        viaMergePipeline?: boolean;
        reopen?: boolean;
        hasPrOpen?: boolean;
        prMerged?: boolean;
      },
    ) => {
      let taskId: string;
      let taskUpdates: Partial<Task>;

      if (typeof taskOrId === "string") {
        taskId = taskOrId;
        taskUpdates = updates || {};
      } else {
        taskId = taskOrId.id;
        taskUpdates = taskOrId;
      }

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Status changes smuggled through field updates (MCP tools, lifecycle
      // hooks) face the same state machine as drag & drop.
      const actor = options?.actor ?? "user";
      if (taskUpdates.status && taskUpdates.status !== task.status) {
        const transitionCtx = buildTransitionContext(task, taskUpdates.status, actor);
        const verdict = validateTransition(task.status, taskUpdates.status, {
          ...transitionCtx,
          viaMergePipeline: options?.viaMergePipeline,
          reopen: options?.reopen,
          hasPrOpen: options?.hasPrOpen ?? transitionCtx.hasPrOpen,
          prMerged: options?.prMerged ?? transitionCtx.prMerged,
          localReviewerGate: options?.localReviewerGate,
        });
        if (
          !verdict.allowed ||
          (verdict.requires === "merge-pipeline" && !options?.viaMergePipeline)
        ) {
          addToast(
            verdict.reason ??
              "This card has unmerged agent work — it can only reach Commit through the merge pipeline.",
            "error",
          );
          return;
        }
      }

      const previousTask = { ...task };
      const updatedTask = mergeTaskWithUpdates(task, taskUpdates, new Date());
      const statusChanged = updatedTask.status !== previousTask.status;

      pushUndo({
        type: "task-update",
        task: updatedTask,
        previousState: previousTask,
      });
      commitTaskMutation(
        tasks.map((t) => (t.id === taskId ? updatedTask : t)),
        { op: "update", taskId, patch: updatedTask },
        { kind: "task", task: updatedTask },
        [
          {
            streamId: taskId,
            type: statusChanged ? "task.moved" : "task.updated",
            payload: {
              task: serializeTask(updatedTask),
              changed: Object.keys(taskUpdates),
              ...(statusChanged
                ? { from: previousTask.status, to: updatedTask.status }
                : {}),
            },
            actor: options?.actorLabel ?? actor,
          },
        ],
      );
      searchIndexServiceRef.current?.updateTask?.(updatedTask, previousTask);
      augmentTaskSemantically(updatedTask);
    },
    [
      tasks,
      pushUndo,
      searchIndexServiceRef,
      augmentTaskSemantically,
      commitTaskMutation,
      buildTransitionContext,
      addToast,
    ],
  );

  const handleUpdateTaskDueDate = useCallback(
    (taskId: string, newDate: Date) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        addToast("Task not found", "error");
        return;
      }

      const normalizedDate = new Date(newDate);
      normalizedDate.setHours(0, 0, 0, 0);

      const currentDueDate = task.dueDate ? new Date(task.dueDate) : null;
      if (currentDueDate) {
        currentDueDate.setHours(0, 0, 0, 0);
        if (currentDueDate.getTime() === normalizedDate.getTime()) {
          return;
        }
      }

      const previousTask = { ...task };
      const updates: Partial<Task> = {
        dueDate: normalizedDate,
        updatedAt: new Date(),
      };

      const updatedTask = activityServiceRef.current?.logChange(task, updates) || {
        ...task,
        ...updates,
      };

      pushUndo({
        type: "task-update",
        task: updatedTask,
        previousState: previousTask,
      });
      commitTaskMutation(
        tasks.map((t) => (t.id === taskId ? updatedTask : t)),
        { op: "update", taskId, patch: updatedTask },
        { kind: "task", task: updatedTask },
        [
          {
            streamId: taskId,
            type: "task.updated",
            payload: { task: serializeTask(updatedTask), changed: ["dueDate"] },
            actor: "user",
          },
        ],
      );
      searchIndexServiceRef.current?.updateTask?.(updatedTask, previousTask);
      augmentTaskSemantically(updatedTask);

      const dateStr = normalizedDate.toLocaleDateString();
      addToast(`Due date updated to ${dateStr}`, "success");
    },
    [tasks, addToast, pushUndo, activityServiceRef, searchIndexServiceRef, augmentTaskSemantically, commitTaskMutation],
  );

  const handleMoveTaskToWorkspace = useCallback(
    (taskId: string, projectId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const targetProject = projects.find((p) => p.id === projectId);
      if (!targetProject) return;

      if (task.projectId === projectId) {
        addToast("Task is already in this workspace", "info");
        return;
      }

      const previousTask = { ...task };
      const updatedTask = {
        ...task,
        projectId,
        updatedAt: new Date(),
      };

      pushUndo({
        type: "task-update",
        task: updatedTask,
        previousState: previousTask,
      });
      commitTaskMutation(
        tasks.map((t) => (t.id === taskId ? updatedTask : t)),
        { op: "update", taskId, patch: updatedTask },
        { kind: "task", task: updatedTask },
        [
          {
            streamId: taskId,
            type: "task.updated",
            payload: { task: serializeTask(updatedTask), changed: ["projectId"] },
            actor: "user",
          },
        ],
      );
      searchIndexServiceRef.current?.updateTask?.(updatedTask, previousTask);
      addToast(`Task moved to "${targetProject.name}"`, "success");
    },
    [tasks, projects, addToast, pushUndo, searchIndexServiceRef, commitTaskMutation],
  );

  const handleCreateOrUpdateTask = useCallback(
    async (taskData: Partial<Task>, editingTask: Task | null) => {
      if (editingTask) {
        const previousTask = tasks.find((t) => t.id === editingTask.id);
        const updates = { ...taskData, updatedAt: new Date() };
        let updatedTask = activityServiceRef.current?.logChange(editingTask, updates) || {
          ...editingTask,
          ...updates,
        };

        const automationResult = resolveAutomationUpdates(
          "onUpdate",
          {
            previousTask,
            newTask: updatedTask,
            changedFields: Object.keys(updates),
          },
          tasks,
        );
        const automationUpdates =
          automationResult instanceof Promise ? await automationResult : automationResult;
        if (automationUpdates) {
          const safe = sanitizeAutomationUpdates(updatedTask, automationUpdates);
          if (safe) updatedTask = { ...updatedTask, ...safe };
        }

        if (previousTask) {
          pushUndo({
            type: "task-update",
            task: updatedTask,
            previousState: previousTask,
          });
        }
        commitTaskMutation(
          tasks.map((t) => (t.id === editingTask.id ? updatedTask : t)),
          { op: "update", taskId: editingTask.id, patch: updatedTask },
          { kind: "task", task: updatedTask },
          [
            {
              streamId: editingTask.id,
              type: "task.updated",
              payload: { task: serializeTask(updatedTask), changed: Object.keys(updates) },
              actor: "user",
            },
          ],
        );
        searchIndexServiceRef.current?.updateTask?.(updatedTask, previousTask);
        augmentTaskSemantically(updatedTask);

        const recurringService = recurringTaskServiceRef.current;
        if (
          updatedTask.recurring?.enabled &&
          recurringService &&
          !updatedTask.recurring.nextOccurrence
        ) {
          const nextOccurrence = recurringService.calculateNextOccurrence(updatedTask.recurring);
          const withRecurring = {
            ...updatedTask,
            recurring: { ...updatedTask.recurring, nextOccurrence },
          };
          commitTaskMutation(
            tasks.map((t) => (t.id === updatedTask.id ? withRecurring : t)),
            { op: "update", taskId: updatedTask.id, patch: withRecurring },
            { kind: "task", task: withRecurring },
          );
        }

        addToast("Task updated successfully", "success");
        return;
      }

      const now = new Date();
      const newTask: Task = {
        id: generateTaskId(),
        jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
        projectId: activeProjectId,
        title: taskData.title || "Untitled",
        subtitle: taskData.subtitle || "",
        summary: taskData.summary || "",
        assignee: taskData.assignee || "",
        priority: taskData.priority || "medium",
        status: taskData.status || getBacklogColumnId(columns),
        createdAt: now,
        updatedAt: now,
        subtasks: taskData.subtasks || [],
        attachments: taskData.attachments || [],
        customFieldValues: taskData.customFieldValues || {},
        links: taskData.links || [],
        tags: taskData.tags || [],
        timeEstimate: taskData.timeEstimate || 0,
        timeSpent: taskData.timeSpent || 0,
        errorLogs: taskData.errorLogs || [],
        activity: activityServiceRef.current
          ? [activityServiceRef.current.createActivity("create", "Task created")]
          : [],
        recurring: taskData.recurring ? { ...taskData.recurring } : undefined,
      };

      const recurringService = recurringTaskServiceRef.current;
      if (newTask.recurring?.enabled && recurringService && !newTask.recurring.nextOccurrence) {
        newTask.recurring.nextOccurrence = recurringService.calculateNextOccurrence(
          newTask.recurring,
        );
      }

      const createAutomationResult = resolveAutomationUpdates("onCreate", { newTask }, tasks);
      const automationUpdates =
        createAutomationResult instanceof Promise
          ? await createAutomationResult
          : createAutomationResult;
      if (automationUpdates) {
        const safe = sanitizeAutomationUpdates(newTask, automationUpdates);
        if (safe) Object.assign(newTask, safe);
      }

      pushUndo({ type: "task-create", taskId: newTask.id });
      commitTaskMutation(
        [...tasks, newTask],
        { op: "create", task: newTask },
        { kind: "task", task: newTask },
        [
          {
            streamId: newTask.id,
            type: "task.created",
            payload: { task: serializeTask(newTask), changed: ["*"] },
            actor: "user",
          },
        ],
      );
      searchIndexServiceRef.current?.updateTask?.(newTask);
      augmentTaskSemantically(newTask);

      addToast("Task created successfully (Ctrl+Z to undo)", "success");
      // Return the created task so programmatic callers (e.g. DevCouncil
      // auto-init) can dispatch it to an agent. The update branch returns void.
      return newTask;
    },
    [
      tasks,
      activeProjectId,
      columns,
      pushUndo,
      addToast,
      activityServiceRef,
      recurringTaskServiceRef,
      searchIndexServiceRef,
      augmentTaskSemantically,
      commitTaskMutation,
      resolveAutomationUpdates,
      sanitizeAutomationUpdates,
    ],
  );

  const handleBulkCreateTasks = useCallback(
    (newTasksData: Partial<Task>[]) => {
      const now = new Date();
      const createdTasks: Task[] = newTasksData.map((taskData, idx) => ({
        ...taskData,
        id: generateTaskId(idx),
        jobId: `IMP-${Math.floor(Math.random() * 9000) + 1000}`,
        projectId: taskData.projectId || activeProjectId,
        title: taskData.title || "Untitled",
        subtitle: taskData.subtitle || "",
        summary: taskData.summary || "",
        assignee: taskData.assignee || "",
        priority: taskData.priority || "medium",
        status: getBacklogColumnId(columns),
        createdAt: now,
        updatedAt: now,
        subtasks: taskData.subtasks || [],
        attachments: taskData.attachments || [],
        customFieldValues: taskData.customFieldValues || {},
        links: taskData.links || [],
        tags: taskData.tags || [],
        timeEstimate: taskData.timeEstimate || 0,
        timeSpent: taskData.timeSpent || 0,
        errorLogs: taskData.errorLogs || [],
        activity: [
          ...(taskData.activity || []),
          ...(activityServiceRef.current
            ? [activityServiceRef.current.createActivity("create", "Bulk created")]
            : []),
        ],
      }));

      commitTaskMutation(
        [...tasks, ...createdTasks],
        { op: "bulkUpsert", newTasks: createdTasks },
        { kind: "tasks", tasks: createdTasks },
        createdTasks.map((task) => ({
          streamId: task.id,
          type: "task.created" as const,
          payload: { task: serializeTask(task), changed: ["*"] },
          actor: "user",
        })),
      );
      createdTasks.forEach((task) => {
        searchIndexServiceRef.current?.updateTask?.(task);
      });

      // Augment semantically in background
      createdTasks.forEach((task) => {
        void augmentTaskSemantically(task);
      });
    },
    [tasks, activeProjectId, columns, searchIndexServiceRef, activityServiceRef, augmentTaskSemantically, commitTaskMutation],
  );

  const handleDeleteTaskInternal = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      pushUndo({ type: "task-delete", task });
      commitTaskMutation(
        tasks.filter((t) => t.id !== taskId),
        { op: "delete", taskId },
        { kind: "delete", taskId },
        [
          {
            streamId: taskId,
            type: "task.deleted",
            payload: { changed: ["*"] },
            actor: "user",
          },
        ],
      );
      searchIndexServiceRef.current?.removeTask?.(task);
      addToast("Task deleted (Ctrl+Z to undo)", "info");
    },
    [tasks, pushUndo, addToast, searchIndexServiceRef, commitTaskMutation],
  );

  const moveTask = useCallback(
    async (
      taskId: string,
      newStatus: string,
      newPriority?: string,
      newOrder?: number,
      options?: MoveTaskOptions,
    ) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) {
        addToast("Task not found", "error");
        return false;
      }

      const targetColumn = columns.find((c) => c.id === newStatus);
      if (!targetColumn) {
        addToast("Invalid column", "error");
        return false;
      }

      // Persistently reveal hidden lanes (e.g. In Review) once a task enters them.
      if (targetColumn.hidden && onColumnsChange) {
        const nextColumns = unhideColumn(columns, newStatus);
        if (nextColumns.some((col, i) => col.hidden !== columns[i]?.hidden)) {
          onColumnsChange(nextColumns);
        }
      }

      // Git-aligned state machine: every column transition is validated here,
      // regardless of origin (drag & drop, keyboard, MCP, automation).
      const actor = options?.actor ?? "user";
      const transitionCtx = buildTransitionContext(task, newStatus, actor);
      const verdict = validateTransition(task.status, newStatus, {
        ...transitionCtx,
        viaMergePipeline: options?.viaMergePipeline,
        reopen: options?.reopen,
        hasPrOpen: options?.hasPrOpen ?? transitionCtx.hasPrOpen,
        prMerged: options?.prMerged ?? transitionCtx.prMerged,
        localReviewerGate: options?.localReviewerGate,
      });
      if (!verdict.allowed) {
        addToast(verdict.reason ?? "That move is not allowed.", "error");
        return false;
      }
      if (verdict.requires === "merge-pipeline" && !options?.viaMergePipeline) {
        // Unmerged agent work may only land in Commit through the
        // transactional merge pipeline (the board shell intercepts this).
        addToast(
          "This card has unmerged agent work — approve it so the merge pipeline can commit it.",
          "warning",
        );
        return false;
      }

      const previousTask = { ...task };

      let finalOrder = newOrder;
      if (finalOrder === undefined) {
        if (newStatus === task.status) {
          finalOrder = task.order;
        } else {
          const tasksInNewColumn = tasks.filter((t) => t.status === newStatus && t.id !== taskId);
          const maxOrder = tasksInNewColumn.reduce((max, t) => Math.max(max, t.order ?? 0), 0);
          finalOrder = maxOrder + 1;
        }
      }

      const updates: Partial<Task> = {
        status: newStatus,
        priority: newPriority ?? task.priority,
        order: finalOrder,
        updatedAt: new Date(),
      };

      if (targetColumn.isCompleted && !task.completedAt) {
        updates.completedAt = new Date();
      }

      const activity: ActivityItem[] = [];
      if (newStatus !== task.status && activityServiceRef.current) {
        activity.push(
          activityServiceRef.current.createActivity(
            "move",
            `Moved to ${columns.find((c) => c.id === newStatus)?.title}`,
            "status",
            task.status,
            newStatus,
          ),
        );
      }
      if (newPriority && newPriority !== task.priority && activityServiceRef.current) {
        activity.push(
          activityServiceRef.current.createActivity(
            "update",
            `Priority changed to ${newPriority}`,
            "priority",
            task.priority,
            newPriority,
          ),
        );
      }

      let updatedTask = {
        ...task,
        ...updates,
        activity: [...(task.activity || []), ...activity],
      };

      const moveAutomationResult = resolveAutomationUpdates(
        "onMove",
        { previousTask, newTask: updatedTask },
        tasks,
      );
      const automationUpdates =
        moveAutomationResult instanceof Promise ? await moveAutomationResult : moveAutomationResult;
      if (automationUpdates) {
        const safe = sanitizeAutomationUpdates(updatedTask, automationUpdates);
        if (safe) updatedTask = { ...updatedTask, ...safe };
      }

      const recurringService = recurringTaskServiceRef.current;
      if (targetColumn.isCompleted && updatedTask.recurring?.enabled && recurringService) {
        recurringService.updateNextOccurrence(updatedTask);

        const completeAutomationResult = resolveAutomationUpdates(
          "onComplete",
          { previousTask, newTask: updatedTask },
          tasks,
        );
        const completeUpdates =
          completeAutomationResult instanceof Promise
            ? await completeAutomationResult
            : completeAutomationResult;
        if (completeUpdates) {
          const safeComplete = sanitizeAutomationUpdates(updatedTask, completeUpdates);
          if (safeComplete) updatedTask = { ...updatedTask, ...safeComplete };
        }
      }

      pushUndo({
        type: "task-move",
        task: updatedTask,
        previousState: previousTask,
      });
      commitTaskMutation(
        tasks.map((t) => (t.id === taskId ? updatedTask : t)),
        { op: "update", taskId, patch: updatedTask },
        { kind: "task", task: updatedTask },
        [
          {
            streamId: taskId,
            type: newStatus !== previousTask.status ? "task.moved" : "task.updated",
            payload: {
              task: serializeTask(updatedTask),
              changed: ["status", "order", "priority"],
              from: previousTask.status,
              to: newStatus,
              viaMergePipeline: options?.viaMergePipeline ?? false,
            },
            actor,
          },
        ],
      );
      searchIndexServiceRef.current?.updateTask?.(updatedTask, previousTask);

      // Auto-Pilot Subtask Engine
      const currentAiService = aiServiceRef?.current;
      if (
        newStatus !== previousTask.status &&
        targetColumn.title.toLowerCase().includes("progress") &&
        updatedTask.subtasks.length === 0 &&
        currentAiService
      ) {
        addToast("Auto-pilot: Generating subtasks...", "info");
        const prevRunId = autoPilotRunIdsRef.current.get(taskId) ?? 0;
        const capturedRunId = prevRunId + 1;
        autoPilotRunIdsRef.current.set(taskId, capturedRunId);
        currentAiService
          .generateSubtasks(updatedTask.title, updatedTask.summary)
          .then((subtaskTitles) => {
            if (!isMountedRef.current) return;
            if (autoPilotRunIdsRef.current.get(taskId) !== capturedRunId) return;
            autoPilotRunIdsRef.current.delete(taskId);
            if (subtaskTitles.length > 0) {
              const newSubtasks = subtaskTitles.map((title, i) => ({
                id: `ai-st-${Date.now()}-${i}`,
                title,
                completed: false,
              }));

              const prev = tasksRef.current;
              const movedTask = prev.find((t) => t.id === taskId);
              if (!movedTask) return;

              const finalTask = { ...movedTask, subtasks: newSubtasks, updatedAt: new Date() };
              commitTaskMutation(
                prev.map((t) => (t.id === taskId ? finalTask : t)),
                { op: "update", taskId, patch: finalTask },
                { kind: "task", task: finalTask },
                [
                  {
                    streamId: taskId,
                    type: "task.updated",
                    payload: { task: serializeTask(finalTask), changed: ["subtasks"] },
                    actor: "automation",
                  },
                ],
              );
              addToast(`Auto-pilot added ${subtaskTitles.length} subtasks`, "success");
            }
          })
          .catch((e) => {
            autoPilotRunIdsRef.current.delete(taskId);
            console.error("Auto-pilot failed:", e);
          });
      }
      return true;
    },
    [
      tasks,
      columns,
      addToast,
      pushUndo,
      activityServiceRef,
      recurringTaskServiceRef,
      searchIndexServiceRef,
      aiServiceRef,
      commitTaskMutation,
      resolveAutomationUpdates,
      sanitizeAutomationUpdates,
      buildTransitionContext,
      onColumnsChange,
    ],
  );

  /**
   * Drag-preview validation — same state machine as `moveTask`, minus the
   * merge-pipeline requirement (the board shell intercepts Completed→Commit
   * drops with unmerged work and routes them through the pipeline, so the
   * drop itself is legal).
   */
  const canMoveTask = useCallback(
    (taskId: string, newStatus: string, _newPriority?: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return { allowed: false, reason: "Task not found" };

      const targetColumn = columns.find((c) => c.id === newStatus);
      if (!targetColumn) return { allowed: false, reason: "Invalid column" };

      const verdict = validateTransition(
        task.status,
        newStatus,
        buildTransitionContext(task, newStatus, "user"),
      );
      if (!verdict.allowed) return { allowed: false, reason: verdict.reason };
      return { allowed: true };
    },
    [tasks, columns, buildTransitionContext],
  );

  const patchTaskPrState = useCallback(
    (taskId: string, patch: TaskPrState, eventType: FeedbackDaemonKind) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const prState = {
        ...task.prState,
        ...patch,
        ci: patch.ci ? { ...task.prState?.ci, ...patch.ci } : task.prState?.ci,
        review: patch.review
          ? { ...task.prState?.review, ...patch.review }
          : task.prState?.review,
      };
      const updatedTask = mergeTaskWithUpdates(task, { prState }, new Date());
      commitTaskMutation(
        tasks.map((t) => (t.id === taskId ? updatedTask : t)),
        { op: "update", taskId, patch: updatedTask },
        { kind: "task", task: updatedTask },
        [
          {
            streamId: taskId,
            type: mapFeedbackToTaskEvent(eventType),
            payload: { prState },
            actor: "system",
          },
        ],
      );
    },
    [tasks, commitTaskMutation],
  );

  return {
    tasks,
    setTasks,
    canUndo,
    canMoveTask,
    handleUndo,
    handleUpdateTask,
    patchTaskPrState,
    handleUpdateTaskDueDate,
    handleMoveTaskToWorkspace,
    handleCreateOrUpdateTask,
    handleBulkCreateTasks,
    handleDeleteTaskInternal,
    moveTask,
    pushUndo,
  };
};
