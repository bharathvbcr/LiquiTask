/**
 * External session discovery + reconciler (Phase 5 / kanban-code CardReconciler).
 *
 * Scans on-disk agent sessions via agentd `sessions.discover`, matches them to
 * existing runs/tasks (sessionId → branch → project path), and surfaces
 * unmatched sessions as adoptable Inbox cards.
 */
import { STORAGE_KEYS } from '../../constants';
import { localApi } from '../../core/api/localApi';
import { isTauri } from '../../runtime/runtimeEnvironment';
import type { AgentProfile, AgentRun, Project, Task } from '../../../types';
import storageService from '../storageService';
import agentRunService from './agentRunService';
import agentService from './agentService';
import { generateTaskId, getBacklogColumnId } from '../../utils/taskUtils';

export interface DiscoveredSession {
  sessionId: string;
  runtime: string;
  projectPath: string;
  sessionPath: string;
  gitBranch?: string;
  preview?: string;
  modifiedAtMs: number;
}

export interface AdoptableSession {
  session: DiscoveredSession;
  /** Set when reconciler linked to an existing run (no inbox card). */
  matchedRunId?: string;
  matchedTaskId?: string;
}

export interface ReconcileResult {
  /** Sessions linked to existing runs (sessionId backfilled when missing). */
  linked: Array<{ sessionId: string; runId: string; taskId: string }>;
  /** Unmatched sessions surfaced for adoption. */
  adoptable: AdoptableSession[];
}

type Listener = (adoptable: AdoptableSession[]) => void;

const DISCOVERY_POLL_MS = 60_000;

/** Normalize filesystem paths for stable comparison. */
export function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed;
}

/** Repo root for a session cwd, worktree, or project path. */
export function repoRoot(path: string): string {
  const normalized = normalizePath(path);
  for (const marker of ['/.claude/worktrees/', '/.git/worktrees/']) {
    const idx = normalized.indexOf(marker);
    if (idx >= 0) return normalized.slice(0, idx);
  }
  return normalized;
}

function pathsCompatible(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ra = repoRoot(na);
  const rb = repoRoot(nb);
  return ra === nb || rb === na || ra === rb;
}

function branchName(branch?: string): string | undefined {
  if (!branch) return undefined;
  const base = branch.replace(/^refs\/heads\//, '').trim();
  return base || undefined;
}

function runtimeToProvider(runtime: string): AgentProfile['provider'] | null {
  if (runtime === 'claude') return 'claude-code';
  const supported: AgentProfile['provider'][] = [
    'codex',
    'cursor',
    'grok',
    'copilot',
    'opencode',
    'openclaw',
    'hermes',
    'pi',
    'kimi',
    'kiro',
    'antigravity',
    'qoder',
    'codebuddy',
    'traecli',
  ];
  return supported.includes(runtime as AgentProfile['provider'])
    ? (runtime as AgentProfile['provider'])
    : null;
}

function titleFromSession(session: DiscoveredSession): string {
  const preview = session.preview?.trim();
  if (preview) return preview.slice(0, 120);
  if (session.gitBranch) return `Session on ${session.gitBranch}`;
  const base = session.projectPath.split('/').filter(Boolean).pop();
  return base ? `External ${session.runtime} session (${base})` : `External ${session.runtime} session`;
}

function projectForPath(projects: Project[], projectPath: string): Project | undefined {
  const root = repoRoot(projectPath);
  for (const project of projects) {
    for (const ws of project.workspacePaths ?? []) {
      if (pathsCompatible(ws, projectPath) || pathsCompatible(ws, root)) {
        return project;
      }
    }
  }
  return undefined;
}

function agentForRuntime(runtime: string, project?: Project): AgentProfile | undefined {
  const provider = runtimeToProvider(runtime);
  if (!provider) return undefined;
  const agents = agentService.getAgents();
  const match = agents.find((a) => a.provider === provider);
  if (match) return match;
  return agents.find((a) => {
    if (a.provider !== provider) return false;
    if (!project?.workspacePaths?.length) return true;
    return project.workspacePaths.some((ws) => pathsCompatible(ws, a.workingDir));
  });
}

/**
 * Pure reconciler: sessionId → git branch (scoped by project) → project path.
 * Returns linked run updates and adoptable inbox items.
 */
export function reconcileDiscoveredSessions(
  discovered: DiscoveredSession[],
  runs: AgentRun[],
  tasks: Task[],
  projects: Project[],
  dismissedIds: ReadonlySet<string> = new Set(),
): ReconcileResult {
  const linked: ReconcileResult['linked'] = [];
  const adoptable: AdoptableSession[] = [];

  const runBySession = new Map<string, AgentRun>();
  const runsByBranch = new Map<string, AgentRun[]>();
  const runsByProject = new Map<string, AgentRun[]>();

  for (const run of runs) {
    if (run.sessionId) runBySession.set(run.sessionId, run);
    const branch = branchName(run.gitBranch);
    const projectPath = run.worktreePath ?? run.repoDir;
    if (branch && projectPath) {
      const key = `${repoRoot(projectPath)}::${branch}`;
      const list = runsByBranch.get(key) ?? [];
      list.push(run);
      runsByBranch.set(key, list);
    }
    if (projectPath) {
      const key = repoRoot(projectPath);
      const list = runsByProject.get(key) ?? [];
      list.push(run);
      runsByProject.set(key, list);
    }
  }

  const taskById = new Map(tasks.map((t) => [t.id, t]));

  for (const session of discovered) {
    if (dismissedIds.has(session.sessionId)) continue;

    let matched: AgentRun | undefined = runBySession.get(session.sessionId);

    if (!matched) {
      const branch = branchName(session.gitBranch);
      const root = repoRoot(session.projectPath);
      if (branch && root) {
        const candidates = runsByBranch.get(`${root}::${branch}`) ?? [];
        matched = candidates.find((run) => {
          const runPath = run.worktreePath ?? run.repoDir;
          return runPath ? pathsCompatible(runPath, session.projectPath) : true;
        });
      }
    }

    if (!matched && session.projectPath) {
      const root = repoRoot(session.projectPath);
      const candidates = runsByProject.get(root) ?? [];
      matched = candidates.find((run) => !run.sessionId);
    }

    if (matched) {
      linked.push({
        sessionId: session.sessionId,
        runId: matched.id,
        taskId: matched.taskId,
      });
      continue;
    }

    // Skip sessions whose project path matches a task workspace but has no run yet —
    // still adoptable; kanban-code creates cards for truly unmatched resources.
    void taskById;
    void projects;

    adoptable.push({ session });
  }

  adoptable.sort(
    (a, b) => (b.session.modifiedAtMs ?? 0) - (a.session.modifiedAtMs ?? 0),
  );

  return { linked, adoptable };
}

class SessionDiscoveryService {
  private adoptable: AdoptableSession[] = [];
  private dismissed = new Set<string>();
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor() {
    const stored = storageService.get<string[]>(STORAGE_KEYS.SESSION_DISCOVERY_DISMISSED, []);
    for (const id of stored ?? []) {
      if (id) this.dismissed.add(id);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.adoptable);
    return () => this.listeners.delete(listener);
  }

  getAdoptable(): AdoptableSession[] {
    return this.adoptable;
  }

  startPolling(): void {
    if (!isTauri() || this.pollTimer) return;
    void this.scan();
    this.pollTimer = setInterval(() => void this.scan(), DISCOVERY_POLL_MS);
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  dismiss(sessionId: string): void {
    this.dismissed.add(sessionId);
    storageService.set(
      STORAGE_KEYS.SESSION_DISCOVERY_DISMISSED,
      Array.from(this.dismissed),
    );
    this.adoptable = this.adoptable.filter((a) => a.session.sessionId !== sessionId);
    this.notify();
  }

  async scan(
    runs: AgentRun[] = agentRunService.getRuns(),
    tasks: Task[] = [],
    projects: Project[] = [],
  ): Promise<ReconcileResult> {
    if (!isTauri() || this.scanning) {
      return { linked: [], adoptable: this.adoptable };
    }
    this.scanning = true;
    try {
      const knownSessionIds = runs
        .map((r) => r.sessionId)
        .filter((id): id is string => Boolean(id));
      const result = await localApi.sessionsDiscover(knownSessionIds);
      const discovered = result?.sessions ?? [];
      const reconciled = reconcileDiscoveredSessions(
        discovered,
        runs,
        tasks,
        projects,
        this.dismissed,
      );

      for (const link of reconciled.linked) {
        agentRunService.linkExternalSession(link.runId, link.sessionId);
      }

      this.adoptable = reconciled.adoptable;
      this.notify();
      return reconciled;
    } catch (err) {
      console.warn('Session discovery scan failed:', err);
      return { linked: [], adoptable: this.adoptable };
    } finally {
      this.scanning = false;
    }
  }

  /**
   * Adopt an external session: create a board task + run wired for followUp/resume.
   */
  async adopt(
    sessionId: string,
    _tasks: Task[],
    projects: Project[],
    columns: { id: string }[],
    options?: {
      agentId?: string;
      onCreateTask?: (task: Task) => void;
    },
  ): Promise<AgentRun | null> {
    const entry = this.adoptable.find((a) => a.session.sessionId === sessionId);
    if (!entry) return null;

    const session = entry.session;
    const project =
      projectForPath(projects, session.projectPath) ??
      (projects.length === 1 ? projects[0] : undefined);
    if (!project) {
      throw new Error('No project matches this session path. Link a workspace first.');
    }

    let agent: AgentProfile | undefined;
    if (options?.agentId) {
      agent = agentService.getAgentById(options.agentId);
    }
    agent ??= agentForRuntime(session.runtime, project);
    if (!agent) {
      throw new Error(`No agent configured for runtime "${session.runtime}".`);
    }

    const backlogId = getBacklogColumnId(columns as Parameters<typeof getBacklogColumnId>[0]);

    const task: Task = {
      id: generateTaskId(),
      jobId: `TSK-${Math.floor(Math.random() * 9000) + 1000}`,
      projectId: project.id,
      title: titleFromSession(session),
      summary: `Adopted external ${session.runtime} session`,
      assignee: agent.name,
      priority: "medium",
      status: backlogId,
      createdAt: new Date(),
      subtasks: [],
      attachments: [],
      tags: [],
      timeEstimate: 0,
      timeSpent: 0,
    };

    if (options?.onCreateTask) {
      options.onCreateTask(task);
    } else {
      throw new Error("Task creation hook required to adopt a session.");
    }

    const run = agentRunService.adoptExternalSession({
      task,
      agent,
      sessionId: session.sessionId,
      repoDir: repoRoot(session.projectPath) || session.projectPath,
      worktreePath: session.projectPath.includes('/.claude/worktrees/')
        ? session.projectPath
        : undefined,
      gitBranch: session.gitBranch,
      preview: session.preview,
      runtime: session.runtime,
    });

    this.adoptable = this.adoptable.filter((a) => a.session.sessionId !== sessionId);
    this.notify();
    return run;
  }

  private notify(): void {
    const snapshot = this.adoptable;
    for (const listener of this.listeners) listener(snapshot);
  }
}

const sessionDiscoveryService = new SessionDiscoveryService();
export default sessionDiscoveryService;
