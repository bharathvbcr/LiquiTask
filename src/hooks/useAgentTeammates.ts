import { useCallback, useEffect, useRef, useState } from "react";

import { COLUMN_STATUS } from "../constants";
import { isTauri } from "../runtime/runtimeEnvironment";
import agentMcpService from "../services/agents/agentMcpService";
import agentDispatchService from "../services/agents/agentDispatchService";
import agentPlannerService, { type PendingPlan } from "../services/agents/agentPlannerService";
import agentRunService from "../services/agents/agentRunService";
import agentService from "../services/agents/agentService";
import mergePipelineService from "../services/agents/mergePipelineService";
import deadLetterService from "../services/deadLetterService";
import notificationService from "../services/notificationService";
import {
  recordRunOutcome,
  runDurationMinutes,
} from "../services/agents/agentEstimateLearningService";
import type {
  ActivityItem,
  AgentProfile,
  AgentRun,
  BoardColumn,
  Project,
  Task,
  ToastType,
} from "../../types";
import { resolveAgentWorkspace } from "../services/agents/resolveAgentWorkspace";
import { generateTaskId, getBacklogColumnId } from "../utils/taskUtils";

interface UseAgentTeammatesArgs {
  isLoaded: boolean;
  tasks: Task[];
  columns: BoardColumn[];
  projects: Project[];
  handleUpdateTask: (
    taskId: string,
    updates: Partial<Task>,
    options?: {
      actor?: "user" | "agent" | "automation" | "system";
      actorLabel?: string;
      viaMergePipeline?: boolean;
      reopen?: boolean;
    },
  ) => void;
  handleCreateTask?: (task: Partial<Task> & { title: string; projectId: string }) => void;
  addToast: (message: string, type: ToastType) => void;
}

const activityEntry = (agentName: string, details: string): ActivityItem => ({
  id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: "comment",
  timestamp: new Date(),
  userId: agentName,
  details,
});

/**
 * Wires the agent run engine into the board (Multica-style teammates):
 * - auto-pickup when a backlog task is assigned to an agent with `autoPickup`
 * - card moves to In Progress when a run starts
 * - successful runs move to Completed for human review
 * - approving commits & merges the run's worktree and moves the card to Commit
 * - streamed results land in the task's activity trail / error logs
 * - MCP bridge lets agents move the card / post progress mid-run
 */
export const useAgentTeammates = ({
  isLoaded,
  tasks,
  columns,
  projects,
  handleUpdateTask,
  handleCreateTask,
  addToast,
}: UseAgentTeammatesArgs) => {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [pendingPlans, setPendingPlans] = useState<PendingPlan[]>([]);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Bind runs to the task's project workspace (fixes agents running in the
  // wrong repo). The resolver reads the latest projects via the ref, so it
  // stays current without re-registering.
  useEffect(() => {
    agentRunService.setWorkspaceResolver((task, agent) =>
      resolveAgentWorkspace(task, agent, projectsRef.current),
    );
  }, []);
  /** taskId -> assignee already auto-picked, to avoid re-trigger loops. */
  const pickedUpRef = useRef(new Map<string, string>());
  /** runId -> repair tasks already created from gate gaps. */
  const repairedRunsRef = useRef(new Set<string>());
  /** taskId -> auto-retry attempts, to cap crash/stall retries at one. */
  const autoRetryCountRef = useRef(new Map<string, number>());

  const refreshAgents = useCallback(() => {
    setAgents(agentService.getAgents());
  }, []);

  // -- MCP hooks --------------------------------------------------------------

  useEffect(() => {
    agentMcpService.setHooks({
      getTask: (taskId) => tasksRef.current.find((t) => t.id === taskId),
      getColumns: () => columnsRef.current,
      // MCP mutations are agent-actor moves: the board state machine rejects
      // anything outside In Progress → Completed for them.
      updateTask: (taskId, updates, options) =>
        handleUpdateTask(taskId, updates, {
          actor: "agent",
          actorLabel: options?.actorLabel ?? "agent-mcp",
        }),
      getRunsForTask: (taskId) => agentRunService.getRunsForTask(taskId),
      createTask: (partial) => {
        if (!handleCreateTask) return null;
        const task: Task = {
          id: generateTaskId(),
          jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
          projectId: partial.projectId,
          title: partial.title,
          summary: partial.summary ?? "",
          assignee: partial.assignee ?? "",
          priority: partial.priority ?? "medium",
          status: partial.status ?? getBacklogColumnId(columnsRef.current),
          createdAt: new Date(),
          subtasks: [],
          attachments: [],
          tags: partial.tags ?? [],
          timeEstimate: 0,
          timeSpent: 0,
          links: partial.links,
        };
        handleCreateTask(task);
        return task;
      },
    });
  }, [handleUpdateTask, handleCreateTask]);

  // -- service lifecycle ------------------------------------------------------

  useEffect(() => {
    if (!isLoaded || !isTauri()) return;
    void notificationService.requestPermission();
    void agentRunService
      .initialize()
      .then(() => {
        // Restore context for runs that survived headless across a relaunch, so
        // their completion still drives the board (card moves, skills, queue).
        agentRunService.rehydrateActiveRuns((run) => {
          const task = tasksRef.current.find((t) => t.id === run.taskId);
          const agent = agentService.getAgentById(run.agentId);
          return task && agent ? { task, agent } : null;
        });
        setRuns(agentRunService.getRuns());
        refreshAgents();
        // Retro-drive the board for runs that finished while the app was closed
        // (moves their cards to Completed, posts activity, notifies). Runs still
        // live at reattach are excluded and finish through the normal stream.
        agentRunService.flushPendingBoardSync();
        // Worktree lifecycle hygiene: reap `.worktrees/` entries whose runs no
        // longer exist (crashed sessions, force-quits) so repos don't accrete
        // orphaned branches.
        void agentRunService.pruneStaleWorktrees(agentService.getAgents());
      })
      .catch((err) => {
        console.warn("Agent runtime unavailable:", err);
      });
    const unsubscribe = agentRunService.subscribe(setRuns);
    return () => {
      unsubscribe();
    };
  }, [isLoaded, refreshAgents]);

  // -- dead-letter retry strategies -------------------------------------------
  // "run" letters re-dispatch the task to its agent; "mcp-action" letters are
  // handled inside agentMcpService; "merge" letters inside mergePipelineService.

  useEffect(() => {
    deadLetterService.registerRetryHandler("run", async (letter) => {
      const taskId = String(letter.payload.taskId ?? letter.taskId ?? "");
      const agentId = String(letter.payload.agentId ?? "");
      const task = tasksRef.current.find((t) => t.id === taskId);
      const agent = agentService.getAgentById(agentId);
      if (!task) throw new Error("Task no longer exists.");
      if (!agent) throw new Error("Agent profile no longer exists.");
      const run = await agentRunService.assign(task, agent);
      if (!run) throw new Error("Run could not be started.");
    });
  }, []);

  // The merge pipeline needs a board hook so a successful DLQ retry also
  // advances the card to Commit (the original failure left it in Completed).
  useEffect(() => {
    mergePipelineService.setBoardHooks({
      moveTaskToCommit: (taskId, note) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        if (!task) return;
        const commitCol =
          columnsRef.current.find((c) => c.id === COLUMN_STATUS.COMMIT) ??
          columnsRef.current.find((c) => c.isCompleted);
        handleUpdateTask(
          taskId,
          {
            status: commitCol?.id ?? COLUMN_STATUS.COMMIT,
            completedAt: new Date(),
            activity: [
              ...(task.activity ?? []),
              activityEntry("user", `merge retried from Inbox — ${note.slice(0, 300)}`),
            ],
          },
          { actor: "user", viaMergePipeline: true },
        );
        addToast("Merge retry succeeded — card moved to Commit.", "success");
      },
    });
  }, [handleUpdateTask, addToast]);

  useEffect(() => {
    agentRunService.setTaskHooks({
      onRunStarted: (taskId, run) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        const agent = agentService.getAgentById(run.agentId);
        if (!task || !agent) return;

        const updates: Partial<Task> = {
          activity: [
            ...(task.activity ?? []),
            activityEntry(agent.name, `started working on this task (run ${run.id}).`),
          ],
        };
        const inProgress = columnsRef.current.find(
          (c) => c.id === COLUMN_STATUS.IN_PROGRESS && !c.isCompleted,
        );
        if (inProgress && task.status !== inProgress.id) {
          updates.status = inProgress.id;
        }
        handleUpdateTask(taskId, updates, { actor: "system", actorLabel: `agent:${agent.name}` });
      },
      onRunFinished: (taskId, run) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        const agent = agentService.getAgentById(run.agentId);
        if (!task || !agent) return;

        const succeeded = run.status === "completed";
        const gateNote = run.verification
          ? run.verification.passed
            ? " DevCouncil gate: passed."
            : ` DevCouncil gate: ${run.verification.blockingGaps.length} blocking gap(s).`
          : "";

        const details = succeeded
          ? `finished the task.${gateNote} ${run.summary ? `Summary: ${run.summary.slice(0, 1500)}` : ""}`
          : run.status === "cancelled"
            ? "run was cancelled."
            : `run failed: ${run.error ?? "unknown error"}.${gateNote}`;

        const updates: Partial<Task> = {
          activity: [...(task.activity ?? []), activityEntry(agent.name, details.trim())],
        };

        if (succeeded) {
          const completedCol =
            columnsRef.current.find((c) => c.id === COLUMN_STATUS.COMPLETED) ??
            columnsRef.current.find(
              (c) => !c.isCompleted && c.title.toLowerCase() === "completed",
            );
          if (completedCol) updates.status = completedCol.id;
        }

        if (!succeeded && run.status === "failed") {
          updates.errorLogs = [
            ...(task.errorLogs ?? []),
            { timestamp: new Date(), message: run.error ?? "Agent run failed" },
          ];
          // A crashed/timed-out/stalled run is owned by onRunAborted (it returns
          // the card to the board or retries), so skip the dead-letter for those
          // — otherwise the Inbox shows a contradictory "retry" card for a task
          // we're already recovering. Normal failures still dead-letter.
          if (!run.failureKind) {
            deadLetterService.record({
              kind: "run",
              taskId,
              runId: run.id,
              title: `Agent run failed: ${task.title.slice(0, 80)}`,
              detail: run.error ?? "Agent run failed with no error detail.",
              payload: { taskId, agentId: agent.id, agentName: agent.name },
            });
          }
        }
        handleUpdateTask(taskId, updates, { actor: "system", actorLabel: `agent:${agent.name}` });

        // Auto-repair: create linked subtasks from DevCouncil blocking gaps.
        const gaps = run.verification?.blockingGaps ?? [];
        if (
          !succeeded &&
          gaps.length > 0 &&
          agent.workingDir &&
          handleCreateTask &&
          !repairedRunsRef.current.has(run.id)
        ) {
          repairedRunsRef.current.add(run.id);
          void (async () => {
            try {
              const repair = await agentPlannerService.repairFromGaps(agent.workingDir, gaps);
              if (repair.tasks.length === 0) return;

              const { tasks: repairTasks } = agentPlannerService.materializeSubtasks({
                parentTask: task,
                subtasks: repair.tasks,
                agents: agentService.getAgents(),
                columns: columnsRef.current,
                linkType: "blocks",
                tagPrefix: `repair:${run.id}`,
              });

              for (const repairTask of repairTasks) {
                handleCreateTask(repairTask);
              }

              handleUpdateTask(taskId, {
                activity: [
                  ...(task.activity ?? []),
                  activityEntry(
                    agent.name,
                    `created ${repairTasks.length} repair task(s) from ${gaps.length} blocking gap(s).`,
                  ),
                ],
              });

              addToast(
                `Created ${repairTasks.length} repair task(s) from DevCouncil gaps.`,
                repair.success ? "success" : "info",
              );

              // Auto-start repair tasks when assigned agents have auto-pickup.
              for (const repairTask of repairTasks) {
                const worker = agentService.getAgentByAssignee(repairTask.assignee);
                if (worker?.autoPickup) {
                  pickedUpRef.current.set(repairTask.id, repairTask.assignee);
                  void agentRunService.assign(repairTask, worker).catch((err) => {
                    addToast(
                      err instanceof Error ? err.message : "Could not start repair run.",
                      "error",
                    );
                  });
                }
              }
            } catch (err) {
              console.warn("DevCouncil repair failed:", err);
              addToast(
                err instanceof Error ? err.message : "Could not create repair tasks.",
                "warning",
              );
            }
          })();
        }

        // Aborted/crashed runs get their own message + recovery from
        // onRunAborted; don't double-toast/notify here.
        if (succeeded || !run.failureKind) {
          addToast(
            succeeded
              ? `${agent.name} finished "${task.title}" — review & commit from the board${gateNote}`
              : `${agent.name}: run ${run.status} on "${task.title}"`,
            succeeded ? "success" : run.status === "cancelled" ? "info" : "error",
          );

          if (succeeded) {
            notificationService.show({
              title: "Agent run complete",
              body: `${agent.name} finished work on a task — review the diff and commit it.`,
            });
          } else if (run.status === "failed") {
            notificationService.show({
              title: "Agent run failed",
              body: `${agent.name} run failed.${gateNote}`,
            });
          }
        }
      },
      onRunAborted: (taskId, run, reason) => {
        const task = tasksRef.current.find((t) => t.id === taskId);
        const agent = agentService.getAgentById(run.agentId);
        if (!task || !agent) return;

        const reasonLabel =
          reason === "crashed" ? "crashed" : reason === "timeout" ? "timed out" : "stalled";

        // Opt-in single auto-retry (with a short backoff) before giving up.
        const attempts = autoRetryCountRef.current.get(taskId) ?? 0;
        if (agent.autoRetryOnCrash && attempts < 1) {
          autoRetryCountRef.current.set(taskId, attempts + 1);
          handleUpdateTask(
            taskId,
            {
              activity: [
                ...(task.activity ?? []),
                activityEntry(agent.name, `run ${reasonLabel}; auto-retrying once.`),
              ],
            },
            { actor: "system", actorLabel: `agent:${agent.name}` },
          );
          addToast(`${agent.name} ${reasonLabel} — retrying "${task.title}"…`, "warning");
          setTimeout(() => {
            const latest = tasksRef.current.find((t) => t.id === taskId) ?? task;
            void agentRunService.assign(latest, agent).catch(() => {});
          }, 4000);
          return;
        }

        // Auto-recover (default on): return the dead run's task to the board so
        // the card isn't stuck "in progress" with no live run behind it.
        if (agent.autoRecover === false) return;
        const backlogId = getBacklogColumnId(columnsRef.current);
        if (task.status !== backlogId && task.status !== COLUMN_STATUS.COMMIT) {
          handleUpdateTask(
            taskId,
            {
              status: backlogId,
              activity: [
                ...(task.activity ?? []),
                activityEntry(agent.name, `run ${reasonLabel}; returned the task to the board.`),
              ],
            },
            { actor: "system", actorLabel: `agent:${agent.name}` },
          );
        }
        addToast(`${agent.name} ${reasonLabel} — "${task.title}" returned to the board.`, "warning");
      },
    });
  }, [handleUpdateTask, addToast, handleCreateTask]);

  // -- plan gate ----------------------------------------------------------------
  // Mirror the planner service's pending-plan store into state so the Inbox can
  // render "plan awaiting approval" cards for plans awaiting a decision.
  useEffect(() => agentPlannerService.subscribePendingPlans(setPendingPlans), []);

  // -- permission alerts --------------------------------------------------------
  // A run blocks silently while a permission prompt is pending; make sure the
  // user hears about it even when the runs dock is collapsed.
  const seenPermissionIdsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!isLoaded || !isTauri()) return;
    return agentMcpService.subscribePermissions((requests) => {
      for (const req of requests) {
        if (seenPermissionIdsRef.current.has(req.requestId)) continue;
        seenPermissionIdsRef.current.add(req.requestId);
        const task = tasksRef.current.find((t) => t.id === req.taskId);
        const label = task ? `"${task.title}"` : "a task";
        addToast(
          `Agent needs permission (${req.toolName}) on ${label} — approve in the runs dock.`,
          "warning",
        );
        notificationService.show({
          title: "Agent waiting for permission",
          body: `Approve or deny ${req.toolName} to let the run continue.`,
        });
      }
    });
  }, [isLoaded, addToast]);

  // -- auto-pickup ------------------------------------------------------------
  // Only tasks sitting in the backlog ("Task") column are auto-picked. Cards in
  // Completed/Commit must never re-trigger runs (previously any non-completed
  // column qualified, which re-ran finished work after an app restart).

  useEffect(() => {
    if (!isLoaded || !isTauri()) return;
    const backlogId = getBacklogColumnId(columns);
    for (const task of tasks) {
      const agent = agentService.getAgentByAssignee(task.assignee);
      if (!agent || !agent.autoPickup) continue;

      if (task.status !== backlogId) continue;

      if (pickedUpRef.current.get(task.id) === task.assignee) continue;
      if (agentRunService.getActiveRunForTask(task.id)) continue;

      pickedUpRef.current.set(task.id, task.assignee);
      void agentRunService.assign(task, agent).catch((err) => {
        addToast(err instanceof Error ? err.message : "Could not start agent run.", "error");
      });
    }
    for (const [taskId, assignee] of pickedUpRef.current) {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || task.assignee !== assignee) pickedUpRef.current.delete(taskId);
    }
  }, [isLoaded, tasks, columns, addToast]);

  // -- manual controls --------------------------------------------------------

  const startAgentRun = useCallback(
    async (task: Task) => {
      const agent = agentService.getAgentByAssignee(task.assignee);
      if (!agent) {
        addToast("This task is not assigned to an agent.", "warning");
        return;
      }
      pickedUpRef.current.set(task.id, task.assignee);
      try {
        const run = await agentRunService.assign(task, agent);
        if (run?.status === "queued") {
          const pos = agentRunService.getQueuePosition(task.id);
          addToast(
            `${agent.name} is busy — task queued${pos ? ` (#${pos} in line)` : ""}.`,
            "info",
          );
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not start agent run.", "error");
      }
    },
    [addToast],
  );

  const cancelAgentRun = useCallback(async (runId: string) => {
    await agentRunService.cancel(runId);
  }, []);

  /**
   * Stop a run and return its task to the board. Works whether the run is still
   * active (cancel first) or already terminal — e.g. a failed run that left the
   * card stuck "In Progress". This is the per-run Stop / "clear running task".
   */
  const stopAgentRun = useCallback(
    async (runId: string) => {
      const run = agentRunService.getRuns().find((r) => r.id === runId);
      if (!run) {
        addToast("That run no longer exists.", "warning");
        return;
      }
      const wasActive =
        run.status === "running" || run.status === "queued" || run.status === "verifying";
      if (wasActive) {
        try {
          await agentRunService.cancel(runId);
        } catch (err) {
          // Leave the card where it is: the run may still be executing, so
          // returning the task to the board here would be a lie.
          addToast(err instanceof Error ? err.message : "Failed to stop the run.", "error");
          return;
        }
      }
      const task = tasksRef.current.find((t) => t.id === run.taskId);
      const backlogId = getBacklogColumnId(columnsRef.current);
      const moved =
        !!task && task.status !== backlogId && task.status !== COLUMN_STATUS.COMMIT;
      if (task && moved) {
        handleUpdateTask(
          task.id,
          {
            status: backlogId,
            activity: [
              ...(task.activity ?? []),
              activityEntry(
                "user",
                wasActive
                  ? "stopped the agent run and returned the task to the board."
                  : "cleared the task back to the board.",
              ),
            ],
          },
          { actor: "user" },
        );
      }
      if (wasActive) {
        addToast(moved ? "Run stopped — task returned to the board." : "Run stopped.", "info");
      } else if (moved) {
        addToast("Task returned to the board.", "info");
      } else {
        addToast("Nothing to clear — the task is already on the board.", "warning");
      }
    },
    [addToast, handleUpdateTask],
  );

  /** Bulk-clear terminal runs from the dock + inbox (worktree-pending runs stay). */
  const clearFinishedRuns = useCallback(() => {
    const cleared = agentRunService.clearFinishedRuns();
    addToast(
      cleared > 0
        ? `Cleared ${cleared} finished run${cleared === 1 ? "" : "s"}.`
        : "No finished runs to clear.",
      cleared > 0 ? "info" : "warning",
    );
  }, [addToast]);

  /**
   * Dismiss a single finished/failed run card. Worktree-pending runs are kept
   * (Merge/Discard first) — the service refuses those and we surface why.
   */
  const dismissRun = useCallback(
    (runId: string) => {
      const removed = agentRunService.removeRun(runId);
      if (!removed) {
        addToast("Resolve this run's worktree (Merge or Discard) before dismissing it.", "warning");
      }
    },
    [addToast],
  );

  /**
   * Restore runs removed by a bulk clear — the "Undo" affordance. The surface
   * hands back the exact snapshot it cleared; the service ignores any that are
   * already present so undo is idempotent.
   */
  const restoreRuns = useCallback(
    (snapshot: AgentRun[]) => {
      const restored = agentRunService.restoreRuns(snapshot);
      if (restored > 0) {
        addToast(`Restored ${restored} run${restored === 1 ? "" : "s"}.`, "info");
      }
    },
    [addToast],
  );

  /**
   * Re-run a failed/cancelled run: start a fresh run for the same task, then
   * drop the old terminal card once the new run is under way so it visually
   * replaces the failure instead of stacking beside it.
   */
  const retryAgentRun = useCallback(
    async (runId: string) => {
      const run = agentRunService.getRuns().find((r) => r.id === runId);
      if (!run) {
        addToast("That run no longer exists.", "warning");
        return;
      }
      const task = tasksRef.current.find((t) => t.id === run.taskId);
      if (!task) {
        addToast("The task for this run no longer exists.", "warning");
        return;
      }
      await startAgentRun(task);
      const started = agentRunService
        .getRunsForTask(task.id)
        .some(
          (r) =>
            r.id !== runId &&
            (r.status === "queued" || r.status === "running" || r.status === "verifying"),
        );
      if (started) agentRunService.removeRun(runId);
    },
    [addToast, startAgentRun],
  );

  /** Bulk-dismiss every open dead-letter / failed-action item in the Inbox. */
  const clearDeadLetters = useCallback(() => {
    const cleared = deadLetterService.discardAll();
    addToast(
      cleared > 0
        ? `Cleared ${cleared} inbox item${cleared === 1 ? "" : "s"}.`
        : "Inbox already clear.",
      cleared > 0 ? "info" : "warning",
    );
  }, [addToast]);

  const assignTaskToAgent = useCallback(
    async (task: Task, agentId: string, options?: { silent?: boolean; via?: string }) => {
      const silent = options?.silent ?? false;
      const agent = agentService.getAgentById(agentId);
      if (!agent) {
        addToast("Agent profile no longer exists.", "warning");
        return;
      }

      // Planner agent: decompose epic via DevCouncil `dev plan`, not a coding run.
      if ((agent.role ?? "default") === "planner") {
        if (!handleCreateTask) {
          addToast("Cannot create subtasks — board handler unavailable.", "error");
          return;
        }
        addToast(`${agent.name} is planning "${task.title}"…`, "info");
        try {
          const { result, goal } = await agentPlannerService.planEpic(task, agent);
          if (!result.success || result.tasks.length === 0) {
            addToast(
              result.error ?? "DevCouncil plan produced no tasks.",
              result.cliAvailable ? "error" : "warning",
            );
            handleUpdateTask(task.id, {
              activity: [
                ...(task.activity ?? []),
                activityEntry(
                  agent.name,
                  `planning failed: ${result.error ?? "no tasks exported"}.`,
                ),
              ],
            });
            return;
          }

          // Plan gate (Rework Plan §3.4 item 1): park the typed plan in the
          // pending store instead of materializing straight away — the Inbox
          // renders it as an approval card, and only `approvePlan` creates the
          // subtasks and spawns scope-bound runs.
          agentPlannerService.registerPendingPlan({
            epicId: task.id,
            epicTitle: task.title,
            agentId: agent.id,
            agentName: agent.name,
            goal,
            subtasks: result.tasks,
            requirementsCount: result.requirementsCount,
          });

          handleUpdateTask(task.id, {
            assignee: agent.name,
            activity: [
              ...(task.activity ?? []),
              activityEntry(
                agent.name,
                `proposed ${result.tasks.length} subtask(s) via dev plan (${result.requirementsCount} requirement(s)) — awaiting approval in the Inbox. Goal: ${goal.slice(0, 200)}`,
              ),
            ],
          });

          addToast(
            `${agent.name} proposed ${result.tasks.length} subtask(s) — review the plan in the Inbox.`,
            "info",
          );
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Planner failed.", "error");
        }
        return;
      }

      const assigned: Task = { ...task, assignee: agent.name };
      if (task.assignee !== agent.name) {
        handleUpdateTask(task.id, {
          assignee: agent.name,
          activity: [
            ...(task.activity ?? []),
            activityEntry(
              "user",
              `handed this task off to ${agent.name}${options?.via ? ` (${options.via})` : ""}.`,
            ),
          ],
        });
      }
      pickedUpRef.current.set(task.id, agent.name);
      try {
        const run = await agentRunService.assign(assigned, agent);
        if (run?.status === "queued" && !silent) {
          const pos = agentRunService.getQueuePosition(task.id);
          addToast(
            `${agent.name} is busy — "${task.title}" queued${pos ? ` (#${pos} in line)` : ""}.`,
            "info",
          );
        } else if (run && !silent) {
          addToast(`${agent.name} picked up "${task.title}".`, "success");
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not start agent run.", "error");
      }
    },
    [addToast, handleUpdateTask, handleCreateTask],
  );

  // One-call dispatch from anywhere (context menu, keyboard, bulk bar):
  // register the board-wired assign + toast handlers on the dispatch singleton.
  useEffect(() => {
    agentDispatchService.registerHandlers({
      assign: assignTaskToAgent,
      notify: addToast,
    });
  }, [assignTaskToAgent, addToast]);

  const openRunInTerminal = useCallback(
    async (run: AgentRun) => {
      const agent = agentService.getAgentById(run.agentId);
      if (!agent) {
        addToast("Agent profile no longer exists.", "warning");
        return;
      }
      try {
        await agentRunService.openInTerminal(run, agent);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not open Terminal.", "error");
      }
    },
    [addToast],
  );

  const followUpRun = useCallback(
    async (runId: string, message: string) => {
      try {
        await agentRunService.followUp(runId, message);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Follow-up failed.", "error");
      }
    },
    [addToast],
  );

  const pauseAgentRun = useCallback(
    async (runId: string) => {
      try {
        await agentRunService.pause(runId);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not pause run.", "error");
      }
    },
    [addToast],
  );

  const resumeAgentRun = useCallback(
    async (runId: string) => {
      try {
        await agentRunService.resume(runId);
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not resume run.", "error");
      }
    },
    [addToast],
  );

  const injectGuidance = useCallback(
    async (runId: string, message: string) => {
      try {
        await agentRunService.injectGuidance(runId, message);
        addToast("Guidance queued for agent.", "info");
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not inject guidance.", "error");
      }
    },
    [addToast],
  );

  /**
   * Plan-gate approval: materialize the DevCouncil plan into linked board
   * tasks (materializeSubtasks also registers each subtask's PlannedFile
   * scope) and hand them to their assigned workers — the same apply path the
   * planner branch ran inline before the Inbox gate deferred it.
   */
  const approvePlan = useCallback(
    (plan: PendingPlan) => {
      if (!handleCreateTask) {
        addToast("Cannot create subtasks — board handler unavailable.", "error");
        return;
      }
      const epic = tasksRef.current.find((t) => t.id === plan.epicId);
      if (!epic) {
        agentPlannerService.rejectPendingPlan(plan.id, "Epic task no longer exists.");
        addToast("The plan's epic no longer exists — plan discarded.", "warning");
        return;
      }
      // Resolve the store entry first so a double-click (or a stale card in a
      // second window) can't materialize the same plan twice.
      const approved = agentPlannerService.approvePendingPlan(plan.id);
      if (!approved) return;

      const { tasks: plannedTasks, assignments } = agentPlannerService.materializeSubtasks({
        parentTask: epic,
        subtasks: plan.subtasks,
        agents: agentService.getAgents(),
        columns: columnsRef.current,
        tagPrefix: `plan:${epic.id}`,
      });

      for (const planned of plannedTasks) {
        handleCreateTask(planned);
      }

      handleUpdateTask(epic.id, {
        activity: [
          ...(epic.activity ?? []),
          activityEntry(
            "user",
            `approved ${plan.agentName}'s plan — created ${plannedTasks.length} subtask(s).`,
          ),
        ],
      });
      addToast(`Plan approved — created ${plannedTasks.length} subtask(s).`, "success");

      for (const { taskId: childId, agentName } of assignments) {
        const child = plannedTasks.find((t) => t.id === childId);
        const worker = agentService.getAgentByAssignee(agentName);
        if (child && worker) {
          pickedUpRef.current.set(childId, agentName);
          void agentRunService.assign(child, worker).catch((err) => {
            addToast(
              err instanceof Error ? err.message : `Could not start ${agentName}'s run.`,
              "error",
            );
          });
        }
      }
    },
    [addToast, handleCreateTask, handleUpdateTask],
  );

  /** Plan-gate rejection: discard the plan, keeping the feedback on record. */
  const rejectPlan = useCallback(
    (plan: PendingPlan, feedback: string) => {
      if (!feedback.trim()) {
        addToast("Add feedback for the planner before rejecting.", "warning");
        return;
      }
      agentPlannerService.rejectPendingPlan(plan.id, feedback);
      const epic = tasksRef.current.find((t) => t.id === plan.epicId);
      if (epic) {
        handleUpdateTask(epic.id, {
          activity: [
            ...(epic.activity ?? []),
            activityEntry("user", `rejected ${plan.agentName}'s plan: ${feedback.slice(0, 500)}`),
          ],
        });
      }
      addToast("Plan rejected.", "info");
    },
    [addToast, handleUpdateTask],
  );

  /**
   * Verify-verdict repair loop (Rework Plan §3.4 item 3): resume a gate-blocked
   * run with the formatted blocking gaps as reviewer feedback.
   */
  const sendRepairRun = useCallback(
    async (run: AgentRun, feedback: string) => {
      try {
        await agentRunService.rejectWithFeedback(run.id, feedback);
        addToast(
          `${agentService.getAgentById(run.agentId)?.name ?? "Agent"} re-running to close the gaps.`,
          "info",
        );
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not start repair run.", "error");
      }
    },
    [addToast],
  );

  /** Resolve the terminal Commit column (falls back to any completed column). */
  const findCommitColumn = useCallback(() => {
    return (
      columnsRef.current.find((c) => c.id === COLUMN_STATUS.COMMIT) ??
      columnsRef.current.find((c) => c.isCompleted)
    );
  }, []);

  /**
   * Commit stage: approving agent work commits any uncommitted worktree
   * changes, merges the run branch back into the repo, removes the worktree,
   * and lands the card in the Commit column. If the merge conflicts, the card
   * stays in Completed with the error on record so the user can resolve it.
   */
  const approveAgentWork = useCallback(
    async (task: Task, run: AgentRun) => {
      const actualMinutes = runDurationMinutes(run);
      recordRunOutcome(run, { outcome: "approved" });

      let commitNote = "approved agent work.";
      if (run.worktreePath && run.gitBranch) {
        try {
          const message = await agentRunService.mergeWorktree(run);
          commitNote = `approved agent work — ${message ?? `merged ${run.gitBranch}`}.`;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          handleUpdateTask(task.id, {
            activity: [
              ...(task.activity ?? []),
              activityEntry(
                "user",
                `commit failed: ${reason.slice(0, 400)} — card stays in Completed until resolved.`,
              ),
            ],
          });
          addToast(`Commit failed: ${reason}`, "error");
          return;
        }
      }

      const commitCol = findCommitColumn();
      const updates: Partial<Task> = {
        status: commitCol?.id ?? COLUMN_STATUS.COMMIT,
        completedAt: new Date(),
        activity: [...(task.activity ?? []), activityEntry("user", commitNote)],
      };
      if (actualMinutes != null) {
        updates.timeSpent = actualMinutes;
        if (actualMinutes > 0) {
          updates.activity = [
            ...(updates.activity ?? []),
            activityEntry("user", `recorded ${actualMinutes}m actual duration from agent run.`),
          ];
        }
      }
      handleUpdateTask(task.id, updates, { actor: "user", viaMergePipeline: true });
      addToast(
        run.gitBranch
          ? `Committed "${task.title}" — ${run.gitBranch} merged.`
          : `Approved "${task.title}".`,
        "success",
      );
    },
    [handleUpdateTask, addToast, findCommitColumn],
  );

  const rejectAgentWork = useCallback(
    async (task: Task, run: AgentRun, feedback: string) => {
      if (!feedback.trim()) {
        addToast("Add feedback for the agent before rejecting.", "warning");
        return;
      }
      recordRunOutcome(run, { outcome: "rejected", feedback });
      handleUpdateTask(task.id, {
        status: COLUMN_STATUS.IN_PROGRESS,
        activity: [
          ...(task.activity ?? []),
          activityEntry("user", `requested changes: ${feedback.slice(0, 500)}`),
        ],
      });
      try {
        await agentRunService.rejectWithFeedback(run.id, feedback);
        addToast(`${agentService.getAgentById(run.agentId)?.name ?? "Agent"} re-running with feedback.`, "info");
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not resume agent.", "error");
      }
    },
    [handleUpdateTask, addToast],
  );

  /** Manual commit+merge from the runs dock — also advances the card to Commit. */
  const mergeWorktree = useCallback(
    async (run: AgentRun) => {
      try {
        await agentRunService.mergeWorktree(run);
        addToast(`Committed & merged ${run.gitBranch ?? "branch"} into repo.`, "success");
        const task = tasksRef.current.find((t) => t.id === run.taskId);
        const commitCol = findCommitColumn();
        if (task && commitCol && task.status !== commitCol.id) {
          handleUpdateTask(
            task.id,
            {
              status: commitCol.id,
              completedAt: new Date(),
              activity: [
                ...(task.activity ?? []),
                activityEntry("user", `committed & merged ${run.gitBranch ?? "agent branch"}.`),
              ],
            },
            { actor: "user", viaMergePipeline: true },
          );
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Merge failed.", "error");
      }
    },
    [addToast, findCommitColumn, handleUpdateTask],
  );

  const discardWorktree = useCallback(
    async (run: AgentRun) => {
      try {
        await agentRunService.discardWorktree(run);
        addToast(`Discarded worktree ${run.gitBranch ?? ""}.`, "info");
        const task = tasksRef.current.find((t) => t.id === run.taskId);
        if (task) {
          handleUpdateTask(task.id, {
            activity: [
              ...(task.activity ?? []),
              activityEntry("user", `discarded agent worktree ${run.gitBranch ?? ""}.`),
            ],
          });
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Discard failed.", "error");
      }
    },
    [addToast, handleUpdateTask],
  );

  return {
    agents,
    agentRuns: runs,
    pendingPlans,
    refreshAgents,
    approvePlan,
    rejectPlan,
    sendRepairRun,
    startAgentRun,
    cancelAgentRun,
    stopAgentRun,
    clearFinishedRuns,
    dismissRun,
    restoreRuns,
    retryAgentRun,
    clearDeadLetters,
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
  };
};
