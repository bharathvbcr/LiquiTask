//! Thin `#[tauri::command]` wrapper over `liquitask_core::risk`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! `recurring_advance`), so the renderer calls:
//!   invoke("risk_heuristics", { tasks, nowMs })
//!
//! Only the deterministic heuristic half of `analyzeProjectRisks` runs here;
//! the AI enrichment and merge stay in the TypeScript service.

use liquitask_core::model::Task;
use liquitask_core::risk::{self, RiskHeuristics};

/// Critical path + heuristic risks + overall score + prediction message.
///
/// `now_ms` is the reference instant (epoch millis) supplied by the renderer;
/// the core never reads a clock. Returns camelCase JSON matching the TS
/// `ProjectRiskSummary`/`RiskAssessment` shapes.
#[tauri::command]
pub fn risk_heuristics(tasks: Vec<Task>, now_ms: i64) -> RiskHeuristics {
    risk::heuristics(&tasks, now_ms)
}
