import { useCallback, useEffect, useRef, useState } from "react";

import { COLUMN_STATUS } from "../constants";
import { isTauri } from "../runtime/runtimeEnvironment";
import agentMcpService from "../services/agents/agentMcpService";
import agentPlannerService from "../services/agents/agentPlannerService";
import agentRunService from "../services/agents/agentRunService";
import agentService from "../services/agents/agentService";
import notificationService from "../services/notificationService";
import type {
  ActivityItem,
  AgentProfile,
  AgentRun,
  BoardColumn,
  Task,
  ToastType,
} from "../../types";
import { generateTaskId, getBacklogColumnId } from "../utils/taskUtils";

interface UseAgentTeammatesArgs {
  isLoaded: boolean;
  tasks: Task[];
  columns: BoardColumn[];
  handleUpdateTask: (taskId: string, updates: Partial<Task>) => void;
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
 * - auto-pickup when a task is assigned to an agent with `autoPickup`
 * - card moves to In Progress when a run starts
 * - successful runs move to Review column for approval
 * - streamed results land in the task's activity trail / error logs
 * - MCP bridge updates board mid-run
 */
export const useAgentTeammates = ({
  isLoaded,
  tasks,
  columns,
  handleUpdateTask,
  handleCreateTask,
  addToast,
}: UseAgentTeammatesArgs) => {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  /** taskId -> assignee already auto-picked, to avoid re-trigger loops. */
  const pickedUpRef = useRef(new Map<string, string>());
  /** runId -> repair tasks already created from gate gaps. */
  const repairedRunsRef = useRef(new Set<string>());

  const refreshAgents = useCallback(() => {
    setAgents(agentService.getAgents());
  }, []);

  // -- MCP hooks --------------------------------------------------------------

  useEffect(() => {
    agentMcpService.setHooks({
      getTask: (taskId) => tasksRef.current.find((t) => t.id === taskId),
      getColumns: () => columnsRef.current,
      updateTask: handleUpdateTask,
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
        // (moves their cards to Review, posts activity, notifies). Runs still
        // live at reattach are excluded and finish through the normal stream.
        agentRunService.flushPendingBoardSync();
      })
      .catch((err) => {
        console.warn("Agent runtime unavailable:", err);
      });
    const unsubscribe = agentRunService.subscribe(setRuns);
    return () => {
      unsubscribe();
    };
  }, [isLoaded, refreshAgents]);

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
        handleUpdateTask(taskId, updates);
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
          const reviewCol = columnsRef.current.find((c) => c.id === COLUMN_STATUS.REVIEW);
          if (reviewCol) updates.status = reviewCol.id;
        }

        if (!succeeded && run.status === "failed") {
          updates.errorLogs = [
            ...(task.errorLogs ?? []),
            { timestamp: new Date(), message: run.error ?? "Agent run failed" },
          ];
        }
        handleUpdateTask(taskId, updates);

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
                  void agentRunService.assign(repairTask, worker);
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

        addToast(
          succeeded
            ? `${agent.name} finished "${task.title}" — ready for review${gateNote}`
            : `${agent.name}: run ${run.status} on "${task.title}"`,
          succeeded ? "success" : run.status === "cancelled" ? "info" : "error",
        );

        if (succeeded) {
          notificationService.show({
            title: "Agent run complete",
            body: `${agent.name} finished work on a task — review on the board.`,
          });
        } else if (run.status === "failed") {
          notificationService.show({
            title: "Agent run failed",
            body: `${agent.name} run failed.${gateNote}`,
          });
        }
      },
    });
  }, [handleUpdateTask, addToast, handleCreateTask]);

  // -- auto-pickup ------------------------------------------------------------

  useEffect(() => {
    if (!isLoaded || !isTauri()) return;
    for (const task of tasks) {
      const agent = agentService.getAgentByAssignee(task.assignee);
      if (!agent || !agent.autoPickup) continue;

      const column = columns.find((c) => c.id === task.status);
      if (column?.isCompleted) continue;

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
  }, [isLoaded, tasks, columns]);

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
          addToast(`${agent.name} is busy — task queued.`, "info");
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

  const assignTaskToAgent = useCallback(
    async (task: Task, agentId: string) => {
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

          const { tasks: plannedTasks, assignments } = agentPlannerService.materializeSubtasks({
            parentTask: task,
            subtasks: result.tasks,
            agents: agentService.getAgents(),
            columns: columnsRef.current,
            tagPrefix: `plan:${task.id}`,
          });

          for (const planned of plannedTasks) {
            handleCreateTask(planned);
          }

          handleUpdateTask(task.id, {
            assignee: agent.name,
            activity: [
              ...(task.activity ?? []),
              activityEntry(
                agent.name,
                `decomposed epic into ${plannedTasks.length} subtask(s) via dev plan (${result.requirementsCount} requirement(s)). Goal: ${goal.slice(0, 200)}`,
              ),
            ],
          });

          addToast(
            `${agent.name} created ${plannedTasks.length} subtask(s) from the plan.`,
            "success",
          );

          for (const { taskId: childId, agentName } of assignments) {
            const child = plannedTasks.find((t) => t.id === childId);
            const worker = agentService.getAgentByAssignee(agentName);
            if (child && worker) {
              pickedUpRef.current.set(childId, agentName);
              void agentRunService.assign(child, worker);
            }
          }
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
            activityEntry("user", `handed this task off to ${agent.name}.`),
          ],
        });
      }
      pickedUpRef.current.set(task.id, agent.name);
      try {
        const run = await agentRunService.assign(assigned, agent);
        if (run?.status === "queued") {
          addToast(`${agent.name} is busy — "${task.title}" queued.`, "info");
        } else if (run) {
          addToast(`${agent.name} picked up "${task.title}".`, "success");
        }
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Could not start agent run.", "error");
      }
    },
    [addToast, handleUpdateTask, handleCreateTask],
  );

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

  const approveAgentWork = useCallback(
    async (task: Task, run: AgentRun) => {
      const completedCol = columnsRef.current.find((c) => c.isCompleted && c.id !== COLUMN_STATUS.REVIEW);
      handleUpdateTask(task.id, {
        status: completedCol?.id ?? COLUMN_STATUS.COMPLETED,
        completedAt: new Date(),
        activity: [
          ...(task.activity ?? []),
          activityEntry("user", "approved agent work."),
        ],
      });
      if (run.gitBranch) {
        try {
          const url = await agentRunService.openPullRequest(run, task.title);
          if (url) addToast(`PR opened: ${url}`, "success");
        } catch (err) {
          addToast(err instanceof Error ? err.message : "Could not open PR.", "warning");
        }
      }
      addToast(`Approved "${task.title}".`, "success");
    },
    [handleUpdateTask, addToast],
  );

  const rejectAgentWork = useCallback(
    async (task: Task, run: AgentRun, feedback: string) => {
      if (!feedback.trim()) {
        addToast("Add feedback for the agent before rejecting.", "warning");
        return;
      }
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

  const mergeWorktree = useCallback(
    async (run: AgentRun) => {
      try {
        await agentRunService.mergeWorktree(run);
        addToast(`Merged ${run.gitBranch ?? "branch"} into repo.`, "success");
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Merge failed.", "error");
      }
    },
    [addToast],
  );

  const discardWorktree = useCallback(
    async (run: AgentRun) => {
      try {
        await agentRunService.discardWorktree(run);
        addToast(`Discarded worktree ${run.gitBranch ?? ""}.`, "info");
      } catch (err) {
        addToast(err instanceof Error ? err.message : "Discard failed.", "error");
      }
    },
    [addToast],
  );

  return {
    agents,
    agentRuns: runs,
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
  };
};
