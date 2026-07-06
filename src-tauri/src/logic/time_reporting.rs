//! Thin `#[tauri::command]` wrappers over `liquitask_core::time_reporting`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! the existing `workspace_read_file` / `recurring_*` commands), so the
//! renderer calls:
//!   invoke("time_generate_report",     { tasks, options, projectNames, nowMs })
//!   invoke("time_productivity_metrics",{ report })
//!   invoke("time_export_csv",          { tasks, projectNames })
//!   invoke("time_export_json",         { report, nowMs })
//!
//! `projectNames` is an `id -> name` map the TS side builds from the renderer's
//! projects (the core groups `byProject` by name and never models `Project`).
//! `nowMs` is passed in explicitly — the core never reads the clock.

use std::collections::HashMap;

use liquitask_core::model::Task;
use liquitask_core::time_reporting::{
    self, ProductivityMetrics, TimeReport, TimeReportOptions,
};

/// Generate the full time report (totals + four grouped aggregations + task
/// rows). `now_ms` is accepted for symmetry with the other commands even though
/// `generate_report` itself is clock-free; kept so the renderer always passes a
/// fixed instant.
#[tauri::command]
pub fn time_generate_report(
    tasks: Vec<Task>,
    options: TimeReportOptions,
    project_names: HashMap<String, String>,
) -> TimeReport {
    time_reporting::generate_report(&tasks, &options, &project_names)
}

/// Productivity metrics derived from a previously computed report.
#[tauri::command]
pub fn time_productivity_metrics(report: TimeReport) -> ProductivityMetrics {
    time_reporting::productivity_metrics(&report)
}

/// CSV export string for the given tasks.
#[tauri::command]
pub fn time_export_csv(tasks: Vec<Task>, project_names: HashMap<String, String>) -> String {
    time_reporting::export_csv(&tasks, &project_names)
}

/// Pretty JSON export string for a report; `now_ms` supplies `generatedAt`.
#[tauri::command]
pub fn time_export_json(report: TimeReport, now_ms: i64) -> String {
    time_reporting::export_json(&report, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_and_metrics_wrappers_roundtrip() {
        let tasks: Vec<Task> = serde_json::from_value(serde_json::json!([
            { "id": "1", "jobId": "LT-1", "projectId": "p1", "assignee": "A",
              "priority": "high", "timeSpent": 60.0, "timeEstimate": 45.0,
              "createdAt": 0, "completedAt": 86_400_000 }
        ]))
        .unwrap();
        let mut names = HashMap::new();
        names.insert("p1".to_string(), "Project 1".to_string());
        let opts: TimeReportOptions =
            serde_json::from_value(serde_json::json!({ "groupBy": "project" })).unwrap();

        let report = time_generate_report(tasks.clone(), opts, names.clone());
        assert_eq!(report.total_time_spent, 60.0);
        assert_eq!(report.by_project["Project 1"].count, 1);

        let metrics = time_productivity_metrics(report.clone());
        assert_eq!(metrics.tasks_over_estimate, 1);

        let csv = time_export_csv(tasks, names);
        assert!(csv.contains("LT-1"));

        let json = time_export_json(report, 0);
        assert!(json.contains("\"generatedAt\": \"1970-01-01T00:00:00.000Z\""));
    }
}
