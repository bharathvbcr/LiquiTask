//! DevCouncil planner (`dev plan`) and repair (`dev repair`) integration.
//!
//! ## CLI assumptions (DevCouncil v0.x as of 2026-07)
//!
//! * `dev plan GOAL [--project-root PATH]` — debate-plans work; no `--json` flag on
//!   `plan` itself. We chain `dev export --json` afterward to read structured tasks.
//! * `dev repair [--project-root PATH]` — converts blocking verification gaps into
//!   repair tasks in DevCouncil state; we read them via `dev export --json`.
//! * `dev export --json [--project-root PATH]` — stdout payload:
//!   `{ initialized, requirements[], tasks[], gaps{...} }`
//! * When the `dev` binary is missing, callers get `cli_available: false` and may
//!   use fixture/fallback paths (repair can synthesize tasks from gap strings).

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::agent_runner::{augmented_path, find_executable};
use crate::{is_path_authorized, read_storage, safe_workspace_paths};

// ---------------------------------------------------------------------------
// Public result types (serde camelCase for TS)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevCouncilSubtask {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_gap: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevPlanResult {
    pub success: bool,
    pub cli_available: bool,
    pub tasks: Vec<DevCouncilSubtask>,
    pub requirements_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_export: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevRepairResult {
    pub success: bool,
    pub cli_available: bool,
    pub tasks: Vec<DevCouncilSubtask>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_export: Option<String>,
}

// ---------------------------------------------------------------------------
// Internal DevCouncil export schema (subset)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ExportPayload {
    #[serde(default)]
    requirements: Vec<Value>,
    #[serde(default)]
    tasks: Vec<ExportTask>,
}

#[derive(Debug, Deserialize)]
struct ExportTask {
    id: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    priority: Option<String>,
    #[serde(default)]
    depends_on: Vec<String>,
    #[serde(default)]
    status: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_dev_cli() -> Option<std::path::PathBuf> {
    find_executable("dev").or_else(|| find_executable("devcouncil"))
}

fn validate_working_dir(app: &AppHandle, working_dir: &str) -> Result<std::path::PathBuf, String> {
    if working_dir.is_empty() || working_dir.len() > 512 {
        return Err("Invalid working directory".to_string());
    }
    let data = read_storage(app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(working_dir, &authorized) {
        return Err(format!(
            "Working directory is not an authorised workspace path: {working_dir}"
        ));
    }
    dunce::canonicalize(working_dir).map_err(|e| format!("Working directory not accessible: {e}"))
}

fn run_dev(cwd: &Path, args: &[&str]) -> Result<(i32, String, String), String> {
    let program = resolve_dev_cli().ok_or_else(|| "DevCouncil CLI (`dev`) not found on PATH.".to_string())?;
    let output = Command::new(&program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", augmented_path())
        .output()
        .map_err(|e| format!("Failed to run {}: {e}", program.display()))?;
    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok((code, stdout, stderr))
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let start = raw.find('{')?;
    Some(&raw[start..])
}

pub fn parse_export_tasks(raw: &str) -> Result<(Vec<DevCouncilSubtask>, usize), String> {
    let json = extract_json_object(raw).ok_or_else(|| "No JSON object in export output".to_string())?;
    let payload: ExportPayload =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse export JSON: {e}"))?;
    let tasks = payload
        .tasks
        .into_iter()
        .map(|t| DevCouncilSubtask {
            id: t.id,
            title: t.title,
            description: t.description,
            priority: t.priority,
            depends_on: t.depends_on,
            source_gap: None,
        })
        .collect();
    Ok((tasks, payload.requirements.len()))
}

pub fn subtasks_from_gaps(gaps: &[String]) -> Vec<DevCouncilSubtask> {
    gaps.iter()
        .enumerate()
        .map(|(i, gap)| DevCouncilSubtask {
            id: format!("GAP-{:03}", i + 1),
            title: truncate_title(gap, 120),
            description: gap.clone(),
            priority: Some("high".to_string()),
            depends_on: Vec::new(),
            source_gap: Some(gap.clone()),
        })
        .collect()
}

fn truncate_title(input: &str, max: usize) -> String {
    let trimmed = input.trim();
    if trimmed.len() <= max {
        trimmed.to_string()
    } else {
        format!("{}…", &trimmed[..max.saturating_sub(1)])
    }
}

// ---------------------------------------------------------------------------
// Core operations (testable without Tauri)
// ---------------------------------------------------------------------------

pub fn run_dev_plan(cwd: &Path, epic_context: &str) -> DevPlanResult {
    let goal = epic_context.trim();
    if goal.is_empty() {
        return DevPlanResult {
            success: false,
            cli_available: resolve_dev_cli().is_some(),
            tasks: Vec::new(),
            requirements_count: 0,
            summary: None,
            error: Some("Epic context (goal) must not be empty".to_string()),
            raw_export: None,
        };
    }

    if resolve_dev_cli().is_none() {
        return DevPlanResult {
            success: false,
            cli_available: false,
            tasks: Vec::new(),
            requirements_count: 0,
            summary: None,
            error: Some("DevCouncil CLI (`dev`) not found on PATH.".to_string()),
            raw_export: None,
        };
    }

    let root = cwd.to_string_lossy();
    let plan_args = ["plan", goal, "--project-root", &root];
    let (code, stdout, stderr) = match run_dev(cwd, &plan_args) {
        Ok(v) => v,
        Err(e) => {
            return DevPlanResult {
                success: false,
                cli_available: false,
                tasks: Vec::new(),
                requirements_count: 0,
                summary: None,
                error: Some(e),
                raw_export: None,
            };
        }
    };

    let summary = if stdout.trim().is_empty() {
        None
    } else {
        Some(stdout.chars().take(2000).collect())
    };

    if code != 0 {
        return DevPlanResult {
            success: false,
            cli_available: true,
            tasks: Vec::new(),
            requirements_count: 0,
            summary,
            error: Some(format!(
                "dev plan exited with code {code}: {}",
                stderr.chars().take(1000).collect::<String>()
            )),
            raw_export: None,
        };
    }

    let (_, export_stdout, export_stderr) = match run_dev(cwd, &["export", "--json", "--project-root", &root]) {
        Ok(v) => v,
        Err(e) => {
            return DevPlanResult {
                success: false,
                cli_available: true,
                tasks: Vec::new(),
                requirements_count: 0,
                summary,
                error: Some(e),
                raw_export: None,
            };
        }
    };

    match parse_export_tasks(&export_stdout) {
        Ok((tasks, req_count)) => {
            let empty = tasks.is_empty();
            DevPlanResult {
                success: !empty,
                cli_available: true,
                tasks,
                requirements_count: req_count,
                summary,
                error: if empty {
                    Some("Plan completed but export contained no tasks.".to_string())
                } else {
                    None
                },
                raw_export: Some(export_stdout.chars().take(8000).collect()),
            }
        }
        Err(parse_err) => DevPlanResult {
            success: false,
            cli_available: true,
            tasks: Vec::new(),
            requirements_count: 0,
            summary,
            error: Some(format!(
                "{parse_err}. export stderr: {}",
                export_stderr.chars().take(500).collect::<String>()
            )),
            raw_export: Some(export_stdout.chars().take(8000).collect()),
        },
    }
}

pub fn run_dev_repair(cwd: &Path, gap_context: &[String]) -> DevRepairResult {
    if resolve_dev_cli().is_none() {
        let tasks = subtasks_from_gaps(gap_context);
        let empty = tasks.is_empty();
        return DevRepairResult {
            success: !empty,
            cli_available: false,
            tasks,
            error: if empty {
                Some("No gaps provided and DevCouncil CLI unavailable.".to_string())
            } else {
                None
            },
            raw_export: None,
        };
    }

    let root = cwd.to_string_lossy();
    let (code, _stdout, stderr) = match run_dev(cwd, &["repair", "--project-root", &root]) {
        Ok(v) => v,
        Err(e) => {
            let tasks = subtasks_from_gaps(gap_context);
            return DevRepairResult {
                success: !tasks.is_empty(),
                cli_available: false,
                tasks,
                error: Some(e),
                raw_export: None,
            };
        }
    };

    let (_, export_stdout, export_stderr) = match run_dev(cwd, &["export", "--json", "--project-root", &root]) {
        Ok(v) => v,
        Err(e) => {
            let tasks = subtasks_from_gaps(gap_context);
            return DevRepairResult {
                success: !tasks.is_empty(),
                cli_available: true,
                tasks,
                error: Some(e),
                raw_export: None,
            };
        }
    };

    match parse_export_tasks(&export_stdout) {
        Ok((mut tasks, _)) => {
            // Tag tasks created from known gaps when counts align poorly.
            if tasks.is_empty() && !gap_context.is_empty() {
                tasks = subtasks_from_gaps(gap_context);
            } else if tasks.len() == gap_context.len() {
                for (task, gap) in tasks.iter_mut().zip(gap_context.iter()) {
                    task.source_gap = Some(gap.clone());
                }
            }
            let empty = tasks.is_empty();
            DevRepairResult {
                success: code == 0 && !empty,
                cli_available: true,
                tasks,
                error: if code != 0 {
                    Some(format!(
                        "dev repair exited with code {code}: {}",
                        stderr.chars().take(1000).collect::<String>()
                    ))
                } else if empty {
                    Some("Repair produced no tasks.".to_string())
                } else {
                    None
                },
                raw_export: Some(export_stdout.chars().take(8000).collect()),
            }
        }
        Err(parse_err) => {
            let tasks = subtasks_from_gaps(gap_context);
            DevRepairResult {
                success: !tasks.is_empty(),
                cli_available: true,
                tasks,
                error: Some(format!(
                    "{parse_err}. export stderr: {}",
                    export_stderr.chars().take(500).collect::<String>()
                )),
                raw_export: Some(export_stdout.chars().take(8000).collect()),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn agent_dev_plan(
    app: AppHandle,
    working_dir: String,
    epic_context: String,
) -> Result<DevPlanResult, String> {
    let cwd = validate_working_dir(&app, &working_dir)?;
    Ok(run_dev_plan(&cwd, &epic_context))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_dev_repair(
    app: AppHandle,
    working_dir: String,
    gap_context: Vec<String>,
) -> Result<DevRepairResult, String> {
    let cwd = validate_working_dir(&app, &working_dir)?;
    Ok(run_dev_repair(&cwd, &gap_context))
}

/// Parse export JSON without invoking the CLI (for tests / fixture replay).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_dev_parse_export(raw: String) -> Result<Vec<DevCouncilSubtask>, String> {
    parse_export_tasks(&raw).map(|(tasks, _)| tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_EXPORT: &str = r#"{
  "initialized": true,
  "requirements": [{"id": "REQ-001"}],
  "tasks": [
    {
      "id": "TASK-001",
      "title": "Implement API",
      "description": "Add REST endpoints",
      "priority": "high",
      "depends_on": [],
      "status": "planned"
    },
    {
      "id": "TASK-002",
      "title": "Write tests",
      "description": "Cover API layer",
      "priority": "medium",
      "depends_on": ["TASK-001"],
      "status": "planned"
    }
  ],
  "gaps": {"blocking_count": 0, "items": []}
}"#;

    #[test]
    fn parses_export_fixture() {
        let (tasks, req_count) = parse_export_tasks(FIXTURE_EXPORT).expect("parse");
        assert_eq!(req_count, 1);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].title, "Implement API");
        assert_eq!(tasks[1].depends_on, vec!["TASK-001".to_string()]);
    }

    #[test]
    fn subtasks_from_gaps_fallback() {
        let gaps = vec!["Missing test coverage".to_string(), "Unhandled edge case".to_string()];
        let tasks = subtasks_from_gaps(&gaps);
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].source_gap.as_deref(), Some("Missing test coverage"));
    }

    #[test]
    fn truncate_title_respects_limit() {
        let long = "x".repeat(150);
        assert!(truncate_title(&long, 80).ends_with('…'));
    }

    #[test]
    fn empty_goal_fails_plan() {
        let result = run_dev_plan(Path::new("/tmp"), "  ");
        assert!(!result.success);
        assert!(result.error.unwrap_or_default().contains("empty"));
    }
}
