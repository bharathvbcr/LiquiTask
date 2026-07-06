//! Shared serde data model mirroring `types.ts`.
//!
//! Boundary rule: every `Date` in the TS model crosses into Rust as **epoch
//! milliseconds** (`i64`). The TypeScript bridge is responsible for converting
//! `Date -> number` (via `getTime()`) before `invoke`, and back on return. This
//! keeps the core crate free of any date-parsing dependency.
//!
//! Every field is `#[serde(default)]` so partial DTOs from the various services
//! deserialize without error; each service only populates what it needs.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Subtask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskLink {
    #[serde(default, rename = "targetTaskId")]
    pub target_task_id: String,
    /// "blocks" | "blocked-by" | "relates-to" | "duplicates"
    #[serde(default, rename = "type")]
    pub link_type: String,
}

/// Recurrence config. Dates are epoch millis (see module note).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringConfig {
    #[serde(default)]
    pub enabled: bool,
    /// "daily" | "weekly" | "monthly" | "custom"
    #[serde(default)]
    pub frequency: String,
    #[serde(default)]
    pub interval: i64,
    #[serde(default)]
    pub days_of_week: Option<Vec<i64>>,
    #[serde(default)]
    pub day_of_month: Option<i64>,
    #[serde(default)]
    pub end_date: Option<i64>,
    #[serde(default)]
    pub next_occurrence: Option<i64>,
}

/// A task DTO. Dates are epoch millis. Only the fields used by the ported
/// services are modeled; unknown fields from the renderer are ignored.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    pub id: String,
    pub job_id: String,
    pub project_id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub summary: String,
    pub assignee: String,
    pub priority: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: Option<i64>,
    pub due_date: Option<i64>,
    pub completed_at: Option<i64>,
    pub subtasks: Vec<Subtask>,
    pub tags: Vec<String>,
    pub time_estimate: f64,
    pub time_spent: f64,
    pub links: Option<Vec<TaskLink>>,
    /// We only ever need the *count* of activity entries; keep them opaque.
    pub activity: Option<Vec<serde_json::Value>>,
    pub recurring: Option<RecurringConfig>,
}

impl Task {
    /// IDs of tasks this task is "blocked-by".
    pub fn blocked_by_ids(&self) -> Vec<String> {
        self.links
            .as_ref()
            .map(|ls| {
                ls.iter()
                    .filter(|l| l.link_type == "blocked-by")
                    .map(|l| l.target_task_id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn activity_len(&self) -> usize {
        self.activity.as_ref().map(|a| a.len()).unwrap_or(0)
    }
}
