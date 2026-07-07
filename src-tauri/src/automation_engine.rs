//! Automation rule action merging (ported core from automationService.ts).
//!
//! Condition evaluation remains in TS (query engine UI dependency) for now;
//! Rust owns deterministic action aggregation.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const MUTABLE_TASK_FIELDS: [&str; 5] = ["assignee", "summary", "title", "subtitle", "timeEstimate"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationActionInput {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub field: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRuleInput {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Unused until condition evaluation moves from TS into Rust.
    #[allow(dead_code)]
    pub trigger: String,
    #[serde(default)]
    pub actions: Vec<AutomationActionInput>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    /// Unused until condition evaluation moves from TS into Rust.
    #[allow(dead_code)]
    pub id: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Unused until condition evaluation moves from TS into Rust.
    #[allow(dead_code)]
    #[serde(default)]
    pub status: String,
    /// Unused until condition evaluation moves from TS into Rust.
    #[allow(dead_code)]
    #[serde(default)]
    pub priority: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessAutomationRequest {
    /// Unused until condition evaluation moves from TS into Rust.
    #[allow(dead_code)]
    pub event: String,
    pub task: TaskSnapshot,
    pub rules: Vec<AutomationRuleInput>,
    #[serde(default)]
    pub matched_rule_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessAutomationResponse {
    pub updates: Map<String, Value>,
    pub tags_to_add: Vec<String>,
    pub tags_to_remove: Vec<String>,
    pub notifications: Vec<String>,
    pub assign_to_agent_ids: Vec<String>,
}

pub fn merge_automation_actions(
    task: &TaskSnapshot,
    rules: &[AutomationRuleInput],
    matched_rule_ids: &[String],
) -> ProcessAutomationResponse {
    let mut updates = Map::new();
    let mut tags_to_add = Vec::new();
    let mut tags_to_remove = Vec::new();
    let mut notifications = Vec::new();
    let mut assign_to_agent_ids = Vec::new();

    let matched: Vec<&AutomationRuleInput> = if matched_rule_ids.is_empty() {
        rules.iter().filter(|r| r.enabled).collect()
    } else {
        rules
            .iter()
            .filter(|r| matched_rule_ids.contains(&r.id))
            .collect()
    };

    for rule in matched {
        for action in &rule.actions {
            match action.action_type.as_str() {
                "setField" => {
                    if let (Some(field), Some(value)) = (&action.field, &action.value) {
                        if MUTABLE_TASK_FIELDS.contains(&field.as_str()) {
                            updates.insert(field.clone(), value.clone());
                        }
                    }
                }
                "addTag" => {
                    if let Some(Value::String(tag)) = &action.value {
                        tags_to_add.push(tag.clone());
                    }
                }
                "removeTag" => {
                    if let Some(Value::String(tag)) = &action.value {
                        tags_to_remove.push(tag.clone());
                    }
                }
                "moveToColumn" => {
                    if let Some(Value::String(status)) = &action.value {
                        updates.insert("status".to_string(), Value::String(status.clone()));
                    }
                }
                "setPriority" => {
                    if let Some(Value::String(priority)) = &action.value {
                        updates.insert("priority".to_string(), Value::String(priority.clone()));
                    }
                }
                "notify" => {
                    if let Some(Value::String(msg)) = &action.value {
                        notifications.push(msg.clone());
                    }
                }
                "assignToAgent" => {
                    if let Some(Value::String(agent)) = &action.value {
                        assign_to_agent_ids.push(agent.clone());
                    }
                }
                _ => {}
            }
        }
    }

    if !tags_to_add.is_empty() || !tags_to_remove.is_empty() {
        let mut new_tags = task
            .tags
            .iter()
            .filter(|t| !tags_to_remove.contains(t))
            .cloned()
            .collect::<Vec<_>>();
        for tag in &tags_to_add {
            if !new_tags.contains(tag) {
                new_tags.push(tag.clone());
            }
        }
        updates.insert("tags".to_string(), Value::Array(
            new_tags.into_iter().map(Value::String).collect(),
        ));
    }

    notifications.sort_unstable();
    notifications.dedup();
    assign_to_agent_ids.sort_unstable();
    assign_to_agent_ids.dedup();

    ProcessAutomationResponse {
        updates,
        tags_to_add,
        tags_to_remove,
        notifications,
        assign_to_agent_ids,
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn automation_process_actions(
    request: ProcessAutomationRequest,
) -> Result<ProcessAutomationResponse, String> {
    Ok(merge_automation_actions(
        &request.task,
        &request.rules,
        &request.matched_rule_ids,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_tags_and_priority() {
        let response = merge_automation_actions(
            &TaskSnapshot {
                id: "t1".to_string(),
                tags: vec!["a".to_string()],
                status: "open".to_string(),
                priority: "low".to_string(),
            },
            &[AutomationRuleInput {
                id: "r1".to_string(),
                enabled: true,
                trigger: "onCreate".to_string(),
                actions: vec![
                    AutomationActionInput {
                        action_type: "addTag".to_string(),
                        value: Some(Value::String("urgent".to_string())),
                        field: None,
                    },
                    AutomationActionInput {
                        action_type: "setPriority".to_string(),
                        value: Some(Value::String("high".to_string())),
                        field: None,
                    },
                ],
            }],
            &[],
        );
        assert_eq!(
            response.updates.get("priority").and_then(Value::as_str),
            Some("high")
        );
        let tags = response.updates.get("tags").unwrap().as_array().unwrap();
        assert!(tags.iter().any(|v| v.as_str() == Some("urgent")));
    }
}
