/**
 * Session fork / checkpoint / rewind for Claude and Codex on-disk JSONL sessions.
 */
import type { AgentProfile, AgentRun, SessionCheckpoint, Task } from '../../../types';
import { localApi } from '../../core/api/localApi';
import { generateTaskId } from '../../utils/taskUtils';
import agentRunService from './agentRunService';
import agentService from './agentService';

export function supportsSessionFork(provider: AgentProfile['provider']): boolean {
  return provider === 'claude-code' || provider === 'codex';
}

export function runtimeForProvider(provider: AgentProfile['provider']): string {
  return provider === 'claude-code' ? 'claude' : provider;
}

function projectPathForRun(run: AgentRun): string | undefined {
  return run.worktreePath ?? run.repoDir;
}

function checkpointLabel(index: number, label?: string): string {
  const trimmed = label?.trim();
  return trimmed || `Checkpoint @ message ${index}`;
}

export async function countSessionMessages(
  runtime: string,
  sessionId: string,
  projectPath?: string,
): Promise<number> {
  const result = await localApi.sessionsMessageCount(runtime, sessionId, projectPath);
  return result?.messageIndex ?? 0;
}

export async function createCheckpoint(
  runId: string,
  label?: string,
): Promise<SessionCheckpoint | null> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run?.sessionId) throw new Error('No resumable session for this run.');
  const agent = agentService.getAgentById(run.agentId);
  if (!agent || !supportsSessionFork(agent.provider)) {
    throw new Error('Checkpoints are only supported for Claude and Codex runs.');
  }
  const runtime = runtimeForProvider(agent.provider);
  const messageIndex = await countSessionMessages(
    runtime,
    run.sessionId,
    projectPathForRun(run),
  );
  if (messageIndex <= 0) throw new Error('Session file has no messages to checkpoint.');

  const checkpoint: SessionCheckpoint = {
    id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: checkpointLabel(messageIndex, label),
    messageIndex,
    createdAt: new Date(),
  };
  agentRunService.addCheckpoint(runId, checkpoint);
  void import('./runTraceService').then(({ mirrorSessionCheckpoint }) =>
    mirrorSessionCheckpoint(runId, checkpoint.id, checkpoint.label ?? '', checkpoint.messageIndex),
  );
  return checkpoint;
}

export async function rewindToCheckpoint(
  runId: string,
  checkpointId: string,
): Promise<void> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run?.sessionId) throw new Error('No resumable session for this run.');
  const checkpoint = run.checkpoints?.find((c) => c.id === checkpointId);
  if (!checkpoint) throw new Error('Checkpoint not found.');
  const agent = agentService.getAgentById(run.agentId);
  if (!agent || !supportsSessionFork(agent.provider)) {
    throw new Error('Rewind is only supported for Claude and Codex runs.');
  }
  const runtime = runtimeForProvider(agent.provider);
  await localApi.sessionsTruncate(
    runtime,
    run.sessionId,
    checkpoint.messageIndex,
    projectPathForRun(run),
  );
  agentRunService.noteRewind(runId, checkpoint);
  await agentRunService.followUp(runId, 'Continue from the checkpoint.');
}

export async function forkSession(
  runId: string,
  options: {
    task: Task;
    onCreateTask: (task: Task) => void;
    messageIndex?: number;
  },
): Promise<AgentRun> {
  const run = agentRunService.getRuns().find((r) => r.id === runId);
  if (!run?.sessionId) throw new Error('No resumable session to fork.');
  const agent = agentService.getAgentById(run.agentId);
  if (!agent || !supportsSessionFork(agent.provider)) {
    throw new Error('Session fork is only supported for Claude and Codex runs.');
  }
  const runtime = runtimeForProvider(agent.provider);
  const forked = await localApi.sessionsFork(
    runtime,
    run.sessionId,
    projectPathForRun(run),
    options.messageIndex,
  );
  if (!forked?.newSessionId) throw new Error('Session fork failed.');

  const forkTask: Task = {
    ...options.task,
    id: generateTaskId(),
    jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
    title: `${options.task.title} (fork)`,
    summary: options.task.summary
      ? `${options.task.summary} — forked session`
      : 'Forked agent session',
    createdAt: new Date(),
    subtasks: options.task.subtasks.map((s) => ({ ...s, id: generateTaskId() })),
    attachments: [...(options.task.attachments ?? [])],
    tags: [...(options.task.tags ?? [])],
    customFieldValues: { ...(options.task.customFieldValues ?? {}) },
    activity: [
      ...(options.task.activity ?? []),
      {
        id: generateTaskId(),
        type: 'comment' as const,
        timestamp: new Date(),
        userId: 'system',
        details: `Forked from run ${run.id.slice(0, 8)}…`,
      },
    ],
  };
  options.onCreateTask(forkTask);

  const forkedRun = agentRunService.adoptExternalSession({
    task: forkTask,
    agent,
    sessionId: forked.newSessionId,
    repoDir: run.repoDir ?? projectPathForRun(run) ?? agent.workingDir,
    worktreePath: run.worktreePath,
    gitBranch: run.gitBranch,
    preview: run.summary,
    runtime,
  });
  forkedRun.forkedFromRunId = run.id;
  agentRunService.persistRun(forkedRun);
  agentRunService.logInfo(
    run.id,
    `Forked session to ${forked.newSessionId.slice(0, 8)}… (task ${forkTask.jobId})`,
  );
  return forkedRun;
}
