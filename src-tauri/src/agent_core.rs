//! Agent prompt construction and stream-json parsing (ported from TS agent services).

use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_SKILLS_IN_PROMPT: usize = 5;
const MAX_SKILL_SUMMARY_CHARS: usize = 600;

/// Keys we unwrap, in preference order, when handed an object where a string
/// was expected. Mirrors `src/utils/coerce.ts` on the renderer side.
const STRING_LIKE_KEYS: [&str; 9] = [
    "title",
    "name",
    "text",
    "label",
    "task",
    "step",
    "value",
    "summary",
    "description",
];

/// Best-effort coercion of any JSON value into a string. Prevents a malformed
/// field (e.g. an AI-generated subtask returned as `{ "title": "..." }`) from
/// failing deserialization of the whole command payload with
/// `invalid type: map, expected a string`.
fn lenient_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Array(items) => items
            .iter()
            .map(lenient_string)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        Value::Object(map) => {
            for key in STRING_LIKE_KEYS {
                if let Some(Value::String(s)) = map.get(key) {
                    if !s.trim().is_empty() {
                        return s.clone();
                    }
                }
            }
            String::new()
        }
        Value::Null => String::new(),
    }
}

/// serde `deserialize_with` adaptor: accept a string or coerce from any value.
fn de_lenient_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Value::deserialize(deserializer)?;
    Ok(lenient_string(&value))
}

/// serde `deserialize_with` adaptor for optional string fields.
fn de_lenient_opt_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(value
        .map(|v| lenient_string(&v))
        .filter(|s| !s.is_empty()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillInput {
    pub title: String,
    pub summary: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskInput {
    #[serde(deserialize_with = "de_lenient_string")]
    pub title: String,
    #[serde(default)]
    pub completed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPromptInput {
    pub id: String,
    #[serde(default)]
    pub job_id: String,
    #[serde(deserialize_with = "de_lenient_string")]
    pub title: String,
    #[serde(default, deserialize_with = "de_lenient_opt_string")]
    pub subtitle: Option<String>,
    #[serde(default, deserialize_with = "de_lenient_opt_string")]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub subtasks: Vec<SubtaskInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedStreamEvent {
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedStreamResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub num_turns: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    pub is_error: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedStreamLine {
    pub events: Vec<ParsedStreamEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ParsedStreamResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CouncilVerdict {
    pub passed: bool,
    pub blocking_gaps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub raw: String,
}

pub fn build_task_prompt(task: &TaskPromptInput, skills: &[AgentSkillInput]) -> String {
    let subtasks = task
        .subtasks
        .iter()
        .filter(|s| !s.completed)
        .map(|s| format!("- {}", s.title))
        .collect::<Vec<_>>()
        .join("\n");

    let skills_section = skills
        .iter()
        .take(MAX_SKILLS_IN_PROMPT)
        .map(|skill| {
            let summary = if skill.summary.len() > MAX_SKILL_SUMMARY_CHARS {
                &skill.summary[..MAX_SKILL_SUMMARY_CHARS]
            } else {
                &skill.summary
            };
            format!("### {}\n{summary}", skill.title)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let job = if task.job_id.is_empty() {
        &task.id
    } else {
        &task.job_id
    };

    let mut sections = vec![
        "You are working as an autonomous teammate on the following task from the LiquiTask board.".to_string(),
        format!("## Task {job}: {}", task.title),
    ];

    if let Some(subtitle) = &task.subtitle {
        if !subtitle.is_empty() {
            sections.push(format!("Subtitle: {subtitle}"));
        }
    }
    if let Some(summary) = &task.summary {
        if !summary.is_empty() {
            sections.push(format!("## Description\n{summary}"));
        }
    }
    if !subtasks.is_empty() {
        sections.push(format!("## Open subtasks\n{subtasks}"));
    }
    if !task.tags.is_empty() {
        sections.push(format!("Tags: {}", task.tags.join(", ")));
    }
    if !skills_section.is_empty() {
        sections.push(format!(
            "## Team knowledge (from previous runs in this repo)\n{skills_section}"
        ));
    }
    sections.push("## Board workflow (liquitask MCP tools)".to_string());
    sections.push(
        [
            "Your task card lives on a kanban board with columns: Task → In Progress → Completed → Commit.",
            "- Your card is already in **In Progress**; you are likely working in an isolated git worktree on your own branch.",
            "- Use `post_comment` to report progress at each major step — the user follows your work live on the board.",
            "- Use `toggle_subtask` to check off subtasks as you finish them, and `create_subtask`/`report_blocker` when you discover new work or blockers.",
            "- When your work is done and verified, call `complete_task` with a summary — this moves the card to **Completed**.",
            "- Do NOT try to move the card to **Commit**: that stage is human-gated (a person reviews your diff and commits/merges the worktree).",
        ]
        .join("\n"),
    );
    sections.push("## Instructions".to_string());
    sections.push(
        [
            "- Work only inside the current repository.",
            "- Follow the repository's CLAUDE.md conventions if present.",
            "- Prefer minimal, well-tested changes; run the project's tests when available.",
            "- Do not run `git commit`, switch branches, or push unless the task explicitly asks — committing/merging happens from the board's Commit stage.",
            "- Before large refactors or when stuck, call the `get_user_guidance` MCP tool — the user may inject mid-run course corrections from the board.",
            "- Finish with a concise summary of what changed, files touched, and anything left open.",
        ]
        .join("\n"),
    );

    sections.join("\n\n")
}

pub fn build_council_goal(task: &TaskPromptInput) -> String {
    let mut parts = vec![task.title.clone()];
    if let Some(summary) = &task.summary {
        if !summary.is_empty() {
            parts.push(summary.clone());
        }
    }
    parts.join(" — ").chars().take(2000).collect()
}

fn describe_tool_use(name: &str, input: &Value) -> String {
    let obj = input.as_object();
    let target = obj
        .and_then(|o| {
            o.get("file_path")
                .or_else(|| o.get("command"))
                .or_else(|| o.get("pattern"))
                .and_then(Value::as_str)
        })
        .unwrap_or("");
    if target.is_empty() {
        name.to_string()
    } else {
        format!("{name}: {}", &target[..target.len().min(200)])
    }
}

pub fn parse_claude_stream_line(line: &str) -> ParsedStreamLine {
    let parsed: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            return ParsedStreamLine {
                events: vec![ParsedStreamEvent {
                    kind: "info".to_string(),
                    text: line.to_string(),
                }],
                session_id: None,
                result: None,
            };
        }
    };

    let ty = parsed.get("type").and_then(Value::as_str).unwrap_or("");

    if ty == "system" {
        let subtype = parsed
            .get("subtype")
            .and_then(Value::as_str)
            .unwrap_or("init");
        return ParsedStreamLine {
            events: vec![ParsedStreamEvent {
                kind: "system".to_string(),
                text: format!("Session started ({subtype})"),
            }],
            session_id: parsed
                .get("session_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            result: None,
        };
    }

    if ty == "assistant" {
        let mut events = Vec::new();
        if let Some(content) = parsed
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        {
            for block in content {
                let block_type = block.get("type").and_then(Value::as_str).unwrap_or("");
                if block_type == "text" {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        events.push(ParsedStreamEvent {
                            kind: "assistant".to_string(),
                            text: text.to_string(),
                        });
                    }
                } else if block_type == "tool_use" {
                    if let Some(name) = block.get("name").and_then(Value::as_str) {
                        events.push(ParsedStreamEvent {
                            kind: "tool".to_string(),
                            text: describe_tool_use(name, block.get("input").unwrap_or(&Value::Null)),
                        });
                    }
                }
            }
        }
        return ParsedStreamLine {
            events,
            session_id: None,
            result: None,
        };
    }

    if ty == "result" {
        let summary = parsed.get("result").and_then(Value::as_str).map(str::to_string);
        let is_error = parsed.get("is_error").and_then(Value::as_bool).unwrap_or(false)
            || parsed.get("subtype").and_then(Value::as_str) != Some("success");
        let text = summary.clone().unwrap_or_else(|| {
            if is_error {
                format!(
                    "Run ended: {}",
                    parsed
                        .get("subtype")
                        .and_then(Value::as_str)
                        .unwrap_or("error")
                )
            } else {
                "Run completed".to_string()
            }
        });
        return ParsedStreamLine {
            events: vec![ParsedStreamEvent {
                kind: "result".to_string(),
                text,
            }],
            session_id: parsed
                .get("session_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            result: Some(ParsedStreamResult {
                summary,
                num_turns: parsed.get("num_turns").and_then(Value::as_u64),
                cost_usd: parsed.get("total_cost_usd").and_then(Value::as_f64),
                is_error,
            }),
        };
    }

    ParsedStreamLine {
        events: vec![ParsedStreamEvent {
            kind: "info".to_string(),
            text: line.chars().take(400).collect(),
        }],
        session_id: None,
        result: None,
    }
}

pub fn parse_council_report(raw: &str) -> CouncilVerdict {
    let bounded: String = raw.chars().take(200_000).collect();
    let json_start = bounded.find('{');
    let fallback = CouncilVerdict {
        passed: true,
        blocking_gaps: Vec::new(),
        summary: None,
        raw: bounded.chars().take(4000).collect(),
    };
    let Some(start) = json_start else {
        return fallback;
    };

    let parsed: Value = match serde_json::from_str(&bounded[start..]) {
        Ok(v) => v,
        Err(_) => return fallback,
    };

    let gaps: Vec<String> = parsed
        .get("blocking_gaps")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|g| {
                    if let Some(s) = g.as_str() {
                        s.to_string()
                    } else {
                        g.to_string()
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let passed_flag = parsed
        .get("passed")
        .or_else(|| parsed.get("ok"))
        .and_then(Value::as_bool)
        .unwrap_or(gaps.is_empty());
    let passed = passed_flag && gaps.is_empty();

    CouncilVerdict {
        passed,
        blocking_gaps: gaps,
        summary: parsed
            .get("diff_summary")
            .and_then(Value::as_str)
            .map(str::to_string),
        raw: bounded.chars().take(4000).collect(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_build_task_prompt(
    task: TaskPromptInput,
    skills: Vec<AgentSkillInput>,
) -> Result<String, String> {
    Ok(build_task_prompt(&task, &skills))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_build_council_goal(task: TaskPromptInput) -> Result<String, String> {
    Ok(build_council_goal(&task))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_parse_stream_line(line: String) -> Result<ParsedStreamLine, String> {
    Ok(parse_claude_stream_line(&line))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_parse_council_report(raw: String) -> Result<CouncilVerdict, String> {
    Ok(parse_council_report(&raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_task_prompt_with_subtasks() {
        let prompt = build_task_prompt(
            &TaskPromptInput {
                id: "t1".to_string(),
                job_id: "TSK-1".to_string(),
                title: "Fix bug".to_string(),
                subtitle: None,
                summary: Some("Details".to_string()),
                tags: vec!["rust".to_string()],
                subtasks: vec![SubtaskInput {
                    title: "Write test".to_string(),
                    completed: false,
                }],
            },
            &[],
        );
        assert!(prompt.contains("Fix bug"));
        assert!(prompt.contains("Write test"));
    }

    #[test]
    fn deserializes_task_with_object_shaped_subtasks() {
        // Regression: models return subtasks as objects, which previously failed
        // the whole command with `invalid type: map, expected a string`.
        let payload = serde_json::json!({
            "id": "t1",
            "title": "Redesign the pill",
            "summary": { "text": "make it modern" },
            "subtasks": [
                { "title": "Locate component", "completed": false },
                "Rework styles",
                { "step": "Verify no regressions" }
            ]
        });
        let parsed: TaskPromptInput = serde_json::from_value(payload).expect("should not error");
        assert_eq!(parsed.title, "Redesign the pill");
        assert_eq!(parsed.summary.as_deref(), Some("make it modern"));
        assert_eq!(parsed.subtasks.len(), 3);
        assert_eq!(parsed.subtasks[0].title, "Locate component");
        assert_eq!(parsed.subtasks[1].title, "Rework styles");
        assert_eq!(parsed.subtasks[2].title, "Verify no regressions");
    }

    #[test]
    fn parses_result_line() {
        let line = r#"{"type":"result","subtype":"success","result":"done","session_id":"s1"}"#;
        let parsed = parse_claude_stream_line(line);
        assert_eq!(parsed.session_id.as_deref(), Some("s1"));
        assert!(!parsed.result.as_ref().unwrap().is_error);
    }
}
