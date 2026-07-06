//! Thin `#[tauri::command]` wrappers over `liquitask_core::auto_organize`.
//!
//! Only the deterministic, structural helpers of the auto-organize pipeline are
//! exposed here; ALL `aiService` orchestration (deduplication, clustering,
//! tagging, hierarchy, project assignment, tag consolidation, apply) stays in
//! TypeScript. These commands just return structural data — the renderer keeps
//! the `Date.now()` / `Math.random()` id assembly.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! `workspace_read_file`), so the renderer calls:
//!   invoke("autoorg_filter_task_ids", { tasks, excludedProjectIds, maxTasksPerBatch })
//!   invoke("autoorg_dedup_candidate_pairs", { tasks })
//!   invoke("autoorg_consolidate_tags", { tags, before, suggested })

use liquitask_core::auto_organize;
use liquitask_core::model::Task;

/// Kept task ids after the exclude-projects + batch-cap pre-filter.
#[tauri::command]
pub fn autoorg_filter_task_ids(
    tasks: Vec<Task>,
    excluded_project_ids: Vec<String>,
    max_tasks_per_batch: i64,
) -> Vec<String> {
    auto_organize::filter_task_ids(&tasks, &excluded_project_ids, max_tasks_per_batch)
}

/// Unique unordered duplicate-candidate id-pairs from the title-word index.
/// Each pair is `[id_a, id_b]` in the original sorted-key order.
#[tauri::command]
pub fn autoorg_dedup_candidate_pairs(tasks: Vec<Task>) -> Vec<[String; 2]> {
    auto_organize::dedup_candidate_pairs(&tasks)
}

/// Remap a task's tags through `before -> suggested`, de-duped in order.
#[tauri::command]
pub fn autoorg_consolidate_tags(
    tags: Vec<String>,
    before: Vec<String>,
    suggested: String,
) -> Vec<String> {
    auto_organize::consolidate_tags(&tags, &before, &suggested)
}
