//! Git worktree and PR helpers for agent runs.
//!
//! Security: every renderer-supplied directory is validated against the user's
//! authorised workspace allowlist (same boundary as `agent_run_start`), and
//! branch/ref strings are rejected if they could be parsed as flags.

use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::agent_cli_util::augmented_path;
use crate::agent_council_runner::{
    AgentProcessRegistry, AgentRunEventPayload, TrackedRun, AGENT_RUN_EVENT,
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

/// Reject path traversal and absolute paths for repo-relative file lookups.
fn validate_repo_relative_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 500 || path.starts_with('-') || path.contains('\0') {
        return Err(format!("Invalid file path: {path}"));
    }
    if path.contains("..") || Path::new(path).is_absolute() {
        return Err(format!("File path must be repo-relative: {path}"));
    }
    Ok(())
}

/// Require `candidate` to live inside `repo`'s `.worktrees` directory.
/// Both paths are canonicalized so a symlinked `.worktrees` cannot escape the repo.
fn require_worktree_inside(repo: &Path, candidate: &str) -> Result<PathBuf, String> {
    let resolved =
        dunce::canonicalize(candidate).map_err(|e| format!("Worktree not accessible: {e}"))?;
    let root = dunce::canonicalize(repo.join(".worktrees"))
        .map_err(|e| format!("Worktrees root not accessible: {e}"))?;
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
pub struct GitChangedFile {
    pub path: String,
    /// One of: modified, added, deleted, renamed, untracked.
    pub status: String,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFilesResult {
    pub files: Vec<GitChangedFile>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiffResult {
    pub path: String,
    pub diff: String,
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

/// Paths that must never be auto-staged during the merge pipeline.
fn is_high_risk_stage_path(path: &str) -> bool {
    let p = path.trim_start_matches("./");
    if p.is_empty() {
        return false;
    }
    let lower = p.to_ascii_lowercase();
    if lower.starts_with(".env") || lower == ".env" {
        return true;
    }
    if lower.ends_with(".pem") || lower.ends_with(".key") || lower.ends_with(".p12") {
        return true;
    }
    if lower.contains("id_rsa") || lower.contains("credentials") {
        return true;
    }
    if lower.starts_with("node_modules/") || lower == "node_modules" {
        return true;
    }
    false
}

fn repo_has_gitignore(worktree: &Path) -> bool {
    worktree.join(".gitignore").is_file()
        || git_cmd(worktree, &["rev-parse", "--show-toplevel"])
            .ok()
            .and_then(|top| {
                let root = PathBuf::from(top);
                Some(root.join(".gitignore").is_file())
            })
            .unwrap_or(false)
}

/// Refuse to stage secrets/junk when `.gitignore` is absent.
fn validate_staging_safe(worktree: &Path, status: &str) -> Result<(), String> {
    let has_ignore = repo_has_gitignore(worktree);
    for line in status.lines() {
        if line.len() < 4 {
            continue;
        }
        let path = line[3..].split(" -> ").next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }
        if is_high_risk_stage_path(path) && !has_ignore {
            return Err(format!(
                "Refusing to auto-commit high-risk path {path:?} — add a .gitignore or commit manually."
            ));
        }
    }
    Ok(())
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
    validate_staging_safe(worktree, &status)?;
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

/// Refuse to reap worktrees that still hold uncommitted work or unpushed commits.
fn worktree_prune_blocked(worktree: &Path, repo: &Path, branch: Option<&str>) -> bool {
    match git_cmd(worktree, &["status", "--porcelain"]) {
        Ok(s) if s.lines().any(|l| !l.trim().is_empty()) => return true,
        Err(_) => return true,
        _ => {}
    }
    if let Some(branch) = branch {
        match commits_ahead(repo, branch) {
            Ok(n) if n > 0 => return true,
            Err(_) => return true,
            _ => {}
        }
    }
    false
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

fn acquire_repo_lock(repo: &Path) -> Result<(RepoLockGuard, CrossProcessRepoLock), String> {
    let cross = acquire_cross_process_lock(repo)?;
    let mut busy = busy_repos()
        .lock()
        .map_err(|_| "Repo lock poisoned".to_string())?;
    if !busy.insert(repo.to_path_buf()) {
        return Err(
            "Another git operation (merge/prune) is already running on this repository — retry when it finishes."
                .to_string(),
        );
    }
    Ok((RepoLockGuard { repo: repo.to_path_buf() }, cross))
}

// ---------------------------------------------------------------------------
// Cross-process repo lock (survives across LiquiTask instances)
// ---------------------------------------------------------------------------

/// Advisory lock file under `<repo>/.git/`. Held for the duration of a merge or
/// prune so an external git client cannot interleave with our pipeline.
struct CrossProcessRepoLock {
    _file: File,
}

/// Resolve the git common directory (handles worktree `.git` files and submodules).
fn resolve_git_common_dir(repo: &Path) -> Result<PathBuf, String> {
    let raw = git_cmd(repo, &["rev-parse", "--git-common-dir"])?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("Not a git repository: {}", repo.display()));
    }
    let p = PathBuf::from(trimmed);
    if p.is_absolute() {
        Ok(p)
    } else {
        Ok(repo.join(p))
    }
}

/// Refuse merge/push when the checkout is in a dangerous git state.
fn preflight_repo_for_mutation(repo: &Path) -> Result<(), String> {
    if git_cmd(repo, &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Err(
            "Repository has no commits yet — create an initial commit before merging agent work."
                .to_string(),
        );
    }
    if git_cmd(repo, &["symbolic-ref", "-q", "HEAD"]).is_err() {
        return Err(
            "Repository is in detached HEAD state — checkout a branch before merging agent work."
                .to_string(),
        );
    }
    if repo.join(".git").join("MERGE_HEAD").exists()
        || resolve_git_common_dir(repo)
            .ok()
            .is_some_and(|d| d.join("MERGE_HEAD").exists())
    {
        return Err(
            "Repository is mid-merge — resolve or abort the existing merge before retrying."
                .to_string(),
        );
    }
    if repo.join(".git").join("rebase-merge").exists()
        || repo.join(".git").join("rebase-apply").exists()
        || resolve_git_common_dir(repo)
            .ok()
            .is_some_and(|d| d.join("rebase-merge").exists() || d.join("rebase-apply").exists())
    {
        return Err(
            "Repository is mid-rebase — finish or abort the rebase before retrying."
                .to_string(),
        );
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct MergeInProgressJournal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    branch: String,
    worktree_path: String,
    pre_merge_sha: String,
    /// "committed" = worktree auto-commit done; "merged" = main merge succeeded.
    phase: String,
    started_at: String,
}

fn merge_journal_path(repo: &Path) -> PathBuf {
    repo.join(".worktrees").join(".merge-in-progress.json")
}

fn write_merge_journal(repo: &Path, entry: &MergeInProgressJournal) {
    let _ = std::fs::create_dir_all(repo.join(".worktrees"));
    if let Ok(raw) = serde_json::to_string_pretty(entry) {
        let _ = std::fs::write(merge_journal_path(repo), raw);
    }
}

fn clear_merge_journal(repo: &Path) {
    let _ = std::fs::remove_file(merge_journal_path(repo));
}

fn read_merge_journal(repo: &Path) -> Option<MergeInProgressJournal> {
    let raw = std::fs::read_to_string(merge_journal_path(repo)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Boot/recovery helper: if a prior merge tx died mid-flight, roll back or finish cleanup.
fn recover_merge_journal_inner(repo: &Path) -> Option<String> {
    let journal = read_merge_journal(repo)?;
    let head = git_cmd(repo, &["rev-parse", "HEAD"]).unwrap_or_default();
    let mut note = String::new();
    if journal.phase == "merged" && head != journal.pre_merge_sha {
        let _ = git_cmd(repo, &["reset", "--hard", &journal.pre_merge_sha]);
        note.push_str("Rolled back a stale post-merge state from a crashed merge tx. ");
    } else if journal.phase == "committed" && head == journal.pre_merge_sha {
        note.push_str(
            "Found a stale merge-in-progress journal (worktree commit completed, merge not started). ",
        );
    }
    clear_merge_journal(repo);
    Some(format!(
        "{note}Journal cleared for branch {} (run {:?}).",
        journal.branch, journal.run_id
    ))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_recover_merge_journal(
    app: AppHandle,
    repo_dir: String,
) -> Result<Option<String>, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    Ok(recover_merge_journal_inner(repo_buf.as_path()))
}

#[cfg(unix)]
fn acquire_cross_process_lock(repo: &Path) -> Result<CrossProcessRepoLock, String> {
    use std::os::unix::io::AsRawFd;

    let git_dir = resolve_git_common_dir(repo)?;
    if !git_dir.is_dir() {
        return Err(format!("Not a git repository: {}", repo.display()));
    }
    let lock_path = git_dir.join("liquitask-git.lock");
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| format!("Failed to open repo lock file: {e}"))?;
    let fd = file.as_raw_fd();
    let ret = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };
    if ret != 0 {
        return Err(
            "Another process holds the git operation lock on this repository — retry when it finishes."
                .to_string(),
        );
    }
    let _ = file.set_len(0);
    write!(file, "{}", std::process::id()).map_err(|e| format!("Failed to write repo lock file: {e}"))?;
    Ok(CrossProcessRepoLock { _file: file })
}

#[cfg(windows)]
fn acquire_cross_process_lock(repo: &Path) -> Result<CrossProcessRepoLock, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;

    let git_dir = resolve_git_common_dir(repo)?;
    if !git_dir.is_dir() {
        return Err(format!("Not a git repository: {}", repo.display()));
    }
    let lock_path = git_dir.join("liquitask-git.lock");
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| format!("Failed to open repo lock file: {e}"))?;
    let handle = HANDLE(file.as_raw_handle());
    let mut overlapped = unsafe { std::mem::zeroed() };
    unsafe {
        LockFileEx(
            handle,
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            u32::MAX,
            u32::MAX,
            Some(&mut overlapped),
        )
        .map_err(|_| {
            "Another process holds the git operation lock on this repository — retry when it finishes."
                .to_string()
        })?;
    }
    let _ = file.set_len(0);
    let pid = unsafe { GetCurrentProcessId() };
    write!(file, "{pid}").map_err(|e| format!("Failed to write repo lock file: {e}"))?;
    Ok(CrossProcessRepoLock { _file: file })
}

#[cfg(not(any(unix, windows)))]
fn acquire_cross_process_lock(_repo: &Path) -> Result<CrossProcessRepoLock, String> {
    Err("Cross-process git locks are not supported on this platform".to_string())
}

#[cfg(not(any(unix, windows)))]
struct CrossProcessRepoLock;

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
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    preflight_repo_for_mutation(repo)?;

    let slug = slugify(&task_title);
    let branch = format!("agent/{run_id}-{slug}");
    let worktrees_root = repo.join(".worktrees");
    std::fs::create_dir_all(&worktrees_root)
        .map_err(|e| format!("Failed to create .worktrees: {e}"))?;
    exclude_worktrees_dir(repo);
    let worktree_path = worktrees_root.join(&run_id);

    if git_cmd(repo, &["rev-parse", "--verify", &branch]).is_ok() {
        let owned = read_worktree_meta(repo, &run_id)
            .map(|m| m.branch == branch)
            .unwrap_or(false);
        if !owned {
            return Err(format!(
                "Branch {branch} already exists — refusing to reset it (collision safety)."
            ));
        }
    }

    if worktree_path.exists() {
        let _ = git_cmd(
            repo,
            &[
                "worktree",
                "remove",
                "--force",
                worktree_path.to_str().unwrap_or(""),
            ],
        );
    }

    let branch_exists = git_cmd(repo, &["rev-parse", "--verify", &branch]).is_ok();
    if branch_exists {
        git_cmd(
            repo,
            &[
                "worktree",
                "add",
                &branch,
                worktree_path.to_str().ok_or("Invalid worktree path")?,
            ],
        )?;
    } else {
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
    }

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

/// Label attached to the auto-stash so it's identifiable in `git stash list`.
const AUTO_STASH_LABEL: &str = "liquitask: auto-stash before agent merge";

/// Locate the stash entry created by our auto-stash (label-scoped), returning a
/// ref like `stash@{0}` suitable for `git stash pop stash@{N}`.
fn auto_stash_ref(repo: &Path) -> Option<String> {
    let list = git_cmd(repo, &["stash", "list"]).ok()?;
    for (i, line) in list.lines().enumerate() {
        if line.contains(AUTO_STASH_LABEL) {
            return Some(format!("stash@{{{i}}}"));
        }
    }
    None
}

/// Restore the pre-merge auto-stash, if one was taken. Returns a message suffix:
/// empty on a clean pop, or a note (never an error) when the pop conflicts — the
/// stash is durable and stays in `git stash list` for the user to pop manually,
/// so their uncommitted work is never lost.
///
/// SAFETY: only ever call this AFTER any `git reset --hard`/`merge --abort` in a
/// given path — popping first would let a later hard reset discard the applied
/// work while the stash entry is already gone.
fn restore_auto_stash(repo: &std::path::Path, stashed: bool) -> String {
    if !stashed {
        return String::new();
    }
    let Some(stash_ref) = auto_stash_ref(repo) else {
        return String::new();
    };
    match git_cmd(repo, &["stash", "pop", &stash_ref]) {
        Ok(_) => String::new(),
        Err(_) => {
            " Note: your uncommitted changes conflicted with the merge and were kept in the git \
             stash — run `git stash pop` to restore them."
                .to_string()
        }
    }
}

/// RAII guard: restores the auto-stash on every exit path unless already popped.
struct AutoStashGuard {
    repo: PathBuf,
    stashed: bool,
    restored: bool,
}

impl AutoStashGuard {
    fn new(repo: &Path, stashed: bool) -> Self {
        Self {
            repo: repo.to_path_buf(),
            stashed,
            restored: false,
        }
    }

    fn restore(&mut self) -> String {
        if self.stashed && !self.restored {
            self.restored = true;
            return restore_auto_stash(&self.repo, true);
        }
        String::new()
    }
}

impl Drop for AutoStashGuard {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

/// Transactional Commit-stage pipeline:
///
/// 1. acquire the per-repo lock (parallel merges fail fast, not interleave)
/// 2. capture the pre-merge HEAD SHA (rollback anchor)
/// 3. auto-stash the main checkout's uncommitted work (restored after the merge)
/// 4. auto-commit pending worktree changes (agents often leave work unstaged)
/// 5. `merge --no-ff`; on conflict → `merge --abort`, branch/worktree kept
/// 6. cleanup (worktree remove + branch delete + metadata); if cleanup fails
///    AFTER a successful merge, the merge is rolled back with
///    `git reset --hard <pre-merge-sha>` so the repo never lands in a
///    half-committed state — the branch stays intact for a retry.
/// 7. pop the auto-stash to restore the user's uncommitted work.
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
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    preflight_repo_for_mutation(repo)?;
    let _ = recover_merge_journal_inner(repo);

    let pre_merge_sha = git_cmd(repo, &["rev-parse", "HEAD"])?;

    let journal_base = MergeInProgressJournal {
        run_id: run_id.clone(),
        branch: branch.clone(),
        worktree_path: wt.to_string_lossy().to_string(),
        pre_merge_sha: pre_merge_sha.clone(),
        phase: "started".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
    };
    write_merge_journal(repo, &journal_base);

    // A dirty main checkout would tangle the user's uncommitted work into the
    // merge, so stash it first and restore it afterwards — the automated version
    // of the old "commit or stash them first" guidance. Untracked files are
    // included so nothing is left behind.
    let repo_status = git_cmd(repo, &["status", "--porcelain"])?;
    let stashed = !repo_status.trim().is_empty();
    if stashed {
        git_cmd(
            repo,
            &["stash", "push", "--include-untracked", "-m", AUTO_STASH_LABEL],
        )
        .map_err(|e| {
            format!("Couldn't stash the main checkout's uncommitted changes before merging: {e}")
        })?;
    }
    let mut stash_guard = AutoStashGuard::new(repo, stashed);

    let committed = commit_all_in(&wt, &safe_commit_message(commit_message))?;
    if committed.is_some() {
        write_merge_journal(
            repo,
            &MergeInProgressJournal {
                phase: "committed".to_string(),
                ..journal_base.clone()
            },
        );
    }
    let ahead = commits_ahead(repo, &branch).unwrap_or(0);

    let mut merged_sha = None;
    if ahead > 0 {
        if let Err(e) = git_cmd(repo, &["merge", "--no-ff", "--no-edit", &branch]) {
            let abort_ok = git_cmd(repo, &["merge", "--abort"]).is_ok();
            if !abort_ok {
                let _ = git_cmd(repo, &["reset", "--hard", &pre_merge_sha]);
            }
            clear_merge_journal(repo);
            let restore_note = stash_guard.restore();
            return Err(format!(
                "{e} (merge aborted — the worktree and branch were kept for manual resolution).{restore_note}"
            ));
        }
        merged_sha = git_cmd(repo, &["rev-parse", "HEAD"]).ok();
        write_merge_journal(
            repo,
            &MergeInProgressJournal {
                phase: "merged".to_string(),
                ..journal_base.clone()
            },
        );
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
            // Restore the stash AFTER the hard reset — never before, or the reset
            // would discard the just-applied work with the stash already gone.
            let restore_note = stash_guard.restore();
            return Err(format!(
                "Post-merge cleanup failed: {cleanup_err} ({rolled} to {short}). Branch {branch} was kept — retry the commit pipeline.{restore_note}",
            ));
        }
        let restore_note = stash_guard.restore();
        return Err(format!("Worktree cleanup failed: {cleanup_err}{restore_note}"));
    }

    if let Some(rid) = run_id.as_deref() {
        remove_worktree_meta(repo, rid);
    } else if let Some(name) = wt.file_name().and_then(|n| n.to_str()) {
        remove_worktree_meta(repo, name);
    }
    clear_merge_journal(repo);

    // Merge + cleanup succeeded — restore the user's stashed work on top.
    let restore_note = stash_guard.restore();

    let message = match (&committed, ahead) {
        (Some(hash), n) if n > 0 => {
            format!("committed pending changes ({hash}) and merged {branch} ({n} commit(s)){restore_note}")
        }
        (None, n) if n > 0 => format!("merged {branch} ({n} commit(s)){restore_note}"),
        (Some(hash), _) => {
            format!("committed pending changes ({hash}) and merged {branch}{restore_note}")
        }
        (None, _) => format!("no changes to merge from {branch}; worktree cleaned up{restore_note}"),
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

/// Returns true when `branch` is an ancestor of the repo's current HEAD.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_branch_is_ancestor(
    app: AppHandle,
    repo_dir: String,
    branch: String,
) -> Result<bool, String> {
    let repo = authorize_dir(&app, &repo_dir)?;
    validate_ref("branch", &branch)?;
    let head = git_cmd(&repo, &["rev-parse", "HEAD"])?;
    let branch_sha = git_cmd(&repo, &["rev-parse", "--verify", &branch])?;
    Ok(git_cmd(
        &repo,
        &[
            "merge-base",
            "--is-ancestor",
            branch_sha.trim(),
            head.trim(),
        ],
    )
    .is_ok())
}

/// Remove agent worktrees whose runs are gone (not in `keep_run_ids`),
/// delete their branches, and let git prune stale administrative entries.
/// Returns the number of worktrees reaped.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_prune_worktrees(
    app: AppHandle,
    repo_dir: String,
    keep_run_ids: Vec<String>,
    confirm_prune_all: Option<bool>,
) -> Result<u32, String> {
    if keep_run_ids.is_empty() && !confirm_prune_all.unwrap_or(false) {
        return Err(
            "Refusing to prune all agent worktrees without confirmPruneAll: true — pass every run id to keep in keepRunIds, or set confirmPruneAll when you intend to delete them all."
                .to_string(),
        );
    }
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    let _ = recover_merge_journal_inner(repo);
    let keep: HashSet<String> = keep_run_ids.into_iter().collect();
    let mut reaped = 0u32;

    // Reap orphan metadata files whose worktree directory is gone.
    let meta_root = repo.join(".worktrees");
    if let Ok(entries) = std::fs::read_dir(&meta_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem.starts_with('.') {
                continue;
            }
            let wt_path = meta_root.join(stem);
            if !wt_path.is_dir() && !keep.contains(stem) {
                if let Ok(raw) = std::fs::read_to_string(&path) {
                    if let Ok(meta) = serde_json::from_str::<WorktreeMeta>(&raw) {
                        if validate_ref("branch", &meta.branch).is_ok() {
                            let _ = git_cmd(repo, &["branch", "-D", &meta.branch]);
                        }
                    }
                }
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    for entry in agent_git_list_worktrees_inner(repo) {
        if keep.contains(&entry.run_id) {
            continue;
        }
        let wt = Path::new(&entry.worktree_path);
        if wt.exists()
            && worktree_prune_blocked(wt, repo, entry.branch.as_deref())
        {
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

/// Detect the repo's default integration branch (origin/HEAD, else main/master).
fn default_integration_branch(repo: &Path) -> Result<String, String> {
    if let Ok(sym) = git_cmd(repo, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        if let Some(branch) = sym.strip_prefix("refs/remotes/origin/") {
            validate_ref("base branch", branch)?;
            return Ok(branch.to_string());
        }
    }
    for candidate in ["main", "master"] {
        let remote = format!("origin/{candidate}");
        if git_cmd(repo, &["rev-parse", "--verify", &remote]).is_ok() {
            return Ok(candidate.to_string());
        }
        if git_cmd(repo, &["rev-parse", "--verify", candidate]).is_ok() {
            return Ok(candidate.to_string());
        }
    }
    Err("Could not detect default branch (tried origin/HEAD, main, master)".to_string())
}

/// Collect unmerged paths and a bounded snippet of conflict markers for agent context.
fn collect_conflict_context(worktree: &Path, max_chars: usize) -> (Vec<String>, String) {
    let files_raw = git_cmd(worktree, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
    let files: Vec<String> = files_raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    let mut markers = String::new();
    for rel in &files {
        if markers.len() >= max_chars {
            break;
        }
        let path = worktree.join(rel);
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let snippet: String = content
            .lines()
            .filter(|l| {
                l.starts_with("<<<<<<<")
                    || l.starts_with("=======")
                    || l.starts_with(">>>>>>>")
            })
            .take(80)
            .collect::<Vec<_>>()
            .join("\n");
        if snippet.is_empty() {
            continue;
        }
        markers.push_str(&format!("\n--- {rel} ---\n{snippet}\n"));
    }
    (files, markers.chars().take(max_chars).collect())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MergeMainIntoWorktreeResult {
    pub status: String,
    pub base_branch: String,
    pub conflict_files: Vec<String>,
    pub conflict_markers: String,
    pub message: String,
}

/// Merge the integration branch (main/master) into the agent worktree branch
/// *inside* the worktree. Used by the conflict-repair loop to bring the agent
/// branch up to date before a follow-up run resolves markers.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_merge_main_into_worktree(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    base_branch: Option<String>,
) -> Result<MergeMainIntoWorktreeResult, String> {
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    let wt = require_worktree_inside(repo, &worktree_path)?;
    let wt_dirty = git_cmd(&wt, &["status", "--porcelain"])
        .map(|s| s.lines().any(|l| !l.trim().is_empty()))
        .unwrap_or(true);
    if wt_dirty {
        return Err(
            "Worktree has uncommitted changes — commit or stash them before merging main."
                .to_string(),
        );
    }
    let base = match base_branch {
        Some(b) => {
            validate_ref("base branch", &b)?;
            b
        }
        None => default_integration_branch(repo)?,
    };

    let merge_ref = if git_cmd(repo, &["rev-parse", "--verify", &format!("origin/{base}")]).is_ok() {
        format!("origin/{base}")
    } else {
        base.clone()
    };

    let ahead = git_cmd(&wt, &["rev-list", "--count", &format!("{merge_ref}..HEAD")])
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let behind = git_cmd(&wt, &["rev-list", "--count", &format!("HEAD..{merge_ref}")])
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);

    if behind == 0 {
        return Ok(MergeMainIntoWorktreeResult {
            status: "already_up_to_date".to_string(),
            base_branch: base,
            conflict_files: vec![],
            conflict_markers: String::new(),
            message: format!("Worktree branch is already up to date with {merge_ref}."),
        });
    }

    let pre_wt_head = git_cmd(&wt, &["rev-parse", "HEAD"]).unwrap_or_default();

    match git_cmd(&wt, &["merge", "--no-edit", &merge_ref]) {
        Ok(_) => {
            let msg = format!(
                "Merged {merge_ref} into the worktree branch ({behind} commit(s); {ahead} ahead)."
            );
            Ok(MergeMainIntoWorktreeResult {
                status: "clean".to_string(),
                base_branch: base,
                conflict_files: vec![],
                conflict_markers: String::new(),
                message: msg,
            })
        }
        Err(e) => {
            let abort_ok = git_cmd(&wt, &["merge", "--abort"]).is_ok();
            if !abort_ok && !pre_wt_head.is_empty() {
                let _ = git_cmd(&wt, &["reset", "--hard", &pre_wt_head]);
            }
            let (conflict_files, conflict_markers) = collect_conflict_context(&wt, 12_000);
            if conflict_files.is_empty() {
                return Err(format!("Merge of {merge_ref} failed: {e}"));
            }
            let file_count = conflict_files.len();
            Ok(MergeMainIntoWorktreeResult {
                status: "conflicts".to_string(),
                base_branch: base,
                conflict_files,
                conflict_markers,
                message: format!(
                    "Merge of {merge_ref} stopped with conflicts in {file_count} file(s). Resolve markers, commit, then retry the commit pipeline."
                ),
            })
        }
    }
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
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    let wt = require_worktree_inside(repo, &worktree_path)?;
    match commit_all_in(&wt, &safe_commit_message(message))? {
        Some(hash) => Ok(format!("Committed pending changes ({hash}) on the run branch")),
        None => Ok("Worktree already clean — nothing to commit".to_string()),
    }
}

/// Hard-reset a run worktree to a prior trace checkpoint commit.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_reset_worktree_to(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    commit_sha: String,
) -> Result<String, String> {
    validate_ref("commit", &commit_sha)?;
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    let wt = require_worktree_inside(repo, &worktree_path)?;
    git_cmd(&wt, &["reset", "--hard", &commit_sha])
        .map(|_| format!("Reset worktree to {commit_sha}"))
        .map_err(|e| format!("git reset failed: {e}"))
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
    let (_lock, _cross) = acquire_repo_lock(repo)?;
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
pub fn agent_git_list_changed_files(
    app: AppHandle,
    working_dir: String,
    base_ref: Option<String>,
) -> Result<GitChangedFilesResult, String> {
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let repo = repo_buf.as_path();
    let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
    validate_ref("base ref", &base)?;

    let mut files: Vec<GitChangedFile> = Vec::new();
    let mut seen = HashSet::new();

    let name_status = git_cmd(repo, &["diff", "--name-status", &base])?;
    for line in name_status.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, '\t');
        let status_code = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }
        let status = match status_code.chars().next() {
            Some('A') => "added",
            Some('D') => "deleted",
            Some('M') => "modified",
            Some('R') => "renamed",
            Some('C') => "modified",
            Some('T') => "modified",
            _ => "modified",
        };
        seen.insert(path.to_string());
        files.push(GitChangedFile {
            path: path.to_string(),
            status: status.to_string(),
            insertions: 0,
            deletions: 0,
        });
    }

    let numstat = git_cmd(repo, &["diff", "--numstat", &base]).unwrap_or_default();
    for line in numstat.lines() {
        let mut cols = line.split('\t');
        let ins = cols.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        let del = cols.next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
        let path = cols.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }
        if let Some(entry) = files.iter_mut().find(|f| f.path == path) {
            entry.insertions = ins;
            entry.deletions = del;
        }
    }

    let untracked = git_cmd(repo, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default();
    for path in untracked.lines().map(str::trim).filter(|p| !p.is_empty()) {
        if seen.insert(path.to_string()) {
            files.push(GitChangedFile {
                path: path.to_string(),
                status: "untracked".to_string(),
                insertions: 0,
                deletions: 0,
            });
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(GitChangedFilesResult { files })
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_file_diff(
    app: AppHandle,
    working_dir: String,
    file_path: String,
    base_ref: Option<String>,
) -> Result<GitFileDiffResult, String> {
    validate_repo_relative_path(&file_path)?;
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let repo = repo_buf.as_path();
    let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
    validate_ref("base ref", &base)?;

    let full_path = repo.join(&file_path);
    let diff = if full_path.exists() {
        git_cmd(repo, &["diff", &base, "--", &file_path]).unwrap_or_default()
    } else {
        String::new()
    };

    let diff = if diff.trim().is_empty() && full_path.is_file() {
        // Untracked or new file — synthesize a unified diff header.
        let content = std::fs::read_to_string(&full_path).unwrap_or_default();
        let line_count = content.lines().count().max(1);
        format!(
            "diff --git a/{file_path} b/{file_path}\nnew file mode 100644\n--- /dev/null\n+++ b/{file_path}\n@@ -0,0 +1,{line_count} @@\n{}",
            content
                .lines()
                .map(|l| format!("+{l}"))
                .collect::<Vec<_>>()
                .join("\n")
        )
    } else {
        diff
    };

    Ok(GitFileDiffResult {
        path: file_path,
        diff: diff.chars().take(120_000).collect(),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitPushResult {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_hash: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_push(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    branch: String,
    commit_message: Option<String>,
) -> Result<GitPushResult, String> {
    validate_ref("branch", &branch)?;
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let (_lock, _cross) = acquire_repo_lock(repo)?;
    let wt = require_worktree_inside(repo, &worktree_path)?;

    let committed = commit_all_in(&wt, &safe_commit_message(commit_message))?;
    git_cmd(&wt, &["push", "-u", "origin", &branch])?;

    let message = match &committed {
        Some(hash) => format!("committed pending changes ({hash}) and pushed {branch} to origin"),
        None => format!("pushed {branch} to origin"),
    };
    Ok(GitPushResult {
        message,
        committed_hash: committed,
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
            TrackedRun {
                pid,
                pgid: 0,
                child: Some(child),
                signals: None,
                sandbox_profile_dir: None,
            },
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnsureGitignoreResult {
    pub updated: bool,
}

const GITIGNORE_BLOCK_BEGIN: &str = "# BEGIN LiquiTask agent workspace v1";
const GITIGNORE_BLOCK_END: &str = "# END LiquiTask agent workspace";

/// A non-comment, non-empty gitignore line used for deduplication.
fn gitignore_pattern_line(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        None
    } else {
        Some(trimmed)
    }
}

/// Collect pattern lines that already exist outside the managed block.
fn existing_patterns_outside_block(content: &str) -> HashSet<String> {
    let mut in_block = false;
    let mut patterns = HashSet::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == GITIGNORE_BLOCK_BEGIN {
            in_block = true;
            continue;
        }
        if trimmed == GITIGNORE_BLOCK_END {
            in_block = false;
            continue;
        }
        if in_block {
            continue;
        }
        if let Some(pat) = gitignore_pattern_line(line) {
            patterns.insert(pat.to_string());
        }
    }
    patterns
}

/// Filter block lines: drop patterns already present outside the managed region.
fn filter_block_lines(block: &str, existing: &HashSet<String>) -> Vec<String> {
    let mut out = Vec::new();
    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed == GITIGNORE_BLOCK_BEGIN || trimmed == GITIGNORE_BLOCK_END {
            out.push(trimmed.to_string());
            continue;
        }
        if let Some(pat) = gitignore_pattern_line(line) {
            if existing.contains(pat) {
                continue;
            }
        }
        out.push(line.to_string());
    }
    out
}

/// Replace an existing managed block or append a new one. Returns merged content.
fn merge_gitignore_block(existing: &str, block: &str) -> (String, bool) {
    let outside = existing_patterns_outside_block(existing);
    let filtered = filter_block_lines(block, &outside);
    let new_block = filtered.join("\n");

    let begin_idx = existing.find(GITIGNORE_BLOCK_BEGIN);
    let end_idx = existing.find(GITIGNORE_BLOCK_END);

    if let (Some(begin), Some(end)) = (begin_idx, end_idx) {
        if end >= begin {
            let line_end = existing[end..]
                .find('\n')
                .map(|i| end + i + 1)
                .unwrap_or(existing.len());
            let before = existing[..begin].trim_end();
            let after = existing[line_end..].trim_start();
            let mut merged = String::new();
            if !before.is_empty() {
                merged.push_str(before);
                merged.push('\n');
            }
            merged.push_str(&new_block);
            if !after.is_empty() {
                merged.push('\n');
                merged.push_str(after);
            }
            if !merged.ends_with('\n') {
                merged.push('\n');
            }
            let changed = merged != existing;
            return (merged, changed);
        }
    }

    let mut merged = existing.to_string();
    if !merged.is_empty() && !merged.ends_with('\n') {
        merged.push('\n');
    }
    if !merged.is_empty() {
        merged.push('\n');
    }
    merged.push_str(&new_block);
    merged.push('\n');
    (merged, true)
}

/// Idempotently merge the LiquiTask agent-workspace block into the repo's
/// `.gitignore` (create the file when missing). Best-effort: callers treat
/// errors as non-fatal.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_ensure_workspace_gitignore(
    app: AppHandle,
    working_dir: String,
    block: String,
) -> Result<EnsureGitignoreResult, String> {
    if block.trim().is_empty() || !block.contains(GITIGNORE_BLOCK_BEGIN) {
        return Err("Invalid gitignore block".to_string());
    }
    let repo_buf = authorize_dir(&app, &working_dir)?;
    let gitignore_path = repo_buf.join(".gitignore");

    let existing = std::fs::read_to_string(&gitignore_path).unwrap_or_default();
    let (merged, changed) = merge_gitignore_block(&existing, &block);
    if !changed {
        return Ok(EnsureGitignoreResult { updated: false });
    }
    std::fs::write(&gitignore_path, merged)
        .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    Ok(EnsureGitignoreResult { updated: true })
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

    #[test]
    fn merge_gitignore_appends_when_block_missing() {
        let block = "# BEGIN LiquiTask agent workspace v1\n.worktrees/\n# END LiquiTask agent workspace";
        let (merged, changed) = merge_gitignore_block("", block);
        assert!(changed);
        assert!(merged.contains(".worktrees/"));
        assert!(merged.contains(GITIGNORE_BLOCK_BEGIN));
    }

    #[test]
    fn merge_gitignore_replaces_existing_block() {
        let existing = "# custom\n# BEGIN LiquiTask agent workspace v1\n.old/\n# END LiquiTask agent workspace\n";
        let block = "# BEGIN LiquiTask agent workspace v1\n.worktrees/\n# END LiquiTask agent workspace";
        let (merged, changed) = merge_gitignore_block(existing, block);
        assert!(changed);
        assert!(merged.contains(".worktrees/"));
        assert!(!merged.contains(".old/"));
        assert!(merged.starts_with("# custom"));
    }

    #[test]
    fn merge_gitignore_dedupes_patterns_already_outside_block() {
        let existing = ".worktrees/\n";
        let block = "# BEGIN LiquiTask agent workspace v1\n.worktrees/\n.agents/\n# END LiquiTask agent workspace";
        let (merged, _) = merge_gitignore_block(existing, block);
        assert_eq!(merged.matches(".worktrees/").count(), 1);
        assert!(merged.contains(".agents/"));
    }

    #[test]
    fn worktree_prune_blocked_without_git_repo() {
        let dir = std::env::temp_dir().join(format!("lt-prune-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Missing git metadata — treat as unsafe to prune (fail closed).
        assert!(worktree_prune_blocked(dir.as_path(), dir.as_path(), Some("agent/run-1")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn high_risk_stage_paths_blocked_without_gitignore() {
        assert!(is_high_risk_stage_path(".env"));
        assert!(is_high_risk_stage_path("node_modules/foo"));
        assert!(!is_high_risk_stage_path("src/main.ts"));
    }
}
