import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Coffee,
  CornerUpLeft,
  DollarSign,
  Inbox as InboxIcon,
  Link2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  derivePermissionInboxItems,
  formatRepairFeedback,
  isAwaitingReview,
  isBlockedRun,
} from "../../core/inbox/deriveInboxItems";
import {
  DEFAULT_KEYBINDINGS,
  formatKeybindingList,
  matchesKeybindingAction,
} from "../../constants/keybindings";
import type { PendingPlan } from "../../services/agents/agentPlannerService";
import {
  describePermissionInput,
  type AgentPermissionRequest,
  type PermissionResponseDecision,
} from "../../services/agents/agentMcpService";
import { PermissionActionButtons } from "../../components/agents/PermissionActionButtons";
import type { AgentStandupDigest } from "../../services/agents/agentStandupDigestService";
import type { DeadLetter } from "../../services/deadLetterService";
import { ApprovalCard, FlatCard, PresenceRing, StatusPill } from "../../ui";
import type { PresenceStatus } from "../../ui";
import {
  failureKindLabel,
  formatRelativeTime,
  formatRunError,
  runStatusTone,
} from "../../utils/runProgress";
import { formatRunLog } from "../../utils/formatRunLog";
import { CopyButton } from "../../components/common/CopyButton";
import type { AgentProfile, AgentRun, Task } from "../../../types";
import type { AdoptableSession } from "../../services/agents/sessionDiscoveryService";

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
  /** Open quick-add prefilled from a dead-letter failure context. */
  onQuickAddFromDeadLetter?: (title: string, detail: string) => void;
  /** Discard every open dead-letter in one shot ("Clear all"). */
  onClearDeadLetters?: () => void;
  /** Merge DLQ: merge main into worktree and send conflict context to the agent. */
  onResolveMergeWithAgent?: (id: string) => void;
  /** CI/review DLQ: route failure context to the agent via followUp. */
  onSendDeadLetterToAgent?: (id: string) => void;
  /** Bulk-clear finished/failed run cards from the inbox. */
  onClearFinished?: () => void;
  /** Return a finished/failed run's task to the board (clears a stuck card). */
  onReturnToBoard?: (runId: string) => void;
  /** Dismiss a single finished/failed run card. */
  onDismissRun?: (runId: string) => void;
  /** Re-run a failed/cancelled run for the same task. */
  onRetryRun?: (runId: string) => void;
  /** Restore a cleared snapshot of runs (the Undo affordance). */
  onRestoreRuns?: (runs: AgentRun[]) => void;
  /** Pending permission prompts across all active runs. */
  pendingPermissions?: AgentPermissionRequest[];
  /** Respond to a single permission request. */
  onRespondPermission?: (requestId: string, decision: PermissionResponseDecision) => void;
  /** Batch approve or deny all pending permission requests. */
  onRespondAllPermissions?: (decision: PermissionResponseDecision) => void;
  /** External agent sessions discovered on disk, awaiting adoption. */
  adoptableSessions?: AdoptableSession[];
  /** Link a discovered session to the board (creates task + run). */
  onAdoptSession?: (sessionId: string) => void;
  /** Hide a discovered session from the inbox. */
  onDismissSession?: (sessionId: string) => void;
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

const UnifiedPermissionsSection: React.FC<{
  requests: AgentPermissionRequest[];
  agents: AgentProfile[];
  agentRuns: AgentRun[];
  tasks: Task[];
  focusIndex: number;
  onFocusIndexChange: (index: number) => void;
  onRespond: (requestId: string, decision: PermissionResponseDecision) => void;
  onRespondAll?: (decision: PermissionResponseDecision) => void;
  onOpenRun?: (runId: string) => void;
}> = ({
  requests,
  agents,
  agentRuns,
  tasks,
  focusIndex,
  onFocusIndexChange,
  onRespond,
  onRespondAll,
  onOpenRun,
}) => {
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const runById = useMemo(() => new Map(agentRuns.map((r) => [r.id, r])), [agentRuns]);
  const sortedRequests = useMemo(() => derivePermissionInboxItems(requests), [requests]);

  const allowAllHint = formatKeybindingList(DEFAULT_KEYBINDINGS["inbox:permission-allow-all"] ?? []);
  const denyAllHint = formatKeybindingList(DEFAULT_KEYBINDINGS["inbox:permission-deny-all"] ?? []);

  return (
    <FlatCard className="border-amber-500/25 bg-amber-500/5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className="text-amber-400" />
          <span className="text-sm font-medium text-amber-200">
            Permission requests ({requests.length})
          </span>
        </div>
        {onRespondAll && requests.length > 1 && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onRespondAll("allow")}
              className="px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-medium"
              title={allowAllHint}
            >
              Allow all
            </button>
            <button
              type="button"
              onClick={() => onRespondAll("deny")}
              className="px-2 py-0.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[10px] font-medium"
              title={denyAllHint}
            >
              Deny all
            </button>
          </div>
        )}
      </div>
      <p className="text-[10px] text-slate-500">
        {formatKeybindingList(DEFAULT_KEYBINDINGS["inbox:permission-allow"] ?? [])} allow ·{" "}
        {formatKeybindingList(DEFAULT_KEYBINDINGS["inbox:permission-deny"] ?? [])} deny ·{" "}
        {allowAllHint} allow all · {denyAllHint} deny all · ↑↓ navigate
      </p>
      {sortedRequests.map(({ request: req }, index) => {
        const run = runById.get(req.runId);
        const agent = run ? agentById.get(run.agentId) : undefined;
        const task = taskById.get(req.taskId);
        const { summary, detail } = describePermissionInput(req.toolName, req.input);
        const focused = index === focusIndex;
        return (
          <div
            key={req.requestId}
            className={`rounded-lg border p-2.5 space-y-1.5 transition-colors ${
              focused
                ? "border-amber-400/40 bg-amber-500/10"
                : "border-amber-500/15 bg-black/20"
            }`}
            onMouseEnter={() => onFocusIndexChange(index)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-amber-200">{req.toolName}</span>
              <span className="text-[10px] text-slate-500 shrink-0">
                {req.receivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              {agent?.name ?? "Agent"}
              {task ? ` · ${task.title}` : ""}
            </p>
            <p className="text-[11px] text-slate-400 break-words">{summary}</p>
            {detail !== summary && (
              <pre className="text-[10px] text-slate-500 whitespace-pre-wrap break-all max-h-20 overflow-y-auto custom-scrollbar">
                {detail}
              </pre>
            )}
            <PermissionActionButtons
              onRespond={(decision) => onRespond(req.requestId, decision)}
            />
            {onOpenRun && run && (
              <button
                type="button"
                onClick={() => onOpenRun(run.id)}
                className="w-full px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-400 text-[11px]"
                title="Open run"
              >
                Open run
              </button>
            )}
          </div>
        );
      })}
    </FlatCard>
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
  onQuickAddFromDeadLetter,
  onClearDeadLetters,
  onResolveMergeWithAgent,
  onSendDeadLetterToAgent,
  onClearFinished,
  onReturnToBoard,
  onDismissRun,
  onRetryRun,
  onRestoreRuns,
  pendingPermissions = [],
  onRespondPermission,
  onRespondAllPermissions,
  adoptableSessions = [],
  onAdoptSession,
  onDismissSession,
}) => {
  const [permissionFocusIndex, setPermissionFocusIndex] = useState(0);
  const [undo, setUndo] = useState<{ runs: AgentRun[] } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [],
  );
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
    cards.length === 0 &&
    pendingPlans.length === 0 &&
    deadLetters.length === 0 &&
    pendingPermissions.length === 0 &&
    adoptableSessions.length === 0 &&
    !hasStandupContent;

  // Keyboard shortcuts for unified permission triage (Inbox surface).
  useEffect(() => {
    if (pendingPermissions.length === 0 || !onRespondPermission) return;

    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (isTextInput) return;

      const sorted = derivePermissionInboxItems(pendingPermissions);
      const focused = sorted[permissionFocusIndex]?.request ?? sorted[0]?.request;
      if (!focused) return;

      if (matchesKeybindingAction(event, DEFAULT_KEYBINDINGS, "inbox:permission-allow")) {
        event.preventDefault();
        onRespondPermission(focused.requestId, "allow");
        return;
      }
      if (matchesKeybindingAction(event, DEFAULT_KEYBINDINGS, "inbox:permission-deny")) {
        event.preventDefault();
        onRespondPermission(focused.requestId, "deny");
        return;
      }
      if (matchesKeybindingAction(event, DEFAULT_KEYBINDINGS, "inbox:permission-allow-all")) {
        event.preventDefault();
        onRespondAllPermissions?.("allow");
        return;
      }
      if (matchesKeybindingAction(event, DEFAULT_KEYBINDINGS, "inbox:permission-deny-all")) {
        event.preventDefault();
        onRespondAllPermissions?.("deny");
        return;
      }
      if (event.key === "ArrowDown" && pendingPermissions.length > 1) {
        event.preventDefault();
        setPermissionFocusIndex((i) => Math.min(i + 1, pendingPermissions.length - 1));
      }
      if (event.key === "ArrowUp" && pendingPermissions.length > 1) {
        event.preventDefault();
        setPermissionFocusIndex((i) => Math.max(i - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    pendingPermissions,
    permissionFocusIndex,
    onRespondPermission,
    onRespondAllPermissions,
  ]);

  useEffect(() => {
    if (permissionFocusIndex >= pendingPermissions.length) {
      setPermissionFocusIndex(Math.max(0, pendingPermissions.length - 1));
    }
  }, [pendingPermissions.length, permissionFocusIndex]);

  const canClearDeadLetters = !!onClearDeadLetters && deadLetters.length > 0;
  const canClearFinished = !!onClearFinished && otherCards.length > 0;

  // Clear finished cards, keeping a short-lived snapshot so the action is
  // reversible via the Undo bar (worktree-pending runs can't be single-removed,
  // so they're excluded from the snapshot).
  const handleClearFinished = () => {
    const snapshot = otherCards.map((c) => c.run).filter((r) => !r.worktreePath);
    if (onDismissRun && snapshot.length > 0) {
      for (const r of snapshot) onDismissRun(r.id);
    } else {
      onClearFinished?.();
    }
    if (onRestoreRuns && snapshot.length > 0) {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      setUndo({ runs: snapshot });
      undoTimerRef.current = setTimeout(() => setUndo(null), 7000);
    }
  };

  const handleUndo = () => {
    if (undo) onRestoreRuns?.(undo.runs);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = null;
    setUndo(null);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-3 max-w-2xl mx-auto w-full">
      {(canClearDeadLetters || canClearFinished) && (
        <div className="flex items-center justify-end gap-3">
          {canClearDeadLetters && (
            <button
              type="button"
              onClick={() => onClearDeadLetters?.()}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-300 transition-colors"
              title="Discard all failed-action items"
            >
              <Trash2 size={11} /> Clear all failed ({deadLetters.length})
            </button>
          )}
          {canClearFinished && (
            <button
              type="button"
              onClick={handleClearFinished}
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              title="Clear finished run cards from the inbox"
            >
              <Trash2 size={11} /> Clear finished ({otherCards.length})
            </button>
          )}
        </div>
      )}

      {undo && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
          <span className="text-[11px] text-slate-400">
            Cleared {undo.runs.length} finished run{undo.runs.length === 1 ? "" : "s"}
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

      {hasStandupContent && standupDigest && (
        <StandupDigestCard digest={standupDigest} onDismiss={onDismissStandup} />
      )}

      {pendingPermissions.length > 0 && onRespondPermission && (
        <UnifiedPermissionsSection
          requests={pendingPermissions}
          agents={agents}
          agentRuns={agentRuns}
          tasks={tasks}
          focusIndex={permissionFocusIndex}
          onFocusIndexChange={setPermissionFocusIndex}
          onRespond={onRespondPermission}
          onRespondAll={onRespondAllPermissions}
          onOpenRun={onOpenRun}
        />
      )}

      {adoptableSessions.length > 0 && (
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 px-1">
            External Sessions
          </p>
          {adoptableSessions.map(({ session }) => (
            <FlatCard key={session.sessionId} className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-100 truncate">
                    {session.preview?.trim() || `External ${session.runtime} session`}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {session.runtime}
                    {session.gitBranch ? ` · ${session.gitBranch}` : ""}
                    {session.projectPath ? ` · ${session.projectPath}` : ""}
                  </p>
                </div>
                <StatusPill status="Discovered" tone="purple" />
              </div>
              <div className="flex items-center gap-2">
                {onAdoptSession && (
                  <button
                    type="button"
                    onClick={() => onAdoptSession(session.sessionId)}
                    className="liquid-btn liquid-btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1"
                  >
                    <Link2 size={12} /> Adopt
                  </button>
                )}
                {onDismissSession && (
                  <button
                    type="button"
                    onClick={() => onDismissSession(session.sessionId)}
                    className="liquid-btn liquid-btn-ghost text-xs px-3 py-1.5 inline-flex items-center gap-1"
                  >
                    <X size={12} /> Dismiss
                  </button>
                )}
              </div>
            </FlatCard>
          ))}
        </section>
      )}

      {isEmpty && <EmptyInboxState />}

      {deadLetters.map((letter) => (
        <DeadLetterCard
          key={letter.id}
          letter={letter}
          onRetry={onRetryDeadLetter}
          onDiscard={onDiscardDeadLetter}
          onQuickAdd={onQuickAddFromDeadLetter}
          onResolveMergeWithAgent={onResolveMergeWithAgent}
          onSendToAgent={onSendDeadLetterToAgent}
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
          onReturnToBoard={onReturnToBoard}
          onDismissRun={onDismissRun}
          onRetryRun={onRetryRun}
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
  ci: "CI failure",
  review: "PR review feedback",
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
  onQuickAdd?: (title: string, detail: string) => void;
  onResolveMergeWithAgent?: (id: string) => void;
  onSendToAgent?: (id: string) => void;
}> = ({
  letter,
  onRetry,
  onDiscard,
  onQuickAdd,
  onResolveMergeWithAgent,
  onSendToAgent,
}) => (
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
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          {onQuickAdd && (
            <button
              type="button"
              onClick={() => onQuickAdd(letter.title, letter.detail)}
              className="px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium"
            >
              Quick Add
            </button>
          )}
          {letter.kind === "merge" && onResolveMergeWithAgent && (
            <button
              type="button"
              onClick={() => onResolveMergeWithAgent(letter.id)}
              className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[11px] font-medium flex items-center gap-1"
            >
              <Wrench size={10} /> Resolve With Agent
            </button>
          )}
          {(letter.kind === "ci" || letter.kind === "review") && onSendToAgent && (
            <button
              type="button"
              onClick={() => onSendToAgent(letter.id)}
              className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[11px] font-medium flex items-center gap-1"
            >
              <Bot size={10} /> Send To Agent
            </button>
          )}
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
          <CopyButton
            text={`${letter.title}\n\n${letter.detail}`}
            label="Copy"
            title="Copy error detail"
            className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[11px] font-medium inline-flex items-center gap-1 hover:text-white transition-colors"
          />
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
    <FlatCard className="border-amber-500/15">
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
  onReturnToBoard?: (runId: string) => void;
  onDismissRun?: (runId: string) => void;
  onRetryRun?: (runId: string) => void;
}> = ({ card, agent, onOpenRun, onSendRepair, onReturnToBoard, onDismissRun, onRetryRun }) => {
  const { run, task } = card;
  const title = task?.title ?? run.taskId;
  const ts = card.sortTs ? new Date(card.sortTs) : undefined;
  const isRecoverable = run.status === "failed" || run.status === "cancelled";
  const canDismiss = !!onDismissRun && !run.worktreePath;
  // Verify-verdict repair loop: a gate-blocked run exposes its blocking gaps
  // and a one-click repair action that resumes the run seeded with them.
  const blockingGaps =
    card.kind === "blocked" && run.verification && !run.verification.passed
      ? run.verification.blockingGaps
      : undefined;
  // The blocked branch renders its own error/gaps; only surface a plain error
  // line for non-blocked failed runs so we never double up.
  const runError = card.kind !== "blocked" ? formatRunError(run) : undefined;

  return (
    <FlatCard className="group">
      <div className="flex items-center gap-2.5">
        <PresenceRing status={presenceForRun(run)} size={28}>
          <Bot size={13} className="text-red-300" />
        </PresenceRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs text-white truncate">{title}</p>
            <StatusPill status={run.isPaused ? "paused" : run.status} tone={runStatusTone(run)} />
            {failureKindLabel(run.failureKind) && (
              <span
                className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded border bg-amber-500/15 text-amber-300 border-amber-500/25 shrink-0"
                title="Why this run stopped"
              >
                {failureKindLabel(run.failureKind)}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 truncate">
            {agent?.name ?? "Agent"}
            {ts ? ` · ${formatRelativeTime(ts)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {run.status === "completed" ? (
            <CheckCircle2 size={14} className="text-emerald-400" />
          ) : run.status === "failed" ? (
            <XCircle size={14} className="text-red-400" />
          ) : card.kind === "blocked" ? (
            <ShieldAlert size={14} className="text-amber-400" />
          ) : (
            <XCircle size={14} className="text-slate-500" />
          )}
          {canDismiss && (
            <button
              type="button"
              onClick={() => onDismissRun?.(run.id)}
              className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label="Dismiss run"
              title="Dismiss this run"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {run.summary && card.kind === "finished" && run.status !== "failed" && (
        <p className="text-[11px] text-slate-400 truncate">{run.summary}</p>
      )}

      {runError && (
        <p className="text-[11px] text-red-300/90 bg-red-500/5 border border-red-500/15 rounded-lg px-2 py-1 break-words">
          {runError}
        </p>
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

      <div className="flex items-center gap-3">
        {onOpenRun && (
          <button
            type="button"
            onClick={() => onOpenRun(run.id)}
            className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
          >
            Open run
          </button>
        )}
        {onRetryRun && isRecoverable && (
          <button
            type="button"
            onClick={() => onRetryRun(run.id)}
            className="inline-flex items-center gap-1 text-[11px] text-red-300/90 hover:text-red-200"
            title="Start a fresh run for this task"
          >
            <RefreshCw size={10} /> Retry
          </button>
        )}
        {onReturnToBoard &&
          (run.status === "failed" || run.status === "cancelled" || card.kind === "blocked") && (
            <button
              type="button"
              onClick={() => onReturnToBoard(run.id)}
              className="inline-flex items-center gap-1 text-[11px] text-sky-300/90 hover:text-sky-200"
              title="Return this task to the board"
            >
              <CornerUpLeft size={10} /> Return to board
            </button>
          )}
        <CopyButton
          text={() => formatRunLog(run, { title: task?.title, jobId: task?.jobId })}
          label="Copy log"
          title="Copy the full run log"
          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
        />
      </div>
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
