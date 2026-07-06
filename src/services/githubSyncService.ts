import { STORAGE_KEYS } from "../constants";
import { isTauri } from "../runtime/runtimeEnvironment";
import storageService from "./storageService";
import type { BoardColumn, Task } from "../../types";
import { generateTaskId } from "../utils/taskUtils";

export interface GitHubIssueRef {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface GitHubSyncConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  /** Working directory used to detect repo (first agent workspace or manual). */
  workingDir?: string;
  /** Import open issues on manual sync. */
  importOnSync: boolean;
  /** Close GitHub issue when LiquiTask task reaches a completed column. */
  closeOnComplete: boolean;
  /** Post a comment when status changes. */
  commentOnStatusChange: boolean;
  defaultProjectId?: string;
}

export interface GitHubIssueDto {
  number: number;
  title: string;
  body?: string;
  url: string;
  state: string;
  labels: { name: string }[];
}

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  remoteUrl: string;
}

const DEFAULT_CONFIG: GitHubSyncConfig = {
  enabled: false,
  owner: "",
  repo: "",
  importOnSync: true,
  closeOnComplete: true,
  commentOnStatusChange: true,
};

class GitHubSyncService {
  private config: GitHubSyncConfig = { ...DEFAULT_CONFIG };

  load(): GitHubSyncConfig {
    const stored = storageService.get<GitHubSyncConfig | null>(STORAGE_KEYS.GITHUB_SYNC, null);
    this.config = { ...DEFAULT_CONFIG, ...(stored ?? {}) };
    return this.getConfig();
  }

  save(config: GitHubSyncConfig): void {
    this.config = { ...config };
    storageService.set(STORAGE_KEYS.GITHUB_SYNC, this.config);
  }

  getConfig(): GitHubSyncConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.config.owner && !!this.config.repo;
  }

  async detectRepo(workingDir: string): Promise<GitHubRepoInfo | null> {
    if (!isTauri()) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<GitHubRepoInfo>("github_detect_repo", { workingDir });
    } catch {
      return null;
    }
  }

  async listIssues(state: "open" | "closed" = "open"): Promise<GitHubIssueDto[]> {
    if (!isTauri() || !this.isEnabled()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GitHubIssueDto[]>("github_issue_list", {
      owner: this.config.owner,
      repo: this.config.repo,
      state,
      limit: 50,
    });
  }

  issuesToTasks(
    issues: GitHubIssueDto[],
    projectId: string,
    backlogStatus: string,
    existingTasks: Task[],
  ): Partial<Task>[] {
    const linked = new Set(
      existingTasks
        .map((t) => t.githubIssue?.number)
        .filter((n): n is number => typeof n === "number"),
    );

    return issues
      .filter((issue) => !linked.has(issue.number))
      .map((issue) => {
        const priority =
          issue.labels.some((l) => /critical|urgent|high/i.test(l.name))
            ? "high"
            : issue.labels.some((l) => /low/i.test(l.name))
              ? "low"
              : "medium";
        return {
          title: issue.title,
          summary: issue.body ?? "",
          status: backlogStatus,
          projectId,
          priority,
          tags: ["github", ...issue.labels.map((l) => l.name.toLowerCase())],
          githubIssue: {
            owner: this.config.owner,
            repo: this.config.repo,
            number: issue.number,
            url: issue.url,
          },
        };
      });
  }

  createTasksFromIssues(
    issues: GitHubIssueDto[],
    projectId: string,
    backlogStatus: string,
  ): Task[] {
    const now = new Date();
    return issues.map((issue, idx) => ({
      id: generateTaskId(idx),
      jobId: `GH-${issue.number}`,
      projectId,
      title: issue.title,
      summary: issue.body ?? "",
      assignee: "",
      priority: issue.labels.some((l) => /critical|urgent|high/i.test(l.name))
        ? "high"
        : "medium",
      status: backlogStatus,
      createdAt: now,
      updatedAt: now,
      subtasks: [],
      attachments: [],
      tags: ["github", ...issue.labels.map((l) => l.name.toLowerCase())],
      timeEstimate: 0,
      timeSpent: 0,
      githubIssue: {
        owner: this.config.owner,
        repo: this.config.repo,
        number: issue.number,
        url: issue.url,
      },
    }));
  }

  async syncTaskStatusChange(
    task: Task,
    previous: Task | undefined,
    columns: BoardColumn[],
  ): Promise<void> {
    if (!isTauri() || !this.isEnabled() || !task.githubIssue) return;
    if (!this.config.commentOnStatusChange && !this.config.closeOnComplete) return;

    const prevStatus = previous?.status;
    if (prevStatus === task.status) return;

    const column = columns.find((c) => c.id === task.status);
    const prevColumn = columns.find((c) => c.id === prevStatus);
    const statusLabel = column?.title ?? task.status;
    const { owner, repo, number } = task.githubIssue;

    const { invoke } = await import("@tauri-apps/api/core");

    if (this.config.commentOnStatusChange) {
      const body = `LiquiTask: moved to **${statusLabel}**${prevColumn ? ` (from ${prevColumn.title})` : ""}.`;
      await invoke("github_issue_comment", { owner, repo, number, body });
    }

    if (this.config.closeOnComplete && column?.isCompleted) {
      await invoke("github_issue_close", {
        owner,
        repo,
        number,
        comment: `Closed via LiquiTask — task completed.`,
      });
    }
  }
}

export const githubSyncService = new GitHubSyncService();
export default githubSyncService;
