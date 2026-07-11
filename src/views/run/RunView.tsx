import {
  AlertTriangle,
  GitBranch,
  GitMerge,
  GitFork,
  History,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Square,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { COLUMN_STATUS } from "../../constants";
import {
  describePermissionInput,
  type AgentPermissionRequest,
  type PermissionResponseDecision,
} from "../../services/agents/agentMcpService";
import { PermissionActionButtons } from "../../components/agents/PermissionActionButtons";
import { RunPtyTerminal } from "../../components/agents/RunPtyTerminal";
import agentPtyService from "../../services/agents/agentPtyService";
import { ApprovalCard, DiffView, GlassPanel, LazyDiffBrowser, RunTraceTimeline, StatusPill, StreamText, ToolTimeline } from "../../ui";
import { listTrace } from "../../services/agents/runTraceService";
import { formatRunError, runStatusTone } from "../../utils/runProgress";
import {
  deriveRunCostDisplay,
  formatCostUsd,
  formatTokenCount,
} from "../../utils/runUsage";
import { getSafeExternalUrl } from "../../utils/safeUrl";
import type { AgentProfile, AgentRun, Task } from "../../../types";
import { supportsSessionFork } from "../../services/agents/sessionForkService";

export interface RunViewProps {
  /**
   * The run to display. `null` means "closed / no run selected" — this
   * component renders nothing in that case. Callers may instead choose to
   * conditionally mount `RunView` only when a run is selected; either
   * approach works since the component also no-ops on `run === null`.
   */
  run: AgentRun | null;
  agent: AgentProfile | undefined;
  task: Task | undefined;
  isOpen: boolean;
  onClose: () => void;
  onCancel: (runId: string) => void;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onInjectGuidance?: (runId: string, message: string) => void;
  onFollowUp?: (runId: string, message: string) => void;
  onApprove?: (task: Task, run: AgentRun) => void;
  onReject?: (task: Task, run: AgentRun, feedback: string) => void;
  onOpenTerminal?: (run: AgentRun) => void;
  onMergeWorktree?: (run: AgentRun) => void;
  onDiscardWorktree?: (run: AgentRun) => void;
  /** Re-run a failed/cancelled run for the same task. */
  onRetryRun?: (runId: string) => void;
  /** Dismiss this finished/failed run (the caller typically also closes the view). */
  onDismissRun?: (runId: string) => void;
  /** Fork session to a duplicated task card (Claude/Codex only). */
  onForkSession?: (runId: string) => void;
  /** Save a message-index checkpoint (Claude/Codex only). */
  onCreateCheckpoint?: (runId: string) => void;
  /** Rewind session to a checkpoint and resume (Claude/Codex only). */
  onRewindCheckpoint?: (runId: string, checkpointId: string) => void;
  /** Revert run trace to a step (git + session). */
  onRevertTraceStep?: (runId: string, stepId: string) => void;
  /** Fork a new card/run from a trace step. */
  onForkTraceStep?: (runId: string, stepId: string) => void;
  /** Permission requests scoped to any run; this view filters to `run.id` itself. */
  permissionRequests?: AgentPermissionRequest[];
}

const EVENT_COLORS: Record<string, string> = {
  assistant: "text-slate-200",
  tool: "text-sky-300",
  result: "text-emerald-300",
  stderr: "text-red-300",
  verify: "text-purple-300",
  system: "text-slate-500",
  info: "text-slate-400",
};

/** True while the run is actively executing (mirrors AgentRunsDock's `isActive`). */
function isRunActive(run: AgentRun): boolean {
  return run.status === "running" || run.status === "verifying" || run.status === "queued";
}

/**
 * Scrollable transcript of `run.events`, auto-scrolling to the bottom as new
 * events arrive. The most recent event streams in via `StreamText` while the
 * run is active; earlier events render as plain text. Adapted from
 * AgentRunsDock's `RunLog`.
 */
const Transcript: React.FC<{ run: AgentRun }> = ({ run }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const eventCount = run.events.length;
  const active = isRunActive(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new events
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [eventCount]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto custom-scrollbar rounded-xl bg-black/50 border border-white/5 p-3 font-mono text-[12px] leading-relaxed space-y-1.5"
    >
      {run.gitBranch && (
        <div className="text-amber-300/80 flex items-center gap-1.5 pb-1.5 border-b border-white/5">
          <GitBranch size={12} /> {run.gitBranch}
          {(() => {
            const safePrUrl = run.prUrl ? getSafeExternalUrl(run.prUrl) : null;
            return safePrUrl ? (
              <a
                href={safePrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 hover:underline truncate ml-1"
              >
                PR
              </a>
            ) : null;
          })()}
        </div>
      )}
      {run.events.map((event, index) => {
        const isLast = index === run.events.length - 1;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: events are append-only and never reordered, so index is a stable identity
            key={`${run.id}-${event.ts.getTime()}-${index}`}
            className={EVENT_COLORS[event.kind] ?? "text-slate-400"}
          >
            <span className="text-slate-600 mr-1.5">
              {event.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            {event.kind === "tool" ? "▸ " : ""}
            {isLast && active ? (
              <StreamText text={event.text} isStreaming />
            ) : (
              <span className="whitespace-pre-wrap break-words">{event.text}</span>
            )}
          </div>
        );
      })}
      {run.events.length === 0 && <div className="text-slate-600">Waiting for output…</div>}
      {run.verification && !run.verification.passed && (
        <div className="text-amber-300 border-t border-white/5 pt-1.5 mt-1.5">
          Blocking gaps: {run.verification.blockingGaps.join(" · ")}
        </div>
      )}
    </div>
  );
};

/**
 * Inline permission prompts for this run, rendered with the shared
 * `ApprovalCard` primitive. Adapted from AgentRunsDock's `PermissionPromptPanel`,
 * but delegates the actual allow/deny call to the parent via callbacks so this
 * view stays decoupled from `agentMcpService` beyond describing the request.
 */
const PermissionPrompts: React.FC<{
  runId: string;
  requests: AgentPermissionRequest[];
  onRespond: (requestId: string, decision: PermissionResponseDecision) => void;
}> = ({ runId, requests, onRespond }) => {
  const runRequests = requests.filter((r) => r.runId === runId);
  if (runRequests.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-amber-500/20 pt-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-400/90">
        <ShieldAlert size={12} />
        Permission required ({runRequests.length})
      </div>
      {runRequests.map((req) => {
        const { summary, detail } = describePermissionInput(req.toolName, req.input);
        return (
          <ApprovalCard
            key={req.requestId}
            title={req.toolName}
            description={summary}
          >
            {detail !== summary && (
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar">
                {detail}
              </pre>
            )}
            <div className="text-[10px] text-slate-500">
              {req.receivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <PermissionActionButtons
              onRespond={(decision) => onRespond(req.requestId, decision)}
              size="compact"
            />
          </ApprovalCard>
        );
      })}
    </div>
  );
};

/**
 * Full-height slide-in drawer for a single agent run: streamed transcript,
 * inline permission prompts, and a footer action bar (cancel / pause / resume
 * / follow-up / merge / discard / terminal). This is the single-run,
 * full-detail counterpart to `AgentRunsDock`'s per-run card — interaction
 * logic (guidance injection, follow-up input, worktree actions) intentionally
 * mirrors the dock so behavior doesn't regress when it later replaces the
 * dock's expanded-row view.
 *
 * Renders nothing when `run` is `null` or `isOpen` is `false`; callers may
 * also choose to only mount `RunView` when a run is selected instead.
 */
export const RunView: React.FC<RunViewProps> = ({
  run,
  agent,
  task,
  isOpen,
  onClose,
  onCancel,
  onPause,
  onResume,
  onInjectGuidance,
  onFollowUp,
  onApprove,
  onReject,
  onOpenTerminal,
  onMergeWorktree,
  onDiscardWorktree,
  onRetryRun,
  onDismissRun,
  onForkSession,
  onCreateCheckpoint,
  onRewindCheckpoint,
  onRevertTraceStep,
  onForkTraceStep,
  permissionRequests = [],
}) => {
  const [guidanceText, setGuidanceText] = useState("");
  const [followUpText, setFollowUpText] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [activeTab, setActiveTab] = useState<"transcript" | "terminal">("transcript");
  const [ptyTakenOver, setPtyTakenOver] = useState(false);
  const [ptyFitEpoch, setPtyFitEpoch] = useState(0);
  const [selectedCheckpointId, setSelectedCheckpointId] = useState("");

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Reset terminal takeover when switching runs.
  useEffect(() => {
    setPtyTakenOver(false);
    setActiveTab("transcript");
  }, [run?.id]);

  if (!run || !isOpen) return null;

  const active = isRunActive(run);
  const inReview = task?.status === COLUMN_STATUS.COMPLETED;
  const showReview = !active && inReview && run.status === "completed" && task && onApprove && onReject;
  const showWorktreeActions =
    !active && run.worktreePath && run.gitBranch && (onMergeWorktree || onDiscardWorktree);
  const canFollowUp = !active && !!run.sessionId && !!onFollowUp;
  const canInjectGuidance = active && !!onInjectGuidance;
  const sessionForkCapable = !!agent && supportsSessionFork(agent.provider);
  const showSessionForkActions = !!run.sessionId && (!!onForkSession || !!onCreateCheckpoint || !!onRewindCheckpoint);
  const checkpoints = run.checkpoints ?? [];
  const traceSteps = listTrace(run.id)?.steps ?? run.traceSteps ?? [];
  const hasToolEvents = run.events.some((event) => event.kind === "tool");
  const runPermissionRequests = permissionRequests.filter((p) => p.runId === run.id);
  const isFailed = run.status === "failed";
  const isCancelled = run.status === "cancelled";
  const showRecovery = !active && (isFailed || isCancelled) && (!!onRetryRun || !!onDismissRun);
  const runError = isFailed ? formatRunError(run) : undefined;
  const canDismiss = !active && !!onDismissRun && !run.worktreePath;
  const showTerminalTab =
    run.engine === "agentd" && !!run.agentdRunId && agentPtyService.isAvailable();
  const canTakeOverTerminal = showTerminalTab && active && !ptyTakenOver;

  const handleTakeOver = async () => {
    if (!run.agentdRunId) return;
    try {
      await agentPtyService.takeover(run.agentdRunId);
      setPtyTakenOver(true);
      setActiveTab("terminal");
      setPtyFitEpoch((n) => n + 1);
    } catch {
      // Parent pause/run state updates via sidecar events when available.
    }
  };

  const submitGuidance = () => {
    const text = guidanceText.trim();
    if (!text || !onInjectGuidance) return;
    onInjectGuidance(run.id, text);
    setGuidanceText("");
  };

  const submitFollowUp = () => {
    const text = followUpText.trim();
    if (!text || !onFollowUp) return;
    onFollowUp(run.id, text);
    setFollowUpText("");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agent run detail"
        className="relative h-full w-full max-w-2xl liquid-glass rounded-none border-l border-white/10 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/5 shrink-0">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={run.isPaused ? "paused" : run.status} tone={runStatusTone(run)} />
              {agent?.name && (
                <span className="text-[11px] text-slate-400">{agent.name}</span>
              )}
              {(() => {
                const cost = deriveRunCostDisplay(run);
                if (!cost) return null;
                return (
                  <span
                    className="text-[11px] font-mono text-slate-500"
                    title={cost.estimated ? "Estimated from token usage rates" : "Reported run cost"}
                  >
                    {formatCostUsd(cost.costUsd, cost.estimated)}
                    {cost.totalTokens > 0 ? (
                      <span className="text-slate-600"> · {formatTokenCount(cost.totalTokens)} tok</span>
                    ) : null}
                  </span>
                );
              })()}
            </div>
            <h2 className="text-sm font-medium text-white truncate">
              {task?.title ?? run.taskId}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all shrink-0"
            aria-label="Close run detail"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 px-5 py-4 overflow-hidden">
          {runError && (
            <div className="shrink-0 flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-[12px] text-red-200/90 break-words">{runError}</p>
            </div>
          )}

          <div className="shrink-0 flex items-center gap-1 border-b border-white/5 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("transcript")}
              className={`px-2.5 py-1 rounded-lg text-[11px] uppercase tracking-wider transition-colors ${
                activeTab === "transcript"
                  ? "bg-white/10 text-white"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              Transcript
            </button>
            {showTerminalTab && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("terminal");
                  setPtyFitEpoch((n) => n + 1);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] uppercase tracking-wider transition-colors flex items-center gap-1 ${
                  activeTab === "terminal"
                    ? "bg-white/10 text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Terminal size={11} /> Terminal
              </button>
            )}
            {canTakeOverTerminal && activeTab === "terminal" && (
              <button
                type="button"
                onClick={() => void handleTakeOver()}
                className="ml-auto px-2.5 py-1 rounded-lg text-[11px] uppercase tracking-wider bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-colors"
                title="Pause the agent and send keystrokes to the live session"
              >
                Take Over
              </button>
            )}
            {ptyTakenOver && activeTab === "terminal" && (
              <span className="ml-auto text-[10px] uppercase tracking-wider text-amber-400/90">
                Interactive — agent paused
              </span>
            )}
          </div>

          {activeTab === "transcript" ? (
            <Transcript run={run} />
          ) : (
            <div className="flex-1 min-h-0 rounded-xl bg-black/50 border border-white/5 overflow-hidden">
              <RunPtyTerminal
                agentdRunId={run.agentdRunId ?? ""}
                visible={activeTab === "terminal"}
                inputEnabled={ptyTakenOver}
                fitEpoch={ptyFitEpoch}
              />
            </div>
          )}

          {hasToolEvents && (
            <div className="shrink-0 max-h-44 overflow-y-auto custom-scrollbar rounded-xl bg-black/30 border border-white/5 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">
                Timeline
              </div>
              <ToolTimeline events={run.events} />
            </div>
          )}

          {traceSteps.length > 0 && (onRevertTraceStep || onForkTraceStep) && (
            <RunTraceTimeline
              steps={traceSteps}
              disabled={active}
              onRevert={onRevertTraceStep ? (stepId) => onRevertTraceStep(run.id, stepId) : undefined}
              onFork={onForkTraceStep ? (stepId) => onForkTraceStep(run.id, stepId) : undefined}
            />
          )}

          {(run.worktreePath || run.gitDiff) && (
            <div className="shrink-0 max-h-56 overflow-y-auto custom-scrollbar">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                Diff
              </div>
              {run.worktreePath ? (
                <LazyDiffBrowser workingDir={run.worktreePath} fallbackDiff={run.gitDiff} />
              ) : (
                <DiffView diff={run.gitDiff} />
              )}
            </div>
          )}

          {runPermissionRequests.length > 0 && (
            <PermissionPrompts
              runId={run.id}
              requests={permissionRequests}
              onRespond={(requestId, decision) => {
                void import("../../services/agents/agentMcpService").then(({ default: svc }) =>
                  svc.respondToPermission(requestId, decision),
                );
              }}
            />
          )}

          {showReview && (
            <GlassPanel className="rounded-xl bg-white/5 border-white/5 shadow-none p-3 space-y-2">
              <input
                type="text"
                value={rejectFeedback}
                onChange={(e) => setRejectFeedback(e.target.value)}
                placeholder="Rejection feedback (required to reject)…"
                className="w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onApprove?.(task, run)}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[12px] font-medium hover:bg-emerald-500/20 transition-colors"
                  title={
                    run.gitBranch
                      ? `Commit & merge ${run.gitBranch}, then move the card to Commit`
                      : "Approve and move the card to Commit"
                  }
                >
                  {run.gitBranch ? "Commit & merge" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => onReject?.(task, run, rejectFeedback)}
                  className="flex-1 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[12px] font-medium flex items-center justify-center gap-1 hover:bg-amber-500/20 transition-colors"
                >
                  <MessageSquare size={11} /> Reject
                </button>
              </div>
            </GlassPanel>
          )}

          {canInjectGuidance && (
            <div className="flex gap-2 pt-1 border-t border-white/5">
              <input
                type="text"
                value={guidanceText}
                onChange={(e) => setGuidanceText(e.target.value)}
                placeholder="Inject guidance mid-run…"
                className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitGuidance();
                }}
              />
              <button
                type="button"
                disabled={!guidanceText.trim()}
                onClick={submitGuidance}
                className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 disabled:opacity-40"
                aria-label="Inject guidance"
                title="Queue guidance for the agent (fetched via MCP get_user_guidance)"
              >
                <Send size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Footer action bar */}
        <div className="shrink-0 border-t border-white/5 px-5 py-3 space-y-2.5">
          {showRecovery && (
            <div className="flex gap-2">
              {onRetryRun && (
                <button
                  type="button"
                  onClick={() => onRetryRun(run.id)}
                  className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-red-500/20 transition-colors"
                  title="Start a fresh run for this task"
                >
                  <RefreshCw size={12} /> Retry run
                </button>
              )}
              {canDismiss && (
                <button
                  type="button"
                  onClick={() => onDismissRun?.(run.id)}
                  className="flex-1 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-white/10 transition-colors"
                  title="Dismiss this run"
                >
                  <X size={12} /> Dismiss
                </button>
              )}
            </div>
          )}

          {showWorktreeActions && (
            <div className="flex gap-2">
              {onMergeWorktree && (
                <button
                  type="button"
                  onClick={() => onMergeWorktree(run)}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-500/20 transition-colors"
                >
                  <GitMerge size={12} /> Commit &amp; merge
                </button>
              )}
              {onDiscardWorktree && (
                <button
                  type="button"
                  onClick={() => onDiscardWorktree(run)}
                  className="flex-1 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-red-500/20 transition-colors"
                >
                  <Trash2 size={12} /> Discard
                </button>
              )}
            </div>
          )}

          {canFollowUp && (
            <div className="flex gap-2">
              <input
                type="text"
                value={followUpText}
                onChange={(e) => setFollowUpText(e.target.value)}
                placeholder="Follow-up message…"
                className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitFollowUp();
                }}
              />
              <button
                type="button"
                disabled={!followUpText.trim()}
                onClick={submitFollowUp}
                className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 disabled:opacity-40"
                aria-label="Send follow-up"
              >
                <Send size={13} />
              </button>
            </div>
          )}

          {showSessionForkActions && (
            <div className="flex flex-wrap items-center gap-2">
              {onForkSession && (
                <button
                  type="button"
                  disabled={!sessionForkCapable || active}
                  onClick={() => onForkSession(run.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[12px] font-medium flex items-center gap-1.5 hover:bg-white/10 transition-colors disabled:opacity-40"
                  title={
                    sessionForkCapable
                      ? "Copy session to a new task card"
                      : "Session fork is available for Claude and Codex only"
                  }
                >
                  <GitFork size={12} /> Fork
                </button>
              )}
              {onCreateCheckpoint && (
                <button
                  type="button"
                  disabled={!sessionForkCapable}
                  onClick={() => onCreateCheckpoint(run.id)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[12px] font-medium flex items-center gap-1.5 hover:bg-white/10 transition-colors disabled:opacity-40"
                  title={
                    sessionForkCapable
                      ? "Save a message-index checkpoint"
                      : "Checkpoints are available for Claude and Codex only"
                  }
                >
                  <History size={12} /> Checkpoint
                </button>
              )}
              {onRewindCheckpoint && checkpoints.length > 0 && (
                <>
                  <select
                    value={selectedCheckpointId}
                    onChange={(e) => setSelectedCheckpointId(e.target.value)}
                    className="min-w-0 flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[12px] text-white"
                    aria-label="Select checkpoint"
                  >
                    <option value="">Rewind to checkpoint…</option>
                    {[...checkpoints]
                      .sort((a, b) => b.messageIndex - a.messageIndex)
                      .map((cp) => (
                        <option key={cp.id} value={cp.id}>
                          {cp.label ?? `Message ${cp.messageIndex}`}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!sessionForkCapable || !selectedCheckpointId || active}
                    onClick={() => {
                      if (!selectedCheckpointId) return;
                      onRewindCheckpoint(run.id, selectedCheckpointId);
                      setSelectedCheckpointId("");
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[12px] font-medium disabled:opacity-40"
                    title={
                      sessionForkCapable
                        ? "Truncate session and resume from checkpoint"
                        : "Rewind is available for Claude and Codex only"
                    }
                  >
                    Rewind
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {run.sessionId && onOpenTerminal && (
              <button
                type="button"
                onClick={() => onOpenTerminal(run)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all"
                aria-label="Continue in Terminal"
                title="Continue this session in Terminal (claude --resume)"
              >
                <Terminal size={14} />
              </button>
            )}
            {active && run.status === "running" && onPause && onResume && (
              run.isPaused ? (
                <button
                  type="button"
                  onClick={() => onResume(run.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                  aria-label="Resume run"
                  title="Resume agent"
                >
                  <Play size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onPause(run.id)}
                  className="p-2 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                  aria-label="Pause run"
                  title="Pause agent"
                >
                  <Pause size={14} />
                </button>
              )
            )}
            {active && (
              <button
                type="button"
                onClick={() => onCancel(run.id)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 transition-all text-[12px] font-medium ml-auto"
              >
                <Square size={12} /> Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RunView;
