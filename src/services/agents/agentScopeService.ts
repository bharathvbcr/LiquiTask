/**
 * DevCouncil scope enforcement — the "second gate" for planned agent runs.
 *
 * When DevCouncil's plan gate returns `plannedFiles` on a subtask, the
 * materialized task carries a whitelist of files it is allowed to touch.
 * This service tracks that whitelist per task, binds it to whichever run(s)
 * execute the task, and lets `agentMcpService` check write/delete tool calls
 * against it before approving them.
 *
 * Tasks that were never DevCouncil-planned have no registered scope, so
 * `checkPath` treats them as unrestricted — identical to pre-existing
 * behavior.
 *
 * NOTE: This is a product control, not a security boundary. Agents running in
 * the host sandbox (the default for all 14 runtimes today) retain direct
 * filesystem access outside this MCP permission path — containment requires a
 * container/sandbox worktree policy, not scope checks alone.
 */

import { STORAGE_KEYS } from "../../constants";
import storageService from "../storageService";

export interface PlannedFile {
  path: string;
  reason: string;
  allowedChange: "create" | "modify" | "delete" | "read_only";
}

export interface ScopeCheckResult {
  inScope: boolean;
  reason?: string;
}

/** Sentinel returned when a path escapes the registered run root. */
export const SCOPE_PATH_ESCAPE = "";

/**
 * Normalize a repo-relative or absolute path for scope comparison.
 * - Collapses `.` / `..` segments
 * - Strips leading `./` and trailing slashes
 * - When `runRoot` is set, absolute paths must live under that root; otherwise
 *   they are treated as an escape attempt (returns {@link SCOPE_PATH_ESCAPE})
 */
export function normalizePath(path: string, runRoot?: string): string {
  let normalized = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized) return "";

  const root = runRoot?.trim().replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalized.startsWith("/")) {
    if (!root) {
      normalized = normalized.replace(/^\//, "");
    } else if (normalized === root) {
      normalized = "";
    } else if (normalized.startsWith(`${root}/`)) {
      normalized = normalized.slice(root.length + 1);
    } else {
      return SCOPE_PATH_ESCAPE;
    }
  }

  normalized = normalized.replace(/^\.\//, "");

  const parts = normalized.split("/").filter((part) => part.length > 0);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) return SCOPE_PATH_ESCAPE;
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

/**
 * Convert a glob (supporting `*`, `**`, `?`) into an anchored RegExp.
 * `*` matches within a single path segment; `**` matches across segments.
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // let `**/` collapse to `.*`
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Does a planned-file pattern cover `normalizedTarget`?
 * - a trailing slash marks a directory: matches the dir and everything beneath it
 * - `*` / `**` / `?` are treated as globs
 * - everything else is an exact (normalized) file match
 */
function patternMatches(
  rawPattern: string,
  normalizedTarget: string,
  runRoot?: string,
): boolean {
  const isDir = /\/\s*$/.test(rawPattern);
  const pattern = normalizePath(rawPattern, runRoot);
  if (pattern === SCOPE_PATH_ESCAPE || pattern.length === 0) return false;
  if (isDir) {
    return normalizedTarget === pattern || normalizedTarget.startsWith(`${pattern}/`);
  }
  if (/[*?]/.test(pattern)) {
    return globToRegExp(pattern).test(normalizedTarget);
  }
  return pattern === normalizedTarget;
}

class AgentScopeService {
  /** taskId -> planned file whitelist (only present for DevCouncil-planned tasks). */
  private scopeByTask = new Map<string, PlannedFile[]>();
  /** runId -> planned file whitelist, bound at run creation from the task's scope. */
  private scopeByRun = new Map<string, PlannedFile[]>();
  /** runId -> worktree/repo root used to resolve absolute paths for scope checks. */
  private runRoots = new Map<string, string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const taskScope =
      storageService.get<Record<string, PlannedFile[]>>(STORAGE_KEYS.AGENT_SCOPE_BY_TASK, {}) ?? {};
    const runScope =
      storageService.get<Record<string, PlannedFile[]>>(STORAGE_KEYS.AGENT_SCOPE_BY_RUN, {}) ?? {};
    const runRoots =
      storageService.get<Record<string, string>>(STORAGE_KEYS.AGENT_SCOPE_RUN_ROOTS, {}) ?? {};

    this.scopeByTask = new Map(Object.entries(taskScope));
    this.scopeByRun = new Map(Object.entries(runScope));
    this.runRoots = new Map(Object.entries(runRoots));
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void storageService.set(
        STORAGE_KEYS.AGENT_SCOPE_BY_TASK,
        Object.fromEntries(this.scopeByTask),
      );
      void storageService.set(STORAGE_KEYS.AGENT_SCOPE_BY_RUN, Object.fromEntries(this.scopeByRun));
      void storageService.set(STORAGE_KEYS.AGENT_SCOPE_RUN_ROOTS, Object.fromEntries(this.runRoots));
    }, 250);
  }

  /**
   * Register (or clear) the planned-file scope for a task. An empty list
   * no-ops as a clear so tasks without DevCouncil planning stay unrestricted.
   */
  setScopeForTask(taskId: string, plannedFiles: PlannedFile[]): void {
    if (!plannedFiles || plannedFiles.length === 0) {
      this.scopeByTask.delete(taskId);
    } else {
      this.scopeByTask.set(taskId, plannedFiles);
    }
    this.schedulePersist();
  }

  /** Look up a task's scope (if any) and associate it with a freshly created run. */
  bindTaskScopeToRun(runId: string, taskId: string): void {
    const scope = this.scopeByTask.get(taskId);
    if (!scope || scope.length === 0) {
      this.scopeByRun.delete(runId);
    } else {
      this.scopeByRun.set(runId, scope);
    }
    this.schedulePersist();
  }

  /** Register the run's worktree/repo root for absolute-path normalization. */
  setRunRoot(runId: string, rootDir: string | undefined): void {
    if (!rootDir?.trim()) {
      this.runRoots.delete(runId);
    } else {
      this.runRoots.set(runId, rootDir.trim());
    }
    this.schedulePersist();
  }

  /** Look up a task's planned scope (empty when unrestricted). */
  getScopeForTask(taskId: string): PlannedFile[] {
    return this.scopeByTask.get(taskId) ?? [];
  }

  /** Clear a run's scope binding on run cleanup so maps don't leak across runs. */
  clearScopeForRun(runId: string): void {
    this.scopeByRun.delete(runId);
    this.runRoots.delete(runId);
    this.schedulePersist();
  }

  /** True if any scope is registered for this run (used only for diagnostics/tests). */
  hasScopeForRun(runId: string): boolean {
    return this.scopeByRun.has(runId);
  }

  /**
   * Check whether a write/delete on `filePath` is allowed for `runId`.
   * A run with no registered scope is always in-scope (backward-compatible
   * default — most tasks aren't DevCouncil-planned).
   */
  checkPath(
    runId: string,
    filePath: string,
    operation: "write" | "delete" = "write",
  ): ScopeCheckResult {
    const scope = this.scopeByRun.get(runId);
    if (!scope || scope.length === 0) {
      return { inScope: true };
    }

    const runRoot = this.runRoots.get(runId);
    const normalizedTarget = normalizePath(filePath, runRoot);
    if (normalizedTarget === SCOPE_PATH_ESCAPE) {
      return {
        inScope: false,
        reason: `${filePath} resolves outside the run workspace root.`,
      };
    }

    const entry =
      scope.find((f) => normalizePath(f.path, runRoot) === normalizedTarget) ??
      scope.find((f) => patternMatches(f.path, normalizedTarget, runRoot));

    if (!entry) {
      return {
        inScope: false,
        reason: `${filePath} is outside the DevCouncil plan's file whitelist for this task.`,
      };
    }

    if (entry.allowedChange === "read_only") {
      return {
        inScope: false,
        reason: `${filePath} is planned as read-only (${entry.reason}); writes are not allowed.`,
      };
    }

    if (operation === "delete" && entry.allowedChange !== "delete") {
      return {
        inScope: false,
        reason: `${filePath} is planned as "${entry.allowedChange}", not delete (${entry.reason}).`,
      };
    }

    return { inScope: true };
  }

  /** Test-only reset of persisted scope state. */
  resetForTests(): void {
    this.scopeByTask.clear();
    this.scopeByRun.clear();
    this.runRoots.clear();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }
}

export const agentScopeService = new AgentScopeService();
export default agentScopeService;
