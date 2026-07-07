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
 */

export interface PlannedFile {
  path: string;
  reason: string;
  allowedChange: "create" | "modify" | "delete" | "read_only";
}

export interface ScopeCheckResult {
  inScope: boolean;
  reason?: string;
}

/** Strip leading './', normalize backslashes, and drop trailing slashes. */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
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
 *
 * This is the "glob-aware" half of scope enforcement: a plan that scopes a
 * subsystem (`src/services/agents/`) or a file group (`src/services/*.ts`) no
 * longer reverts sibling edits the planner clearly intended.
 */
function patternMatches(rawPattern: string, normalizedTarget: string): boolean {
  const isDir = /\/\s*$/.test(rawPattern);
  const pattern = normalizePath(rawPattern);
  if (pattern.length === 0) return false;
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

  /**
   * Register (or clear) the planned-file scope for a task. An empty list
   * no-ops as a clear so tasks without DevCouncil planning stay unrestricted.
   */
  setScopeForTask(taskId: string, plannedFiles: PlannedFile[]): void {
    if (!plannedFiles || plannedFiles.length === 0) {
      this.scopeByTask.delete(taskId);
      return;
    }
    this.scopeByTask.set(taskId, plannedFiles);
  }

  /** Look up a task's scope (if any) and associate it with a freshly created run. */
  bindTaskScopeToRun(runId: string, taskId: string): void {
    const scope = this.scopeByTask.get(taskId);
    if (!scope || scope.length === 0) {
      this.scopeByRun.delete(runId);
      return;
    }
    this.scopeByRun.set(runId, scope);
  }

  /** Clear a run's scope binding on run cleanup so maps don't leak across runs. */
  clearScopeForRun(runId: string): void {
    this.scopeByRun.delete(runId);
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

    const normalizedTarget = normalizePath(filePath);
    // Prefer an exact file match (most specific — preserves a file's read_only /
    // delete intent) before falling back to directory- and glob-scoped entries.
    const entry =
      scope.find((f) => normalizePath(f.path) === normalizedTarget) ??
      scope.find((f) => patternMatches(f.path, normalizedTarget));

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
}

export const agentScopeService = new AgentScopeService();
export default agentScopeService;
