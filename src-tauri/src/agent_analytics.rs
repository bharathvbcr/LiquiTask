//! Agent run analytics aggregation (ported from agentAnalyticsService.ts).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileInput {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunVerificationInput {
    #[serde(default)]
    pub passed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunInput {
    pub agent_id: String,
    pub status: String,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub finished_at: Option<i64>,
    #[serde(default)]
    pub cost_usd: Option<f64>,
    #[serde(default)]
    pub num_turns: Option<f64>,
    #[serde(default)]
    pub verification: Option<AgentRunVerificationInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnalyticsRow {
    pub agent_id: String,
    pub agent_name: String,
    pub total_runs: usize,
    pub completed: usize,
    pub failed: usize,
    pub success_rate: f64,
    pub avg_cost_usd: f64,
    pub avg_turns: f64,
    pub avg_duration_ms: f64,
    pub gate_pass_rate: f64,
}

fn avg(nums: &[f64]) -> f64 {
    if nums.is_empty() {
        0.0
    } else {
        nums.iter().sum::<f64>() / nums.len() as f64
    }
}

pub fn compute_agent_analytics(
    agents: &[AgentProfileInput],
    runs: &[AgentRunInput],
) -> Vec<AgentAnalyticsRow> {
    agents
        .iter()
        .map(|agent| {
            let agent_runs: Vec<&AgentRunInput> =
                runs.iter().filter(|r| r.agent_id == agent.id).collect();
            let finished: Vec<&AgentRunInput> = agent_runs
                .iter()
                .copied()
                .filter(|r| r.status == "completed" || r.status == "failed")
                .collect();
            let completed = finished.iter().filter(|r| r.status == "completed").count();
            let with_gate: Vec<&AgentRunInput> = finished
                .iter()
                .copied()
                .filter(|r| r.verification.is_some())
                .collect();
            let gate_passed = with_gate
                .iter()
                .filter(|r| r.verification.as_ref().map(|v| v.passed).unwrap_or(false))
                .count();

            let durations: Vec<f64> = finished
                .iter()
                .filter_map(|r| match (r.started_at, r.finished_at) {
                    (Some(start), Some(end)) => Some((end - start) as f64),
                    _ => None,
                })
                .collect();
            let costs: Vec<f64> = finished
                .iter()
                .filter_map(|r| r.cost_usd)
                .collect();
            let turns: Vec<f64> = finished
                .iter()
                .filter_map(|r| r.num_turns)
                .collect();

            AgentAnalyticsRow {
                agent_id: agent.id.clone(),
                agent_name: agent.name.clone(),
                total_runs: agent_runs.len(),
                completed,
                failed: finished.len().saturating_sub(completed),
                success_rate: if finished.is_empty() {
                    0.0
                } else {
                    completed as f64 / finished.len() as f64
                },
                avg_cost_usd: avg(&costs),
                avg_turns: avg(&turns),
                avg_duration_ms: avg(&durations),
                gate_pass_rate: if with_gate.is_empty() {
                    0.0
                } else {
                    gate_passed as f64 / with_gate.len() as f64
                },
            }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnalyticsRequest {
    pub agents: Vec<AgentProfileInput>,
    pub runs: Vec<AgentRunInput>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_compute_analytics(request: AgentAnalyticsRequest) -> Result<Vec<AgentAnalyticsRow>, String> {
    Ok(compute_agent_analytics(&request.agents, &request.runs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregates_success_and_gate_rates() {
        let agents = vec![AgentProfileInput {
            id: "a1".to_string(),
            name: "Bot".to_string(),
        }];
        let runs = vec![
            AgentRunInput {
                agent_id: "a1".to_string(),
                status: "completed".to_string(),
                started_at: Some(0),
                finished_at: Some(1000),
                cost_usd: Some(1.0),
                num_turns: Some(2.0),
                verification: Some(AgentRunVerificationInput { passed: true }),
            },
            AgentRunInput {
                agent_id: "a1".to_string(),
                status: "failed".to_string(),
                started_at: Some(0),
                finished_at: Some(500),
                cost_usd: Some(0.5),
                num_turns: Some(1.0),
                verification: None,
            },
        ];
        let stats = compute_agent_analytics(&agents, &runs);
        assert_eq!(stats[0].total_runs, 2);
        assert_eq!(stats[0].completed, 1);
        assert!((stats[0].success_rate - 0.5).abs() < f64::EPSILON);
        assert!((stats[0].gate_pass_rate - 1.0).abs() < f64::EPSILON);
    }
}
