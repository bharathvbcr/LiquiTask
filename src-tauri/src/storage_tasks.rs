//! Task JSON hydration/serialization and in-memory task-array CRUD.
//! Ports `parseTasks`, IndexedDB date handling, and storage orchestration from TS.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const DATE_FIELDS: [&str; 7] = [
    "createdAt",
    "updatedAt",
    "dueDate",
    "completedAt",
    "timestamp",
    "nextOccurrence",
    "endDate",
];

fn is_date_field(key: &str) -> bool {
    DATE_FIELDS.contains(&key)
}

fn parse_date_to_millis(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) if !s.is_empty() => {
            if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
                return Some(dt.timestamp_millis());
            }
            if let Ok(dt) = s.parse::<i64>() {
                return Some(dt);
            }
            None
        }
        _ => None,
    }
}

fn hydrate_dates(value: &mut Value) {
    match value {
        Value::Array(items) => {
            for item in items {
                hydrate_dates(item);
            }
        }
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if key == "customFieldValues" {
                    continue;
                }
                if is_date_field(key) {
                    if let Some(ms) = parse_date_to_millis(child) {
                        *child = Value::Number(ms.into());
                    }
                } else {
                    hydrate_dates(child);
                }
            }
        }
        _ => {}
    }
}

fn serialize_dates(value: &mut Value) {
    hydrate_dates(value);
}

/// Normalize stored task records: known date fields become epoch millis.
pub fn parse_stored_tasks(raw: Vec<Value>) -> Vec<Map<String, Value>> {
    raw.into_iter()
        .filter_map(|mut item| {
            hydrate_dates(&mut item);
            item.as_object().cloned()
        })
        .collect()
}

/// Prepare task records for persistence (dates as epoch millis).
pub fn serialize_stored_tasks(raw: Vec<Value>) -> Vec<Map<String, Value>> {
    raw.into_iter()
        .filter_map(|mut item| {
            serialize_dates(&mut item);
            item.as_object().cloned()
        })
        .collect()
}

fn task_id(task: &Map<String, Value>) -> Option<&str> {
    task.get("id").and_then(Value::as_str)
}

fn merge_task(base: &Map<String, Value>, patch: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = base.clone();
    for (key, value) in patch {
        merged.insert(key.clone(), value.clone());
    }
    merged
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutateRequest {
    pub op: String,
    #[serde(default)]
    pub tasks: Vec<Value>,
    #[serde(default)]
    pub task: Option<Value>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub task_ids: Option<Vec<String>>,
    #[serde(default)]
    pub patch: Option<Value>,
    #[serde(default)]
    pub new_tasks: Option<Vec<Value>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutateResponse {
    pub tasks: Vec<Map<String, Value>>,
}

pub fn mutate_tasks(request: TaskMutateRequest) -> Result<TaskMutateResponse, String> {
    let mut tasks = parse_stored_tasks(request.tasks);

    match request.op.as_str() {
        "create" => {
            let new_task = request
                .task
                .ok_or_else(|| "create requires task".to_string())?;
            let mut serialized = new_task;
            serialize_dates(&mut serialized);
            let map = serialized
                .as_object()
                .cloned()
                .ok_or_else(|| "task must be an object".to_string())?;
            if task_id(&map).is_none() {
                return Err("task.id is required".to_string());
            }
            tasks.push(map);
        }
        "update" => {
            let target_id = request
                .task_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "update requires taskId".to_string())?;
            let patch_val = request
                .patch
                .ok_or_else(|| "update requires patch".to_string())?;
            let mut patch_serialized = patch_val;
            serialize_dates(&mut patch_serialized);
            let patch = patch_serialized
                .as_object()
                .cloned()
                .ok_or_else(|| "patch must be an object".to_string())?;
            let idx = tasks
                .iter()
                .position(|t| task_id(t) == Some(target_id.as_str()))
                .ok_or_else(|| format!("task not found: {target_id}"))?;
            tasks[idx] = merge_task(&tasks[idx], &patch);
        }
        "delete" => {
            let target_id = request
                .task_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "delete requires taskId".to_string())?;
            tasks.retain(|t| task_id(t) != Some(target_id.as_str()));
        }
        "bulkUpsert" => {
            let new_tasks = request
                .new_tasks
                .ok_or_else(|| "bulkUpsert requires newTasks".to_string())?;
            for mut item in new_tasks {
                serialize_dates(&mut item);
                let map = item
                    .as_object()
                    .cloned()
                    .ok_or_else(|| "each newTask must be an object".to_string())?;
                let id = task_id(&map).ok_or_else(|| "each newTask requires id".to_string())?;
                if let Some(idx) = tasks.iter().position(|t| task_id(t) == Some(id)) {
                    tasks[idx] = merge_task(&tasks[idx], &map);
                } else {
                    tasks.push(map);
                }
            }
        }
        "bulkDelete" => {
            let ids: Vec<String> = request
                .task_ids
                .filter(|v| !v.is_empty())
                .ok_or_else(|| "bulkDelete requires taskIds".to_string())?;
            tasks.retain(|t| {
                task_id(t)
                    .map(|id| !ids.iter().any(|x| x == id))
                    .unwrap_or(true)
            });
        }
        "replace" => {
            tasks = parse_stored_tasks(
                request
                    .new_tasks
                    .ok_or_else(|| "replace requires newTasks".to_string())?,
            );
        }
        other => return Err(format!("unknown op: {other}")),
    }

    Ok(TaskMutateResponse { tasks })
}

#[tauri::command(rename_all = "camelCase")]
pub fn storage_parse_tasks(raw: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    Ok(parse_stored_tasks(raw))
}

#[tauri::command(rename_all = "camelCase")]
pub fn storage_serialize_tasks(raw: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    Ok(serialize_stored_tasks(raw))
}

#[tauri::command(rename_all = "camelCase")]
pub fn storage_tasks_mutate(request: TaskMutateRequest) -> Result<TaskMutateResponse, String> {
    mutate_tasks(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_iso_dates_to_millis() {
        let raw = vec![json!({
            "id": "t1",
            "createdAt": "2026-01-15T10:00:00.000Z",
            "recurring": {
                "enabled": true,
                "nextOccurrence": "2026-02-01T00:00:00.000Z"
            }
        })];
        let parsed = parse_stored_tasks(raw);
        assert!(parsed[0].get("createdAt").unwrap().is_number());
        let recurring = parsed[0].get("recurring").unwrap().as_object().unwrap();
        assert!(recurring.get("nextOccurrence").unwrap().is_number());
    }

    #[test]
    fn serialize_and_create_task() {
        let response = mutate_tasks(TaskMutateRequest {
            op: "create".to_string(),
            tasks: vec![],
            task: Some(json!({
                "id": "t2",
                "title": "New",
                "createdAt": "2026-01-15T10:00:00.000Z"
            })),
            task_id: None,
            task_ids: None,
            patch: None,
            new_tasks: None,
        })
        .unwrap();
        assert_eq!(response.tasks.len(), 1);
        assert!(response.tasks[0].get("createdAt").unwrap().is_number());
    }

    #[test]
    fn update_and_delete_task() {
        let base = vec![json!({ "id": "t1", "title": "A", "createdAt": 1 })];
        let updated = mutate_tasks(TaskMutateRequest {
            op: "update".to_string(),
            tasks: base.clone(),
            task: None,
            task_id: Some("t1".to_string()),
            task_ids: None,
            patch: Some(json!({ "title": "B" })),
            new_tasks: None,
        })
        .unwrap();
        assert_eq!(
            updated.tasks[0].get("title").and_then(Value::as_str),
            Some("B")
        );

        let deleted = mutate_tasks(TaskMutateRequest {
            op: "delete".to_string(),
            tasks: updated.tasks.into_iter().map(Value::Object).collect(),
            task: None,
            task_id: Some("t1".to_string()),
            task_ids: None,
            patch: None,
            new_tasks: None,
        })
        .unwrap();
        assert!(deleted.tasks.is_empty());
    }
}
