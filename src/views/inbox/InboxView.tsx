import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coffee,
  DollarSign,
  Inbox as InboxIcon,
  MessageSquare,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";

import {
  formatRepairFeedback,
  isAwaitingReview,
  isBlockedRun,
} from "../../core/inbox/deriveInboxItems";
import type { PendingPlan } from "../../services/agents/agentPlannerService";
import type { AgentStandupDigest } from "../../services/agents/agentStandupDigestService";
import type { DeadLetter } from "../../services/deadLetterService";
import { ApprovalCard, FlatCard, PresenceRing, StatusPill } from "../../ui";
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
  /** DevCouncil plans awaiting the plan-gate decision (Rework Plan §3.4 item 1). */
  pendingPlans?: PendingPlan[];
  /** Approve a pending plan — materializes subtasks and spawns scoped runs. */
  onApprovePlan?: (plan: PendingPlan) => void;
  /** Reject a pending plan, with required feedback text. */
  onRejectPlan?: (plan: PendingPlan, feedback: string) => void;
  /** Re-run a gate-blocked run seeded with its formatted blocking gaps. */
  onSendRepair?: (run: AgentRun, feedback: string) => void;
  /** Dismiss the standup digest summary card. */
  onDismissStandup?: () => void;
  /** Open dead-lettered actions (failed merges / agent actions / runs). */
  deadLetters?: DeadLetter[];
  /** Re-execute a dead-lettered action through its registered handler. */
  onRetryDeadLetter?: (id: string) => void;
  /** Discard a dead-lettered action permanently. */
  onDiscardDeadLetter?: (id: string) => void;
}

type InboxCard =
  | { kind: "approval"; run: AgentRun; task: Task | undefined; sortTs: number }
  | { kind: "finished"; run: AgentRun; task: Task | undefined; sortTs: number }
  | { kind: "blocked"; run: AgentRun; task: Task | undefined; sortTs: number };

function runTimestamp(run: AgentRun): number {
  return (run.finishedAt ?? run.startedAt ?? run.createdAt).getTime();
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

const PlanRejectInput: React.FC<{
  plan: PendingPlan;
  onReject: (plan: PendingPlan, feedback: string) => void;
}> = ({ plan, onReject }) => {
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
        onClick={() => onReject(plan, feedback)}
        className="w-full py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1"
      >
        <MessageSquare size={10} /> Reject plan with feedback
      </button>
    </div>
  );
};

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
  pendingPlans = [],
  onApprovePlan,
  onRejectPlan,
  onSendRepair,
  onDismissStandup,
  deadLetters = [],
  onRetryDeadLetter,
  onDiscardDeadLetter,
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

  const isEmpty =
    cards.length === 0 && pendingPlans.length === 0 && deadLetters.length === 0 && !hasStandupContent;

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
      {hasStandupContent && standupDigest && (
        <StandupDigestCard digest={standupDigest} onDismiss={onDismissStandup} />
      )}

      {isEmpty && <EmptyInboxState />}

      {deadLetters.map((letter) => (
        <DeadLetterCard
          key={letter.id}
          letter={letter}
          onRetry={onRetryDeadLetter}
          onDiscard={onDiscardDeadLetter}
        />
      ))}

      {pendingPlans.map((plan) => (
        <ApprovalCard
          key={plan.id}
          title={`${plan.epicTitle} — plan awaiting approval`}
          description={`${plan.agentName} proposed ${plan.subtasks.length} subtask(s) from dev plan (${plan.requirementsCount} requirement(s)). Approving creates the subtasks and starts scoped runs.`}
          approveLabel="Approve plan"
          onApprove={onApprovePlan ? () => onApprovePlan(plan) : undefined}
        >
          <ul className="space-y-0.5 text-[11px] text-slate-400 max-h-24 overflow-y-auto custom-scrollbar">
            {plan.subtasks.map((subtask) => (
              <li key={subtask.id} className="truncate">
                • {subtask.title}
                {subtask.plannedFiles?.length ? (
                  <span className="text-slate-500">
                    {" "}
                    · {subtask.plannedFiles.length} file(s) in scope
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {onRejectPlan && <PlanRejectInput plan={plan} onReject={onRejectPlan} />}
        </ApprovalCard>
      ))}

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
          onSendRepair={onSendRepair}
        />
      ))}
    </div>
  );
};

const DEAD_LETTER_KIND_LABEL: Record<DeadLetter["kind"], string> = {
  merge: "Failed merge",
  "mcp-action": "Failed agent action",
  run: "Failed run",
  automation: "Failed automation",
  "event-log": "Unrecorded change",
};

/**
 * Dead-letter card: a failed side effect (merge, MCP board write, run) held
 * for triage with one-click Retry (re-executes through the registered
 * handler) or Discard. Nothing that fails after intent-capture is silent.
 */
const DeadLetterCard: React.FC<{
  letter: DeadLetter;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
}> = ({ letter, onRetry, onDiscard }) => (
  <FlatCard className="border-red-500/20 bg-red-950/20">
    <div className="flex items-start gap-2">
      <ShieldAlert size={14} className="text-red-400 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-red-400/80">
            {DEAD_LETTER_KIND_LABEL[letter.kind]}
          </span>
          {letter.attempts > 0 && (
            <span className="text-[10px] text-slate-500">
              {letter.attempts} retr{letter.attempts === 1 ? "y" : "ies"}
            </span>
          )}
        </div>
        <p className="text-xs text-white font-medium truncate">{letter.title}</p>
        <p className="text-[11px] text-slate-400 whitespace-pre-wrap break-words max-h-20 overflow-y-auto custom-scrollbar">
          {letter.detail}
        </p>
        <div className="flex items-center gap-2 pt-1">
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(letter.id)}
              className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium flex items-center gap-1"
            >
              <RotateCcw size={10} /> Retry
            </button>
          )}
          {onDiscard && (
            <button
              type="button"
              onClick={() => onDiscard(letter.id)}
              className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[11px] font-medium flex items-center gap-1"
            >
              <Trash2 size={10} /> Discard
            </button>
          )}
        </div>
      </div>
    </div>
  </FlatCard>
);

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
    <FlatCard className="bg-gradient-to-br from-slate-900/80 to-black/40">
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
    </FlatCard>
  );
};

const InboxRunCard: React.FC<{
  card: InboxCard;
  agent: AgentProfile | undefined;
  onOpenRun?: (runId: string) => void;
  onSendRepair?: (run: AgentRun, feedback: string) => void;
}> = ({ card, agent, onOpenRun, onSendRepair }) => {
  const { run, task } = card;
  const title = task?.title ?? run.taskId;
  const ts = card.sortTs ? new Date(card.sortTs) : undefined;
  // Verify-verdict repair loop: a gate-blocked run exposes its blocking gaps
  // and a one-click repair action that resumes the run seeded with them.
  const blockingGaps =
    card.kind === "blocked" && run.verification && !run.verification.passed
      ? run.verification.blockingGaps
      : undefined;

  return (
    <FlatCard>
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

      {card.kind === "blocked" &&
        (blockingGaps ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-amber-300">
              DevCouncil gate: {blockingGaps.length} blocking gap(s)
            </p>
            <ul className="space-y-0.5 text-[11px] text-amber-300/90 max-h-24 overflow-y-auto custom-scrollbar">
              {blockingGaps.map((gap, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list recomputed each render, no natural id
                <li key={`${run.id}-gap-${index}`} className="break-words">
                  • {gap}
                </li>
              ))}
            </ul>
            {onSendRepair && blockingGaps.length > 0 && (
              <button
                type="button"
                onClick={() => onSendRepair(run, formatRepairFeedback(blockingGaps))}
                className="w-full py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium flex items-center justify-center gap-1 hover:bg-amber-500/20 transition-colors"
              >
                <Wrench size={10} /> Send repair run
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-amber-300/90 truncate">
            {run.error || "Blocked — needs attention."}
          </p>
        ))}

      {onOpenRun && (
        <button
          type="button"
          onClick={() => onOpenRun(run.id)}
          className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
        >
          Open run
        </button>
      )}
    </FlatCard>
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
