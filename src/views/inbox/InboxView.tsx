import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coffee,
  DollarSign,
  Inbox as InboxIcon,
  MessageSquare,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import { COLUMN_STATUS } from "../../constants";
import type { AgentStandupDigest } from "../../services/agents/agentStandupDigestService";
import { ApprovalCard, GlassCard, PresenceRing, StatusPill } from "../../ui";
import type { PresenceStatus } from "../../ui";
import type { AgentProfile, AgentRun, Task } from "../../../types";

export interface InboxViewProps {
  /** All known agent runs — the raw feed this surface triages. */
  agentRuns: AgentRun[];
  /** Agent roster, used to resolve `run.agentId` to a display name. */
  agents: AgentProfile[];
  /** Task list, used to resolve `run.taskId` to a title/status. */
  tasks: Task[];
  /** Rolled-up standup digest (completed/failed/blocked/pending), shown as a summary card. */
  standupDigest?: AgentStandupDigest;
  /** Open the full run detail (e.g. expand the runs dock / navigate to Run surface). */
  onOpenRun?: (runId: string) => void;
  /** Approve a finished run awaiting review. */
  onApprove?: (task: Task, run: AgentRun) => void;
  /** Reject a finished run awaiting review, with required feedback text. */
  onReject?: (task: Task, run: AgentRun, feedback: string) => void;
  /** Dismiss the standup digest summary card. */
  onDismissStandup?: () => void;
}

type InboxCard =
  | { kind: "approval"; run: AgentRun; task: Task | undefined; sortTs: number }
  | { kind: "finished"; run: AgentRun; task: Task | undefined; sortTs: number }
  | { kind: "blocked"; run: AgentRun; task: Task | undefined; sortTs: number };

function runTimestamp(run: AgentRun): number {
  return (run.finishedAt ?? run.startedAt ?? run.createdAt).getTime();
}

/** True while the agent process is paused, or an error mentions a permission/block. */
function isBlockedRun(run: AgentRun): boolean {
  if (run.status === "failed" && run.verification && !run.verification.passed) return true;
  if (run.status === "running" && run.isPaused) return true;
  const err = (run.error ?? "").toLowerCase();
  return err.includes("permission") || err.includes("blocked");
}

/** Mirrors AgentRunsDock's `showReview` gating: finished run, task sitting in Review, no verdict yet. */
function isAwaitingReview(run: AgentRun, task: Task | undefined): boolean {
  if (run.status !== "completed" || run.reviewOutcome) return false;
  return task?.status === COLUMN_STATUS.REVIEW;
}

function presenceForRun(run: AgentRun): PresenceStatus {
  if (run.isPaused) return "blocked";
  if (isBlockedRun(run)) return "blocked";
  if (run.status === "running" || run.status === "verifying" || run.status === "queued") {
    return "working";
  }
  return "idle";
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

const RejectInput: React.FC<{
  task: Task;
  run: AgentRun;
  onReject: (task: Task, run: AgentRun, feedback: string) => void;
}> = ({ task, run, onReject }) => {
  const [feedback, setFeedback] = useState("");
  return (
    <div className="space-y-1.5">
      <input
        type="text"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder="Rejection feedback (required to reject)…"
        className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
      />
      <button
        type="button"
        onClick={() => onReject(task, run, feedback)}
        className="w-full py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1"
      >
        <MessageSquare size={10} /> Reject with feedback
      </button>
    </div>
  );
};

/**
 * Inbox — the default landing surface. A card-based triage feed derived purely from props:
 * approvals awaiting review, finished runs, blocked agents, and a standup digest summary.
 * No backend event bus yet; this is a pure presentational component.
 */
export const InboxView: React.FC<InboxViewProps> = ({
  agentRuns,
  agents,
  tasks,
  standupDigest,
  onOpenRun,
  onApprove,
  onReject,
  onDismissStandup,
}) => {
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

  const cards = useMemo(() => {
    const result: InboxCard[] = [];
    for (const run of agentRuns) {
      const task = taskById.get(run.taskId);
      const sortTs = runTimestamp(run);

      if (isAwaitingReview(run, task)) {
        result.push({ kind: "approval", run, task, sortTs });
        continue;
      }
      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        if (run.status === "failed" && isBlockedRun(run)) {
          result.push({ kind: "blocked", run, task, sortTs });
        } else {
          result.push({ kind: "finished", run, task, sortTs });
        }
        continue;
      }
      if (isBlockedRun(run)) {
        result.push({ kind: "blocked", run, task, sortTs });
      }
    }
    // Most recent first.
    return result.sort((a, b) => b.sortTs - a.sortTs);
  }, [agentRuns, taskById]);

  const approvalCards = cards.filter((c) => c.kind === "approval");
  const otherCards = cards.filter((c) => c.kind !== "approval");

  const hasStandupContent =
    !!standupDigest &&
    (standupDigest.completed.length > 0 ||
      standupDigest.failed.length > 0 ||
      standupDigest.blocked.length > 0 ||
      standupDigest.pendingPermissions > 0 ||
      standupDigest.activeRuns > 0);

  const isEmpty = cards.length === 0 && !hasStandupContent;

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
      {hasStandupContent && standupDigest && (
        <StandupDigestCard digest={standupDigest} onDismiss={onDismissStandup} />
      )}

      {isEmpty && <EmptyInboxState />}

      {approvalCards.map((card) => {
        const agent = agentById.get(card.run.agentId);
        const title = card.task?.title ?? card.run.taskId;
        return (
          <ApprovalCard
            key={card.run.id}
            title={`${title} — awaiting review`}
            description={
              agent
                ? `${agent.name} finished this run. Review the result before it moves on.`
                : "Agent finished this run. Review the result before it moves on."
            }
            onApprove={
              onApprove && card.task ? () => onApprove(card.task as Task, card.run) : undefined
            }
          >
            {card.run.summary && (
              <p className="text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">
                {card.run.summary}
              </p>
            )}
            {onOpenRun && (
              <button
                type="button"
                onClick={() => onOpenRun(card.run.id)}
                className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
              >
                Open run
              </button>
            )}
            {onReject && card.task && (
              <RejectInput task={card.task} run={card.run} onReject={onReject} />
            )}
          </ApprovalCard>
        );
      })}

      {otherCards.map((card) => (
        <InboxRunCard
          key={card.run.id}
          card={card}
          agent={agentById.get(card.run.agentId)}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  );
};

const StandupDigestCard: React.FC<{ digest: AgentStandupDigest; onDismiss?: () => void }> = ({
  digest,
  onDismiss,
}) => {
  const sinceLabel = digest.since.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <GlassCard className="bg-gradient-to-br from-slate-900/80 to-black/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Coffee size={16} className="text-amber-300" />
          Agent standup
          <span className="text-xs font-normal text-slate-500">since {sinceLabel}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Dismiss
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">
          <CheckCircle2 size={12} /> {digest.completed.length} done
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 text-red-300">
          <AlertTriangle size={12} /> {digest.failed.length} failed
        </span>
        {digest.blocked.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">
            <ShieldAlert size={12} /> {digest.blocked.length} blocked
          </span>
        )}
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-1 text-slate-300">
          <DollarSign size={12} /> ${digest.totalCostUsd.toFixed(2)}
        </span>
        {digest.pendingPermissions > 0 && (
          <span className="rounded-full bg-purple-500/10 px-2 py-1 text-purple-300">
            {digest.pendingPermissions} permission{digest.pendingPermissions === 1 ? "" : "s"} pending
          </span>
        )}
        {digest.activeRuns > 0 && (
          <span className="rounded-full bg-blue-500/10 px-2 py-1 text-blue-300">
            {digest.activeRuns} active
          </span>
        )}
      </div>

      {(digest.completed.length > 0 || digest.failed.length > 0 || digest.blocked.length > 0) && (
        <ul className="space-y-1 text-xs text-slate-400 max-h-28 overflow-y-auto custom-scrollbar">
          {digest.completed.slice(0, 4).map((e) => (
            <li key={e.runId}>✓ {e.taskTitle}</li>
          ))}
          {[...digest.blocked, ...digest.failed].slice(0, 3).map((e) => (
            <li key={e.runId} className="text-amber-300/90">
              ! {e.taskTitle}
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
};

const InboxRunCard: React.FC<{
  card: InboxCard;
  agent: AgentProfile | undefined;
  onOpenRun?: (runId: string) => void;
}> = ({ card, agent, onOpenRun }) => {
  const { run, task } = card;
  const title = task?.title ?? run.taskId;
  const ts = card.sortTs ? new Date(card.sortTs) : undefined;

  return (
    <GlassCard>
      <div className="flex items-center gap-2.5">
        <PresenceRing status={presenceForRun(run)} size={28}>
          <Bot size={13} className="text-red-300" />
        </PresenceRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs text-white truncate">{title}</p>
            <StatusPill status={run.isPaused ? "paused" : run.status} />
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {agent?.name ?? "Agent"}
            {ts ? ` · ${formatRelativeTime(ts)}` : ""}
          </p>
        </div>
        {run.status === "completed" ? (
          <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
        ) : run.status === "failed" ? (
          <XCircle size={14} className="text-red-400 shrink-0" />
        ) : card.kind === "blocked" ? (
          <ShieldAlert size={14} className="text-amber-400 shrink-0" />
        ) : (
          <XCircle size={14} className="text-slate-500 shrink-0" />
        )}
      </div>

      {run.summary && card.kind === "finished" && (
        <p className="text-[11px] text-slate-400 truncate">{run.summary}</p>
      )}

      {card.kind === "blocked" && (
        <p className="text-[11px] text-amber-300/90 truncate">
          {run.verification && !run.verification.passed
            ? `Blocking gaps: ${run.verification.blockingGaps.join(" · ")}`
            : run.error || "Blocked — needs attention."}
        </p>
      )}

      {onOpenRun && (
        <button
          type="button"
          onClick={() => onOpenRun(run.id)}
          className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
        >
          Open run
        </button>
      )}
    </GlassCard>
  );
};

const EmptyInboxState: React.FC = () => (
  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
    <div className="rounded-full bg-white/5 border border-white/10 p-4">
      <InboxIcon size={22} className="text-slate-500" />
    </div>
    <p className="text-sm font-medium text-slate-200">You're all caught up</p>
    <p className="text-xs text-slate-500 max-w-xs">
      No runs need review, nothing's blocked, and there's nothing new to triage right now.
    </p>
  </div>
);

export default InboxView;
