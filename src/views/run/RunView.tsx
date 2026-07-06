import {
  GitBranch,
  GitMerge,
  MessageSquare,
  Pause,
  Play,
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
import { describePermissionInput } from "../../services/agents/agentMcpService";
import type { AgentPermissionRequest } from "../../services/agents/agentMcpService";
import { ApprovalCard, GlassPanel, StatusPill, StreamText } from "../../ui";
import type { AgentProfile, AgentRun, Task } from "../../../types";

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
          {run.prUrl && (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:underline truncate ml-1"
            >
              PR
            </a>
          )}
        </div>
      )}
      {run.gitDiff && (
        <pre className="text-slate-500 whitespace-pre-wrap mb-1.5 border-b border-white/5 pb-1.5">
          {run.gitDiff.slice(0, 4000)}
        </pre>
      )}
      {run.events.map((event, index) => {
        const isLast = index === run.events.length - 1;
        return (
          <div
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
  onRespond: (requestId: string, approved: boolean) => void;
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
            approveLabel="Allow"
            denyLabel="Deny"
            onApprove={() => onRespond(req.requestId, true)}
            onDeny={() => onRespond(req.requestId, false)}
          >
            {detail !== summary && (
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar">
                {detail}
              </pre>
            )}
            <div className="text-[10px] text-slate-500">
              {req.receivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
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
  permissionRequests = [],
}) => {
  const [guidanceText, setGuidanceText] = useState("");
  const [followUpText, setFollowUpText] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!run || !isOpen) return null;

  const active = isRunActive(run);
  const inReview = task?.status === COLUMN_STATUS.REVIEW;
  const showReview = !active && inReview && run.status === "completed" && task && onApprove && onReject;
  const showWorktreeActions =
    !active && run.worktreePath && run.gitBranch && (onMergeWorktree || onDiscardWorktree);
  const canFollowUp = !active && !!run.sessionId && !!onFollowUp;
  const canInjectGuidance = active && !!onInjectGuidance;
  const runPermissionRequests = permissionRequests.filter((p) => p.runId === run.id);

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
        className="relative h-full w-full max-w-2xl bg-slate-900/95 border-l border-white/10 backdrop-blur-xl shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-white/5 shrink-0">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={run.isPaused ? "paused" : run.status} />
              {agent?.name && (
                <span className="text-[11px] text-slate-400">{agent.name}</span>
              )}
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
          <Transcript run={run} />

          {runPermissionRequests.length > 0 && (
            <PermissionPrompts
              runId={run.id}
              requests={permissionRequests}
              onRespond={(requestId, approved) => {
                void import("../../services/agents/agentMcpService").then(({ default: svc }) =>
                  svc.respondToPermission(requestId, approved),
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
                >
                  Approve
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
          {showWorktreeActions && (
            <div className="flex gap-2">
              {onMergeWorktree && (
                <button
                  type="button"
                  onClick={() => onMergeWorktree(run)}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-500/20 transition-colors"
                >
                  <GitMerge size={12} /> Merge
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
