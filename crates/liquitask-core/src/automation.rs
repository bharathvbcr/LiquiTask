//! Port of `src/services/automationService.ts` pure logic.
//!
//! Only the deterministic *action reducer* and the *schedule due-check* move to
//! Rust. Everything stateful or effectful stays in TypeScript:
//!   * the scheduler (`setInterval`) and rule storage,
//!   * the `notify` / `onAssignToAgent` callbacks (fired in TS),
//!   * and — importantly — **condition evaluation** (`evaluateConditions` /
//!     `executeAdvancedFilter`, the query engine). The TS service filters the
//!     matching rules (trigger + enabled + conditions) itself and passes only
//!     the ALREADY-MATCHED rules here.
//!
//! Time rule (see `model` / `dateutil`): the reference clock (`new Date()` in
//! the original scheduler) crosses in as `now_ms` (epoch millis) plus
//! `timezone_offset_minutes` (JS `getTimezoneOffset()`). We NEVER read a clock
//! here; `is_rule_due` decomposes local wall-clock civil components.
//!
//! Action shape is a serde union, read defensively to mirror the JS `switch`:
//!   * `{ type: "setField", field, value }` — `value` may be ANY JSON type.
//!   * `{ type, value }` — for tag/move/priority/notify/assign; each of those
//!     branches only fires when `typeof value === "string"`.
//! Modeling actions as `serde_json::Value` lets us reproduce the exact type
//! guards (a non-string `value` for e.g. `addTag` is silently ignored, just
//! like the original).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::dateutil::Civil;
use crate::model::Task;

/// Explicit allowlist of task fields an automation rule may mutate via
/// `setField`. Mirrors `MUTABLE_TASK_FIELDS` in the TS service exactly.
/// Internal/integrity fields (id, projectId, createdAt, …) are intentionally
/// excluded so user/AI-authored rules cannot corrupt them.
const MUTABLE_TASK_FIELDS: &[&str] = &[
    "assignee",
    "summary",
    "title",
    "subtitle",
    "timeEstimate",
    "dueDate",
];

/// Result of reducing a set of matched rules' actions over a task.
///
/// `serde(rename_all = "camelCase")` so the JSON handed back to the renderer
/// matches the TS-side `NativeAutomationResult` shape (updates, tags,
/// notifications, assignToAgentIds, hasUpdates).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    /// The `Partial<Task>` update payload: any `setField` fields, plus `status`
    /// / `priority` / `tags` when their actions fired. Values are preserved
    /// verbatim (a `setField` value can be any JSON type, matching the JS which
    /// assigns `action.value` unchanged).
    pub updates: Map<String, Value>,
    /// The merged tag list, present only when at least one add/remove tag
    /// action fired (mirrors `updates.tags` being set conditionally in TS).
    /// This is redundant with `updates["tags"]` but exposed for convenience.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Notify messages, deduped + trimmed exactly like the original
    /// (`trim()` -> drop empty -> unique, preserving first-seen order).
    pub notifications: Vec<String>,
    /// Agent ids to assign, unique and preserving first-seen order.
    pub assign_to_agent_ids: Vec<String>,
    /// `Object.keys(updates).length > 0` in the original — true iff `updates`
    /// carries at least one key. The TS reducer returns `null` when false.
    pub has_updates: bool,
}

/// Read `obj["key"]` as a `&str`, `None` unless it is a JSON string.
/// This reproduces the JS `typeof value === "string"` guard used by the
/// tag/move/priority/notify/assign branches.
fn str_field<'a>(obj: &'a Value, key: &str) -> Option<&'a str> {
    obj.get(key).and_then(Value::as_str)
}

/// Faithful port of the action-application loop inside
/// `AutomationService.processTaskEvent` (the JS/web fallback path).
///
/// `rules` are the ALREADY-MATCHED rules (trigger + enabled + conditions were
/// checked in TS). Each element is the raw rule JSON; only its `actions` array
/// is read here. `task` supplies the current `tags` used for the tag merge.
///
/// The reducer walks every action of every rule in order and mirrors the JS
/// `switch` branch-for-branch, including the type guards. Tag merges, notify
/// dedup/trim and agent-id de-duplication match the original precisely.
pub fn apply_actions(rules: &[Value], task: &Task) -> ApplyResult {
    let mut updates: Map<String, Value> = Map::new();
    let mut tags_to_add: Vec<String> = Vec::new();
    let mut tags_to_remove: Vec<String> = Vec::new();
    let mut notifications: Vec<String> = Vec::new();
    let mut assign_to_agent_ids: Vec<String> = Vec::new();

    for rule in rules {
        // `rule.actions` — skip anything that is not an array of objects.
        let actions = match rule.get("actions").and_then(Value::as_array) {
            Some(a) => a,
            None => continue,
        };

        for action in actions {
            let action_type = match str_field(action, "type") {
                Some(t) => t,
                None => continue,
            };

            match action_type {
                "setField" => {
                    // The JS guard is `if (action.field && MUTABLE_TASK_FIELDS.has(...))`.
                    // `action.field` must be a truthy string; `value` is stored
                    // as-is (any JSON type, incl. an explicit `null`). When the
                    // `value` key is ABSENT, TS assigns `action.value === undefined`,
                    // which `JSON.stringify` drops on the wire — so we insert
                    // nothing (rather than a `null`) to match that observable result.
                    if let Some(field) = str_field(action, "field") {
                        if !field.is_empty() && MUTABLE_TASK_FIELDS.contains(&field) {
                            if let Some(value) = action.get("value") {
                                updates.insert(field.to_string(), value.clone());
                            }
                        }
                    }
                }
                "addTag" => {
                    if let Some(v) = str_field(action, "value") {
                        tags_to_add.push(v.to_string());
                    }
                }
                "removeTag" => {
                    if let Some(v) = str_field(action, "value") {
                        tags_to_remove.push(v.to_string());
                    }
                }
                "moveToColumn" => {
                    if let Some(v) = str_field(action, "value") {
                        updates.insert("status".to_string(), Value::String(v.to_string()));
                    }
                }
                "setPriority" => {
                    if let Some(v) = str_field(action, "value") {
                        updates.insert("priority".to_string(), Value::String(v.to_string()));
                    }
                }
                "notify" => {
                    if let Some(v) = str_field(action, "value") {
                        notifications.push(v.to_string());
                    }
                }
                "assignToAgent" => {
                    if let Some(v) = str_field(action, "value") {
                        assign_to_agent_ids.push(v.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    // ---- Merge tag changes (only when an add/remove action fired) ----------
    // newTags = currentTags without the removed ones, then the added ones that
    // are not already present — preserving order exactly like the JS spread.
    let mut merged_tags: Option<Vec<String>> = None;
    if !tags_to_add.is_empty() || !tags_to_remove.is_empty() {
        let current_tags = &task.tags;
        let mut new_tags: Vec<String> = current_tags
            .iter()
            .filter(|t| !tags_to_remove.contains(*t))
            .cloned()
            .collect();
        for t in &tags_to_add {
            // `.filter((t) => !currentTags.includes(t))` — dedupe against the
            // ORIGINAL current tags (not the running result), matching the JS.
            if !current_tags.contains(t) {
                new_tags.push(t.clone());
            }
        }
        updates.insert(
            "tags".to_string(),
            Value::Array(new_tags.iter().cloned().map(Value::String).collect()),
        );
        merged_tags = Some(new_tags);
    }

    // ---- Dedup + trim notifications ---------------------------------------
    // Array.from(new Set(notifications.map(trim).filter(Boolean))) — trim,
    // drop empty, keep unique in first-seen order.
    let mut deduped_notifications: Vec<String> = Vec::new();
    for n in &notifications {
        let trimmed = n.trim();
        if trimmed.is_empty() {
            continue;
        }
        let trimmed = trimmed.to_string();
        if !deduped_notifications.contains(&trimmed) {
            deduped_notifications.push(trimmed);
        }
    }

    // ---- Unique agent ids (first-seen order), like Array.from(new Set(...)) -
    let mut unique_agent_ids: Vec<String> = Vec::new();
    for id in &assign_to_agent_ids {
        if !unique_agent_ids.contains(id) {
            unique_agent_ids.push(id.clone());
        }
    }

    let has_updates = !updates.is_empty();

    ApplyResult {
        updates,
        tags: merged_tags,
        notifications: deduped_notifications,
        assign_to_agent_ids: unique_agent_ids,
        has_updates,
    }
}

/// Faithful port of the private `AutomationService.isRuleDue`.
///
/// `now_ms` replaces the original `now: Date`. The original reads
/// `getHours()/getMinutes()/getDay()/getDate()` in **local** wall-clock time;
/// here we shift epoch millis by `timezone_offset_minutes` (JS
/// `getTimezoneOffset()`) before decomposing into civil components. Returns
/// `false` when the rule has no `schedule`.
pub fn is_rule_due(rule: &Value, now_ms: i64, timezone_offset_minutes: i64) -> bool {
    let schedule = match rule.get("schedule") {
        Some(s) if s.is_object() => s,
        _ => return false, // `if (!rule.schedule) return false;`
    };

    let local_ms = now_ms - timezone_offset_minutes * 60_000;
    let civil = Civil::from_millis(local_ms);

    // currentTime = `${HH}:${mm}` with zero-padding (getHours()/getMinutes()).
    let current_time = format!("{:02}:{:02}", civil.hour, civil.minute);
    match str_field(schedule, "time") {
        Some(t) if t == current_time => {}
        // `if (rule.schedule.time !== currentTime) return false;`
        _ => return false,
    }

    let frequency = str_field(schedule, "frequency").unwrap_or("");

    // weekly: `typeof dayOfWeek === "number"` -> `getDay() === dayOfWeek`. The TS
    // compares an integer weekday against the RAW number with `===`, so a
    // fractional `dayOfWeek` (e.g. 1.5) never matches. Compare as `f64` to
    // reproduce that exactly — do NOT truncate the number to an int.
    if frequency == "weekly" {
        if let Some(dow) = schedule.get("dayOfWeek").and_then(Value::as_f64) {
            return civil.weekday() as f64 == dow;
        }
    }

    // monthly: `typeof dayOfMonth === "number"` -> `getDate() === dayOfMonth`.
    if frequency == "monthly" {
        if let Some(dom) = schedule.get("dayOfMonth").and_then(Value::as_f64) {
            return civil.day as f64 == dom;
        }
    }

    // Daily (or weekly/monthly without the discriminating day field): the time
    // already matched, so the rule is due.
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn task_with_tags(tags: &[&str]) -> Task {
        Task {
            id: "t1".to_string(),
            tags: tags.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn rule(actions: Value) -> Value {
        json!({ "id": "r", "enabled": true, "trigger": "onCreate", "actions": actions })
    }

    #[test]
    fn add_tag_merges_preserving_order() {
        let t = task_with_tags(&["tag1"]);
        let rules = vec![rule(json!([{ "type": "addTag", "value": "auto" }]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.tags, Some(vec!["tag1".to_string(), "auto".to_string()]));
        assert_eq!(out.updates.get("tags"), Some(&json!(["tag1", "auto"])));
        assert!(out.has_updates);
    }

    #[test]
    fn add_tag_dedupes_against_current() {
        let t = task_with_tags(&["a", "b"]);
        let rules = vec![rule(json!([
            { "type": "addTag", "value": "b" },
            { "type": "addTag", "value": "c" }
        ]))];
        let out = apply_actions(&rules, &t);
        // "b" already present, dropped; "c" appended.
        assert_eq!(out.tags, Some(vec!["a".into(), "b".into(), "c".into()]));
    }

    #[test]
    fn remove_tag_yields_empty() {
        let t = task_with_tags(&["tag1"]);
        let rules = vec![rule(json!([{ "type": "removeTag", "value": "tag1" }]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.tags, Some(Vec::<String>::new()));
        assert_eq!(out.updates.get("tags"), Some(&json!([])));
    }

    #[test]
    fn set_field_only_allows_allowlist() {
        let t = task_with_tags(&[]);
        let rules = vec![rule(json!([
            { "type": "setField", "field": "assignee", "value": "Bob" },
            { "type": "setField", "field": "id", "value": "HACK" },
            { "type": "setField", "field": "", "value": "nope" }
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.updates.get("assignee"), Some(&json!("Bob")));
        assert!(!out.updates.contains_key("id"));
        assert!(!out.updates.contains_key(""));
    }

    #[test]
    fn set_field_preserves_non_string_value() {
        let t = task_with_tags(&[]);
        let rules = vec![rule(json!([
            { "type": "setField", "field": "timeEstimate", "value": 120 }
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.updates.get("timeEstimate"), Some(&json!(120)));
    }

    #[test]
    fn set_field_absent_value_writes_nothing() {
        let t = task_with_tags(&[]);
        // `value` key absent — TS assigns `undefined`, which JSON.stringify drops,
        // so the field must NOT be written (previously this inserted a null).
        let rules = vec![rule(json!([{ "type": "setField", "field": "assignee" }]))];
        let out = apply_actions(&rules, &t);
        assert!(!out.updates.contains_key("assignee"));
    }

    #[test]
    fn set_field_explicit_null_is_preserved() {
        let t = task_with_tags(&[]);
        // An explicit `null` value DOES cross the boundary and is written.
        let rules = vec![rule(json!([
            { "type": "setField", "field": "assignee", "value": null }
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.updates.get("assignee"), Some(&Value::Null));
    }

    fn ms(y: i64, mo: i64, d: i64, h: i64, mi: i64) -> i64 {
        (crate::dateutil::Civil {
            year: y,
            month: mo,
            day: d,
            hour: h,
            minute: mi,
            second: 0,
            milli: 0,
        })
        .to_millis()
    }

    #[test]
    fn is_rule_due_fractional_day_never_matches() {
        // 2024-01-01T09:00Z is a Monday (weekday 1), day-of-month 1.
        let now = ms(2024, 1, 1, 9, 0);
        // Integer weekday 1 on a Monday -> due.
        let weekly_int =
            json!({ "schedule": { "frequency": "weekly", "time": "09:00", "dayOfWeek": 1 } });
        assert!(is_rule_due(&weekly_int, now, 0));
        // Fractional 1.5 -> JS `1 === 1.5` is false; must NOT truncate to 1.
        let weekly_frac =
            json!({ "schedule": { "frequency": "weekly", "time": "09:00", "dayOfWeek": 1.5 } });
        assert!(!is_rule_due(&weekly_frac, now, 0));
        // Monthly fractional day-of-month likewise never matches.
        let monthly_int =
            json!({ "schedule": { "frequency": "monthly", "time": "09:00", "dayOfMonth": 1 } });
        assert!(is_rule_due(&monthly_int, now, 0));
        let monthly_frac =
            json!({ "schedule": { "frequency": "monthly", "time": "09:00", "dayOfMonth": 1.7 } });
        assert!(!is_rule_due(&monthly_frac, now, 0));
    }

    #[test]
    fn move_and_priority_require_string() {
        let t = task_with_tags(&[]);
        let rules = vec![rule(json!([
            { "type": "moveToColumn", "value": "Done" },
            { "type": "setPriority", "value": 3 } // non-string -> ignored
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.updates.get("status"), Some(&json!("Done")));
        assert!(!out.updates.contains_key("priority"));
    }

    #[test]
    fn notifications_trim_and_dedup() {
        let t = task_with_tags(&[]);
        let rules = vec![rule(json!([
            { "type": "notify", "value": "  hi  " },
            { "type": "notify", "value": "hi" },
            { "type": "notify", "value": "   " },
            { "type": "notify", "value": "bye" }
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.notifications, vec!["hi".to_string(), "bye".to_string()]);
        // Notifications alone do not populate `updates`.
        assert!(!out.has_updates);
    }

    #[test]
    fn assign_ids_unique() {
        let t = task_with_tags(&[]);
        let rules = vec![rule(json!([
            { "type": "assignToAgent", "value": "a1" },
            { "type": "assignToAgent", "value": "a1" },
            { "type": "assignToAgent", "value": "a2" }
        ]))];
        let out = apply_actions(&rules, &t);
        assert_eq!(out.assign_to_agent_ids, vec!["a1".to_string(), "a2".to_string()]);
    }

    #[test]
    fn no_actions_no_updates() {
        let t = task_with_tags(&["x"]);
        let out = apply_actions(&[], &t);
        assert!(!out.has_updates);
        assert_eq!(out.tags, None);
        assert!(out.notifications.is_empty());
    }

    #[test]
    fn is_rule_due_daily_time_match() {
        // 2024-01-01T12:01:00Z
        let now = (Civil { year: 2024, month: 1, day: 1, hour: 12, minute: 1, second: 0, milli: 0 })
            .to_millis();
        let r = json!({ "schedule": { "frequency": "daily", "time": "12:01" } });
        assert!(is_rule_due(&r, now, 0));
        let r2 = json!({ "schedule": { "frequency": "daily", "time": "12:02" } });
        assert!(!is_rule_due(&r2, now, 0));
    }

    #[test]
    fn is_rule_due_no_schedule_false() {
        let r = json!({ "id": "r" });
        assert!(!is_rule_due(&r, 0, 0));
    }

    #[test]
    fn is_rule_due_weekly_matches_weekday() {
        // 2024-01-01 is a Monday (getDay() == 1) in UTC.
        let now = (Civil { year: 2024, month: 1, day: 1, hour: 9, minute: 0, second: 0, milli: 0 })
            .to_millis();
        let due = json!({ "schedule": { "frequency": "weekly", "time": "09:00", "dayOfWeek": 1 } });
        assert!(is_rule_due(&due, now, 0));
        let not_due =
            json!({ "schedule": { "frequency": "weekly", "time": "09:00", "dayOfWeek": 2 } });
        assert!(!is_rule_due(&not_due, now, 0));
    }

    #[test]
    fn is_rule_due_monthly_matches_day() {
        // Day-of-month 15.
        let now =
            (Civil { year: 2024, month: 3, day: 15, hour: 8, minute: 30, second: 0, milli: 0 })
                .to_millis();
        let due =
            json!({ "schedule": { "frequency": "monthly", "time": "08:30", "dayOfMonth": 15 } });
        assert!(is_rule_due(&due, now, 0));
        let not_due =
            json!({ "schedule": { "frequency": "monthly", "time": "08:30", "dayOfMonth": 16 } });
        assert!(!is_rule_due(&not_due, now, 0));
    }

    #[test]
    fn is_rule_due_uses_local_wall_clock_offset() {
        // UTC epoch for 2024-01-01T20:00:00Z. With PST offset (480 min), local
        // wall clock is 12:00 on Jan 1.
        let utc_ms = (Civil {
            year: 2024,
            month: 1,
            day: 1,
            hour: 20,
            minute: 0,
            second: 0,
            milli: 0,
        })
        .to_millis();
        let pst_offset = 480;
        let due = json!({ "schedule": { "frequency": "daily", "time": "12:00" } });
        assert!(is_rule_due(&due, utc_ms, pst_offset));
        let not_due = json!({ "schedule": { "frequency": "daily", "time": "20:00" } });
        assert!(!is_rule_due(&not_due, utc_ms, pst_offset));
    }

    #[test]
    fn is_rule_due_dst_boundary_local_date() {
        // US spring-forward 2024-03-10 at 2:00 AM PST -> 3:00 AM PDT.
        // Local midnight on that Sunday is still PST (offset 480).
        let utc_midnight = (Civil {
            year: 2024,
            month: 3,
            day: 10,
            hour: 8,
            minute: 0,
            second: 0,
            milli: 0,
        })
        .to_millis();
        let pst_offset = 480;
        let due = json!({
            "schedule": { "frequency": "weekly", "time": "00:00", "dayOfWeek": 0 }
        });
        assert!(is_rule_due(&due, utc_midnight, pst_offset));

        // After spring-forward, 3:30 AM PDT on the same day (offset 420).
        let utc_after = (Civil {
            year: 2024,
            month: 3,
            day: 10,
            hour: 10,
            minute: 30,
            second: 0,
            milli: 0,
        })
        .to_millis();
        let pdt_offset = 420;
        let morning = json!({ "schedule": { "frequency": "daily", "time": "03:30" } });
        assert!(is_rule_due(&morning, utc_after, pdt_offset));
    }
}
