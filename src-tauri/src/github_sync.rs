//! GitHub Issues sync via `gh` CLI (mirrors agent_git.rs PR helpers).

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::agent_runner::augmented_path;

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

#[tauri::command(rename_all = "camelCase")]
pub fn github_detect_repo(working_dir: String) -> Result<GitHubRepoInfo, String> {
    let dir = Path::new(&working_dir);
    if !dir.is_dir() {
        return Err(format!("Working directory not found: {working_dir}"));
    }
    let remote = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(dir)
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
}
