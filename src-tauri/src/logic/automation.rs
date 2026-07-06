//! Thin `#[tauri::command]` wrappers over `liquitask_core::automation`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! `recurring_advance` / `risk_heuristics`), so the renderer calls:
//!   invoke("automation_apply_actions", { rules, task })
//!   invoke("automation_is_rule_due",   { rule, nowMs })
//!
//! Only the deterministic action reducer and schedule due-check run here. The
//! TS service still filters matching rules (trigger + enabled + CONDITION
//! evaluation via the query engine) and fires the notify / assign callbacks;
//! it passes only the already-matched rules into `automation_apply_actions`.

use serde_json::Value;

use liquitask_core::automation::{self, ApplyResult};
use liquitask_core::model::Task;

/// Reduce a list of ALREADY-MATCHED rules' actions over `task`, returning the
/// `{ updates, tags, notifications, assignToAgentIds, hasUpdates }` payload the
/// TS service consumes (it applies `updates`, and fires notify / assign for the
/// collected messages and agent ids).
#[tauri::command]
pub fn automation_apply_actions(rules: Vec<Value>, task: Task) -> ApplyResult {
    automation::apply_actions(&rules, &task)
}

/// Whether a scheduled rule is due at `now_ms` (epoch millis). Mirrors the
/// private `isRuleDue`; used by the scheduler's per-minute tick.
#[tauri::command]
pub fn automation_is_rule_due(rule: Value, now_ms: i64) -> bool {
    automation::is_rule_due(&rule, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn apply_actions_command_reduces() {
        let rules = vec![json!({
            "id": "r1",
            "actions": [
                { "type": "addTag", "value": "auto" },
                { "type": "setPriority", "value": "High" }
            ]
        })];
        let task = Task {
            id: "1".to_string(),
            tags: vec!["tag1".to_string()],
            ..Default::default()
        };
        let out = automation_apply_actions(rules, task);
        assert!(out.has_updates);
        assert_eq!(out.updates.get("priority"), Some(&json!("High")));
        assert_eq!(out.updates.get("tags"), Some(&json!(["tag1", "auto"])));
    }

    #[test]
    fn is_rule_due_command_matches_time() {
        // 1970-01-01T00:00:00Z -> "00:00", Thursday (getDay() == 4).
        let rule = json!({ "schedule": { "frequency": "daily", "time": "00:00" } });
        assert!(automation_is_rule_due(rule, 0));
        let rule2 = json!({ "schedule": { "frequency": "daily", "time": "00:01" } });
        assert!(!automation_is_rule_due(rule2, 0));
    }
}
