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
pub fn cleanup_heuristic_merge(tasks: Vec<Task>) -> MergeSuggestion {
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
