//! GitHub Issues sync via `gh` CLI (mirrors agent_git.rs PR helpers).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::agent_cli_util::augmented_path;
use crate::authorize_workspace_dir;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRepoInfo {
    pub owner: String,
    pub repo: String,
    pub remote_url: String,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub url: String,
    pub state: String,
    pub labels: Vec<GitHubIssueLabel>,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
pub struct GitHubIssueLabel {
    pub name: String,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrCheck {
    pub name: String,
    pub state: String,
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub workflow: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrChecksResult {
    pub pr_number: u64,
    pub checks: Vec<GitHubPrCheck>,
    pub failed_count: u32,
    pub pending_count: u32,
    pub all_passed: bool,
}

#[derive(Serialize, Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrReviewComment {
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u64>,
    pub created_at: Option<String>,
    pub url: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrReviewCommentsResult {
    pub pr_number: u64,
    pub comments: Vec<GitHubPrReviewComment>,
}

fn gh_cmd(repo_dir: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("gh");
    cmd.args(args).env("PATH", augmented_path());
    if let Some(dir) = repo_dir {
        cmd.current_dir(dir);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run gh: {e}. Install GitHub CLI (gh) and authenticate."))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn parse_github_remote(url: &str) -> Option<(String, String)> {
    let trimmed = url.trim();
    // https://github.com/owner/repo.git
    if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        let parts: Vec<&str> = rest.trim_end_matches(".git").split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }
    // git@github.com:owner/repo.git
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let parts: Vec<&str> = rest.trim_end_matches(".git").split('/').collect();
        if parts.len() >= 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }
    None
}

/// Extract the PR number from a GitHub pull URL.
fn parse_pr_number(pr_url: &str) -> Result<u64, String> {
    let trimmed = pr_url.trim().trim_end_matches('/');
    let num = trimmed
        .rsplit('/')
        .next()
        .ok_or_else(|| format!("Invalid PR URL: {pr_url}"))?
        .parse::<u64>()
        .map_err(|_| format!("Invalid PR number in URL: {pr_url}"))?;
    if num == 0 {
        return Err(format!("Invalid PR number in URL: {pr_url}"));
    }
    Ok(num)
}

fn authorize_repo_dir(app: &AppHandle, working_dir: Option<String>) -> Result<Option<PathBuf>, String> {
    match working_dir {
        Some(dir) if !dir.trim().is_empty() => Ok(Some(authorize_workspace_dir(app, &dir)?)),
        _ => Ok(None),
    }
}

fn summarize_checks(checks: &[GitHubPrCheck]) -> (u32, u32, bool) {
    let mut failed = 0u32;
    let mut pending = 0u32;
    for c in checks {
        let state = c.state.to_uppercase();
        if state.contains("FAIL") || state == "ERROR" {
            failed += 1;
        } else if state.contains("PEND") || state == "IN_PROGRESS" || state == "QUEUED" {
            pending += 1;
        }
    }
    let all_passed = !checks.is_empty() && failed == 0 && pending == 0;
    (failed, pending, all_passed)
}

#[tauri::command(rename_all = "camelCase")]
pub fn github_detect_repo(app: AppHandle, working_dir: String) -> Result<GitHubRepoInfo, String> {
    let dir: PathBuf = authorize_workspace_dir(&app, &working_dir)?;
    if !dir.is_dir() {
        return Err(format!("Working directory not found: {working_dir}"));
    }
    let remote = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&dir)
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if !remote.status.success() {
        return Err("No git origin remote found".to_string());
    }
    let remote_url = String::from_utf8_lossy(&remote.stdout).trim().to_string();
    let (owner, repo) =
        parse_github_remote(&remote_url).ok_or_else(|| format!("Unsupported remote: {remote_url}"))?;
    Ok(GitHubRepoInfo {
        owner,
        repo,
        remote_url,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn github_issue_list(
    owner: String,
    repo: String,
    state: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GitHubIssue>, String> {
    let repo_flag = format!("{owner}/{repo}");
    let state_val = state.unwrap_or_else(|| "open".to_string());
    let lim = limit.unwrap_or(50).min(100);
    let json = gh_cmd(
        None,
        &[
            "issue",
            "list",
            "--repo",
            &repo_flag,
            "--state",
            &state_val,
            "--limit",
            &lim.to_string(),
            "--json",
            "number,title,body,url,state,labels",
        ],
    )?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse gh output: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
pub fn github_issue_close(
    owner: String,
    repo: String,
    number: u64,
    comment: Option<String>,
) -> Result<String, String> {
    let repo_flag = format!("{owner}/{repo}");
    let num = number.to_string();
    let mut args = vec!["issue", "close", &num, "--repo", &repo_flag];
    if let Some(ref body) = comment {
        args.push("--comment");
        args.push(body);
    }
    gh_cmd(None, &args)
}

#[tauri::command(rename_all = "camelCase")]
pub fn github_issue_comment(
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> Result<String, String> {
    let repo_flag = format!("{owner}/{repo}");
    let num = number.to_string();
    gh_cmd(
        None,
        &["issue", "comment", &num, "--repo", &repo_flag, "--body", &body],
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn github_auth_status() -> Result<bool, String> {
    let output = Command::new("gh")
        .args(["auth", "status"])
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run gh: {e}"))?;
    Ok(output.status.success())
}

/// Poll CI/check status for a pull request (`gh pr checks`).
#[tauri::command(rename_all = "camelCase")]
pub fn github_pr_checks(
    app: AppHandle,
    pr_url: String,
    working_dir: Option<String>,
) -> Result<GitHubPrChecksResult, String> {
    let pr_number = parse_pr_number(&pr_url)?;
    let repo_dir = authorize_repo_dir(&app, working_dir)?;
    let num = pr_number.to_string();
    let json = gh_cmd(
        repo_dir.as_deref(),
        &[
            "pr",
            "checks",
            &num,
            "--json",
            "name,state,bucket,link,workflow",
        ],
    )?;
    let checks: Vec<GitHubPrCheck> =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse gh pr checks: {e}"))?;
    let (failed_count, pending_count, all_passed) = summarize_checks(&checks);
    Ok(GitHubPrChecksResult {
        pr_number,
        checks,
        failed_count,
        pending_count,
        all_passed,
    })
}

/// Fetch failed CI logs for a PR's head branch (`gh run view --log-failed`).
#[tauri::command(rename_all = "camelCase")]
pub fn github_pr_failed_logs(
    app: AppHandle,
    pr_url: String,
    working_dir: Option<String>,
    head_branch: Option<String>,
) -> Result<String, String> {
    let pr_number = parse_pr_number(&pr_url)?;
    let repo_dir = authorize_repo_dir(&app, working_dir)?;
    let repo_path = repo_dir.as_deref();

    let branch = match head_branch {
        Some(b) if !b.trim().is_empty() => b,
        _ => {
            let num = pr_number.to_string();
            let json = gh_cmd(
                repo_path,
                &["pr", "view", &num, "--json", "headRefName"],
            )?;
            let parsed: serde_json::Value = serde_json::from_str(&json)
                .map_err(|e| format!("Failed to parse gh pr view: {e}"))?;
            parsed
                .get("headRefName")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "PR head branch not found".to_string())?
                .to_string()
        }
    };

    let runs_json = gh_cmd(
        repo_path,
        &[
            "run",
            "list",
            "--branch",
            &branch,
            "--limit",
            "5",
            "--json",
            "databaseId,conclusion,status,displayTitle,url",
        ],
    )?;
    let runs: Vec<serde_json::Value> =
        serde_json::from_str(&runs_json).map_err(|e| format!("Failed to parse gh run list: {e}"))?;
    let run_id = runs
        .iter()
        .find(|r| {
            r.get("conclusion")
                .and_then(|v| v.as_str())
                .map(|c| c == "failure")
                .unwrap_or(false)
        })
        .or_else(|| runs.first())
        .and_then(|r| r.get("databaseId"))
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "No workflow runs found for PR branch".to_string())?;

    let id = run_id.to_string();
    let logs = gh_cmd(repo_path, &["run", "view", &id, "--log-failed"])?;
    Ok(logs.chars().take(24_000).collect())
}

/// Fetch review and inline comments on a pull request.
#[tauri::command(rename_all = "camelCase")]
pub fn github_pr_review_comments(
    app: AppHandle,
    pr_url: String,
    working_dir: Option<String>,
) -> Result<GitHubPrReviewCommentsResult, String> {
    let pr_number = parse_pr_number(&pr_url)?;
    let repo_dir = authorize_repo_dir(&app, working_dir)?;
    let num = pr_number.to_string();

    let view_json = gh_cmd(
        repo_dir.as_deref(),
        &["pr", "view", &num, "--json", "reviews,comments"],
    )?;

    let view: serde_json::Value =
        serde_json::from_str(&view_json).map_err(|e| format!("Failed to parse gh pr view: {e}"))?;

    let mut comments: Vec<GitHubPrReviewComment> = Vec::new();

    if let Some(reviews) = view.get("reviews").and_then(|v| v.as_array()) {
        for review in reviews {
            let body = review.get("body").and_then(|v| v.as_str()).unwrap_or("").trim();
            if body.is_empty() {
                continue;
            }
            comments.push(GitHubPrReviewComment {
                author: review
                    .get("author")
                    .and_then(|a| a.get("login"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("reviewer")
                    .to_string(),
                body: body.to_string(),
                path: None,
                line: None,
                created_at: review.get("submittedAt").and_then(|v| v.as_str()).map(str::to_string),
                url: review.get("url").and_then(|v| v.as_str()).map(str::to_string),
            });
        }
    }
    if let Some(issue_comments) = view.get("comments").and_then(|v| v.as_array()) {
        for c in issue_comments {
            let body = c.get("body").and_then(|v| v.as_str()).unwrap_or("").trim();
            if body.is_empty() {
                continue;
            }
            comments.push(GitHubPrReviewComment {
                author: c
                    .get("author")
                    .and_then(|a| a.get("login"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("reviewer")
                    .to_string(),
                body: body.to_string(),
                path: None,
                line: None,
                created_at: c.get("createdAt").and_then(|v| v.as_str()).map(str::to_string),
                url: c.get("url").and_then(|v| v.as_str()).map(str::to_string),
            });
        }
    }

    // Inline review comments (file/line) via the REST API when gh is authenticated.
    if let Ok(inline_json) = gh_cmd(
        repo_dir.as_deref(),
        &[
            "api",
            &format!("repos/{{owner}}/{{repo}}/pulls/{num}/comments"),
            "--paginate",
        ],
    ) {
        if let Ok(inline) = serde_json::from_str::<Vec<serde_json::Value>>(&inline_json) {
            for c in inline {
                let body = c.get("body").and_then(|v| v.as_str()).unwrap_or("").trim();
                if body.is_empty() {
                    continue;
                }
                comments.push(GitHubPrReviewComment {
                    author: c
                        .get("user")
                        .and_then(|u| u.get("login"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("reviewer")
                        .to_string(),
                    body: body.to_string(),
                    path: c.get("path").and_then(|v| v.as_str()).map(str::to_string),
                    line: c.get("line").and_then(|v| v.as_u64()),
                    created_at: c.get("created_at").and_then(|v| v.as_str()).map(str::to_string),
                    url: c.get("html_url").and_then(|v| v.as_str()).map(str::to_string),
                });
            }
        }
    }

    Ok(GitHubPrReviewCommentsResult {
        pr_number,
        comments,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_https_remote() {
        let (owner, repo) = parse_github_remote("https://github.com/acme/widgets.git").unwrap();
        assert_eq!(owner, "acme");
        assert_eq!(repo, "widgets");
    }

    #[test]
    fn parse_ssh_remote() {
        let (owner, repo) = parse_github_remote("git@github.com:acme/widgets.git").unwrap();
        assert_eq!(owner, "acme");
        assert_eq!(repo, "widgets");
    }

    #[test]
    fn parse_pr_url_number() {
        assert_eq!(
            parse_pr_number("https://github.com/acme/widgets/pull/42").unwrap(),
            42
        );
    }

    #[test]
    fn summarize_check_states() {
        let checks = vec![
            GitHubPrCheck {
                name: "test".into(),
                state: "SUCCESS".into(),
                bucket: None,
                link: None,
                workflow: None,
            },
            GitHubPrCheck {
                name: "lint".into(),
                state: "FAILURE".into(),
                bucket: None,
                link: None,
                workflow: None,
            },
        ];
        let (failed, pending, all_passed) = summarize_checks(&checks);
        assert_eq!(failed, 1);
        assert_eq!(pending, 0);
        assert!(!all_passed);
    }
}
