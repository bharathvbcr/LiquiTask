import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CornerUpLeft,
  GitBranch,
  GitMerge,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Undo2,
  UsersRound,
  X,
  XCircle,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { COLUMN_STATUS } from '../../constants';
import { useCampaign } from '../../hooks/useCampaign';
import agentRunService from '../../services/agents/agentRunService';
import agentMcpService, {
  describePermissionInput,
  type AgentPermissionRequest,
} from '../../services/agents/agentMcpService';
import { StatusPill } from '../../ui';
import { AgentQuickCreate } from './AgentQuickCreate';
import { AgentTeamSection, PHASE_LABEL } from './AgentTeamPanel';
import {
  deriveRunProgress,
  formatRelativeTime,
  formatRunError,
  runStatusTone,
  type RunStatusTone,
} from '../../utils/runProgress';
import type { AgentProfile, AgentRun, BoardColumn, Task, ToastType } from '../../../types';

type DockTab = 'runs' | 'team';

/** Which grouped section a run belongs to in the redesigned dock. */
type RunGroup = 'active' | 'review' | 'done';

interface AgentRunsDockProps {
  tasks: Task[];
  columns: BoardColumn[];
  agents: AgentProfile[];
  runs: AgentRun[];
  onStart: (task: Task) => void;
  onCancel: (runId: string) => void;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onInjectGuidance?: (runId: string, message: string) => void;
  onOpenTerminal: (run: AgentRun) => void;
  onFollowUp?: (runId: string, message: string) => void;
  onApprove?: (task: Task, run: AgentRun) => void;
  onReject?: (task: Task, run: AgentRun, feedback: string) => void;
  onMergeWorktree?: (run: AgentRun) => void;
  onDiscardWorktree?: (run: AgentRun) => void;
  /** Return a stopped/failed run's task to the board (clears a stuck card). */
  onReturnToBoard?: (runId: string) => void;
  /** Bulk-clear terminal runs from the dock. */
  onClearFinished?: () => void;
  /** Dismiss a single finished/failed run card. */
  onDismissRun?: (runId: string) => void;
  /** Restore a cleared snapshot of runs (the Undo affordance). */
  onRestoreRuns?: (runs: AgentRun[]) => void;
  /** Re-run a failed/cancelled run for the same task. */
  onRetryRun?: (runId: string) => void;
  /** Team runs (merged from the old AgentTeamPanel). */
  onCreateTasks?: (tasks: Task[]) => void;
  addToast?: (message: string, type: ToastType) => void;
  ntfyTopic?: string;
  /** Controlled "Team" tab open state (e.g. from the command palette). */
  teamOpen?: boolean;
  onTeamOpenChange?: (open: boolean) => void;
  /** Called after quick-create saves an agent so the host refreshes its roster. */
  onAgentsChanged?: () => void;
  /** Active project's linked workspace folders — quick-create defaults to the first. */
  workspacePaths?: string[];
}

/** Left-edge status spine colour, keyed by the shared run tone. */
const TONE_SPINE: Record<RunStatusTone, string> = {
  amber: 'bg-amber-400/70',
  red: 'bg-red-500/80',
  emerald: 'bg-emerald-400/70',
  slate: 'bg-slate-500/50',
  blue: 'bg-blue-400/70',
  purple: 'bg-purple-400/70',
};

const EVENT_COLORS: Record<string, string> = {
  assistant: 'text-slate-200',
  tool: 'text-sky-300',
  result: 'text-emerald-300',
  stderr: 'text-red-300',
  verify: 'text-purple-300',
  system: 'text-slate-500',
  info: 'text-slate-400',
};

const UNDO_WINDOW_MS = 7000;

/** Small uppercase eyebrow that heads each run group. */
const SectionHeader: React.FC<{
  label: string;
  count?: number;
  right?: React.ReactNode;
}> = ({ label, count, right }) => (
  <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
    <span className="text-[10px] uppercase tracking-widest text-slate-500">
      {label}
      {typeof count === 'number' && count > 0 ? (
        <span className="text-slate-600"> · {count}</span>
      ) : null}
    </span>
    {right}
  </div>
);

const RunLog: React.FC<{ run: AgentRun }> = ({ run }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventCount = run.events.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new events
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [eventCount]);

  return (
    <div
      ref={scrollRef}
      className="max-h-56 overflow-y-auto custom-scrollbar rounded-lg bg-black/50 border border-white/5 p-2 font-mono text-[11px] leading-relaxed space-y-1"
    >
      {run.gitBranch && (
        <div className="text-amber-300/80 flex items-center gap-1 pb-1 border-b border-white/5">
          <GitBranch size={10} /> {run.gitBranch}
          {run.prUrl && (
            <a href={run.prUrl} className="text-sky-400 hover:underline truncate ml-1">
              PR
            </a>
          )}
        </div>
      )}
      {run.gitDiff && (
        <pre className="text-slate-500 whitespace-pre-wrap mb-1 border-b border-white/5 pb-1">
          {run.gitDiff.slice(0, 1200)}
        </pre>
      )}
      {run.events.map((event, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only and never reordered, so index is a stable identity
        <div key={`${run.id}-${index}`} className={EVENT_COLORS[event.kind] ?? 'text-slate-400'}>
          <span className="text-slate-600 mr-1.5">
            {event.ts.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
          {event.kind === 'tool' ? '▸ ' : ''}
          {event.text}
        </div>
      ))}
      {run.events.length === 0 && <div className="text-slate-600">Waiting for output…</div>}
      {run.verification && !run.verification.passed && (
        <div className="text-amber-300 border-t border-white/5 pt-1 mt-1">
          Blocking gaps: {run.verification.blockingGaps.join(' · ')}
        </div>
      )}
    </div>
  );
};

const FollowUpInput: React.FC<{
  run: AgentRun;
  onFollowUp?: (runId: string, message: string) => void;
}> = ({ run, onFollowUp }) => {
  const [text, setText] = useState('');
  if (!run.sessionId || !onFollowUp) return null;
  const isActive = run.status === 'running' || run.status === 'verifying';
  if (isActive) return null;

  return (
    <div className="flex gap-1.5 pt-1">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Follow-up message…"
        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
        onKeyDown={e => {
          if (e.key === 'Enter' && text.trim()) {
            onFollowUp(run.id, text.trim());
            setText('');
          }
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (!text.trim()) return;
          onFollowUp(run.id, text.trim());
          setText('');
        }}
        className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 disabled:opacity-40"
        aria-label="Send follow-up"
      >
        <Send size={11} />
      </button>
    </div>
  );
};

const GuidanceInput: React.FC<{
  run: AgentRun;
  onInjectGuidance?: (runId: string, message: string) => void;
}> = ({ run, onInjectGuidance }) => {
  const [text, setText] = useState('');
  if (!onInjectGuidance) return null;
  const isActive = run.status === 'running' || run.status === 'verifying';
  if (!isActive) return null;

  return (
    <div className="flex gap-1.5 pt-1 border-t border-white/5">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Inject guidance mid-run…"
        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
        onKeyDown={e => {
          if (e.key === 'Enter' && text.trim()) {
            onInjectGuidance(run.id, text.trim());
            setText('');
          }
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (!text.trim()) return;
          onInjectGuidance(run.id, text.trim());
          setText('');
        }}
        className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 disabled:opacity-40"
        aria-label="Inject guidance"
        title="Queue guidance for the agent (fetched via MCP get_user_guidance)"
      >
        <Send size={11} />
      </button>
    </div>
  );
};

const PermissionPromptPanel: React.FC<{
  runId: string;
  requests: AgentPermissionRequest[];
}> = ({ runId, requests }) => {
  const runRequests = requests.filter(r => r.runId === runId);
  if (runRequests.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-amber-500/20 pt-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400/90">
        <ShieldAlert size={11} />
        Permission required ({runRequests.length})
      </div>
      {runRequests.map(req => {
        const { summary, detail } = describePermissionInput(req.toolName, req.input);
        return (
          <div
            key={req.requestId}
            className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-amber-200">{req.toolName}</span>
              <span className="text-[10px] text-slate-500 shrink-0">
                {req.receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 break-words">{summary}</p>
            {detail !== summary && (
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all max-h-24 overflow-y-auto custom-scrollbar">
                {detail}
              </pre>
            )}
            <div className="flex gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={() => agentMcpService.respondToPermission(req.requestId, true)}
                className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium"
              >
                Allow
              </button>
              <button
                type="button"
                onClick={() => agentMcpService.respondToPermission(req.requestId, false)}
                className="flex-1 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium"
              >
                Deny
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Floating dock (Multica-style board presence) — the single home for agents.
 * Runs are grouped into Active (in flight), Needs review (a decision is
 * waiting — approve/reject or merge/discard), and Done (finished, failed or
 * cancelled). Every card carries a status spine, a per-card dismiss, and —
 * for failures — a one-click Retry; a bulk "Clear all" on Done is undoable.
 */
export const AgentRunsDock: React.FC<AgentRunsDockProps> = ({
  tasks,
  columns,
  agents,
  runs,
  onStart,
  onCancel,
  onPause,
  onResume,
  onInjectGuidance,
  onOpenTerminal,
  onFollowUp,
  onApprove,
  onReject,
  onMergeWorktree,
  onDiscardWorktree,
  onReturnToBoard,
  onClearFinished,
  onDismissRun,
  onRestoreRuns,
  onRetryRun,
  onCreateTasks,
  addToast,
  ntfyTopic,
  teamOpen,
  onTeamOpenChange,
  onAgentsChanged,
  workspacePaths,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const [tab, setTab] = useState<DockTab>('runs');
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState<Record<string, string>>({});
  const [pendingPermissions, setPendingPermissions] = useState<AgentPermissionRequest[]>([]);
  const [doneCollapsed, setDoneCollapsed] = useState(true);
  const [undo, setUndo] = useState<{ runs: AgentRun[] } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return agentMcpService.subscribePermissions(setPendingPermissions);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Team runs (campaigns) live here now — one hook instance owns the wiring.
  const {
    state: teamState,
    isRunning: teamRunning,
    startCampaign,
    cancelCampaign,
  } = useCampaign({ tasks, columns, agents, onCreateTasks, addToast, ntfyTopic });

  // Command palette (or any host) can open/close the Team tab.
  useEffect(() => {
    if (teamOpen === undefined) return;
    if (teamOpen) {
      setCollapsed(false);
      setTab('team');
    } else {
      setCollapsed(true);
    }
  }, [teamOpen]);

  const switchTab = (next: DockTab) => {
    setTab(next);
    onTeamOpenChange?.(next === 'team');
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next && tab === 'team') onTeamOpenChange?.(false);
  };

  const agentByName = useMemo(() => {
    const map = new Map<string, AgentProfile>();
    for (const agent of agents) map.set(agent.name.trim().toLowerCase(), agent);
    return map;
  }, [agents]);

  const agentById = useMemo(() => {
    const map = new Map<string, AgentProfile>();
    for (const agent of agents) map.set(agent.id, agent);
    return map;
  }, [agents]);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  // Bucket every run into exactly one group. "Needs review" is anything with a
  // human decision pending (approve/reject a finished run, or merge/discard a
  // worktree); everything else terminal is "Done".
  const { active, review, done } = useMemo(() => {
    const activeRuns: AgentRun[] = [];
    const reviewRuns: AgentRun[] = [];
    const doneRuns: AgentRun[] = [];
    for (const run of runs) {
      if (run.status === 'running' || run.status === 'verifying' || run.status === 'queued') {
        activeRuns.push(run);
        continue;
      }
      const task = taskById.get(run.taskId);
      const awaitingReview =
        run.status === 'completed' &&
        !run.reviewOutcome &&
        task?.status === COLUMN_STATUS.COMPLETED &&
        !!onApprove &&
        !!onReject;
      const needsWorktree =
        !!run.worktreePath && !!run.gitBranch && (!!onMergeWorktree || !!onDiscardWorktree);
      if (awaitingReview || needsWorktree) reviewRuns.push(run);
      else doneRuns.push(run);
    }
    return { active: activeRuns, review: reviewRuns, done: doneRuns };
  }, [runs, taskById, onApprove, onReject, onMergeWorktree, onDiscardWorktree]);

  const failedCount = useMemo(() => done.filter(r => r.status === 'failed').length, [done]);

  const idleAssigned = useMemo(() => {
    const activeTaskIds = new Set(active.map(r => r.taskId));
    return tasks.filter(task => {
      const agent = agentByName.get((task.assignee ?? '').trim().toLowerCase());
      if (!agent || activeTaskIds.has(task.id)) return false;
      const column = columns.find(c => c.id === task.status);
      return !column?.isCompleted;
    });
  }, [tasks, columns, agentByName, active]);

  // Auto-expand when runs go live or a permission prompt needs an answer.
  const activeCount = active.length;
  const prevActiveCountRef = useRef(0);
  useEffect(() => {
    if (activeCount > prevActiveCountRef.current) setCollapsed(false);
    prevActiveCountRef.current = activeCount;
  }, [activeCount]);
  useEffect(() => {
    if (pendingPermissions.length > 0) setCollapsed(false);
  }, [pendingPermissions.length]);

  const hasRunsContent =
    active.length > 0 || review.length > 0 || done.length > 0 || idleAssigned.length > 0;
  const needsAttention = pendingPermissions.length > 0 || review.length > 0 || failedCount > 0;

  const clearUndo = () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndo(null);
  };

  // "Clear all" on the Done section — scoped to Done only (Active / Needs review
  // are untouched) and reversible for a few seconds via the Undo bar.
  const handleClearDone = () => {
    const snapshot = done.filter(r => !r.worktreePath);
    if (snapshot.length === 0) return;
    if (onDismissRun) {
      for (const r of snapshot) onDismissRun(r.id);
    } else {
      onClearFinished?.();
    }
    if (onRestoreRuns) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndo({ runs: snapshot });
      undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    }
  };

  const handleUndo = () => {
    if (undo) onRestoreRuns?.(undo.runs);
    clearUndo();
  };

  const renderRunCard = (run: AgentRun, group: RunGroup) => {
    const task = taskById.get(run.taskId);
    const agent = agentById.get(run.agentId);
    const isExpanded = expandedRunId === run.id;
    const lastEvent = run.events[run.events.length - 1];
    const isActive =
      run.status === 'running' || run.status === 'verifying' || run.status === 'queued';
    const tone = runStatusTone(run);
    const inReview = task?.status === COLUMN_STATUS.COMPLETED;
    const showReview =
      !isActive && inReview && run.status === 'completed' && task && onApprove && onReject;
    const showWorktreeActions =
      !isActive && run.worktreePath && run.gitBranch && (onMergeWorktree || onDiscardWorktree);
    const hasPendingPermissions = pendingPermissions.some(p => p.runId === run.id);
    const subtasks = task?.subtasks ?? [];
    const progress = deriveRunProgress(run, {
      subtasksTotal: subtasks.length,
      subtasksDone: subtasks.filter(s => s.completed).length,
    });
    const errorLine = formatRunError(run);
    const isFailed = run.status === 'failed';
    const isCancelled = run.status === 'cancelled';
    // Dismiss is offered on Done cards without a pending worktree (the service
    // refuses worktree-pending removes; keeping it hidden avoids a dead button).
    const canDismiss = group === 'done' && !!onDismissRun && !run.worktreePath;
    const showRecovery = group === 'done' && (isFailed || isCancelled);
    const finishedAt = run.finishedAt ?? run.startedAt ?? run.createdAt;
    const queueLabel =
      run.status === 'queued'
        ? (() => {
            const pos = agentRunService.getQueuePosition(run.taskId);
            return pos ? `queued #${pos}` : 'queued';
          })()
        : null;

    return (
      <div
        key={run.id}
        className={`group relative overflow-hidden rounded-xl bg-white/5 border p-2.5 pl-3 space-y-2 transition-all hover:bg-white/[0.07] ${
          hasPendingPermissions
            ? 'border-amber-500/30 ring-1 ring-amber-500/10'
            : isFailed
              ? 'border-red-500/20'
              : 'border-white/5'
        }`}
      >
        {/* Status spine */}
        <span
          className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${TONE_SPINE[tone]}`}
          aria-hidden
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
            className="flex-1 min-w-0 text-left"
          >
            <div className="flex items-center gap-1.5">
              <StatusPill status={run.isPaused ? 'paused' : queueLabel ?? run.status} tone={tone} />
              {run.verification?.passed && (
                <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
              )}
              <span className="text-xs text-white truncate">{task?.title ?? run.taskId}</span>
            </div>
            {!isExpanded && (
              <p className="text-[11px] text-slate-500 truncate mt-1">
                {isActive && lastEvent
                  ? `${agent?.name ? `${agent.name}: ` : ''}${lastEvent.text}`
                  : `${agent?.name ?? 'Agent'} · ${formatRelativeTime(finishedAt)}`}
              </p>
            )}
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            {run.sessionId && (
              <button
                type="button"
                onClick={() => onOpenTerminal(run)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Continue in Terminal"
                title="Continue this session in Terminal (claude --resume)"
              >
                <Terminal size={12} />
              </button>
            )}
            {isActive &&
              run.status === 'running' &&
              onPause &&
              onResume &&
              (run.isPaused ? (
                <button
                  type="button"
                  onClick={() => onResume(run.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                  aria-label="Resume run"
                  title="Resume agent"
                >
                  <Play size={12} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onPause(run.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                  aria-label="Pause run"
                  title="Pause agent"
                >
                  <Pause size={12} />
                </button>
              ))}
            {isActive ? (
              <button
                type="button"
                onClick={() => onCancel(run.id)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                aria-label="Stop run"
                title="Stop run and return the task to the board"
              >
                <Square size={12} />
              </button>
            ) : run.status === 'completed' ? (
              <CheckCircle2 size={14} className="text-emerald-400" />
            ) : isFailed ? (
              <XCircle size={14} className="text-red-400/80" />
            ) : (
              <XCircle size={14} className="text-slate-500" />
            )}
            {canDismiss && (
              <button
                type="button"
                onClick={() => onDismissRun?.(run.id)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                aria-label="Dismiss run"
                title="Dismiss this run"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {progress.active && (
          <div className="space-y-0.5">
            <div
              className="h-1 w-full rounded-full bg-white/5 overflow-hidden"
              role="progressbar"
              aria-label={`Progress: ${progress.label}`}
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-red-500/70 transition-[width] duration-500"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              {progress.label}
              {subtasks.length > 0
                ? ` · ${subtasks.filter(s => s.completed).length}/${subtasks.length} subtasks`
                : ''}
            </p>
          </div>
        )}

        {errorLine && (
          <p className="text-[11px] text-red-300/90 bg-red-500/5 border border-red-500/15 rounded-lg px-2 py-1 break-words">
            {errorLine}
          </p>
        )}

        {isActive && <PermissionPromptPanel runId={run.id} requests={pendingPermissions} />}

        {/* Recovery actions for a failed / cancelled run. */}
        {showRecovery && (onRetryRun || onReturnToBoard) && (
          <div className="flex gap-1.5">
            {onRetryRun && (
              <button
                type="button"
                onClick={() => onRetryRun(run.id)}
                className="flex-1 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium flex items-center justify-center gap-1 hover:bg-red-500/20 transition-colors"
                title="Start a fresh run for this task"
              >
                <RefreshCw size={10} /> Retry
              </button>
            )}
            {onReturnToBoard && (
              <button
                type="button"
                onClick={() => onReturnToBoard(run.id)}
                className="flex-1 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[11px] font-medium flex items-center justify-center gap-1 hover:bg-white/10 transition-colors"
                title="Return this task to the board"
              >
                <CornerUpLeft size={10} /> Return
              </button>
            )}
          </div>
        )}

        {showReview && (
          <div className="space-y-1.5 border-t border-white/5 pt-2">
            <input
              type="text"
              value={rejectFeedback[run.id] ?? ''}
              onChange={e => setRejectFeedback(prev => ({ ...prev, [run.id]: e.target.value }))}
              placeholder="Rejection feedback (required to reject)…"
              className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onApprove?.(task, run)}
                className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium"
                title={
                  run.gitBranch
                    ? `Commit & merge ${run.gitBranch}, then move the card to Commit`
                    : 'Approve and move the card to Commit'
                }
              >
                {run.gitBranch ? 'Commit & merge' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => onReject?.(task, run, rejectFeedback[run.id] ?? '')}
                className="flex-1 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1"
              >
                <MessageSquare size={10} /> Reject
              </button>
            </div>
          </div>
        )}

        {showWorktreeActions && (
          <div className="flex gap-1.5 border-t border-white/5 pt-2">
            {onMergeWorktree && (
              <button
                type="button"
                onClick={() => onMergeWorktree(run)}
                className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium flex items-center justify-center gap-1"
              >
                <GitMerge size={10} /> Merge
              </button>
            )}
            {onDiscardWorktree && (
              <button
                type="button"
                onClick={() => onDiscardWorktree(run)}
                className="flex-1 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium flex items-center justify-center gap-1"
              >
                <Trash2 size={10} /> Discard
              </button>
            )}
          </div>
        )}

        {isActive && <GuidanceInput run={run} onInjectGuidance={onInjectGuidance} />}

        {isExpanded && (
          <>
            <RunLog run={run} />
            <FollowUpInput run={run} onFollowUp={onFollowUp} />
          </>
        )}
      </div>
    );
  };

  // Collapsed: a compact frosted pill — quiet board presence, expands on click.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className={`fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3.5 py-2 liquid-badge text-slate-300 hover:text-white transition-colors ${
          needsAttention ? 'liquid-glow-red' : ''
        }`}
        aria-label="Open agents dock"
      >
        <Bot size={14} className="text-red-400" />
        <span className="text-xs font-medium">Agents</span>
        {active.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-blue-300">
            <Loader2 size={10} className="animate-spin" />
            {active.length}
          </span>
        )}
        {review.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300">
            <ShieldCheck size={10} />
            {review.length}
          </span>
        )}
        {failedCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-red-300">
            <XCircle size={10} />
            {failedCount}
          </span>
        )}
        {pendingPermissions.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300">
            <ShieldAlert size={10} />
            {pendingPermissions.length}
          </span>
        )}
        {teamRunning && teamState && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300">
            <UsersRound size={10} />
            {PHASE_LABEL[teamState.phase]}
          </span>
        )}
        <ChevronUp size={12} className="text-slate-600" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] liquid-surface overflow-hidden">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-red-400" />
          <span className="text-sm font-medium text-white">Agents</span>
          {active.length > 0 && (
            <span className="liquid-badge flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-blue-300">
              <Loader2 size={10} className="animate-spin" />
              {active.length} active
            </span>
          )}
          {review.length > 0 && (
            <span className="liquid-badge flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-amber-300">
              <ShieldCheck size={10} />
              {review.length} to review
            </span>
          )}
          {failedCount > 0 && (
            <span className="liquid-badge flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-red-300">
              <XCircle size={10} />
              {failedCount} failed
            </span>
          )}
          {pendingPermissions.length > 0 && (
            <span className="liquid-badge flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-amber-300">
              <ShieldAlert size={10} />
              {pendingPermissions.length} pending
            </span>
          )}
          {teamRunning && teamState && (
            <span className="liquid-badge flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-amber-300">
              <UsersRound size={10} />
              team: {PHASE_LABEL[teamState.phase]}
            </span>
          )}
        </div>
        <ChevronDown size={14} className="text-slate-500" />
      </button>

      <div className="border-t border-white/5">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2">
          <button
            type="button"
            onClick={() => switchTab('runs')}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
              tab === 'runs'
                ? 'bg-red-500/10 text-red-300 border-red-500/20'
                : 'text-slate-400 border-transparent hover:text-white hover:bg-white/5'
            }`}
          >
            Runs{active.length > 0 ? ` (${active.length})` : ''}
          </button>
          <button
            type="button"
            onClick={() => switchTab('team')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
              tab === 'team'
                ? 'bg-red-500/10 text-red-300 border-red-500/20'
                : 'text-slate-400 border-transparent hover:text-white hover:bg-white/5'
            }`}
          >
            <UsersRound size={11} />
            Team Run
            {teamRunning && <Loader2 size={10} className="animate-spin text-amber-300" />}
          </button>
        </div>

        <div className="px-3 pb-3 space-y-1.5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {tab === 'team' ? (
            <AgentTeamSection
              tasks={tasks}
              agents={agents}
              state={teamState}
              isRunning={teamRunning}
              onStart={epic => void startCampaign(epic)}
              onCancel={() => cancelCampaign()}
            />
          ) : (
            <>
              {!hasRunsContent && (
                <p className="text-[11px] text-slate-500 px-1 py-2">
                  {agents.length === 0
                    ? 'No agents yet — create one below, then assign any task to it by name.'
                    : 'No runs yet — assign a task to an agent by name, or drop a card on one.'}
                </p>
              )}

              {undo && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5">
                  <span className="text-[11px] text-slate-400">
                    Cleared {undo.runs.length} finished run{undo.runs.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={handleUndo}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-red-300 hover:text-red-200 transition-colors"
                  >
                    <Undo2 size={11} /> Undo
                  </button>
                </div>
              )}

              {/* Active */}
              {active.length > 0 && (
                <>
                  <SectionHeader label="Active" count={active.length} />
                  {active.map(run => renderRunCard(run, 'active'))}
                </>
              )}

              {/* Ready to start (assigned but idle) */}
              {idleAssigned.length > 0 && (
                <>
                  <SectionHeader label="Ready to start" count={idleAssigned.length} />
                  {idleAssigned.slice(0, 5).map(task => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/5 p-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-white truncate">{task.title}</p>
                        <p className="text-[11px] text-slate-500 truncate">→ {task.assignee}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onStart(task)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-all text-[11px] font-medium shrink-0"
                      >
                        <Play size={11} /> Start
                      </button>
                    </div>
                  ))}
                </>
              )}

              {/* Needs review */}
              {review.length > 0 && (
                <>
                  <SectionHeader label="Needs review" count={review.length} />
                  {review.map(run => renderRunCard(run, 'review'))}
                </>
              )}

              {/* Done (collapsible) */}
              {done.length > 0 && (
                <>
                  <SectionHeader
                    label="Done"
                    count={done.length}
                    right={
                      <div className="flex items-center gap-2">
                        {(onDismissRun || onClearFinished) && (
                          <button
                            type="button"
                            onClick={handleClearDone}
                            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                            title="Clear finished runs (undoable)"
                          >
                            <Trash2 size={10} /> Clear all
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDoneCollapsed(v => !v)}
                          className="text-slate-500 hover:text-slate-300 transition-colors"
                          aria-label={doneCollapsed ? 'Expand done runs' : 'Collapse done runs'}
                        >
                          {doneCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                        </button>
                      </div>
                    }
                  />
                  {!doneCollapsed && done.slice(0, 8).map(run => renderRunCard(run, 'done'))}
                  {!doneCollapsed && done.length > 8 && (
                    <p className="text-[10px] text-slate-600 px-1 py-1">
                      +{done.length - 8} older run{done.length - 8 === 1 ? '' : 's'} hidden
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {/* Quick-create — always within reach, both tabs. */}
          <AgentQuickCreate
            onAgentsChanged={onAgentsChanged}
            addToast={addToast}
            defaultOpen={agents.length === 0}
            workspacePaths={workspacePaths}
          />
        </div>
      </div>
    </div>
  );
};
