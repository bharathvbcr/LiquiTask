//! Port of `src/services/riskAnalysisService.ts` pure logic.
//!
//! Only the deterministic heuristics move to Rust: the critical-path search,
//! the per-task heuristic scoring, the overall score, and the prediction
//! message. The AI enrichment (`getAIRiskAssessment`) and the merge in
//! `analyzeProjectRisks` stay in TS because they call `aiService`.
//!
//! Time rule (see `model` / `dateutil`): the reference clock (`new Date()` in
//! the original) crosses in as `now_ms` (epoch millis). We NEVER read a clock
//! here. Task `dueDate` is already epoch millis on the DTO.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::model::Task;

/// Per-task risk assessment, mirroring the TS `RiskAssessment` interface.
///
/// `serde(rename_all = "camelCase")` so the JSON returned to the renderer
/// matches the existing TS shape (taskId, bottleneckTasks, ...).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RiskAssessment {
    pub task_id: String,
    pub score: f64,
    /// "low" | "medium" | "high"
    pub level: String,
    pub reason: String,
    pub bottleneck_tasks: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mitigation_suggestion: Option<String>,
}

/// Aggregate result of the heuristic half of `analyzeProjectRisks`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RiskHeuristics {
    pub critical_path: Vec<String>,
    pub risks: Vec<RiskAssessment>,
    pub overall_score: f64,
    pub prediction_message: String,
}

/// Faithful port of `RiskAnalysisService.calculateCriticalPath`.
///
/// Builds the "blocked-by" dependency graph (edge dep -> dependent) and returns
/// the longest chain via a memoized DFS. Iteration order of `tasks` is
/// preserved, and children are appended in encounter order, so ties resolve
/// exactly as the original (first-seen longest path wins because the length
/// comparison is strictly greater-than).
pub fn calculate_critical_path(tasks: &[Task]) -> Vec<String> {
    // adjacency: dependency id -> list of dependent task ids (in encounter order)
    let mut adj: HashMap<String, Vec<String>> = HashMap::new();

    for t in tasks {
        // Match the TS build loop: for each "blocked-by" link, record the edge
        // depId -> t.id. (The in-degree bookkeeping in the original is unused by
        // the path search, so we omit it — behaviour is identical.)
        for dep_id in t.blocked_by_ids() {
            adj.entry(dep_id).or_default().push(t.id.clone());
        }
    }

    let mut memo: HashMap<String, Vec<String>> = HashMap::new();

    // Memoized DFS returning the longest downstream chain starting at `id`.
    fn find_longest_path(
        id: &str,
        adj: &HashMap<String, Vec<String>>,
        memo: &mut HashMap<String, Vec<String>>,
    ) -> Vec<String> {
        if let Some(cached) = memo.get(id) {
            return cached.clone();
        }

        let children = adj.get(id).map(|c| c.as_slice()).unwrap_or(&[]);
        if children.is_empty() {
            // NOTE: the original does NOT memoize the leaf `[id]` case; it only
            // memoizes when children exist. We mirror that so behaviour is
            // identical (the result is the same either way, so this is safe).
            return vec![id.to_string()];
        }

        let mut longest_child_path: Vec<String> = Vec::new();
        for child_id in children {
            let path = find_longest_path(child_id, adj, memo);
            if path.len() > longest_child_path.len() {
                longest_child_path = path;
            }
        }

        let mut result = Vec::with_capacity(longest_child_path.len() + 1);
        result.push(id.to_string());
        result.extend(longest_child_path);
        memo.insert(id.to_string(), result.clone());
        result
    }

    let mut max_path: Vec<String> = Vec::new();
    for t in tasks {
        let path = find_longest_path(&t.id, &adj, &mut memo);
        if path.len() > max_path.len() {
            max_path = path;
        }
    }

    max_path
}

/// Faithful port of `RiskAnalysisService.calculateHeuristicRisks`.
///
/// `now_ms` replaces the original `new Date()`. `critical_path` is the output
/// of `calculate_critical_path`. Preserves the original's exact scoring, the
/// join-with-", " reason string, and the subtle detail that `level` is derived
/// from the *unclamped* score while the stored `score` is clamped to `<= 1.0`.
pub fn calculate_heuristic_risks(
    tasks: &[Task],
    critical_path: &[String],
    now_ms: i64,
) -> Vec<RiskAssessment> {
    let mut risks: Vec<RiskAssessment> = Vec::new();

    for task in tasks {
        let mut score: f64 = 0.0;
        let mut reasons: Vec<String> = Vec::new();

        // Risk 1: Overdue or near deadline.
        if let Some(due_ms) = task.due_date {
            if task.status != "Completed" {
                // (due - now) in days; matches the TS floating-point division.
                let diff =
                    (due_ms as f64 - now_ms as f64) / (1000.0 * 60.0 * 60.0 * 24.0);
                if diff < 0.0 {
                    score += 0.8;
                    reasons.push("Task is overdue".to_string());
                } else if diff < 2.0 {
                    score += 0.4;
                    reasons.push("Due within 48 hours".to_string());
                }
            }
        }

        // Risk 2: Critical path.
        if critical_path.iter().any(|id| id == &task.id) {
            score += 0.3;
            reasons.push("Task is on the critical path".to_string());
        }

        // Risk 3: Large estimate with high priority.
        if task.time_estimate > 480.0 && task.priority == "high" {
            score += 0.2;
            reasons.push("Large high-priority task (possible bottleneck)".to_string());
        }

        // Risk 4: Dependency density.
        let blocked_by = task.blocked_by_ids();
        let blockers = blocked_by.len();
        if blockers > 2 {
            score += 0.2;
            reasons.push(format!("Blocked by {} tasks", blockers));
        }

        if score > 0.2 {
            // `level` uses the raw score; `score` field is clamped to 1.0.
            let level = if score > 0.7 {
                "high"
            } else if score > 0.4 {
                "medium"
            } else {
                "low"
            };
            risks.push(RiskAssessment {
                task_id: task.id.clone(),
                score: score.min(1.0),
                level: level.to_string(),
                reason: reasons.join(", "),
                bottleneck_tasks: blocked_by,
                mitigation_suggestion: None,
            });
        }
    }

    risks
}

/// Faithful port of `RiskAnalysisService.calculateOverallScore`.
pub fn calculate_overall_score(risks: &[RiskAssessment]) -> f64 {
    if risks.is_empty() {
        return 0.0;
    }
    let high = risks.iter().filter(|r| r.level == "high").count() as f64;
    let medium = risks.iter().filter(|r| r.level == "medium").count() as f64;
    (high * 0.3 + medium * 0.1).min(1.0)
}

/// Faithful port of `RiskAnalysisService.generatePredictionMessage`.
pub fn generate_prediction_message(risks: &[RiskAssessment], cp_length: usize) -> String {
    let high = risks.iter().filter(|r| r.level == "high").count();
    if high > 2 {
        return format!(
            "Critical: {} major risks detected. Timeline is highly unstable.",
            high
        );
    }
    if cp_length > 5 {
        return format!(
            "Warning: Long critical path ({} steps). Any delay will cascade.",
            cp_length
        );
    }
    if !risks.is_empty() {
        return format!(
            "Project is healthy but watch out for {} potential issues.",
            risks.len()
        );
    }
    "Timeline looks solid! Low risk of delay.".to_string()
}

/// Compose the full heuristic half of `analyzeProjectRisks` (everything that
/// does NOT touch `aiService`). The TS service calls this via the
/// `risk_heuristics` command, then merges AI risks on top.
pub fn heuristics(tasks: &[Task], now_ms: i64) -> RiskHeuristics {
    let critical_path = calculate_critical_path(tasks);
    let risks = calculate_heuristic_risks(tasks, &critical_path, now_ms);
    let overall_score = calculate_overall_score(&risks);
    let prediction_message = generate_prediction_message(&risks, critical_path.len());
    RiskHeuristics {
        critical_path,
        risks,
        overall_score,
        prediction_message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TaskLink;

    const DAY_MS: i64 = 86_400_000;

    fn blocked_by(target: &str) -> TaskLink {
        TaskLink {
            target_task_id: target.to_string(),
            link_type: "blocked-by".to_string(),
        }
    }

    fn task(id: &str) -> Task {
        Task {
            id: id.to_string(),
            status: "Todo".to_string(),
            priority: "medium".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn critical_path_longest_chain() {
        // t3 -> t2 -> t1 via blocked-by; edges t1->t2->t3; longest is [t1,t2,t3].
        let mut t2 = task("t2");
        t2.links = Some(vec![blocked_by("t1")]);
        let mut t3 = task("t3");
        t3.links = Some(vec![blocked_by("t2")]);
        let tasks = vec![task("t1"), t2, t3];
        let cp = calculate_critical_path(&tasks);
        assert_eq!(cp, vec!["t1", "t2", "t3"]);
    }

    #[test]
    fn no_links_no_path_beyond_single() {
        let tasks = vec![task("a"), task("b")];
        // Each node is its own length-1 path; first-seen wins on ties.
        let cp = calculate_critical_path(&tasks);
        assert_eq!(cp, vec!["a"]);
    }

    #[test]
    fn overdue_task_is_high_risk() {
        let now = 1_700_000_000_000;
        let mut t = task("overdue");
        t.due_date = Some(now - DAY_MS); // yesterday
        let cp: Vec<String> = Vec::new();
        let risks = calculate_heuristic_risks(&[t], &cp, now);
        assert_eq!(risks.len(), 1);
        assert_eq!(risks[0].level, "high");
        assert!(risks[0].reason.contains("overdue"));
        assert!((risks[0].score - 0.8).abs() < 1e-9);
    }

    #[test]
    fn completed_overdue_task_is_ignored() {
        let now = 1_700_000_000_000;
        let mut t = task("done");
        t.status = "Completed".to_string();
        t.due_date = Some(now - DAY_MS);
        let cp: Vec<String> = Vec::new();
        let risks = calculate_heuristic_risks(&[t], &cp, now);
        assert!(risks.is_empty());
    }

    #[test]
    fn large_high_priority_alone_is_below_threshold() {
        // Only Risk 3 fires (+0.2), which is NOT > 0.2, so no risk is recorded.
        let now = 1_700_000_000_000;
        let mut t = task("big");
        t.priority = "high".to_string();
        t.time_estimate = 1000.0;
        let cp: Vec<String> = Vec::new();
        let risks = calculate_heuristic_risks(&[t], &cp, now);
        assert!(risks.is_empty());
    }

    #[test]
    fn score_clamped_but_level_from_raw() {
        // overdue (0.8) + on critical path (0.3) = raw 1.1 -> clamped 1.0, high.
        let now = 1_700_000_000_000;
        let mut t = task("x");
        t.due_date = Some(now - DAY_MS);
        let cp = vec!["x".to_string()];
        let risks = calculate_heuristic_risks(&[t], &cp, now);
        assert_eq!(risks.len(), 1);
        assert!((risks[0].score - 1.0).abs() < 1e-9);
        assert_eq!(risks[0].level, "high");
    }

    #[test]
    fn overall_score_and_message() {
        let now = 1_700_000_000_000;
        let mut a = task("a");
        a.due_date = Some(now - DAY_MS); // high
        let mut b = task("b");
        b.due_date = Some(now - DAY_MS); // high
        let mut c = task("c");
        c.due_date = Some(now - DAY_MS); // high
        let cp: Vec<String> = Vec::new();
        let risks = calculate_heuristic_risks(&[a, b, c], &cp, now);
        assert_eq!(risks.len(), 3);
        assert!((calculate_overall_score(&risks) - 0.9).abs() < 1e-9);
        let msg = generate_prediction_message(&risks, 0);
        assert!(msg.starts_with("Critical: 3 major risks"));
    }

    #[test]
    fn heuristics_composes() {
        let now = 1_700_000_000_000;
        let mut t2 = task("t2");
        t2.links = Some(vec![blocked_by("t1")]);
        let mut t3 = task("t3");
        t3.links = Some(vec![blocked_by("t2")]);
        let out = heuristics(&[task("t1"), t2, t3], now);
        assert_eq!(out.critical_path.len(), 3);
        // Only critical-path membership adds +0.3 each, which is > 0.2, so all
        // three tasks appear as low-level risks.
        assert_eq!(out.risks.len(), 3);
        assert!(out.risks.iter().all(|r| r.level == "low"));
    }
}
