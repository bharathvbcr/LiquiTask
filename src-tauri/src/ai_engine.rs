//! Direct Ollama HTTP client and Claude Code CLI bridge for in-app AI requests.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::time::{timeout, Duration};

use crate::agent_cli_util::{augmented_path, find_executable};
use crate::agent_core::parse_claude_stream_line;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaGenerateRequest {
    pub base_url: Option<String>,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaGenerateResponse {
    pub text: String,
    pub latency_ms: f32,
    pub model: String,
}

fn default_temperature() -> f32 {
    0.4
}

fn default_max_tokens() -> u32 {
    2048
}

#[derive(Serialize)]
struct GenerateOptions {
    temperature: f32,
    num_predict: u32,
}

fn normalize_base_url(base_url: Option<String>) -> String {
    base_url
        .unwrap_or_else(|| "http://127.0.0.1:11434".to_string())
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_generate(
    request: OllamaGenerateRequest,
) -> Result<OllamaGenerateResponse, String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        model: &'a str,
        prompt: &'a str,
        stream: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        system: Option<&'a str>,
        options: GenerateOptions,
    }

    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let payload = Payload {
        model: &request.model,
        prompt: &request.prompt,
        stream: false,
        system: request.system.as_deref(),
        options: GenerateOptions {
            temperature: request.temperature,
            num_predict: request.max_tokens,
        },
    };

    let start = Instant::now();
    let response = client
        .post(format!("{base}/api/generate"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {body}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama response: {e}"))?;

    Ok(OllamaGenerateResponse {
        text: data
            .get("response")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        latency_ms: start.elapsed().as_secs_f32() * 1000.0,
        model: request.model,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthRequest {
    pub base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaHealthResponse {
    pub ok: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_health(
    request: OllamaHealthRequest,
) -> Result<OllamaHealthResponse, String> {
    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let ok = client
        .get(format!("{base}/api/tags"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    Ok(OllamaHealthResponse { ok })
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatRequest {
    pub base_url: Option<String>,
    pub model: String,
    pub messages: Vec<OllamaChatMessage>,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub format_json: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaChatResponse {
    pub content: String,
    pub latency_ms: f32,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_ollama_chat(request: OllamaChatRequest) -> Result<OllamaChatResponse, String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        model: &'a str,
        messages: &'a [OllamaChatMessage],
        stream: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<&'static str>,
        options: GenerateOptions,
    }

    let base = normalize_base_url(request.base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let format = if request.format_json {
        Some("json")
    } else {
        None
    };

    let payload = Payload {
        model: &request.model,
        messages: &request.messages,
        stream: false,
        format,
        options: GenerateOptions {
            temperature: request.temperature,
            num_predict: default_max_tokens(),
        },
    };

    let start = Instant::now();
    let response = client
        .post(format!("{base}/api/chat"))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Ollama chat request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned {status}: {body}"));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid Ollama chat response: {e}"))?;

    Ok(OllamaChatResponse {
        content: data
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        latency_ms: start.elapsed().as_secs_f32() * 1000.0,
    })
}

const CLAUDE_CHAT_TIMEOUT_SECS: u64 = 120;

fn is_filtered_child_env_key(key: &str) -> bool {
    matches!(
        key,
        "CLAUDECODE"
            | "CLAUDE_CODE_ENTRYPOINT"
            | "CLAUDE_CODE_EXECPATH"
            | "CLAUDE_CODE_SESSION_ID"
            | "CLAUDE_CODE_SSE_PORT"
    ) || key.starts_with("CLAUDECODE_")
}

fn build_child_env() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(key, _)| !is_filtered_child_env_key(key))
        .collect();
    if !env.iter().any(|(k, _)| k == "PATH") {
        env.push(("PATH".to_string(), augmented_path()));
    } else {
        for entry in &mut env {
            if entry.0 == "PATH" {
                entry.1 = augmented_path();
                break;
            }
        }
    }
    env
}

fn build_claude_input(prompt: &str) -> Result<Vec<u8>, String> {
    let payload = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": prompt}]
        }
    });
    let mut data = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    data.push(b'\n');
    Ok(data)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeChatRequest {
    pub system: Option<String>,
    pub prompt: String,
    pub model: Option<String>,
    #[serde(default = "default_claude_max_turns")]
    pub max_turns: u32,
}

fn default_claude_max_turns() -> u32 {
    1
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeChatResponse {
    pub content: String,
    pub latency_ms: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeHealthResponse {
    pub ok: bool,
    pub version: Option<String>,
}

async fn run_claude_chat(request: ClaudeChatRequest) -> Result<ClaudeChatResponse, String> {
    timeout(
        Duration::from_secs(CLAUDE_CHAT_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || run_claude_chat_blocking(request)),
    )
    .await
    .map_err(|_| format!("Claude Code request timed out after {CLAUDE_CHAT_TIMEOUT_SECS}s"))?
    .map_err(|e| format!("Claude Code task failed: {e}"))?
}

fn run_claude_chat_blocking(request: ClaudeChatRequest) -> Result<ClaudeChatResponse, String> {
    let exec = find_executable("claude").ok_or_else(|| {
        "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code".to_string()
    })?;

    let mut args = vec![
        "-p".to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--input-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        "bypassPermissions".to_string(),
        "--disallowedTools".to_string(),
        "AskUserQuestion".to_string(),
        "--max-turns".to_string(),
        request.max_turns.to_string(),
    ];

    if let Some(model) = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
    {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(system) = request
        .system
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--append-system-prompt".to_string());
        args.push(system.to_string());
    }

    let mut cmd = Command::new(exec);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in build_child_env() {
        cmd.env(key, value);
    }

    let start = Instant::now();
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start Claude Code: {e}"))?;

    let stdin = child.stdin.take();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Claude Code stdout".to_string())?;
    let stderr = child.stderr.take();
    let prompt = request.prompt.clone();

    let write_handle = std::thread::spawn(move || -> Result<(), String> {
        let Some(mut stdin) = stdin else {
            return Ok(());
        };
        let input = build_claude_input(&prompt)?;
        stdin
            .write_all(&input)
            .map_err(|e| format!("Failed to write Claude Code input: {e}"))?;
        Ok(())
    });

    let mut assistant_text = String::new();
    let mut result_text: Option<String> = None;
    let mut is_error = false;

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = parse_claude_stream_line(trimmed);
        for event in parsed.events {
            if event.kind == "assistant" && !event.text.is_empty() {
                if !assistant_text.is_empty() {
                    assistant_text.push('\n');
                }
                assistant_text.push_str(&event.text);
            }
        }
        if let Some(result) = parsed.result {
            is_error = result.is_error;
            if let Some(summary) = result.summary.filter(|s| !s.trim().is_empty()) {
                result_text = Some(summary);
            }
        }
    }

    write_handle
        .join()
        .map_err(|_| "Claude Code stdin thread panicked".to_string())??;

    let content = result_text.unwrap_or(assistant_text);
    let status = child
        .wait()
        .map_err(|e| format!("Claude Code process failed: {e}"))?;

    if content.trim().is_empty() {
        let mut detail = format!("exit code {}", status.code().unwrap_or(-1));
        if let Some(mut stderr_pipe) = stderr {
            let mut buf = String::new();
            if stderr_pipe.read_to_string(&mut buf).is_ok() && !buf.trim().is_empty() {
                let tail: String = buf.chars().rev().take(800).collect::<String>().chars().rev().collect();
                if !tail.trim().is_empty() {
                    detail = format!("{detail}: {tail}");
                }
            }
        }
        return Err(format!("Claude Code returned no output ({detail})"));
    }
    if is_error {
        return Err(format!("Claude Code reported an error: {content}"));
    }
    if !status.success() {
        return Err(format!(
            "Claude Code exited with status {}: {content}",
            status.code().unwrap_or(-1)
        ));
    }

    Ok(ClaudeChatResponse {
        content,
        latency_ms: start.elapsed().as_secs_f32() * 1000.0,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_claude_chat(request: ClaudeChatRequest) -> Result<ClaudeChatResponse, String> {
    run_claude_chat(request).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelsResponse {
    pub models: Vec<ClaudeModelOption>,
    /// "help" when aliases were parsed from `claude --help`; "static" on fallback.
    pub source: String,
}

const CLAUDE_STATIC_MODELS: &[(&str, &str, bool)] = &[
    ("claude-sonnet-5", "Claude Sonnet 5", false),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6", true),
    ("claude-fable-5", "Claude Fable 5", false),
    ("claude-opus-4-8", "Claude Opus 4.8", false),
    ("claude-opus-4-7", "Claude Opus 4.7", false),
    ("claude-haiku-4-5-20251001", "Claude Haiku 4.5", false),
    ("claude-opus-4-6", "Claude Opus 4.6", false),
    ("claude-sonnet-4-5", "Claude Sonnet 4.5", false),
];

fn claude_alias_label(id: &str) -> String {
    match id {
        "sonnet" => "Sonnet (latest)".to_string(),
        "opus" => "Opus (latest)".to_string(),
        "fable" => "Fable (latest)".to_string(),
        other if other.starts_with("claude-") => {
            let title = other
                .trim_start_matches("claude-")
                .split('-')
                .map(|part| {
                    let mut chars = part.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            format!("Claude {title}")
        }
        other => other.to_string(),
    }
}

fn is_claude_alias(id: &str) -> bool {
    matches!(id, "sonnet" | "opus" | "fable")
}

fn sort_claude_model_options(models: &mut [ClaudeModelOption]) {
    const ALIAS_ORDER: &[&str] = &["sonnet", "opus", "fable"];
    models.sort_by(|a, b| {
        let a_alias = ALIAS_ORDER.iter().position(|id| *id == a.id);
        let b_alias = ALIAS_ORDER.iter().position(|id| *id == b.id);
        match (a_alias, b_alias) {
            (Some(ai), Some(bi)) => ai.cmp(&bi),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.label.cmp(&b.label),
        }
    });
}

fn parse_claude_model_ids_from_help(help_text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for token in help_text.split(['\'', '"']) {
        let candidate = token.trim();
        if candidate.is_empty() || candidate.contains('\n') {
            continue;
        }
        let looks_like_model = candidate.starts_with("claude-")
            || matches!(candidate, "fable" | "opus" | "sonnet");
        if looks_like_model && seen.insert(candidate.to_string()) {
            found.push(candidate.to_string());
        }
    }

    found
}

fn discover_claude_models() -> ClaudeModelsResponse {
    let exec = match find_executable("claude") {
        Some(path) => path,
        None => {
            return ClaudeModelsResponse {
                models: claude_static_model_options(),
                source: "static".to_string(),
            };
        }
    };

    let help = Command::new(exec)
        .arg("--help")
        .envs(build_child_env())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let mut models = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut source = "static".to_string();

    for alias in parse_claude_model_ids_from_help(&help) {
        if !is_claude_alias(&alias) {
            continue;
        }
        if seen.insert(alias.clone()) {
            models.push(ClaudeModelOption {
                id: alias.clone(),
                label: claude_alias_label(&alias),
                default: alias == "sonnet",
            });
        }
    }
    if !models.is_empty() {
        source = "help".to_string();
    }

    for (id, label, is_default) in CLAUDE_STATIC_MODELS {
        if seen.insert((*id).to_string()) {
            models.push(ClaudeModelOption {
                id: (*id).to_string(),
                label: (*label).to_string(),
                default: *is_default && !models.iter().any(|m| m.default),
            });
        }
    }

    if models.is_empty() {
        models = claude_static_model_options();
        source = "static".to_string();
    } else {
        sort_claude_model_options(&mut models);
        if !models.iter().any(|m| m.default) {
            if let Some(first) = models.first_mut() {
                first.default = true;
            }
        }
    }

    ClaudeModelsResponse { models, source }
}

fn claude_static_model_options() -> Vec<ClaudeModelOption> {
    CLAUDE_STATIC_MODELS
        .iter()
        .map(|(id, label, is_default)| ClaudeModelOption {
            id: (*id).to_string(),
            label: (*label).to_string(),
            default: *is_default,
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
pub fn ai_claude_models() -> ClaudeModelsResponse {
    discover_claude_models()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn ai_claude_health() -> Result<ClaudeHealthResponse, String> {
    let exec = match find_executable("claude") {
        Some(path) => path,
        None => {
            return Ok(ClaudeHealthResponse {
                ok: false,
                version: None,
            });
        }
    };

    let output = Command::new(exec)
        .arg("--version")
        .envs(build_child_env())
        .output()
        .map_err(|e| format!("Failed to run Claude Code --version: {e}"))?;

    if !output.status.success() {
        return Ok(ClaudeHealthResponse {
            ok: false,
            version: None,
        });
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(ClaudeHealthResponse {
        ok: !version.is_empty(),
        version: if version.is_empty() {
            None
        } else {
            Some(version)
        },
    })
}

#[cfg(test)]
mod claude_tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn build_claude_input_is_ndjson_user_frame() {
        let data = build_claude_input("hello").expect("input");
        let value: Value = serde_json::from_slice(&data).expect("json");
        assert_eq!(value.get("type").and_then(Value::as_str), Some("user"));
        assert!(data.ends_with(b"\n"));
    }

    #[test]
    fn parse_claude_model_ids_from_help_extracts_aliases_and_examples() {
        let help = r#"--model <model>  Provide an alias (e.g. 'fable', 'opus', or 'sonnet') or full name (e.g. 'claude-fable-5')."#;
        let ids = parse_claude_model_ids_from_help(help);
        assert!(ids.contains(&"fable".to_string()));
        assert!(ids.contains(&"opus".to_string()));
        assert!(ids.contains(&"sonnet".to_string()));
        assert!(ids.contains(&"claude-fable-5".to_string()));
    }

    #[test]
    fn discover_claude_models_orders_aliases_before_pinned_models() {
        let response = discover_claude_models();
        assert!(!response.models.is_empty());
        let sonnet_idx = response.models.iter().position(|m| m.id == "sonnet");
        let pinned_idx = response
            .models
            .iter()
            .position(|m| m.id == "claude-sonnet-4-6");
        if let (Some(s), Some(p)) = (sonnet_idx, pinned_idx) {
            assert!(s < p, "aliases should appear before pinned model ids");
        }
    }

    #[test]
    fn claude_static_catalog_marks_one_default() {
        let models = claude_static_model_options();
        let defaults: Vec<_> = models.iter().filter(|m| m.default).collect();
        assert_eq!(defaults.len(), 1);
        assert_eq!(defaults[0].id, "claude-sonnet-4-6");
    }

    #[test]
    fn filtered_child_env_strips_runtime_markers() {
        assert!(is_filtered_child_env_key("CLAUDECODE"));
        assert!(is_filtered_child_env_key("CLAUDE_CODE_SESSION_ID"));
        assert!(!is_filtered_child_env_key("CLAUDE_CODE_GIT_BASH_PATH"));
    }
}
