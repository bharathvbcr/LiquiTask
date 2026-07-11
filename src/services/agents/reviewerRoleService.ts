/**
 * Reviewer-agent stage for local merges (Refactor 5).
 *
 * Flow: Completed → InReview (reviewer run) → Commit (human).
 * Request-changes spawns follow-up on the same worktree.
 */
import type { AgentProfile, AgentRun, ReviewVerdict, Task } from "../../../types";
import { COLUMN_STATUS } from "../../constants";
import { isTauri } from "../../runtime/runtimeEnvironment";
import agentRunService from "./agentRunService";
import agentService from "./agentService";
import { evaluateReviewGate } from "./feedbackLoopService";

export function isReviewerAgent(agent: AgentProfile): boolean {
  return agent.role === "reviewer";
}

export function isCoderAgent(agent: AgentProfile): boolean {
  const role = agent.role ?? "default";
  return role === "default" || role === "coder" || role === "planner";
}

/** Resolve the reviewer profile for a coder agent's local merge gate. */
export function resolveReviewerForCoder(coder: AgentProfile): AgentProfile | undefined {
  if (coder.reviewerAgentId) {
    const byId = agentService.getAgentById(coder.reviewerAgentId);
    if (byId) return byId;
  }
  const roster = agentService.getAgents();
  return roster.find((a) => a.role === "reviewer") ?? roster.find((a) => a.reviewerAgentGate);
}

/** True when local merge should use the InReview reviewer stage (not push+PR). */
export function shouldUseLocalReviewerStage(agent: AgentProfile): boolean {
  if (agent.commitStage === "pushPr") return false;
  if (agent.role === "reviewer") return false;
  return Boolean(agent.reviewerAgentGate || resolveReviewerForCoder(agent));
}

function buildReviewerPrompt(task: Task, diff: string): string {
  const criteria = (task.subtasks ?? [])
    .filter((s) => !s.completed)
    .map((s) => `- ${s.title}`)
    .join("\n");
  return [
    "You are a code reviewer merge gate. Review this diff against the task intent.",
    "",
    `Task: "${task.title}"`,
    task.summary ? `Intent: ${task.summary.slice(0, 2000)}` : "",
    criteria ? `Acceptance criteria (open subtasks):\n${criteria}` : "",
    "",
    'Reply with JSON only on your final line:',
    '{"verdict":"approve"|"request-changes","passed":boolean,"blockingIssues":string[],"summary":string,"fileComments":[{"path":string,"line":number,"comment":string}]}',
    "",
    "Use verdict=approve when ready for human commit. Use request-changes for serious gaps.",
    "Do not modify any files — review only.",
    "",
    "Diff:",
    diff.trim().slice(0, 14_000),
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseStructuredReviewVerdict(raw: unknown): ReviewVerdict {
  const obj =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const blockingIssues = Array.isArray(obj.blockingIssues)
    ? obj.blockingIssues.filter((s): s is string => typeof s === "string")
    : [];
  const verdictRaw = obj.verdict === "request-changes" ? "request-changes" : "approve";
  const passed = obj.passed !== false && verdictRaw === "approve";
  const fileComments = Array.isArray(obj.fileComments)
    ? obj.fileComments
        .filter((c): c is { path: string; comment: string; line?: number } => {
          return (
            typeof c === "object" &&
            c !== null &&
            typeof (c as Record<string, unknown>).path === "string" &&
            typeof (c as Record<string, unknown>).comment === "string"
          );
        })
        .map((c) => ({
          path: c.path,
          comment: c.comment,
          line: typeof c.line === "number" ? c.line : undefined,
        }))
    : undefined;
  return {
    verdict: passed ? "approve" : "request-changes",
    passed,
    blockingIssues,
    summary: typeof obj.summary === "string" ? obj.summary : "",
    fileComments,
  };
}

export interface ReviewerStageHooks {
  moveTask: (
    taskId: string,
    status: string,
    note: string,
    ctx?: { localReviewerGate?: boolean; hasPrOpen?: boolean },
  ) => void;
  unhideInReviewColumn?: () => void;
}

let hooks: ReviewerStageHooks | null = null;

export function setReviewerStageHooks(next: ReviewerStageHooks | null): void {
  hooks = next;
}

/**
 * After a coder run completes, move to InReview and spawn the reviewer agent.
 */
export async function startLocalReviewerStage(
  task: Task,
  workerRun: AgentRun,
  coder: AgentProfile,
): Promise<ReviewVerdict | null> {
  if (!shouldUseLocalReviewerStage(coder) || !isTauri()) return null;
  const reviewer = resolveReviewerForCoder(coder);
  if (!reviewer) return null;

  hooks?.unhideInReviewColumn?.();
  hooks?.moveTask(task.id, COLUMN_STATUS.IN_REVIEW, `Reviewer ${reviewer.name} reviewing.`, {
    localReviewerGate: true,
  });

  const repoDir = workerRun.repoDir ?? coder.workingDir;
  const workDir = workerRun.worktreePath ?? repoDir;
  const { invoke } = await import("@tauri-apps/api/core");
  const diffResult = await invoke<{ diff: string }>("agent_git_diff", {
    workingDir: workDir,
    baseRef: null,
  });

  const gateVerdict = await evaluateReviewGate(diffResult.diff, task.title, {
    reviewerAgentGate: true,
    reviewerAgent: { ...reviewer, permissionMode: "plan", autoApprove: true },
    repoDir,
  });

  const structured = parseStructuredReviewVerdict({
    passed: gateVerdict.passed,
    blockingIssues: gateVerdict.blockingIssues,
    summary: gateVerdict.summary,
    verdict: gateVerdict.passed ? "approve" : "request-changes",
  });

  await handleReviewerVerdict(task, workerRun, structured);
  workerRun.reviewerRunId = workerRun.id;
  agentRunService.persistRun(workerRun);
  return structured;
}

/** Apply reviewer verdict — approve stays InReview; request-changes reopens work. */
export async function handleReviewerVerdict(
  task: Task,
  workerRun: AgentRun,
  verdict: ReviewVerdict,
): Promise<void> {
  if (verdict.verdict === "approve" || verdict.passed) {
    hooks?.moveTask(
      task.id,
      COLUMN_STATUS.IN_REVIEW,
      `Review approved — ready for human commit. ${verdict.summary.slice(0, 200)}`,
      { localReviewerGate: true },
    );
    return;
  }

  const issues = verdict.blockingIssues.length
    ? verdict.blockingIssues.slice(0, 8).join("; ")
    : verdict.summary.slice(0, 500);
  const prompt = [
    "Reviewer requested changes before merge. Address every blocking issue:",
    "",
    issues,
    verdict.fileComments?.length
      ? [
          "",
          "File comments:",
          ...verdict.fileComments.map(
            (c) => `- ${c.path}${c.line ? `:${c.line}` : ""}: ${c.comment}`,
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  hooks?.moveTask(task.id, COLUMN_STATUS.IN_PROGRESS, "Reviewer requested changes — rework.", {});
  if (workerRun.sessionId || workerRun.agentdRunId) {
    await agentRunService.followUp(workerRun.id, prompt);
  }
}

export const reviewerRoleService = {
  isReviewerAgent,
  isCoderAgent,
  resolveReviewerForCoder,
  shouldUseLocalReviewerStage,
  startLocalReviewerStage,
  handleReviewerVerdict,
  parseStructuredReviewVerdict,
  setReviewerStageHooks,
};

export default reviewerRoleService;
