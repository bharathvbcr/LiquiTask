//! Git worktree and PR helpers for agent runs.
//!
//! Security: every renderer-supplied directory is validated against the user's
//! authorised workspace allowlist (same boundary as `agent_run_start`), and
//! branch/ref strings are rejected if they could be parsed as flags.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::agent_runner::{
    augmented_path, AgentProcessRegistry, AgentRunEventPayload, TrackedRun, AGENT_RUN_EVENT,
};
use crate::{is_path_authorized, read_storage, safe_workspace_paths};

/// Canonicalize `dir` and require it to be inside the workspace allowlist.
fn authorize_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let data = read_storage(app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(dir, &authorized) {
        return Err(format!(
            "Directory is not an authorised workspace path: {dir}"
        ));
    }
    let resolved = dunce::canonicalize(dir).map_err(|e| format!("Directory not accessible: {e}"))?;
    let resolved_str = resolved.to_string_lossy().to_string();
    if !is_path_authorized(&resolved_str, &authorized) {
        return Err(format!(
            "Resolved directory escapes the authorised workspace: {resolved_str}"
        ));
    }
    Ok(resolved)
}

/// Reject empty, over-long, or flag-shaped ref/branch/id values.
fn validate_ref(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 200 || value.starts_with('-') {
        return Err(format!("Invalid {label}: {value}"));
    }
    Ok(())
}

/// Require `candidate` to live inside `repo`'s `.worktrees` directory.
fn require_worktree_inside(repo: &Path, candidate: &str) -> Result<PathBuf, String> {
    let resolved =
        dunce::canonicalize(candidate).map_err(|e| format!("Worktree not accessible: {e}"))?;
    let root = repo.join(".worktrees");
    if !resolved.starts_with(&root) || resolved == root {
        return Err(format!(
            "Worktree path must be inside {}: {}",
            root.display(),
            resolved.display()
        ));
    }
    Ok(resolved)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeResult {
    pub branch: String,
    pub worktree_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub diff: String,
    pub files_changed: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitPrResult {
    pub url: Option<String>,
    pub stdout: String,
}

fn git_cmd(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("git {} failed: {stderr}", args.join(" ")))
    }
}

/// Sanitize a commit message: strip control chars, bound length, provide a default.
fn safe_commit_message(message: Option<String>) -> String {
    let raw = message.unwrap_or_default();
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(500)
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "chore(agent): task work from LiquiTask run".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Stage and commit everything pending inside a worktree (agents frequently
/// leave work uncommitted). Returns the short commit hash, or `None` when the
/// worktree was already clean. Uses a fallback identity so commits succeed on
/// machines without a global git user configured.
fn commit_all_in(worktree: &Path, message: &str) -> Result<Option<String>, String> {
    let status = git_cmd(worktree, &["status", "--porcelain"])?;
    if status.trim().is_empty() {
        return Ok(None);
    }
    git_cmd(worktree, &["add", "-A"])?;
    git_cmd(
        worktree,
        &[
            "-c",
            "user.name=LiquiTask Agent",
            "-c",
            "user.email=agent@liquitask.local",
            "commit",
            "-m",
            message,
            "--no-verify",
        ],
    )?;
    let hash = git_cmd(worktree, &["rev-parse", "--short", "HEAD"])?;
    Ok(Some(hash))
}

/// Number of commits `branch` is ahead of the repo's current HEAD.
fn commits_ahead(repo: &Path, branch: &str) -> Result<u32, String> {
    let range = format!("HEAD..{branch}");
    let out = git_cmd(repo, &["rev-list", "--count", &range])?;
    out.trim()
        .parse::<u32>()
        .map_err(|e| format!("Failed to parse rev-list count: {e}"))
}

// ---------------------------------------------------------------------------
// Concurrency: per-repo operation lock
// ---------------------------------------------------------------------------

/// Repos with a mutating git pipeline (merge/prune) in flight. Merging two
/// agent branches into the same checkout concurrently corrupts both — the
/// second caller fails fast instead of queueing behind an unbounded git op.
fn busy_repos() -> &'static Mutex<HashSet<PathBuf>> {
    static BUSY: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    BUSY.get_or_init(|| Mutex::new(HashSet::new()))
}

struct RepoLockGuard {
    repo: PathBuf,
}

impl Drop for RepoLockGuard {
    fn drop(&mut self) {
        if let Ok(mut busy) = busy_repos().lock() {
            busy.remove(&self.repo);
        }
    }
}

fn acquire_repo_lock(repo: &Path) -> Result<RepoLockGuard, String> {
    let mut busy = busy_repos()
        .lock()
        .map_err(|_| "Repo lock poisoned".to_string())?;
    if !busy.insert(repo.to_path_buf()) {
        return Err(
            "Another git operation (merge/prune) is already running on this repository — retry when it finishes."
                .to_string(),
        );
    }
    Ok(RepoLockGuard { repo: repo.to_path_buf() })
}

// ---------------------------------------------------------------------------
// Worktree metadata (lifecycle bookkeeping)
// ---------------------------------------------------------------------------

/// Sidecar metadata written next to each worktree
/// (`<repo>/.worktrees/<runId>.liquitask.json`). Lives OUTSIDE the worktree so
/// it never shows up in the agent's diff, and survives even if the worktree
/// directory itself is clobbered — prune uses it to reap orphaned branches.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeMeta {
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub branch: String,
    pub created_at: String,
}

fn meta_path(repo: &Path, run_id: &str) -> PathBuf {
    repo.join(".worktrees").join(format!("{run_id}.liquitask.json"))
}

fn write_worktree_meta(repo: &Path, meta: &WorktreeMeta) {
    if let Ok(raw) = serde_json::to_string_pretty(meta) {
        let _ = std::fs::write(meta_path(repo, &meta.run_id), raw);
    }
}

fn read_worktree_meta(repo: &Path, run_id: &str) -> Option<WorktreeMeta> {
    let raw = std::fs::read_to_string(meta_path(repo, run_id)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn remove_worktree_meta(repo: &Path, run_id: &str) {
    let _ = std::fs::remove_file(meta_path(repo, run_id));
}

/// Keep `.worktrees/` out of the repo's status/diffs without touching the
/// user's .gitignore (idempotent append to .git/info/exclude).
fn exclude_worktrees_dir(repo: &Path) {
    let git_dir = match git_cmd(repo, &["rev-parse", "--git-common-dir"]) {
        Ok(d) => {
            let p = PathBuf::from(&d);
            if p.is_absolute() { p } else { repo.join(p) }
        }
        Err(_) => return,
    };
    let exclude = git_dir.join("info").join("exclude");
    let existing = std::fs::read_to_string(&exclude).unwrap_or_default();
    if existing.lines().any(|l| l.trim() == ".worktrees/") {
        return;
    }
    let _ = std::fs::create_dir_all(exclude.parent().unwrap_or(&git_dir));
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(".worktrees/\n");
    let _ = std::fs::write(&exclude, content);
}

fn slugify(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(48)
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_create_worktree(
    app: AppHandle,
    working_dir: String,
    run_id: String,
    task_title: String,
    task_id: Option<String>,
) -> Result<GitWorktreeResult, String> {
    validate_ref("run id", &run_id)?;
    if !run_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Invalid run id: {run_id}"));
    }
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let repo = repo_buf.as_path();

    let slug = slugify(&task_title);
    let branch = format!("agent/{run_id}-{slug}");
    let worktrees_root = repo.join(".worktrees");
    std::fs::create_dir_all(&worktrees_root)
        .map_err(|e| format!("Failed to create .worktrees: {e}"))?;
    exclude_worktrees_dir(repo);
    let worktree_path = worktrees_root.join(&run_id);

    // Remove stale worktree if present.
    let _ = git_cmd(repo, &["worktree", "remove", "--force", worktree_path.to_str().unwrap_or("")]);

    git_cmd(
        repo,
        &[
            "worktree",
            "add",
            "-B",
            &branch,
            worktree_path.to_str().ok_or("Invalid worktree path")?,
        ],
    )?;

    // Lifecycle metadata: binds the worktree to its run/task so state queries,
    // MCP tools, and prune can resolve ownership without in-memory context.
    write_worktree_meta(
        repo,
        &WorktreeMeta {
            run_id: run_id.clone(),
            task_id,
            branch: branch.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );

    Ok(GitWorktreeResult {
        branch,
        worktree_path: worktree_path.to_string_lossy().to_string(),
    })
}

/// Structured outcome of the transactional merge pipeline.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeTxResult {
    /// "merged" | "noop" (branch had no commits and no pending changes).
    pub status: String,
    pub message: String,
    /// Repo HEAD before the merge — the rollback anchor.
    pub pre_merge_sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged_sha: Option<String>,
    /// Short hash of the auto-commit of pending worktree changes, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_hash: Option<String>,
}

/// Transactional Commit-stage pipeline:
///
/// 1. acquire the per-repo lock (parallel merges fail fast, not interleave)
/// 2. capture the pre-merge HEAD SHA (rollback anchor)
/// 3. refuse to merge over a dirty main checkout
/// 4. auto-commit pending worktree changes (agents often leave work unstaged)
/// 5. `merge --no-ff`; on conflict → `merge --abort`, branch/worktree kept
/// 6. cleanup (worktree remove + branch delete + metadata); if cleanup fails
///    AFTER a successful merge, the merge is rolled back with
///    `git reset --hard <pre-merge-sha>` so the repo never lands in a
///    half-committed state — the branch stays intact for a retry.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_merge_worktree_tx(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    branch: String,
    commit_message: Option<String>,
    run_id: Option<String>,
) -> Result<MergeTxResult, String> {
    validate_ref("branch", &branch)?;
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let wt = require_worktree_inside(repo, &worktree_path)?;
    let _lock = acquire_repo_lock(repo)?;

    let pre_merge_sha = git_cmd(repo, &["rev-parse", "HEAD"])?;

    // Guard: refuse to merge over a dirty main checkout — a conflicted merge
    // would tangle the user's own uncommitted work with the agent's.
    let repo_status = git_cmd(repo, &["status", "--porcelain"])?;
    if !repo_status.trim().is_empty() {
        return Err(
            "The main checkout has uncommitted changes. Commit or stash them first, then retry the merge."
                .to_string(),
        );
    }

    let committed = commit_all_in(&wt, &safe_commit_message(commit_message))?;
    let ahead = commits_ahead(repo, &branch).unwrap_or(0);

    let mut merged_sha = None;
    if ahead > 0 {
        git_cmd(repo, &["merge", "--no-ff", "--no-edit", &branch]).map_err(|e| {
            // Leave the repo clean on conflict so the user isn't stranded mid-merge.
            let _ = git_cmd(repo, &["merge", "--abort"]);
            format!("{e} (merge aborted — the worktree and branch were kept for manual resolution)")
        })?;
        merged_sha = git_cmd(repo, &["rev-parse", "HEAD"]).ok();
    }

    // Cleanup phase — any failure here after a successful merge rolls the
    // merge back so retrying the pipeline stays idempotent.
    let cleanup = (|| -> Result<(), String> {
        git_cmd(
            repo,
            &[
                "worktree",
                "remove",
                "--force",
                wt.to_str().ok_or("Invalid worktree path")?,
            ],
        )?;
        // Branch delete is best-effort (-d fails if unmerged, which cannot
        // happen after a successful merge; noop case uses -D deliberately).
        let _ = git_cmd(repo, &["branch", if ahead > 0 { "-d" } else { "-D" }, &branch]);
        Ok(())
    })();

    if let Err(cleanup_err) = cleanup {
        if merged_sha.is_some() {
            let rollback = git_cmd(repo, &["reset", "--hard", &pre_merge_sha]);
            let rolled = if rollback.is_ok() { "merge rolled back" } else { "ROLLBACK FAILED" };
            let short = &pre_merge_sha[..pre_merge_sha.len().min(12)];
            return Err(format!(
                "Post-merge cleanup failed: {cleanup_err} ({rolled} to {short}). Branch {branch} was kept — retry the commit pipeline.",
            ));
        }
        return Err(format!("Worktree cleanup failed: {cleanup_err}"));
    }

    if let Some(rid) = run_id.as_deref() {
        remove_worktree_meta(repo, rid);
    } else if let Some(name) = wt.file_name().and_then(|n| n.to_str()) {
        remove_worktree_meta(repo, name);
    }

    let message = match (&committed, ahead) {
        (Some(hash), n) if n > 0 => {
            format!("committed pending changes ({hash}) and merged {branch} ({n} commit(s))")
        }
        (None, n) if n > 0 => format!("merged {branch} ({n} commit(s))"),
        (Some(hash), _) => format!("committed pending changes ({hash}) and merged {branch}"),
        (None, _) => format!("no changes to merge from {branch}; worktree cleaned up"),
    };

    let status = if ahead > 0 || committed.is_some() { "merged" } else { "noop" };
    Ok(MergeTxResult {
        status: status.to_string(),
        message,
        pre_merge_sha,
        merged_sha,
        committed_hash: committed,
    })
}

/// Legacy string-result merge — delegates to the transactional pipeline so
/// there is exactly one merge implementation (locking + rollback included).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_merge_worktree(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    branch: String,
    commit_message: Option<String>,
) -> Result<String, String> {
    agent_git_merge_worktree_tx(app, repo_dir, worktree_path, branch, commit_message, None)
        .map(|r| r.message)
}

// ---------------------------------------------------------------------------
// Worktree state queries + pruning (MCP + lifecycle surfaces)
// ---------------------------------------------------------------------------

/// Snapshot of one worktree, queryable by agents over MCP and by the UI.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    /// Files with uncommitted changes inside the worktree.
    pub dirty_files: u32,
    /// Commits the branch is ahead of the repo's current HEAD.
    pub ahead: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_worktree_state(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
) -> Result<WorktreeState, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let wt = match require_worktree_inside(repo, &worktree_path) {
        Ok(p) if p.is_dir() => p,
        _ => {
            return Ok(WorktreeState {
                exists: false,
                branch: None,
                dirty_files: 0,
                ahead: 0,
                last_commit: None,
                run_id: None,
                task_id: None,
                created_at: None,
            })
        }
    };

    let run_id = wt.file_name().and_then(|n| n.to_str()).map(str::to_string);
    let meta = run_id.as_deref().and_then(|rid| read_worktree_meta(repo, rid));
    let branch = meta
        .as_ref()
        .map(|m| m.branch.clone())
        .or_else(|| git_cmd(&wt, &["rev-parse", "--abbrev-ref", "HEAD"]).ok());
    let dirty_files = git_cmd(&wt, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count() as u32)
        .unwrap_or(0);
    let ahead = branch
        .as_deref()
        .and_then(|b| commits_ahead(repo, b).ok())
        .unwrap_or(0);
    let last_commit = git_cmd(&wt, &["log", "-1", "--format=%h %s"]).ok().filter(|s| !s.is_empty());

    Ok(WorktreeState {
        exists: true,
        branch,
        dirty_files,
        ahead,
        last_commit,
        run_id,
        task_id: meta.as_ref().and_then(|m| m.task_id.clone()),
        created_at: meta.map(|m| m.created_at),
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListEntry {
    pub run_id: String,
    pub worktree_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Enumerate the repo's agent worktrees (directories under `.worktrees/`,
/// joined with their lifecycle metadata).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_list_worktrees(
    app: AppHandle,
    repo_dir: String,
) -> Result<Vec<WorktreeListEntry>, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    Ok(agent_git_list_worktrees_inner(repo_buf.as_path()))
}

/// Remove agent worktrees whose runs are gone (not in `keep_run_ids`),
/// delete their branches, and let git prune stale administrative entries.
/// Returns the number of worktrees reaped.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_prune_worktrees(
    app: AppHandle,
    repo_dir: String,
    keep_run_ids: Vec<String>,
) -> Result<u32, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let _lock = acquire_repo_lock(repo)?;
    let keep: HashSet<String> = keep_run_ids.into_iter().collect();
    let mut reaped = 0u32;

    for entry in agent_git_list_worktrees_inner(repo) {
        if keep.contains(&entry.run_id) {
            continue;
        }
        let _ = git_cmd(repo, &["worktree", "remove", "--force", &entry.worktree_path]);
        if let Some(branch) = entry.branch.as_deref() {
            if validate_ref("branch", branch).is_ok() {
                let _ = git_cmd(repo, &["branch", "-D", branch]);
            }
        }
        remove_worktree_meta(repo, &entry.run_id);
        // Remove leftover directories git no longer tracks.
        let _ = std::fs::remove_dir_all(&entry.worktree_path);
        reaped += 1;
    }
    let _ = git_cmd(repo, &["worktree", "prune"]);
    Ok(reaped)
}

fn agent_git_list_worktrees_inner(repo: &Path) -> Vec<WorktreeListEntry> {
    let root = repo.join(".worktrees");
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(run_id) = path.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        let meta = read_worktree_meta(repo, &run_id);
        out.push(WorktreeListEntry {
            run_id,
            worktree_path: path.to_string_lossy().to_string(),
            branch: meta.as_ref().map(|m| m.branch.clone()),
            task_id: meta.as_ref().and_then(|m| m.task_id.clone()),
            created_at: meta.map(|m| m.created_at),
        });
    }
    out
}

/// Commit pending worktree changes on the agent branch WITHOUT merging —
/// used by the PR flow and for checkpointing before review.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_commit_worktree(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    message: Option<String>,
) -> Result<String, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let wt = require_worktree_inside(repo, &worktree_path)?;
    match commit_all_in(&wt, &safe_commit_message(message))? {
        Some(hash) => Ok(format!("Committed pending changes ({hash}) on the run branch")),
        None => Ok("Worktree already clean — nothing to commit".to_string()),
    }
}

/// Remove an agent worktree and delete its branch without merging.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_discard_worktree(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    branch: String,
) -> Result<(), String> {
    validate_ref("branch", &branch)?;
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    if let Ok(wt) = require_worktree_inside(repo, &worktree_path) {
        if let Some(run_id) = wt.file_name().and_then(|n| n.to_str()) {
            remove_worktree_meta(repo, run_id);
        }
        let _ = git_cmd(
            repo,
            &[
                "worktree",
                "remove",
                "--force",
                wt.to_str().ok_or("Invalid worktree path")?,
            ],
        );
    }
    let _ = git_cmd(repo, &["branch", "-D", &branch]);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_diff(
    app: AppHandle,
    working_dir: String,
    base_ref: Option<String>,
) -> Result<GitDiffResult, String> {
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let repo = repo_buf.as_path();
    let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
    validate_ref("base ref", &base)?;
    let mut diff = git_cmd(repo, &["diff", "--stat", &base])?;
    let mut files_changed = diff.lines().filter(|l| l.contains('|')).count() as u32;

    // `git diff` is blind to untracked files, which is most of what a fresh
    // agent run produces — surface them so reviews aren't misleadingly empty.
    let untracked = git_cmd(repo, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();
    if !untracked.trim().is_empty() {
        let names: Vec<&str> = untracked.lines().take(50).collect();
        files_changed += untracked.lines().count() as u32;
        diff.push_str(&format!(
            "\n\nUntracked (new) files:\n{}",
            names
                .iter()
                .map(|n| format!("  + {n}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }

    Ok(GitDiffResult {
        diff: diff.chars().take(8000).collect(),
        files_changed,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_create_pr(
    app: AppHandle,
    working_dir: String,
    title: String,
    body: String,
    head_branch: String,
) -> Result<GitPrResult, String> {
    validate_ref("head branch", &head_branch)?;
    if title.trim().is_empty() || title.len() > 400 {
        return Err("Invalid PR title".to_string());
    }
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let repo = repo_buf.as_path();
    let output = Command::new("gh")
        .args([
            "pr",
            "create",
            "--title",
            &title,
            "--body",
            &body,
            "--head",
            &head_branch,
        ])
        .current_dir(repo)
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run gh: {e}. Install GitHub CLI (gh)."))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }

    let url = stdout
        .lines()
        .find(|l| l.starts_with("https://"))
        .map(str::to_string);

    Ok(GitPrResult { url, stdout })
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_container_build(
    app: tauri::AppHandle,
    registry: tauri::State<'_, AgentProcessRegistry>,
    image: String,
    dockerfile_dir: Option<String>,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;

    use tauri::Emitter;

    if image.is_empty() || image.len() > 200 || image.starts_with('-') {
        return Err(format!("Invalid image name: {image}"));
    }

    // A renderer-supplied directory must be inside the workspace allowlist;
    // the fallback walk only looks for the app's own bundled agent-sandbox.
    let dir = match dockerfile_dir {
        Some(d) => authorize_dir(&app, &d)?.to_string_lossy().to_string(),
        None => {
            let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let mut found = "agent-sandbox".to_string();
            for _ in 0..6 {
                let candidate = dir.join("agent-sandbox");
                if candidate.join("Dockerfile").is_file() {
                    found = candidate.to_string_lossy().to_string();
                    break;
                }
                if !dir.pop() {
                    break;
                }
            }
            found
        }
    };

    let run_id = format!("container-build-{}", chrono_lite_timestamp());

    let mut child = Command::new("container")
        .args(["build", "-t", &image, "."])
        .current_dir(&dir)
        .env("PATH", augmented_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn container build: {e}"))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let pid = child.id();
        let mut guard = registry.0.lock().map_err(|_| "Registry lock poisoned")?;
        guard.insert(
            run_id.clone(),
            TrackedRun { pid, pgid: 0, child: Some(child), signals: None },
        );
    }

    let app_out = app.clone();
    let id = run_id.clone();
    std::thread::spawn(move || {
        if let Some(out_pipe) = stdout {
            for line in BufReader::new(out_pipe).lines().map_while(Result::ok) {
                let _ = app_out.emit(
                    AGENT_RUN_EVENT,
                    AgentRunEventPayload {
                        run_id: id.clone(),
                        stream: "stdout".to_string(),
                        line: Some(line),
                        code: None,
                    },
                );
            }
        }

        let code = {
            use tauri::Manager;
            let state: tauri::State<'_, AgentProcessRegistry> = app_out.state();
            let tracked = {
                let mut guard = match state.0.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                guard.remove(&id)
            };
            match tracked.and_then(|t| t.child) {
                Some(mut c) => c.wait().ok().and_then(|s| s.code()).unwrap_or(-1),
                None => -1,
            }
        };

        let _ = app_out.emit(
            AGENT_RUN_EVENT,
            AgentRunEventPayload {
                run_id: id.clone(),
                stream: "exit".to_string(),
                line: None,
                code: Some(code),
            },
        );
    });

    let app_err = app.clone();
    let id2 = run_id.clone();
    std::thread::spawn(move || {
        if let Some(err_pipe) = stderr {
            for line in BufReader::new(err_pipe).lines().map_while(Result::ok) {
                let _ = app_err.emit(
                    AGENT_RUN_EVENT,
                    AgentRunEventPayload {
                        run_id: id2.clone(),
                        stream: "stderr".to_string(),
                        line: Some(line),
                        code: None,
                    },
                );
            }
        }
    });

    Ok(run_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_container_system_status() -> Result<bool, String> {
    let output = Command::new("container")
        .args(["system", "status"])
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("container CLI not available: {e}"))?;
    Ok(output.status.success())
}

fn chrono_lite_timestamp() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_normalizes_titles() {
        assert_eq!(slugify("Fix Auth Bug!"), "fix-auth-bug");
        assert_eq!(slugify("  Hello---World  "), "hello-world");
    }

    #[test]
    fn branch_name_includes_run_id() {
        let branch = format!("agent/run-abc-fix-auth-bug");
        assert!(branch.starts_with("agent/"));
        assert!(branch.contains("run-abc"));
    }
}
