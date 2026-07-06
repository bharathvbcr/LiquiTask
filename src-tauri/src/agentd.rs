//! liquitask-agentd sidecar bridge (Phase 1).
//!
//! Spawns the Go `liquitask-agentd` binary and speaks newline-delimited JSON-RPC
//! over stdio. Forwards `run.events` notifications to the renderer as Tauri events.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

pub const AGENTD_RUN_EVENT: &str = "agentd-run-event";
pub const AGENTD_HEALTH_EVENT: &str = "agentd-health";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdRunEventPayload {
    pub run_id: String,
    pub kind: String,
    #[serde(flatten)]
    pub extra: Value,
}

#[derive(Serialize, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentdRuntime {
    pub id: String,
    pub name: String,
    pub binary: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    pub ready: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReattachedRun {
    pub run_id: String,
    pub task_id: String,
    pub runtime: String,
    pub alive: bool,
    pub status: String,
}

struct PendingRpc {
    result: Mutex<Option<Result<Value, String>>>,
    cv: Condvar,
}

pub struct AgentdState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, Arc<PendingRpc>>>>,
    reader_started: Mutex<bool>,
}

impl Default for AgentdState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            reader_started: Mutex::new(false),
        }
    }
}

/// Platform-specific sidecar binary name, mirroring
/// `semantic_layer::sidecar_binary_name()`.
fn agentd_bundled_binary_name() -> &'static str {
    #[cfg(windows)]
    {
        "liquitask-agentd.exe"
    }
    #[cfg(not(windows))]
    {
        "liquitask-agentd"
    }
}

/// Resolve the bundled (packaged-app) sidecar location, mirroring
/// `semantic_layer::resolve_bundled_sidecar()`: Tauri's `externalBin`
/// convention copies the target-triple-suffixed binary next to the app
/// executable (as `<name>-<target-triple>`) and the bundler/OS then makes it
/// available alongside the running binary without the triple suffix at
/// runtime resolution time — but since we spawn it ourselves (no
/// tauri-plugin-shell), we resolve the resource/exe-adjacent path directly.
fn resolve_bundled_agentd(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager as _;

    let name = agentd_bundled_binary_name();

    // 1. Next to the running executable (typical for NSIS/most bundles).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. Tauri's resource directory (covers bundle layouts where externalBin
    //    binaries land alongside resources rather than the exe itself).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let candidate = resource_dir.join("binaries").join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn agentd_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(bundled) = resolve_bundled_agentd(app) {
        return Ok(bundled);
    }

    let candidates = [
        PathBuf::from("liquitask-agentd/liquitask-agentd"),
        PathBuf::from("liquitask-agentd/target/debug/liquitask-agentd"),
        PathBuf::from("../liquitask-agentd/liquitask-agentd"),
    ];
    for c in candidates {
        if c.exists() {
            return Ok(c);
        }
    }
    if let Ok(o) = Command::new("which").arg("liquitask-agentd").output() {
        if o.status.success() {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !s.is_empty() {
                return Ok(PathBuf::from(s));
            }
        }
    }
    Err("liquitask-agentd not built — run: cd liquitask-agentd && go build -o liquitask-agentd ./cmd/liquitask-agentd".to_string())
}

pub fn agentd_start(app: &AppHandle, state: &AgentdState) -> Result<(), String> {
    let mut started = state.reader_started.lock().map_err(|_| "lock")?;
    if *started {
        return Ok(());
    }
    let bin = agentd_binary(app)?;
    let mut child = Command::new(&bin)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn agentd: {e}"))?;

    let stdin = child.stdin.take().ok_or("stdin")?;
    let stdout = child.stdout.take().ok_or("stdout")?;

    {
        let mut sin = state.stdin.lock().map_err(|_| "lock")?;
        *sin = Some(stdin);
    }
    {
        let mut guard = state.child.lock().map_err(|_| "lock")?;
        *guard = Some(child);
    }
    *started = true;

    let app_clone = app.clone();
    let pending = Arc::clone(&state.pending);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(id) = v.get("id").and_then(|x| x.as_u64()) {
                if let Ok(mut map) = pending.lock() {
                    if let Some(slot) = map.remove(&id) {
                        let res = if let Some(err) = v.get("error") {
                            Err(err
                                .get("message")
                                .and_then(|m| m.as_str())
                                .unwrap_or("rpc error")
                                .to_string())
                        } else {
                            Ok(v.get("result").cloned().unwrap_or(Value::Null))
                        };
                        *slot.result.lock().unwrap() = Some(res);
                        slot.cv.notify_one();
                    }
                }
                continue;
            }
            if let Some(method) = v.get("method").and_then(|m| m.as_str()) {
                if method == "run.events" {
                    if let Some(params) = v.get("params") {
                        let run_id = params
                            .get("runId")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        let kind = params
                            .get("kind")
                            .and_then(|x| x.as_str())
                            .unwrap_or("message")
                            .to_string();
                        let _ = app_clone.emit(
                            AGENTD_RUN_EVENT,
                            AgentdRunEventPayload {
                                run_id,
                                kind,
                                extra: params.clone(),
                            },
                        );
                    }
                }
            }
        }
        let _ = app_clone.emit(AGENTD_HEALTH_EVENT, json!({ "alive": false }));
    });

    let _ = app.emit(AGENTD_HEALTH_EVENT, json!({ "alive": true }));
    Ok(())
}

fn rpc_call(state: &AgentdState, method: &str, params: Value) -> Result<Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);
    let slot = Arc::new(PendingRpc {
        result: Mutex::new(None),
        cv: Condvar::new(),
    });
    {
        let mut map = state.pending.lock().map_err(|_| "lock")?;
        map.insert(id, Arc::clone(&slot));
    }

    let req = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    });
    let line = serde_json::to_string(&req).map_err(|e| e.to_string())? + "\n";
    {
        let mut sin = state.stdin.lock().map_err(|_| "lock")?;
        let stdin = sin.as_mut().ok_or("agentd not started")?;
        stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }

    let mut guard = slot.result.lock().map_err(|_| "lock")?;
    let (guard, timeout) = slot
        .cv
        .wait_timeout_while(guard, Duration::from_secs(30), |r| r.is_none())
        .map_err(|_| "wait")?;
    let _ = state.pending.lock().map_err(|_| "lock")?.remove(&id);
    if timeout.timed_out() {
        return Err("rpc timeout".to_string());
    }
    match guard.clone() {
        Some(Ok(v)) => Ok(v),
        Some(Err(e)) => Err(e),
        None => Err("rpc empty".to_string()),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_ensure(app: AppHandle, state: tauri::State<'_, AgentdState>) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_detect(app: AppHandle, state: tauri::State<'_, AgentdState>) -> Result<Vec<AgentdRuntime>, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(&state, "detect", json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_start(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    task_id: String,
    runtime: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    resume_session_id: Option<String>,
    thinking_level: Option<String>,
    mcp_config: Option<String>,
) -> Result<String, String> {
    agentd_start(&app, &state)?;
    let params = json!({
        "taskId": task_id,
        "runtime": runtime,
        "prompt": prompt,
        "cwd": cwd,
        "model": model,
        "resumeSessionId": resume_session_id,
        "thinkingLevel": thinking_level,
        "mcpConfig": mcp_config,
    });
    let result = rpc_call(&state, "run.start", params)?;
    result
        .get("runId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing runId".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_cancel(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    let _ = rpc_call(&state, "run.cancel", json!({ "runId": run_id }))?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_pause(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(&state, "run.pause", json!({ "runId": run_id }))?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_resume(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(&state, "run.resume", json!({ "runId": run_id }))?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_inject(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    guidance: String,
) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(
        &state,
        "run.inject",
        json!({ "runId": run_id, "guidance": guidance }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_reattach(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
) -> Result<Vec<AgentdReattachedRun>, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(&state, "run.reattach", json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_permission_respond(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    request_id: String,
    decision: String,
) -> Result<bool, String> {
    agentd_start(&app, &state)?;
    let result = rpc_call(
        &state,
        "permission.respond",
        json!({ "runId": run_id, "requestId": request_id, "decision": decision }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}
