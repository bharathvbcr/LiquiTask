/**
 * Unified reversible run trace — journal events + session checkpoints + git commits.
 *
 * Refactor 4: one substrate for revert-to-step and fork-from-step across runtimes.
 */
import type { AgentRun, RunTrace, RunTraceStep, RunTraceStepKind, Task } from "../../../types";
import { isTauri } from "../../runtime/runtimeEnvironment";
import agentRunService from "./agentRunService";
import agentService from "./agentService";
import {
  forkSession,
  rewindToCheckpoint,
  runtimeForProvider,
  supportsSessionFork,
} from "./sessionForkService";

const WRITE_TOOLS = new Set(["Write", "Edit", "apply_patch", "MultiEdit", "NotebookEdit"]);

function stepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextIndex(run: AgentRun): number {
  const steps = run.traceSteps ?? [];
  return steps.length > 0 ? Math.max(...steps.map((s) => s.index)) + 1 : 0;
}

/** Build the ordered trace for a run from persisted steps + session checkpoints. */
export function listTrace(runId: string): RunTrace | null {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run) return null;
  const steps = [...(run.traceSteps ?? [])].sort((a, b) => a.index - b.index);
  return { runId, steps };
}

/** Append a trace step and persist on the run. */
export function recordTraceStep(
  runId: string,
  partial: Omit<RunTraceStep, "id" | "index" | "ts"> & { ts?: Date },
): RunTraceStep | null {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run) return null;
  const step: RunTraceStep = {
    id: stepId(),
    index: nextIndex(run),
    ts: partial.ts ?? new Date(),
    kind: partial.kind,
    label: partial.label,
    gitCommitSha: partial.gitCommitSha,
    sessionMessageIndex: partial.sessionMessageIndex,
    sessionCheckpointId: partial.sessionCheckpointId,
    toolName: partial.toolName,
    permissionDecision: partial.permissionDecision,
  };
  run.traceSteps = [...(run.traceSteps ?? []), step];
  agentRunService.persistRun(run);
  return step;
}

/** Cheap git commit on the run branch after a mutating tool (squashed at merge). */
export async function maybeGitCheckpoint(
  runId: string,
  label: string,
): Promise<RunTraceStep | null> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run?.worktreePath || !run.repoDir || !isTauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const msg = await invoke<string>("agent_git_commit_worktree", {
      repoDir: run.repoDir,
      worktreePath: run.worktreePath,
      message: `liquitask trace: ${label.slice(0, 120)}`,
    });
    const shaMatch = msg.match(/\(([0-9a-f]{7,40})\)/i);
    return recordTraceStep(runId, {
      kind: "git_checkpoint",
      label,
      gitCommitSha: shaMatch?.[1],
    });
  } catch {
    return recordTraceStep(runId, { kind: "git_checkpoint", label: `${label} (no commit)` });
  }
}

/** Record tool/permission events from agentd stream into the trace. */
export async function recordAgentdTraceEvent(
  runId: string,
  kind: "tool_use" | "permission_request" | "permission_resolved",
  payload: { tool?: string; input?: Record<string, unknown>; decision?: string },
): Promise<void> {
  if (kind === "tool_use") {
    const tool = payload.tool ?? "tool";
    const stepKind: RunTraceStepKind = WRITE_TOOLS.has(tool) ? "file_write" : "tool";
    recordTraceStep(runId, {
      kind: stepKind,
      label: `${tool}${payload.input?.file_path ? `: ${String(payload.input.file_path)}` : ""}`,
      toolName: tool,
    });
    if (stepKind === "file_write") {
      await maybeGitCheckpoint(runId, `${tool} ${String(payload.input?.file_path ?? "").slice(0, 80)}`);
    }
    return;
  }
  if (kind === "permission_request") {
    recordTraceStep(runId, {
      kind: "permission",
      label: `Permission: ${payload.tool ?? "unknown"}`,
      toolName: payload.tool,
    });
    return;
  }
  if (kind === "permission_resolved" && payload.decision) {
    recordTraceStep(runId, {
      kind: "permission",
      label: `Permission ${payload.decision}: ${payload.tool ?? "unknown"}`,
      toolName: payload.tool,
      permissionDecision: payload.decision as RunTraceStep["permissionDecision"],
    });
  }
}

/** Revert worktree + session to a trace step. */
export async function revertToStep(runId: string, stepId: string): Promise<void> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run) throw new Error("Run not found.");
  const step = run.traceSteps?.find((s) => s.id === stepId);
  if (!step) throw new Error("Trace step not found.");

  if (step.gitCommitSha && run.worktreePath && run.repoDir && isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke<string>("agent_git_reset_worktree_to", {
      repoDir: run.repoDir,
      worktreePath: run.worktreePath,
      commitSha: step.gitCommitSha,
    });
  }

  const agent = agentService.getAgentById(run.agentId);
  if (step.sessionCheckpointId) {
    await rewindToCheckpoint(runId, step.sessionCheckpointId);
  } else if (
    step.sessionMessageIndex != null &&
    run.sessionId &&
    agent &&
    supportsSessionFork(agent.provider)
  ) {
    const runtime = runtimeForProvider(agent.provider);
    await import("../../core/api/localApi").then(({ localApi }) =>
      localApi.sessionsTruncate(
        runtime,
        run.sessionId!,
        step.sessionMessageIndex!,
        run.worktreePath ?? run.repoDir,
      ),
    );
    agentRunService.logInfo(runId, `Rewound session to message ${step.sessionMessageIndex}.`);
    await agentRunService.followUp(runId, "Continue from the reverted trace step.");
  }

  run.traceSteps = (run.traceSteps ?? []).filter((s) => s.index <= step.index);
  agentRunService.persistRun(run);
  agentRunService.logInfo(runId, `Reverted to trace step: ${step.label}`);
}

/** Fork a new task/run from a trace step (git branch + session fork). */
export async function forkFromStep(
  runId: string,
  stepId: string,
  options: { task: Task; onCreateTask: (task: Task) => void },
): Promise<AgentRun> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run) throw new Error("Run not found.");
  const step = run.traceSteps?.find((s) => s.id === stepId);
  if (!step) throw new Error("Trace step not found.");

  const agent = agentService.getAgentById(run.agentId);
  if (!agent) throw new Error("Agent not found.");

  if (step.sessionMessageIndex != null && run.sessionId && supportsSessionFork(agent.provider)) {
    return forkSession(runId, {
      task: options.task,
      onCreateTask: options.onCreateTask,
      messageIndex: step.sessionMessageIndex,
    });
  }

  throw new Error("Fork-from-step requires a session checkpoint on Claude or Codex runs.");
}

/** Mirror a session checkpoint into the trace when created. */
export function mirrorSessionCheckpoint(runId: string, checkpointId: string, label: string, messageIndex: number): void {
  recordTraceStep(runId, {
    kind: "session",
    label,
    sessionMessageIndex: messageIndex,
    sessionCheckpointId: checkpointId,
  });
}

/** DevCouncil timeline mirror — append advisory step from verify/plan events. */
export function mirrorDevCouncilEvent(runId: string, label: string): void {
  recordTraceStep(runId, { kind: "devcouncil", label });
}

export const runTraceService = {
  listTrace,
  recordTraceStep,
  maybeGitCheckpoint,
  recordAgentdTraceEvent,
  revertToStep,
  forkFromStep,
  mirrorSessionCheckpoint,
  mirrorDevCouncilEvent,
};

export default runTraceService;
