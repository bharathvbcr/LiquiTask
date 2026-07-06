import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  GitMerge,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Send,
  ShieldAlert,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { COLUMN_STATUS } from "../../constants";
import agentMcpService, {
  describePermissionInput,
  type AgentPermissionRequest,
} from "../../services/agents/agentMcpService";
import type { AgentProfile, AgentRun, BoardColumn, Task } from "../../../types";

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
}

const STATUS_STYLES: Record<AgentRun["status"], string> = {
  queued: "bg-slate-500/10 text-slate-300 border-slate-500/20",
  running: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  verifying: "bg-sky-500/10 text-sky-300 border-sky-500/20",
  completed: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  failed: "bg-red-500/10 text-red-300 border-red-500/20",
  cancelled: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const EVENT_COLORS: Record<string, string> = {
  assistant: "text-slate-200",
  tool: "text-sky-300",
  result: "text-emerald-300",
  stderr: "text-red-300",
  verify: "text-purple-300",
  system: "text-slate-500",
  info: "text-slate-400",
};

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
        <div key={`${run.id}-${index}`} className={EVENT_COLORS[event.kind] ?? "text-slate-400"}>
          <span className="text-slate-600 mr-1.5">
            {event.ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          {event.kind === "tool" ? "▸ " : ""}
          {event.text}
        </div>
      ))}
      {run.events.length === 0 && <div className="text-slate-600">Waiting for output…</div>}
      {run.verification && !run.verification.passed && (
        <div className="text-amber-300 border-t border-white/5 pt-1 mt-1">
          Blocking gaps: {run.verification.blockingGaps.join(" · ")}
        </div>
      )}
    </div>
  );
};

const FollowUpInput: React.FC<{
  run: AgentRun;
  onFollowUp?: (runId: string, message: string) => void;
}> = ({ run, onFollowUp }) => {
  const [text, setText] = useState("");
  if (!run.sessionId || !onFollowUp) return null;
  const isActive = run.status === "running" || run.status === "verifying";
  if (isActive) return null;

  return (
    <div className="flex gap-1.5 pt-1">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Follow-up message…"
        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            onFollowUp(run.id, text.trim());
            setText("");
          }
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (!text.trim()) return;
          onFollowUp(run.id, text.trim());
          setText("");
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
  const [text, setText] = useState("");
  if (!onInjectGuidance) return null;
  const isActive = run.status === "running" || run.status === "verifying";
  if (!isActive) return null;

  return (
    <div className="flex gap-1.5 pt-1 border-t border-white/5">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Inject guidance mid-run…"
        className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            onInjectGuidance(run.id, text.trim());
            setText("");
          }
        }}
      />
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() => {
          if (!text.trim()) return;
          onInjectGuidance(run.id, text.trim());
          setText("");
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
  const runRequests = requests.filter((r) => r.runId === runId);
  if (runRequests.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-amber-500/20 pt-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400/90">
        <ShieldAlert size={11} />
        Permission required ({runRequests.length})
      </div>
      {runRequests.map((req) => {
        const { summary, detail } = describePermissionInput(req.toolName, req.input);
        return (
          <div
            key={req.requestId}
            className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2 space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-amber-200">{req.toolName}</span>
              <span className="text-[10px] text-slate-500 shrink-0">
                {req.receivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
 * Floating dock (Multica-style board presence) showing agent activity:
 * live runs with streamed logs, follow-up chat, git diff, plus review actions.
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
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState<Record<string, string>>({});
  const [pendingPermissions, setPendingPermissions] = useState<AgentPermissionRequest[]>([]);

  useEffect(() => {
    return agentMcpService.subscribePermissions(setPendingPermissions);
  }, []);

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

  const activeRuns = runs.filter(
    (r) => r.status === "running" || r.status === "verifying" || r.status === "queued",
  );
  const recentRuns = runs
    .filter((r) => r.status !== "running" && r.status !== "verifying" && r.status !== "queued")
    .slice(0, 5);

  const idleAssigned = useMemo(() => {
    const activeTaskIds = new Set(activeRuns.map((r) => r.taskId));
    return tasks.filter((task) => {
      const agent = agentByName.get((task.assignee ?? "").trim().toLowerCase());
      if (!agent || activeTaskIds.has(task.id)) return false;
      const column = columns.find((c) => c.id === task.status);
      return !column?.isCompleted;
    });
  }, [tasks, columns, agentByName, activeRuns]);

  if (agents.length === 0 || (activeRuns.length === 0 && idleAssigned.length === 0 && recentRuns.length === 0)) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-red-400" />
          <span className="text-sm font-medium text-white">Agent teammates</span>
          {activeRuns.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
              <Loader2 size={10} className="animate-spin" />
              {activeRuns.length} active
            </span>
          )}
          {pendingPermissions.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
              <ShieldAlert size={10} />
              {pendingPermissions.length} pending
            </span>
          )}
        </div>
        {collapsed ? (
          <ChevronUp size={14} className="text-slate-500" />
        ) : (
          <ChevronDown size={14} className="text-slate-500" />
        )}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {[...activeRuns, ...recentRuns].map((run) => {
            const task = taskById.get(run.taskId);
            const agent = agentById.get(run.agentId);
            const isExpanded = expandedRunId === run.id;
            const lastEvent = run.events[run.events.length - 1];
            const isActive =
              run.status === "running" || run.status === "verifying" || run.status === "queued";
            const inReview = task?.status === COLUMN_STATUS.REVIEW;
            const showReview =
              !isActive && inReview && run.status === "completed" && task && onApprove && onReject;
            const showWorktreeActions =
              !isActive &&
              run.worktreePath &&
              run.gitBranch &&
              (onMergeWorktree || onDiscardWorktree);
            const hasPendingPermissions = pendingPermissions.some((p) => p.runId === run.id);

            return (
              <div
                key={run.id}
                className={`rounded-xl bg-white/5 border p-2.5 space-y-2 ${
                  hasPendingPermissions ? "border-amber-500/30 ring-1 ring-amber-500/10" : "border-white/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="flex-1 min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STATUS_STYLES[run.status]}`}
                      >
                        {run.isPaused ? "paused" : run.status}
                      </span>
                      {run.isPaused && (
                        <Pause size={11} className="text-amber-400 shrink-0" aria-hidden />
                      )}
                      {run.verification?.passed && (
                        <ShieldCheck size={12} className="text-emerald-400 shrink-0" />
                      )}
                      <span className="text-xs text-white truncate">
                        {task?.title ?? run.taskId}
                      </span>
                    </div>
                    {!isExpanded && lastEvent && (
                      <p className="text-[11px] text-slate-500 truncate mt-1">
                        {agent?.name}: {lastEvent.text}
                      </p>
                    )}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
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
                    {isActive && run.status === "running" && onPause && onResume && (
                      run.isPaused ? (
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
                      )
                    )}
                    {isActive ? (
                      <button
                        type="button"
                        onClick={() => onCancel(run.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        aria-label="Cancel run"
                      >
                        <Square size={12} />
                      </button>
                    ) : run.status === "completed" ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : (
                      <XCircle size={14} className="text-slate-500" />
                    )}
                  </div>
                </div>

                {isActive && (
                  <PermissionPromptPanel runId={run.id} requests={pendingPermissions} />
                )}

                {showReview && (
                  <div className="space-y-1.5 border-t border-white/5 pt-2">
                    <input
                      type="text"
                      value={rejectFeedback[run.id] ?? ""}
                      onChange={(e) =>
                        setRejectFeedback((prev) => ({ ...prev, [run.id]: e.target.value }))
                      }
                      placeholder="Rejection feedback (required to reject)…"
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => onApprove!(task, run)}
                        className="flex-1 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onReject!(task, run, rejectFeedback[run.id] ?? "")}
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

                {isActive && (
                  <GuidanceInput run={run} onInjectGuidance={onInjectGuidance} />
                )}

                {isExpanded && (
                  <>
                    <RunLog run={run} />
                    <FollowUpInput run={run} onFollowUp={onFollowUp} />
                  </>
                )}
              </div>
            );
          })}

          {idleAssigned.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-600 px-1">
                Assigned to agents
              </p>
              {idleAssigned.slice(0, 5).map((task) => (
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
            </div>
          )}
        </div>
      )}
    </div>
  );
};
