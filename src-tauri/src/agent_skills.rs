//! Agent skills capture and filtering (ported from agentSkillsService.ts).

use serde::{Deserialize, Serialize};

const MAX_SKILLS: usize = 200;
const MIN_SUMMARY_LENGTH: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillRecord {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub working_dir: String,
    pub task_id: String,
    pub agent_id: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunCaptureInput {
    pub status: String,
    #[serde(default)]
    pub summary: Option<String>,
    pub agent_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCaptureInput {
    pub id: String,
    pub title: String,
}

fn normalize_dir(dir: &str) -> String {
    dir.trim_end_matches('/').to_string()
}

pub fn filter_skills_for_working_dir(skills: &[AgentSkillRecord], working_dir: &str) -> Vec<AgentSkillRecord> {
    let dir = normalize_dir(working_dir);
    let mut filtered: Vec<AgentSkillRecord> = skills
        .iter()
        .filter(|s| normalize_dir(&s.working_dir) == dir)
        .cloned()
        .collect();
    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    filtered
}

pub fn capture_skill_from_run(
    skills: Vec<AgentSkillRecord>,
    run: AgentRunCaptureInput,
    task: TaskCaptureInput,
    working_dir: String,
    now_ms: i64,
) -> Option<Vec<AgentSkillRecord>> {
    if run.status != "completed" {
        return None;
    }
    let summary = run.summary.unwrap_or_default().trim().to_string();
    if summary.len() < MIN_SUMMARY_LENGTH {
        return None;
    }

    let mut filtered: Vec<AgentSkillRecord> = skills
        .into_iter()
        .filter(|s| !(s.task_id == task.id && s.working_dir == working_dir))
        .collect();

    filtered.push(AgentSkillRecord {
        id: format!("skill-{now_ms}"),
        title: task.title.chars().take(200).collect(),
        summary: summary.chars().take(2000).collect(),
        working_dir,
        task_id: task.id,
        agent_id: run.agent_id,
        created_at: now_ms,
    });

    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    filtered.truncate(MAX_SKILLS);
    Some(filtered)
}

pub fn delete_skill(skills: Vec<AgentSkillRecord>, id: &str) -> Vec<AgentSkillRecord> {
    skills.into_iter().filter(|s| s.id != id).collect()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsFilterRequest {
    pub skills: Vec<AgentSkillRecord>,
    pub working_dir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsCaptureRequest {
    pub skills: Vec<AgentSkillRecord>,
    pub run: AgentRunCaptureInput,
    pub task: TaskCaptureInput,
    pub working_dir: String,
    pub now_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsDeleteRequest {
    pub skills: Vec<AgentSkillRecord>,
    pub id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsCaptureResponse {
    pub skills: Vec<AgentSkillRecord>,
    pub captured: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_skills_filter(request: AgentSkillsFilterRequest) -> Result<Vec<AgentSkillRecord>, String> {
    Ok(filter_skills_for_working_dir(&request.skills, &request.working_dir))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_skills_capture(
    request: AgentSkillsCaptureRequest,
) -> Result<AgentSkillsCaptureResponse, String> {
    let original = request.skills.clone();
    let captured = capture_skill_from_run(
        request.skills,
        request.run,
        request.task,
        request.working_dir,
        request.now_ms,
    );
    match captured {
        Some(skills) => Ok(AgentSkillsCaptureResponse {
            skills,
            captured: true,
        }),
        None => Ok(AgentSkillsCaptureResponse {
            skills: original,
            captured: false,
        }),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_skills_delete(request: AgentSkillsDeleteRequest) -> Result<Vec<AgentSkillRecord>, String> {
    Ok(delete_skill(request.skills, &request.id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_working_dir_newest_first() {
        let skills = vec![
            AgentSkillRecord {
                id: "s1".to_string(),
                title: "A".to_string(),
                summary: "x".repeat(40),
                working_dir: "/repo".to_string(),
                task_id: "t1".to_string(),
                agent_id: "a1".to_string(),
                created_at: 1,
            },
            AgentSkillRecord {
                id: "s2".to_string(),
                title: "B".to_string(),
                summary: "y".repeat(40),
                working_dir: "/other".to_string(),
                task_id: "t2".to_string(),
                agent_id: "a1".to_string(),
                created_at: 2,
            },
        ];
        let filtered = filter_skills_for_working_dir(&skills, "/repo/");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].id, "s1");
    }

    #[test]
    fn capture_skips_short_summary() {
        let out = capture_skill_from_run(
            vec![],
            AgentRunCaptureInput {
                status: "completed".to_string(),
                summary: Some("too short".to_string()),
                agent_id: "a1".to_string(),
            },
            TaskCaptureInput {
                id: "t1".to_string(),
                title: "Title".to_string(),
            },
            "/repo".to_string(),
            100,
        );
        assert!(out.is_none());
    }
}
