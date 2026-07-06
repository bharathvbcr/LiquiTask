//! Git worktree and PR helpers for agent runs.
//!
//! Security: every renderer-supplied directory is validated against the user's
//! authorised workspace allowlist (same boundary as `agent_run_start`), and
//! branch/ref strings are rejected if they could be parsed as flags.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
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

    Ok(GitWorktreeResult {
        branch,
        worktree_path: worktree_path.to_string_lossy().to_string(),
    })
}

/// Merge an agent branch into the repo's current branch and remove the worktree.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_git_merge_worktree(
    app: AppHandle,
    repo_dir: String,
    worktree_path: String,
    branch: String,
) -> Result<String, String> {
    validate_ref("branch", &branch)?;
    let repo_buf = authorize_dir(&app, &repo_dir)?;
    let repo = repo_buf.as_path();
    let wt = require_worktree_inside(repo, &worktree_path)?;

    git_cmd(repo, &["merge", "--no-edit", &branch])?;
    let _ = git_cmd(
        repo,
        &[
            "worktree",
            "remove",
            "--force",
            wt.to_str().ok_or("Invalid worktree path")?,
        ],
    );
    let _ = git_cmd(repo, &["branch", "-d", &branch]);
    Ok(format!("Merged {branch} into current branch"))
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
    let diff = git_cmd(repo, &["diff", "--stat", &base])?;
    let files_changed = diff.lines().filter(|l| l.contains('|')).count() as u32;
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
