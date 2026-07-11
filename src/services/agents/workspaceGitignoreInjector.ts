/**
 * Idempotent LiquiTask agent-workspace `.gitignore` block for user repos.
 *
 * Mirrors the `workspaceSkillsInjector` split: pure plan builder (unit-testable)
 * plus a thin desktop bridge that calls the Rust merge command. Off-desktop →
 * no-op. Does not add blanket `*.db` / `*.sqlite` — DevCouncil DB ignores are
 * scoped to `.devcouncil/*.db` only.
 */
import { getDesktopApi, isTauri } from "../../runtime/runtimeEnvironment";

export const GITIGNORE_BLOCK_BEGIN = "# BEGIN LiquiTask agent workspace v1";
export const GITIGNORE_BLOCK_END = "# END LiquiTask agent workspace";

/** Gitignore lines inside the managed block (excluding markers). */
export const WORKSPACE_GITIGNORE_PATTERNS: readonly string[] = [
  ".devcouncil/*",
  "!.devcouncil/",
  "!.devcouncil/config.yaml",
  "!.devcouncil/graphify.yaml",
  ".devcouncil/*.db",
  ".worktrees/",
  ".agents/",
  ".codex/",
  ".aider*",
  ".claude*",
  ".openhands/",
  ".opencode/",
  ".conducor/",
  ".antigravity/",
  ".warp/",
  "log/",
  "logs/",
  "tmp/",
  "temp/",
  ".tmp/",
  ".temp/",
  "scratch/",
  "dumps/",
  "*.tmp",
  "*.temp",
  "*.dmp",
  "*.bak",
  "*.swp",
  "__pycache__/",
  "*.py[cod]",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
];

export interface WorkspaceGitignoreResult {
  updated: boolean;
  skipped?: "unavailable" | "no-workspace" | "unchanged";
}

/** Render the full marked block (BEGIN … patterns … END). */
export function buildWorkspaceGitignoreBlock(): string {
  return [GITIGNORE_BLOCK_BEGIN, ...WORKSPACE_GITIGNORE_PATTERNS, GITIGNORE_BLOCK_END].join("\n");
}

/**
 * Ensure the LiquiTask agent-workspace block is present in the repo's
 * `.gitignore`. Best-effort: failures are swallowed by callers.
 */
export async function ensureWorkspaceGitignore(
  workingDir: string,
): Promise<WorkspaceGitignoreResult> {
  if (!workingDir) return { updated: false, skipped: "no-workspace" };
  const api = getDesktopApi();
  if (!isTauri() || !api) return { updated: false, skipped: "unavailable" };

  const block = buildWorkspaceGitignoreBlock();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ updated: boolean }>("agent_git_ensure_workspace_gitignore", {
      workingDir,
      block,
    });
    return result.updated ? { updated: true } : { updated: false, skipped: "unchanged" };
  } catch (err) {
    console.warn("[gitignore-inject] failed:", err);
    return { updated: false, skipped: "unchanged" };
  }
}
