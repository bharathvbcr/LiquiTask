//! File-based MCP bridge directory management for agent runs.
//!
//! The Node stdio bridge (`scripts/liquitask-mcp-bridge.mjs`) writes tool
//! requests as JSON files; the renderer polls via these commands and writes
//! responses back.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::Manager;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpToolRequest {
    pub request_id: String,
    pub tool: String,
    pub args: serde_json::Value,
    pub task_id: String,
    pub run_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn mcp_base_dir() -> PathBuf {
    std::env::temp_dir().join("liquitask-mcp")
}

fn run_dir(run_id: &str) -> PathBuf {
    mcp_base_dir().join(sanitize_id(run_id))
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect()
}

fn ensure_subdirs(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir.join("requests"))
        .map_err(|e| format!("Failed to create MCP requests dir: {e}"))?;
    fs::create_dir_all(dir.join("responses"))
        .map_err(|e| format!("Failed to create MCP responses dir: {e}"))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_init(run_id: String, task_id: String) -> Result<String, String> {
    if run_id.is_empty() || task_id.is_empty() {
        return Err("run_id and task_id are required".to_string());
    }
    let dir = run_dir(&run_id);
    ensure_subdirs(&dir)?;
    // Store task id for debugging; bridge gets it via env.
    let _ = fs::write(dir.join("task_id"), &task_id);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_list_requests(mcp_dir: String) -> Result<Vec<McpToolRequest>, String> {
    let dir = PathBuf::from(&mcp_dir);
    if !dir.starts_with(mcp_base_dir()) {
        return Err("Invalid MCP directory".to_string());
    }
    let requests_dir = dir.join("requests");
    let mut out = Vec::new();
    let entries = fs::read_dir(&requests_dir).map_err(|e| format!("Read requests: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("Read request: {e}"))?;
        if let Ok(req) = serde_json::from_str::<McpToolRequest>(&raw) {
            out.push(req);
            let _ = fs::remove_file(&path);
        }
    }
    Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_write_response(
    mcp_dir: String,
    request_id: String,
    response: McpToolResponse,
) -> Result<(), String> {
    let dir = PathBuf::from(&mcp_dir);
    if !dir.starts_with(mcp_base_dir()) {
        return Err("Invalid MCP directory".to_string());
    }
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid request id".to_string());
    }
    let path = dir.join("responses").join(format!("{request_id}.json"));
    let raw = serde_json::to_string(&response).map_err(|e| format!("Serialize response: {e}"))?;
    fs::write(path, raw).map_err(|e| format!("Write response: {e}"))?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_write_config(mcp_dir: String, config_json: String) -> Result<String, String> {
    let dir = PathBuf::from(&mcp_dir);
    if !dir.starts_with(mcp_base_dir()) {
        return Err("Invalid MCP directory".to_string());
    }
    let path = dir.join("mcp-config.json");
    fs::write(&path, &config_json).map_err(|e| format!("Write MCP config: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_resolve_bridge(app: tauri::AppHandle) -> Result<String, String> {
    // Packaged: bundled resource at scripts/liquitask-mcp-bridge.mjs
    if let Ok(bundled) = app.path().resolve(
        "scripts/liquitask-mcp-bridge.mjs",
        BaseDirectory::Resource,
    ) {
        if bundled.is_file() {
            return Ok(bundled.to_string_lossy().to_string());
        }
    }
    // Dev: walk up from cwd looking for scripts/liquitask-mcp-bridge.mjs
    let mut dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..6 {
        let candidate = dir.join("scripts").join("liquitask-mcp-bridge.mjs");
        if candidate.is_file() {
            return Ok(dunce::canonicalize(&candidate)
                .unwrap_or(candidate)
                .to_string_lossy()
                .to_string());
        }
        if !dir.pop() {
            break;
        }
    }
    Err("liquitask-mcp-bridge.mjs not found".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_cleanup(mcp_dir: String) -> Result<(), String> {
    let dir = PathBuf::from(&mcp_dir);
    if !dir.starts_with(mcp_base_dir()) {
        return Err("Invalid MCP directory".to_string());
    }
    let _ = fs::remove_dir_all(dir);
    Ok(())
}

pub fn append_guidance(run_id: &str, message: &str) -> Result<(), String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Guidance message must not be empty".to_string());
    }
    if trimmed.len() > MAX_GUIDANCE_MESSAGE_LEN {
        return Err(format!(
            "Guidance message too long (max {MAX_GUIDANCE_MESSAGE_LEN} chars)"
        ));
    }
    let dir = run_dir(run_id);
    ensure_subdirs(&dir)?;
    let path = dir.join(GUIDANCE_FILE);
    let line = serde_json::to_string(&serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "message": trimmed,
    }))
    .map_err(|e| format!("Serialize guidance: {e}"))?;
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Open guidance file: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Write guidance: {e}"))?;
    Ok(())
}

const GUIDANCE_FILE: &str = "guidance.jsonl";
const MAX_GUIDANCE_MESSAGE_LEN: usize = 4000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_unsafe_chars() {
        assert_eq!(sanitize_id("run-123_abc"), "run-123_abc");
        assert_eq!(sanitize_id("bad;rm -rf"), "badrm-rf");
    }

    #[test]
    fn append_guidance_writes_jsonl() {
        let run_id = format!("test-{}", std::process::id());
        append_guidance(&run_id, "skip the refactor").expect("append");
        let path = run_dir(&run_id).join(GUIDANCE_FILE);
        let raw = fs::read_to_string(&path).expect("read");
        assert!(raw.contains("skip the refactor"));
        let _ = fs::remove_dir_all(run_dir(&run_id));
    }

    #[test]
    fn append_guidance_rejects_empty() {
        assert!(append_guidance("run-empty", "  ").is_err());
    }
}
