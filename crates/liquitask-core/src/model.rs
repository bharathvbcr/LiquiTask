//! Shared serde data model mirroring `types.ts`.
//!
//! Boundary rule: every `Date` in the TS model crosses into Rust as **epoch
//! milliseconds** (`i64`). The TypeScript bridge is responsible for converting
//! `Date -> number` (via `getTime()`) before `invoke`, and back on return. This
//! keeps the core crate free of any date-parsing dependency.
//!
//! Every field is `#[serde(default)]` so partial DTOs from the various services
//! deserialize without error; each service only populates what it needs.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Keys we unwrap, in preference order, when handed an object where a string was
/// expected. Mirrors `src/utils/coerce.ts` and `src-tauri/src/agent_core.rs`.
const STRING_LIKE_KEYS: [&str; 9] = [
    "title",
    "name",
    "text",
    "label",
    "task",
    "step",
    "value",
    "summary",
    "description",
];

/// Best-effort coercion of any JSON value into a string. Keeps a single
/// malformed field (e.g. an AI/plugin-produced subtask returned as
/// `{ "title": "..." }`) from failing deserialization of a whole `Vec<Task>`
/// and bricking every heuristic command (cleanup, risk, auto-organize, …).
fn lenient_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Array(items) => items
            .iter()
            .map(lenient_string)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(map) => {
            for key in STRING_LIKE_KEYS {
                if let Some(Value::String(s)) = map.get(key) {
                    if !s.trim().is_empty() {
                        return s.clone();
                    }
                }
            }
            String::new()
        }
        Value::Null => String::new(),
    }
}

fn de_lenient_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(lenient_string(&Value::deserialize(deserializer)?))
}

fn de_lenient_opt_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Value>::deserialize(deserializer)?
        .map(|v| lenient_string(&v))
        .filter(|s| !s.is_empty()))
}

fn de_lenient_string_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(match Value::deserialize(deserializer)? {
        Value::Array(items) => items
            .iter()
            .map(lenient_string)
            .filter(|s| !s.is_empty())
            .collect(),
        Value::Null => Vec::new(),
        other => {
            let s = lenient_string(&other);
            if s.is_empty() { Vec::new() } else { vec![s] }
        }
    })
}

/// Board columns where work is done or merged — no longer active for heuristics.
pub fn is_terminal_status(status: &str) -> bool {
    status == "Completed" || status == "Commit"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Subtask {
    #[serde(default, deserialize_with = "de_lenient_string")]
    pub id: String,
    #[serde(default, deserialize_with = "de_lenient_string")]
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskLink {
    #[serde(default, rename = "targetTaskId", deserialize_with = "de_lenient_string")]
    pub target_task_id: String,
    /// "blocks" | "blocked-by" | "relates-to" | "duplicates"
    #[serde(default, rename = "type", deserialize_with = "de_lenient_string")]
    pub link_type: String,
}

/// Recurrence config. Dates are epoch millis (see module note).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecurringConfig {
    #[serde(default)]
    pub enabled: bool,
    /// "daily" | "weekly" | "monthly" | "custom"
    #[serde(default, deserialize_with = "de_lenient_string")]
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
    #[serde(deserialize_with = "de_lenient_string")]
    pub id: String,
    #[serde(deserialize_with = "de_lenient_string")]
    pub job_id: String,
    #[serde(deserialize_with = "de_lenient_string")]
    pub project_id: String,
    #[serde(deserialize_with = "de_lenient_string")]
    pub title: String,
    #[serde(deserialize_with = "de_lenient_opt_string")]
    pub subtitle: Option<String>,
    #[serde(deserialize_with = "de_lenient_string")]
    pub summary: String,
    #[serde(default, deserialize_with = "de_lenient_string")]
    pub assignee: String,
    #[serde(default, deserialize_with = "de_lenient_string")]
    pub priority: String,
    #[serde(default, deserialize_with = "de_lenient_string")]
    pub status: String,
    pub created_at: i64,
    pub updated_at: Option<i64>,
    pub due_date: Option<i64>,
    pub completed_at: Option<i64>,
    pub subtasks: Vec<Subtask>,
    #[serde(deserialize_with = "de_lenient_string_vec")]
    pub tags: Vec<String>,
    pub time_estimate: f64,
    pub time_spent: f64,
    pub links: Option<Vec<TaskLink>>,
    /// We only ever need the *count* of activity entries; keep them opaque.
    pub activity: Option<Vec<serde_json::Value>>,
    pub recurring: Option<RecurringConfig>,
}

impl Task {
    /// True when the task is in a terminal column or has a completion timestamp.
    pub fn is_terminal(&self) -> bool {
        self.completed_at.is_some() || is_terminal_status(&self.status)
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_deserializes_object_shaped_string_fields() {
        // Regression: a single object-where-string field previously failed the
        // whole `Vec<Task>` deserialization and bricked cleanup/risk/auto-organize.
        let value = serde_json::json!({
            "id": "t1",
            "title": { "text": "Redesign the pill" },
            "summary": { "value": "make it modern" },
            "subtitle": { "title": "UI" },
            "tags": ["ui", { "name": "design" }, ""],
            "subtasks": [
                { "id": "s1", "title": { "title": "Locate component" }, "completed": false },
                { "id": "s2", "title": "Rework styles" }
            ]
        });

        let task: Task = serde_json::from_value(value).expect("must not error");
        assert_eq!(task.title, "Redesign the pill");
        assert_eq!(task.summary, "make it modern");
        assert_eq!(task.subtitle.as_deref(), Some("UI"));
        assert_eq!(task.tags, vec!["ui".to_string(), "design".to_string()]);
        assert_eq!(task.subtasks.len(), 2);
        assert_eq!(task.subtasks[0].title, "Locate component");
        assert_eq!(task.subtasks[1].title, "Rework styles");
    }

    #[test]
    fn task_deserializes_lenient_assignee_and_status() {
        let value = serde_json::json!({
            "id": { "value": "t4" },
            "assignee": { "name": "Alice" },
            "status": { "label": "Commit" },
            "priority": { "text": "high" },
            "projectId": { "title": "p1" },
            "jobId": { "name": "LT-1" }
        });
        let task: Task = serde_json::from_value(value).unwrap();
        assert_eq!(task.id, "t4");
        assert_eq!(task.assignee, "Alice");
        assert_eq!(task.status, "Commit");
        assert_eq!(task.priority, "high");
        assert_eq!(task.project_id, "p1");
        assert_eq!(task.job_id, "LT-1");
    }

    #[test]
    fn task_still_defaults_missing_fields() {
        let task: Task = serde_json::from_value(serde_json::json!({ "id": "t2" }))
            .expect("partial DTO must deserialize");
        assert_eq!(task.id, "t2");
        assert_eq!(task.title, "");
        assert!(task.subtitle.is_none());
        assert!(task.tags.is_empty());
        assert!(task.subtasks.is_empty());
    }

    #[test]
    fn normal_string_fields_are_unaffected() {
        let value = serde_json::json!({
            "id": "t3",
            "title": "Plain title",
            "summary": "Plain summary",
            "tags": ["a", "b"],
            "subtasks": [{ "id": "s", "title": "Do it", "completed": true }]
        });
        let task: Task = serde_json::from_value(value).unwrap();
        assert_eq!(task.title, "Plain title");
        assert_eq!(task.tags, vec!["a".to_string(), "b".to_string()]);
        assert!(task.subtasks[0].completed);
    }
}
