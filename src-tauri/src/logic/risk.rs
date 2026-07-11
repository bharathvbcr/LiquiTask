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

#[cfg(test)]
mod tests {
    use super::*;
    use liquitask_core::model::TaskLink;

    #[test]
    fn risk_heuristics_wrapper_roundtrip() {
        let now = 1_700_000_000_000i64;
        let t2 = Task {
            id: "t2".to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            links: Some(vec![TaskLink {
                target_task_id: "t1".to_string(),
                link_type: "blocked-by".to_string(),
            }]),
            ..Default::default()
        };
        let t1 = Task {
            id: "t1".to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            ..Default::default()
        };
        let out = risk_heuristics(vec![t1, t2], now);
        assert_eq!(out.critical_path, vec!["t1", "t2"]);
        assert_eq!(out.risks.len(), 2);
    }

    #[test]
    fn risk_wrapper_survives_dependency_cycle() {
        let now = 1_700_000_000_000i64;
        let a = Task {
            id: "a".to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            links: Some(vec![TaskLink {
                target_task_id: "b".to_string(),
                link_type: "blocked-by".to_string(),
            }]),
            ..Default::default()
        };
        let b = Task {
            id: "b".to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            links: Some(vec![TaskLink {
                target_task_id: "a".to_string(),
                link_type: "blocked-by".to_string(),
            }]),
            ..Default::default()
        };
        let out = risk_heuristics(vec![a, b], now);
        assert!(!out.critical_path.is_empty());
    }
}
