//! File-based MCP bridge directory management for agent runs.
//!
//! The Node stdio bridge (`scripts/liquitask-mcp-bridge.mjs`) writes tool
//! requests as JSON files; the renderer polls via these commands and writes
//! authenticated responses back. Bridge dirs live under app-data (0700), not
//! world-writable tmp, and every response/guidance line is HMAC-signed with a
//! per-run secret known only to the app + bridge process.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

type HmacSha256 = Hmac<Sha256>;

const MCP_BRIDGE_DIR: &str = "mcp-bridge";
const SECRET_FILE: &str = ".secret";
const RESPONSE_SECRET_FILE: &str = "response-secret";
const TASK_ID_FILE: &str = "task_id";
const RUN_ID_FILE: &str = "run_id";
const GUIDANCE_FILE: &str = "guidance.jsonl";
const MAX_GUIDANCE_MESSAGE_LEN: usize = 4000;
const MCP_AUTH_VERSION: u8 = 1;
const REQUEST_TIMEOUT_MS: i64 = 30_000;
const PERMISSION_TIMEOUT_MS: i64 = 600_000;

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("Invalid request id".to_string());
    }
    if request_id.contains("..") || request_id.contains('/') || request_id.contains('\\') {
        return Err("Invalid request id".to_string());
    }
    Ok(())
}

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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct McpInitResponse {
    pub mcp_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct InflightEntry {
    request: McpToolRequest,
    expires_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    input_digest: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct BoundResponsePayload {
    request_id: String,
    tool: String,
    expires_at: i64,
    app_originated: bool,
    response: McpToolResponse,
}

#[derive(Serialize)]
struct SignedEnvelope {
    v: u8,
    mac: String,
    payload: serde_json::Value,
}

fn mcp_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {e}"))?
        .join(MCP_BRIDGE_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create MCP root: {e}"))?;
    set_private_dir_mode(&dir)?;
    Ok(dir)
}

fn run_dir(app: &AppHandle, run_id: &str) -> Result<PathBuf, String> {
    Ok(mcp_root(app)?.join(sanitize_id(run_id)))
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(128)
        .collect()
}

fn validate_mcp_dir(app: &AppHandle, dir: &Path) -> Result<PathBuf, String> {
    let root = mcp_root(app)?;
    let canonical = dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let canonical_root = dunce::canonicalize(&root).unwrap_or(root);
    if !canonical.starts_with(&canonical_root) {
        return Err("Invalid MCP directory".to_string());
    }
    Ok(canonical)
}

#[cfg(unix)]
fn set_private_dir_mode(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("chmod MCP dir: {e}"))
}

#[cfg(not(unix))]
fn set_private_dir_mode(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_mode(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("chmod MCP file: {e}"))
}

#[cfg(not(unix))]
fn set_private_file_mode(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn generate_secret() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn read_run_secret(dir: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(dir.join(SECRET_FILE)).map_err(|e| format!("Read MCP secret: {e}"))?;
    let secret = raw.trim();
    if secret.len() < 32 {
        return Err("MCP secret missing or too short".to_string());
    }
    Ok(secret.to_string())
}

fn read_response_secret(dir: &Path) -> Result<String, String> {
    let raw =
        fs::read_to_string(dir.join(RESPONSE_SECRET_FILE)).map_err(|e| format!("Read response secret: {e}"))?;
    let secret = raw.trim();
    if secret.len() < 32 {
        return Err("Response secret missing or too short".to_string());
    }
    Ok(secret.to_string())
}

fn read_run_binding(dir: &Path) -> Result<(String, String), String> {
    let task_id = fs::read_to_string(dir.join(TASK_ID_FILE))
        .map_err(|_| "MCP bridge task binding missing".to_string())?
        .trim()
        .to_string();
    let run_id = fs::read_to_string(dir.join(RUN_ID_FILE))
        .map_err(|_| "MCP bridge run binding missing".to_string())?
        .trim()
        .to_string();
    if task_id.is_empty() || run_id.is_empty() {
        return Err("MCP bridge task/run binding invalid".to_string());
    }
    Ok((task_id, run_id))
}

fn write_run_binding(dir: &Path, run_id: &str, task_id: &str) -> Result<(), String> {
    let task_path = dir.join(TASK_ID_FILE);
    fs::write(&task_path, task_id).map_err(|e| format!("Write MCP task binding: {e}"))?;
    set_private_file_mode(&task_path)?;
    let run_path = dir.join(RUN_ID_FILE);
    fs::write(&run_path, run_id).map_err(|e| format!("Write MCP run binding: {e}"))?;
    set_private_file_mode(&run_path)?;
    Ok(())
}

fn permission_input_digest(input: &serde_json::Value) -> String {
    let body = serde_json::to_string(input).unwrap_or_default();
    let mut mac = <HmacSha256 as Mac>::new_from_slice(b"liquitask-perm-digest")
        .unwrap_or_else(|_| <HmacSha256 as Mac>::new_from_slice(b"liquitask-perm-digest-fallback").expect("key"));
    mac.update(body.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

fn extract_permission_input(args: &serde_json::Value) -> serde_json::Value {
    if let Some(inner) = args.get("input") {
        return inner.clone();
    }
    args.clone()
}

fn request_timeout_ms(tool: &str) -> i64 {
    if tool == "permission_prompt" {
        PERMISSION_TIMEOUT_MS
    } else {
        REQUEST_TIMEOUT_MS
    }
}

fn wrap_bound_response(
    secret: &str,
    request_id: &str,
    tool: &str,
    expires_at: i64,
    app_originated: bool,
    response: &McpToolResponse,
) -> Result<String, String> {
    let payload = BoundResponsePayload {
        request_id: request_id.to_string(),
        tool: tool.to_string(),
        expires_at,
        app_originated,
        response: response.clone(),
    };
    let payload_json =
        serde_json::to_value(&payload).map_err(|e| format!("Serialize bound response: {e}"))?;
    wrap_signed(secret, payload_json)
}

fn permission_response_is_allow(response: &McpToolResponse) -> bool {
    let Some(content) = response.content.as_ref() else {
        return false;
    };
    let Some(first) = content.as_array().and_then(|items| items.first()) else {
        return false;
    };
    let Some(text) = first.get("text").and_then(|v| v.as_str()) else {
        return false;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
        return false;
    };
    parsed.get("behavior").and_then(|v| v.as_str()) == Some("allow")
}

fn write_run_secret(dir: &Path, secret: &str) -> Result<(), String> {
    let path = dir.join(SECRET_FILE);
    fs::write(&path, secret).map_err(|e| format!("Write MCP secret: {e}"))?;
    set_private_file_mode(&path)
}

fn hmac_hex(secret: &str, body: &str) -> Result<String, String> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("Invalid HMAC key: {e}"))?;
    mac.update(body.as_bytes());
    Ok(mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect())
}

fn wrap_signed(secret: &str, payload: serde_json::Value) -> Result<String, String> {
    let body = serde_json::to_string(&payload).map_err(|e| format!("Serialize payload: {e}"))?;
    let mac = hmac_hex(secret, &body)?;
    let envelope = SignedEnvelope {
        v: MCP_AUTH_VERSION,
        mac,
        payload,
    };
    serde_json::to_string(&envelope).map_err(|e| format!("Serialize envelope: {e}"))
}

fn ensure_subdirs(dir: &Path) -> Result<(), String> {
    for sub in ["requests", "responses", "inflight"] {
        let path = dir.join(sub);
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create MCP {sub} dir: {e}"))?;
        set_private_dir_mode(&path)?;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_init(app: AppHandle, run_id: String, task_id: String) -> Result<McpInitResponse, String> {
    if run_id.is_empty() || task_id.is_empty() {
        return Err("run_id and task_id are required".to_string());
    }
    let dir = run_dir(&app, &run_id)?;
    ensure_subdirs(&dir)?;
    set_private_dir_mode(&dir)?;
    let secret = generate_secret();
    write_run_secret(&dir, &secret)?;
    let response_secret = generate_secret();
    let response_secret_path = dir.join(RESPONSE_SECRET_FILE);
    fs::write(&response_secret_path, &response_secret)
        .map_err(|e| format!("Write response secret: {e}"))?;
    set_private_file_mode(&response_secret_path)?;
    write_run_binding(&dir, &run_id, &task_id)?;
    Ok(McpInitResponse {
        mcp_dir: dir.to_string_lossy().to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_list_requests(app: AppHandle, mcp_dir: String) -> Result<Vec<McpToolRequest>, String> {
    let dir = validate_mcp_dir(&app, Path::new(&mcp_dir))?;
    let (bound_task_id, bound_run_id) = read_run_binding(&dir)?;
    let requests_dir = dir.join("requests");
    let inflight_dir = dir.join("inflight");
    let mut out = Vec::new();
    let entries = fs::read_dir(&requests_dir).map_err(|e| format!("Read requests: {e}"))?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("Read request: {e}"))?;
        let mut req: McpToolRequest = match serde_json::from_str(&raw) {
            Ok(req) => req,
            Err(_) => {
                let _ = fs::remove_file(&path);
                continue;
            }
        };
        req.task_id = bound_task_id.clone();
        req.run_id = bound_run_id.clone();
        let mut digest = None;
        if req.tool == "permission_prompt" {
            digest = Some(permission_input_digest(&extract_permission_input(&req.args)));
        }
        let inflight = InflightEntry {
            request: req.clone(),
            expires_at: now_ms + request_timeout_ms(&req.tool),
            input_digest: digest,
        };
        let inflight_path = inflight_dir.join(format!("{}.json", req.request_id));
        let inflight_raw =
            serde_json::to_string(&inflight).map_err(|e| format!("Serialize inflight: {e}"))?;
        if fs::write(&inflight_path, inflight_raw).is_err() {
            continue;
        }
        set_private_file_mode(&inflight_path)?;
        if fs::remove_file(&path).is_err() {
            let _ = fs::remove_file(&inflight_path);
            continue;
        }
        out.push(req);
    }
    Ok(out)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_write_response(
    app: AppHandle,
    mcp_dir: String,
    request_id: String,
    response: McpToolResponse,
) -> Result<(), String> {
    let dir = validate_mcp_dir(&app, Path::new(&mcp_dir))?;
    validate_request_id(&request_id)?;
    let inflight_path = dir.join("inflight").join(format!("{request_id}.json"));
    if !inflight_path.is_file() {
        return Err("MCP response rejected: request is not inflight".to_string());
    }
    let inflight_raw = fs::read_to_string(&inflight_path).map_err(|e| format!("Read inflight: {e}"))?;
    let inflight: InflightEntry =
        serde_json::from_str(&inflight_raw).map_err(|e| format!("Parse inflight: {e}"))?;
    if inflight.request.request_id != request_id {
        return Err("MCP response rejected: request id mismatch".to_string());
    }
    let now_ms = chrono::Utc::now().timestamp_millis();
    if now_ms > inflight.expires_at {
        let _ = fs::remove_file(&inflight_path);
        return Err("MCP response rejected: request expired".to_string());
    }
    if inflight.request.tool == "permission_prompt" {
        if let Some(expected) = inflight.input_digest.as_deref() {
            if !expected.is_empty() && permission_response_is_allow(&response) {
                let approved_input = response
                    .content
                    .as_ref()
                    .and_then(|c| c.as_array())
                    .and_then(|items| items.first())
                    .and_then(|item| item.get("text"))
                    .and_then(|t| t.as_str())
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
                    .and_then(|parsed| parsed.get("updatedInput").cloned())
                    .unwrap_or_else(|| extract_permission_input(&inflight.request.args));
                let actual = permission_input_digest(&approved_input);
                if actual != expected {
                    return Err("MCP response rejected: permission input digest mismatch".to_string());
                }
            }
        }
    }
    let secret = read_response_secret(&dir)?;
    // Every response is written by the app via Tauri; permission allows must
    // carry appOriginated so the bridge rejects agent-signed forgeries.
    let app_originated = true;
    let raw = wrap_bound_response(
        &secret,
        &request_id,
        &inflight.request.tool,
        inflight.expires_at,
        app_originated,
        &response,
    )?;
    let path = dir.join("responses").join(format!("{request_id}.json"));
    fs::write(&path, raw).map_err(|e| format!("Write response: {e}"))?;
    set_private_file_mode(&path)?;
    let _ = fs::remove_file(inflight_path);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_write_config(app: AppHandle, mcp_dir: String, config_json: String) -> Result<String, String> {
    let dir = validate_mcp_dir(&app, Path::new(&mcp_dir))?;
    let path = dir.join("mcp-config.json");
    fs::write(&path, &config_json).map_err(|e| format!("Write MCP config: {e}"))?;
    set_private_file_mode(&path)?;
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
pub fn agent_mcp_cleanup(app: AppHandle, mcp_dir: String) -> Result<(), String> {
    let dir = validate_mcp_dir(&app, Path::new(&mcp_dir))?;
    let _ = fs::remove_dir_all(dir);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_mcp_append_guidance(app: AppHandle, run_id: String, message: String) -> Result<(), String> {
    append_guidance(&app, &run_id, &message)
}

fn append_guidance(app: &AppHandle, run_id: &str, message: &str) -> Result<(), String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err("Guidance message must not be empty".to_string());
    }
    if trimmed.len() > MAX_GUIDANCE_MESSAGE_LEN {
        return Err(format!(
            "Guidance message too long (max {MAX_GUIDANCE_MESSAGE_LEN} chars)"
        ));
    }
    let dir = run_dir(app, run_id)?;
    ensure_subdirs(&dir)?;
    let secret = read_run_secret(&dir).unwrap_or_else(|_| {
        let secret = generate_secret();
        let _ = write_run_secret(&dir, &secret);
        secret
    });
    let payload = serde_json::json!({
        "ts": chrono::Utc::now().to_rfc3339(),
        "message": trimmed,
    });
    let line = wrap_signed(&secret, payload)?;
    let path = dir.join(GUIDANCE_FILE);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Open guidance file: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("Write guidance: {e}"))?;
    set_private_file_mode(&path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitize_strips_unsafe_chars() {
        assert_eq!(sanitize_id("run-123_abc"), "run-123_abc");
        assert_eq!(sanitize_id("bad;rm -rf"), "badrm-rf");
    }

    #[test]
    fn wrap_and_verify_hmac_envelope() {
        let secret = "0123456789abcdef0123456789abcdef";
        let payload = json!({"content":[{"type":"text","text":"ok"}]});
        let raw = wrap_signed(secret, payload.clone()).expect("wrap");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(parsed["v"], MCP_AUTH_VERSION);
        let body = serde_json::to_string(&parsed["payload"]).expect("body");
        let mac = parsed["mac"].as_str().expect("mac");
        assert_eq!(hmac_hex(secret, &body).expect("hmac"), mac);
    }

    #[test]
    fn wrap_rejects_tampered_mac() {
        let secret = "0123456789abcdef0123456789abcdef";
        let payload = json!({"message":"hello"});
        let mut raw: serde_json::Value =
            serde_json::from_str(&wrap_signed(secret, payload).expect("wrap")).expect("parse");
        raw["mac"] = json!("deadbeef");
        let body = serde_json::to_string(&raw["payload"]).expect("body");
        let mac = raw["mac"].as_str().expect("mac");
        assert_ne!(hmac_hex(secret, &body).expect("hmac"), mac);
    }

    #[test]
    fn list_requests_moves_to_inflight_with_binding_and_expiry() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("run-test");
        ensure_subdirs(&dir).expect("subdirs");
        write_run_secret(&dir, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab").expect("secret");
        fs::write(
            dir.join(RESPONSE_SECRET_FILE),
            "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
        )
        .expect("response secret");
        write_run_binding(&dir, "run-1", "bound-task").expect("binding");
        let req = McpToolRequest {
            request_id: "req-1".to_string(),
            tool: "get_task".to_string(),
            args: json!({}),
            task_id: "forged-task".to_string(),
            run_id: "forged-run".to_string(),
        };
        let req_path = dir.join("requests").join("req-1.json");
        fs::write(&req_path, serde_json::to_string(&req).expect("json")).expect("write");

        let requests_dir = dir.join("requests");
        let inflight_dir = dir.join("inflight");
        let (bound_task_id, bound_run_id) = read_run_binding(&dir).expect("binding");
        let entries = fs::read_dir(&requests_dir).expect("read");
        for entry in entries.flatten() {
            let path = entry.path();
            let raw = fs::read_to_string(&path).expect("read");
            let mut parsed: McpToolRequest = serde_json::from_str(&raw).expect("parse");
            parsed.task_id = bound_task_id.clone();
            parsed.run_id = bound_run_id.clone();
            let inflight = InflightEntry {
                request: parsed,
                expires_at: chrono::Utc::now().timestamp_millis() + REQUEST_TIMEOUT_MS,
                input_digest: None,
            };
            fs::write(
                inflight_dir.join("req-1.json"),
                serde_json::to_string(&inflight).expect("json"),
            )
            .expect("inflight");
            fs::remove_file(&path).expect("remove request");
        }

        assert!(!req_path.exists(), "request must leave requests/ on claim");
        let inflight_raw = fs::read_to_string(inflight_dir.join("req-1.json")).expect("inflight");
        let inflight: InflightEntry = serde_json::from_str(&inflight_raw).expect("parse inflight");
        assert_eq!(inflight.request.task_id, "bound-task");
        assert_eq!(inflight.request.run_id, "run-1");
        assert!(inflight.expires_at > chrono::Utc::now().timestamp_millis());
    }

    #[test]
    fn bound_response_requires_app_originated_for_permission_allow() {
        let secret = "0123456789abcdef0123456789abcdef";
        let allow = McpToolResponse {
            content: Some(json!([{
                "type": "text",
                "text": r#"{"behavior":"allow","updatedInput":{}}"#
            }])),
            error: None,
        };
        let deny = McpToolResponse {
            content: Some(json!([{
                "type": "text",
                "text": r#"{"behavior":"deny"}"#
            }])),
            error: None,
        };
        assert!(permission_response_is_allow(&allow));
        assert!(!permission_response_is_allow(&deny));
        let signed = wrap_bound_response(
            secret,
            "req-1",
            "permission_prompt",
            chrono::Utc::now().timestamp_millis() + 1000,
            true,
            &allow,
        )
        .expect("wrap");
        let parsed: serde_json::Value = serde_json::from_str(&signed).expect("parse");
        assert_eq!(parsed["payload"]["appOriginated"], true);
    }
}
