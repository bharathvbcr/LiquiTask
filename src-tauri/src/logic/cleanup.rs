//! Thin `#[tauri::command]` wrappers over `liquitask_core::cleanup`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! `risk_heuristics` / `recurring_advance`), so the renderer calls e.g.:
//!   invoke("cleanup_heuristic_duplicates", { tasks, threshold })
//!   invoke("cleanup_analyze_redundancy",   { tasks, nowMs })
//!   invoke("cleanup_heuristic_categorize", { tasks, nowMs })
//!
//! Only the deterministic heuristic logic runs here; every `aiService` call and
//! every `storageService` read stays in the TypeScript service. The returned
//! structural data (task-id groupings, confidences, reasoning, merged fields) is
//! id-free — the TS wrapper assembles the final typed objects and generates the
//! random ids exactly as the original did.

use liquitask_core::cleanup::{
    self, CategorySuggestion, DuplicateGroup, MergeSuggestion, RedundancyAnalysis, TaskCluster,
};
use liquitask_core::model::Task;

/// Heuristic duplicate groups: `{ taskIds, confidence }` per group.
#[tauri::command]
pub fn cleanup_heuristic_duplicates(tasks: Vec<Task>, threshold: f64) -> Vec<DuplicateGroup> {
    cleanup::heuristic_duplicate_detection(&tasks, threshold)
}

/// Heuristic merge suggestion for a group of (already-selected) tasks.
#[tauri::command]
pub fn cleanup_heuristic_merge(tasks: Vec<Task>) -> Result<MergeSuggestion, String> {
    cleanup::heuristic_merge_suggestion(&tasks)
}

/// Redundancy analysis (fully deterministic; no AI). `now_ms` is the reference
/// instant supplied by the renderer.
#[tauri::command]
pub fn cleanup_analyze_redundancy(tasks: Vec<Task>, now_ms: i64) -> Vec<RedundancyAnalysis> {
    cleanup::analyze_redundancy(&tasks, now_ms)
}

/// Heuristic categorization: suggested tags + priority per task. `now_ms`
/// replaces the original `Date.now()` used by the priority heuristic.
#[tauri::command]
pub fn cleanup_heuristic_categorize(tasks: Vec<Task>, now_ms: i64) -> Vec<CategorySuggestion> {
    cleanup::heuristic_categorization(&tasks, now_ms)
}

/// Heuristic clustering: word-overlap task clusters with theme + common tags.
#[tauri::command]
pub fn cleanup_heuristic_cluster(tasks: Vec<Task>) -> Vec<TaskCluster> {
    cleanup::heuristic_clustering(&tasks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use liquitask_core::model::Subtask;

    fn sample_task(id: &str, title: &str) -> Task {
        Task {
            id: id.to_string(),
            title: title.to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn merge_wrapper_roundtrip() {
        let mut keep = sample_task("keep", "Task A");
        keep.subtasks = vec![Subtask {
            id: "s1".to_string(),
            title: "sub".to_string(),
            completed: false,
        }];
        let other = sample_task("other", "Task B");
        let out = cleanup_heuristic_merge(vec![keep, other]).expect("merge ok");
        assert_eq!(out.keep_task_id, "keep");
        assert_eq!(out.archive_task_ids, vec!["other"]);
    }

    #[test]
    fn merge_wrapper_rejects_empty() {
        assert!(cleanup_heuristic_merge(vec![]).is_err());
    }

    #[test]
    fn redundancy_wrapper_roundtrip() {
        let now = 1_700_000_000_000i64;
        let active = sample_task("act", "deploy api");
        let mut done = sample_task("done", "deploy api");
        done.status = "Commit".to_string();
        let out = cleanup_analyze_redundancy(vec![active, done], now);
        assert!(out.iter().any(|a| a.analysis_type == "completed-overlap"));
    }

    #[test]
    fn categorize_and_cluster_wrappers_roundtrip() {
        let now = 1_700_000_000_000i64;
        let t = sample_task("t", "fix api bug");
        let cats = cleanup_heuristic_categorize(vec![t.clone()], now);
        assert_eq!(cats.len(), 1);
        assert!(cats[0].suggested_tags.contains(&"bug".to_string()));

        let a = sample_task("a", "deploy api service");
        let b = sample_task("b", "deploy api gateway");
        let clusters = cleanup_heuristic_cluster(vec![a, b]);
        assert_eq!(clusters.len(), 1);
    }
}
