//! liquitask-agentd sidecar bridge (Phase 1 supervisor daemon).
//!
//! Connect-or-spawn to the detached Go `liquitask-agentd` supervisor over a
//! Unix socket (Windows: named pipe). Forwards `run.events` notifications to
//! the renderer as Tauri events.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager as _};

use crate::agentd_store::AgentdStore;
use crate::{authorize_workspace_dir, read_storage, safe_workspace_paths};

use crate::agentd_conn::{self, connect_socket};

pub const AGENTD_RUN_EVENT: &str = "agentd-run-event";
pub const AGENTD_PTY_EVENT: &str = "agentd-run-pty";
pub const AGENTD_HEALTH_EVENT: &str = "agentd-health";
pub const AGENTD_FEEDBACK_EVENT: &str = "agentd-feedback-event";
pub const AGENTD_SCHEDULER_EVENT: &str = "agentd-scheduler-event";

const CONNECT_RETRIES: u32 = 40;
const CONNECT_DELAY_MS: u64 = 50;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdPtyEventPayload {
    pub run_id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdPtyHistoryResult {
    pub data: String,
    pub supports_pty: bool,
    pub pty_active: bool,
    pub taken_over: bool,
}

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
pub struct AgentdSkill {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub source_path: String,
    pub provider: String,
    #[serde(default)]
    pub root: String,
    pub file_count: i64,
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdDiscoveredSession {
    pub session_id: String,
    pub runtime: String,
    pub project_path: String,
    pub session_path: String,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub preview: Option<String>,
    pub modified_at_ms: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdDiscoverSessionsResult {
    #[serde(default)]
    pub sessions: Vec<AgentdDiscoveredSession>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdSessionForkResult {
    pub new_session_id: String,
    pub session_path: String,
    pub message_index: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdSessionTruncateResult {
    pub session_path: String,
    pub message_index: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdSessionMessageCountResult {
    pub session_path: String,
    pub message_index: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdQueueState {
    #[serde(default)]
    pub active_by_agent: HashMap<String, String>,
    #[serde(default)]
    pub queue: Vec<AgentdQueueEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdQueueEntry {
    pub task_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub enqueued_at_ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReservationEntry {
    pub run_id: String,
    pub task_id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub claimed_at_ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReservationWaitEntry {
    pub run_id: String,
    pub task_id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub enqueued_at_ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReservationState {
    #[serde(default)]
    pub active: Vec<AgentdReservationEntry>,
    #[serde(default)]
    pub waiting: Vec<AgentdReservationWaitEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReservationConflict {
    pub run_id: String,
    pub task_id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub overlap: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdReservationClaimResult {
    pub ok: bool,
    #[serde(default)]
    pub conflict: Option<AgentdReservationConflict>,
    #[serde(default)]
    pub wait_position: Option<i64>,
}

struct PendingRpc {
    result: Mutex<Option<Result<Value, String>>>,
    cv: Condvar,
}

struct AgentdConnection {
    writer: Mutex<Box<dyn Write + Send>>,
}

pub struct AgentdState {
    conn: Mutex<Option<Arc<AgentdConnection>>>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, Arc<PendingRpc>>>>,
    data_dir: PathBuf,
}

impl Default for AgentdState {
    fn default() -> Self {
        Self {
            conn: Mutex::new(None),
            next_id: AtomicU64::new(1),
            pending: Arc::new(Mutex::new(HashMap::new())),
            data_dir: default_agentd_data_dir(),
        }
    }
}

pub fn default_agentd_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("LIQUITASK_AGENTD_DATA") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".liquitask").join("agentd");
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile).join(".liquitask").join("agentd");
    }
    PathBuf::from(".liquitask/agentd")
}

pub fn socket_path(data_dir: &Path) -> PathBuf {
    agentd_conn::socket_path(data_dir)
}

pub fn token_path(data_dir: &Path) -> PathBuf {
    data_dir.join("token")
}

pub fn pid_path(data_dir: &Path) -> PathBuf {
    data_dir.join("agentd.pid")
}

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

fn resolve_bundled_agentd(app: &AppHandle) -> Option<PathBuf> {
    let name = agentd_bundled_binary_name();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [
            resource_dir.join(name),
            resource_dir.join("binaries").join(name),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
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

fn read_auth_token(data_dir: &Path) -> Result<String, String> {
    let raw = fs::read_to_string(token_path(data_dir)).map_err(|e| format!("read token: {e}"))?;
    let token = raw.trim().to_string();
    if token.is_empty() {
        return Err("empty agentd token".to_string());
    }
    Ok(token)
}

fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if let Ok(h) = handle {
                let _ = CloseHandle(h);
                true
            } else {
                false
            }
        }
    }
}

fn read_pid(data_dir: &Path) -> Option<u32> {
    let raw = fs::read_to_string(pid_path(data_dir)).ok()?;
    raw.trim().parse().ok()
}

fn spawn_detached_daemon(app: &AppHandle, data_dir: &Path) -> Result<(), String> {
    let bin = agentd_binary(app)?;
    fs::create_dir_all(data_dir).map_err(|e| format!("mkdir agentd data: {e}"))?;
    let mut cmd = Command::new(&bin);
    cmd.arg("--daemon")
        .env("LIQUITASK_AGENTD_DATA", data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn()
        .map_err(|e| format!("spawn agentd daemon: {e}"))?;
    Ok(())
}

fn probe_socket(data_dir: &Path) -> bool {
    connect_socket(data_dir).is_ok()
}

fn ensure_daemon_running(app: &AppHandle, state: &AgentdState) -> Result<(), String> {
    let data_dir = &state.data_dir;
    if probe_socket(data_dir) {
        return Ok(());
    }
    if let Some(pid) = read_pid(data_dir) {
        if pid_alive(pid) {
            let deadline =
                Instant::now() + Duration::from_millis(CONNECT_RETRIES as u64 * CONNECT_DELAY_MS);
            while Instant::now() < deadline {
                if probe_socket(data_dir) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(CONNECT_DELAY_MS));
            }
        } else {
            let _ = fs::remove_file(pid_path(data_dir));
        }
    }
    spawn_detached_daemon(app, data_dir)?;
    let deadline = Instant::now() + Duration::from_millis(CONNECT_RETRIES as u64 * CONNECT_DELAY_MS);
    while Instant::now() < deadline {
        if probe_socket(data_dir) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(CONNECT_DELAY_MS));
    }
    Err("agentd daemon did not become reachable".to_string())
}

fn fail_pending_rpcs(pending: &Mutex<HashMap<u64, Arc<PendingRpc>>>, message: &str) {
    if let Ok(mut map) = pending.lock() {
        for (_, slot) in map.drain() {
            if let Ok(mut result) = slot.result.lock() {
                *result = Some(Err(message.to_string()));
            }
            slot.cv.notify_one();
        }
    }
}

fn open_connection(app: &AppHandle, state: &AgentdState) -> Result<Arc<AgentdConnection>, String> {
    ensure_daemon_running(app, state)?;
    let token = read_auth_token(&state.data_dir)?;
    let (mut writer, reader) = connect_socket(&state.data_dir)?;
    let auth_line = format!("{{\"auth\":\"{token}\"}}\n");
    writer
        .write_all(auth_line.as_bytes())
        .map_err(|e| format!("auth write: {e}"))?;
    writer.flush().map_err(|e| format!("auth flush: {e}"))?;

    let conn = Arc::new(AgentdConnection {
        writer: Mutex::new(writer),
    });

    // Always attach a reader to THIS socket. A previous "start once" flag meant
    // reconnects installed a new writer while leaving responses unread on the
    // new socket — every subsequent RPC then hit the 30s timeout and froze the UI.
    let app_clone = app.clone();
    let pending = Arc::clone(&state.pending);
    let conn_for_reader = Arc::clone(&conn);
    thread::spawn(move || {
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
                        if let Some(store) = app_clone.try_state::<AgentdStore>() {
                            let _ = store.record_event(&app_clone, &run_id, &kind, params);
                        }
                        let _ = app_clone.emit(
                            AGENTD_RUN_EVENT,
                            AgentdRunEventPayload {
                                run_id,
                                kind,
                                extra: params.clone(),
                            },
                        );
                    }
                } else if method == "run.pty" {
                    if let Some(params) = v.get("params") {
                        let run_id = params
                            .get("runId")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        let data = params
                            .get("data")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        let _ = app_clone.emit(
                            AGENTD_PTY_EVENT,
                            AgentdPtyEventPayload { run_id, data },
                        );
                    }
                } else if method == "feedback.event" {
                    if let Some(params) = v.get("params") {
                        let _ = app_clone.emit(AGENTD_FEEDBACK_EVENT, params.clone());
                    }
                } else if method.starts_with("scheduler.") {
                    if let Some(params) = v.get("params") {
                        let _ = app_clone.emit(AGENTD_SCHEDULER_EVENT, params.clone());
                    }
                }
            }
        }

        // Drop only the connection this reader was serving (not a newer reconnect).
        let mut cleared_current = false;
        if let Some(state) = app_clone.try_state::<AgentdState>() {
            if let Ok(mut guard) = state.conn.lock() {
                let is_current = guard
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, &conn_for_reader));
                if is_current {
                    *guard = None;
                    cleared_current = true;
                }
            }
        }
        if cleared_current {
            fail_pending_rpcs(&pending, "agentd disconnected");
            let _ = app_clone.emit(AGENTD_HEALTH_EVENT, json!({ "alive": false }));
        }
    });

    Ok(conn)
}

pub fn agentd_connect(app: &AppHandle, state: &AgentdState) -> Result<(), String> {
    // Reuse a live connection. Calling open_connection again used to replace the
    // writer without attaching a reader for the new socket (see above), which
    // made the next RPC hang until the 30s timeout.
    {
        let guard = state.conn.lock().map_err(|_| "lock")?;
        if guard.is_some() {
            return Ok(());
        }
    }
    let conn = open_connection(app, state)?;
    let mut guard = state.conn.lock().map_err(|_| "lock")?;
    *guard = Some(conn);
    let _ = app.emit(AGENTD_HEALTH_EVENT, json!({ "alive": true }));
    Ok(())
}

fn rpc_call(state: &AgentdState, app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let needs_connect = state.conn.lock().map_err(|_| "lock")?.is_none();
    if needs_connect {
        agentd_connect(app, state)?;
    }
    let conn = state
        .conn
        .lock()
        .map_err(|_| "lock")?
        .clone()
        .ok_or_else(|| "agentd not connected".to_string())?;

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
        let mut writer = conn.writer.lock().map_err(|_| "lock")?;
        writer.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }

    let guard = slot.result.lock().map_err(|_| "lock")?;
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
    agentd_connect(&app, &state)?;
    try_install_cli_symlink(&app);
    Ok(true)
}

fn cli_bundled_binary_name() -> &'static str {
    #[cfg(windows)]
    {
        "liquitask-cli.exe"
    }
    #[cfg(not(windows))]
    {
        "liquitask-cli"
    }
}

fn resolve_bundled_cli(app: &AppHandle) -> Option<PathBuf> {
    let name = cli_bundled_binary_name();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for candidate in [resource_dir.join(name), resource_dir.join("binaries").join(name)] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn liquitask_cli_binary(app: &AppHandle) -> Option<PathBuf> {
    if let Some(bundled) = resolve_bundled_cli(app) {
        return Some(bundled);
    }

    let candidates = [
        PathBuf::from("liquitask-agentd/liquitask"),
        PathBuf::from("liquitask-agentd/target/debug/liquitask"),
        PathBuf::from("../liquitask-agentd/liquitask"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    None
}

/// Best-effort install of `liquitask` into `~/.local/bin` on first daemon connect.
fn try_install_cli_symlink(app: &AppHandle) {
    #[cfg(not(unix))]
    {
        let _ = app;
        return;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let Some(src) = liquitask_cli_binary(app) else {
            return;
        };
        let Ok(home) = std::env::var("HOME") else {
            return;
        };
        let marker = PathBuf::from(&home)
            .join(".liquitask")
            .join("cli-symlink.done");
        if marker.exists() {
            return;
        }

        let bin_dir = PathBuf::from(&home).join(".local").join("bin");
        if fs::create_dir_all(&bin_dir).is_err() {
            return;
        }
        let dest = bin_dir.join("liquitask");
        if dest.symlink_metadata().is_ok() {
            let _ = fs::remove_file(&dest);
        }
        if symlink(&src, &dest).is_err() {
            return;
        }
        let _ = fs::write(&marker, format!("{}\n", src.display()));
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_stop(app: AppHandle, state: tauri::State<'_, AgentdState>) -> Result<bool, String> {
    let result = rpc_call(&state, &app, "daemon.stop", json!({}));
    {
        let mut guard = state.conn.lock().map_err(|_| "lock")?;
        *guard = None;
    }
    let _ = app.emit(AGENTD_HEALTH_EVENT, json!({ "alive": false }));
    result.map(|_| true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_detect(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    store: tauri::State<'_, AgentdStore>,
) -> Result<Vec<AgentdRuntime>, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "detect", json!({}))?;
    let runtimes: Vec<AgentdRuntime> = serde_json::from_value(result).map_err(|e| e.to_string())?;
    for rt in &runtimes {
        let _ = store.upsert_agent(
            &app,
            &rt.id,
            &rt.name,
            &rt.binary,
            rt.path.as_deref(),
            rt.version.as_deref(),
            rt.ready,
        );
    }
    Ok(runtimes)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_skills_list(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    provider: Option<String>,
) -> Result<Vec<AgentdSkill>, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "skills.list",
        json!({ "provider": provider.unwrap_or_default() }),
    )?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_skill_read(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    source_path: String,
) -> Result<String, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "skills.read",
        json!({ "sourcePath": source_path }),
    )?;
    Ok(result
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_start(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    store: tauri::State<'_, AgentdStore>,
    task_id: String,
    runtime: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    advisor_model: Option<String>,
    resume_session_id: Option<String>,
    thinking_level: Option<String>,
    mcp_config: Option<String>,
    permission_mode: Option<String>,
    timeout_ms: Option<i64>,
    auto_approve: Option<bool>,
    tool_policy: Option<std::collections::HashMap<String, String>>,
    sandbox_mode: Option<String>,
    container_image: Option<String>,
    host: Option<String>,
    ssh: Option<serde_json::Value>,
    local_base_path: Option<String>,
    local_run_id: Option<String>,
    agent_id: Option<String>,
    scope: Option<Vec<String>>,
    daily_cost_cap_usd: Option<f64>,
    max_runs_per_day: Option<u32>,
    per_run_cost_cap_usd: Option<f64>,
    per_run_token_cap: Option<u64>,
    today_spend_usd: Option<f64>,
    today_run_count: Option<u32>,
) -> Result<String, String> {
    agentd_connect(&app, &state)?;
    let workspace_paths = safe_workspace_paths(&read_storage(&app)?);
    let authorized_cwd = match cwd.as_deref() {
        Some(dir) if !dir.is_empty() => Some(
            authorize_workspace_dir(&app, dir)?
                .to_string_lossy()
                .to_string(),
        ),
        _ => None,
    };
    let mut params = serde_json::Map::new();
    params.insert("taskId".into(), json!(task_id));
    params.insert("runtime".into(), json!(runtime));
    params.insert("prompt".into(), json!(prompt));
    if let Some(id) = local_run_id {
        params.insert("localRunId".into(), json!(id));
    }
    if let Some(id) = agent_id {
        params.insert("agentId".into(), json!(id));
    }
    if let Some(ref dir) = authorized_cwd {
        params.insert("cwd".into(), json!(dir));
    }
    if let Some(ref m) = model {
        params.insert("model".into(), json!(m));
    }
    if let Some(ref advisor) = advisor_model {
        let trimmed = advisor.trim();
        if !trimmed.is_empty() {
            params.insert("advisorModel".into(), json!(trimmed));
        }
    }
    if let Some(id) = resume_session_id {
        params.insert("resumeSessionId".into(), json!(id));
    }
    if let Some(level) = thinking_level {
        params.insert("thinkingLevel".into(), json!(level));
    }
    if let Some(cfg) = mcp_config {
        params.insert("mcpConfig".into(), json!(cfg));
    }
    if let Some(mode) = permission_mode {
        params.insert("permissionMode".into(), json!(mode));
    }
    if let Some(ms) = timeout_ms {
        if ms > 0 {
            params.insert("timeoutMs".into(), json!(ms));
        }
    }
    if auto_approve == Some(true) {
        params.insert("autoApprove".into(), json!(true));
    }
    if let Some(policy) = tool_policy {
        if !policy.is_empty() {
            params.insert("toolPolicy".into(), json!(policy));
        }
    }
    if let Some(mode) = sandbox_mode {
        let trimmed = mode.trim();
        if trimmed == "os" {
            params.insert("sandboxMode".into(), json!("os"));
        }
    }
    if let Some(image) = container_image {
        let trimmed = image.trim();
        if !trimmed.is_empty() {
            params.insert("containerImage".into(), json!(trimmed));
        }
    }
    if let Some(h) = host {
        let trimmed = h.trim();
        if !trimmed.is_empty() {
            params.insert("host".into(), json!(trimmed));
        }
    }
    if let Some(cfg) = ssh {
        if !cfg.is_null() {
            params.insert("ssh".into(), cfg);
        }
    }
    if let Some(base) = local_base_path {
        let trimmed = base.trim();
        if !trimmed.is_empty() {
            params.insert("localBasePath".into(), json!(trimmed));
        }
    }
    params.insert("workspacePaths".into(), json!(workspace_paths));
    if let Some(paths) = scope {
        if !paths.is_empty() {
            params.insert("scope".into(), json!(paths));
        }
    }
    if let Some(cap) = daily_cost_cap_usd {
        if cap > 0.0 {
            params.insert("dailyCostCapUsd".into(), json!(cap));
        }
    }
    if let Some(max) = max_runs_per_day {
        if max > 0 {
            params.insert("maxRunsPerDay".into(), json!(max));
        }
    }
    if let Some(cap) = per_run_cost_cap_usd {
        if cap > 0.0 {
            params.insert("perRunCostCapUsd".into(), json!(cap));
        }
    }
    if let Some(cap) = per_run_token_cap {
        if cap > 0 {
            params.insert("perRunTokenCap".into(), json!(cap));
        }
    }
    if let Some(spend) = today_spend_usd {
        params.insert("todaySpendUsd".into(), json!(spend));
    }
    if let Some(count) = today_run_count {
        params.insert("todayRunCount".into(), json!(count));
    }
    let params = serde_json::Value::Object(params);
    let result = rpc_call(&state, &app, "run.start", params)?;
    let run_id = result
        .get("runId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "missing runId".to_string())?;
    let _ = store.record_run_start(
        &app,
        &run_id,
        &task_id,
        &runtime,
        model.as_deref(),
        authorized_cwd.as_deref(),
    );
    Ok(run_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_ssh_health(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    target: String,
    port: Option<i32>,
    identity_file: Option<String>,
    remote_path: Option<String>,
    fallback_to_local: Option<bool>,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let mut cfg = serde_json::Map::new();
    cfg.insert("target".into(), json!(target));
    if let Some(p) = port {
        if p > 0 {
            cfg.insert("port".into(), json!(p));
        }
    }
    if let Some(id) = identity_file {
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            cfg.insert("identityFile".into(), json!(trimmed));
        }
    }
    if let Some(path) = remote_path {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            cfg.insert("remoteBasePath".into(), json!(trimmed));
        }
    }
    if fallback_to_local == Some(true) {
        cfg.insert("fallbackToLocal".into(), json!(true));
    }
    let _ = rpc_call(&state, &app, "ssh.health", json!(cfg))?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_cancel(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let _ = rpc_call(&state, &app, "run.cancel", json!({ "runId": run_id }))?;
    Ok(true)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_pause(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "run.pause", json!({ "runId": run_id }))?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_resume(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "run.resume", json!({ "runId": run_id }))?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_inject(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    guidance: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "run.inject",
        json!({ "runId": run_id, "guidance": guidance }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_pty_history(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<AgentdPtyHistoryResult, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "run.pty.history",
        json!({ "runId": run_id }),
    )?;
    Ok(AgentdPtyHistoryResult {
        data: result
            .get("data")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        supports_pty: result
            .get("supportsPty")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        pty_active: result
            .get("ptyActive")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        taken_over: result
            .get("takenOver")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_pty_write(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    data: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "run.pty.write",
        json!({ "runId": run_id, "data": data }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_pty_takeover(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "run.pty.takeover",
        json!({ "runId": run_id }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_run_reattach(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
) -> Result<Vec<AgentdReattachedRun>, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "run.reattach", json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_sessions_discover(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    known_session_ids: Option<Vec<String>>,
) -> Result<AgentdDiscoverSessionsResult, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "sessions.discover",
        json!({ "knownSessionIds": known_session_ids.unwrap_or_default() }),
    )?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_sessions_fork(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    runtime: String,
    session_id: String,
    project_path: Option<String>,
    message_index: Option<i64>,
    new_session_id: Option<String>,
) -> Result<AgentdSessionForkResult, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({
        "runtime": runtime,
        "sessionId": session_id,
    });
    if let Some(path) = project_path {
        params["projectPath"] = json!(path);
    }
    if let Some(idx) = message_index {
        params["messageIndex"] = json!(idx);
    }
    if let Some(id) = new_session_id {
        params["newSessionId"] = json!(id);
    }
    let result = rpc_call(&state, &app, "sessions.fork", params)?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_sessions_truncate(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    runtime: String,
    session_id: String,
    message_index: i64,
    project_path: Option<String>,
) -> Result<AgentdSessionTruncateResult, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({
        "runtime": runtime,
        "sessionId": session_id,
        "messageIndex": message_index,
    });
    if let Some(path) = project_path {
        params["projectPath"] = json!(path);
    }
    let result = rpc_call(&state, &app, "sessions.truncate", params)?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_sessions_message_count(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    runtime: String,
    session_id: String,
    project_path: Option<String>,
) -> Result<AgentdSessionMessageCountResult, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({
        "runtime": runtime,
        "sessionId": session_id,
    });
    if let Some(path) = project_path {
        params["projectPath"] = json!(path);
    }
    let result = rpc_call(&state, &app, "sessions.messageCount", params)?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_permission_respond(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    request_id: String,
    decision: String,
    input_digest: Option<String>,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let mut body = serde_json::Map::new();
    body.insert("runId".into(), json!(run_id));
    body.insert("requestId".into(), json!(request_id));
    body.insert("decision".into(), json!(decision));
    if let Some(digest) = input_digest {
        if !digest.is_empty() {
            body.insert("inputDigest".into(), json!(digest));
        }
    }
    let result = rpc_call(
        &state,
        &app,
        "permission.respond",
        serde_json::Value::Object(body),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_queue_list(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
) -> Result<AgentdQueueState, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "queue.list", json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_queue_enqueue(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    task_id: String,
    agent_id: String,
    run_id: Option<String>,
) -> Result<i64, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({ "taskId": task_id, "agentId": agent_id });
    if let Some(id) = run_id {
        params["runId"] = json!(id);
    }
    let result = rpc_call(&state, &app, "queue.enqueue", params)?;
    Ok(result
        .get("position")
        .and_then(|v| v.as_i64())
        .unwrap_or(0))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_queue_remove(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    task_id: Option<String>,
    agent_id: Option<String>,
    run_id: Option<String>,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "queue.remove",
        json!({
            "taskId": task_id.unwrap_or_default(),
            "agentId": agent_id.unwrap_or_default(),
            "runId": run_id.unwrap_or_default(),
        }),
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_queue_acquire(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    agent_id: String,
    run_id: String,
    max_concurrent_runs: Option<i64>,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({ "agentId": agent_id, "runId": run_id });
    if let Some(max) = max_concurrent_runs {
        if max > 0 {
            params["maxConcurrentRuns"] = json!(max);
        }
    }
    let result = rpc_call(
        &state,
        &app,
        "queue.acquire",
        params,
    )?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_queue_release(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    agent_id: String,
) -> Result<Option<AgentdQueueEntry>, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "queue.release",
        json!({ "agentId": agent_id }),
    )?;
    if result.get("next").map(|v| v.is_null()).unwrap_or(true) {
        return Ok(None);
    }
    serde_json::from_value(result.get("next").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_reservation_list(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
) -> Result<AgentdReservationState, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(&state, &app, "reservation.list", json!({}))?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_reservation_claim(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
    task_id: String,
    paths: Vec<String>,
    queue_on_conflict: Option<bool>,
) -> Result<AgentdReservationClaimResult, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "reservation.claim",
        json!({
            "runId": run_id,
            "taskId": task_id,
            "paths": paths,
            "queueOnConflict": queue_on_conflict.unwrap_or(true),
        }),
    )?;
    serde_json::from_value(result).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_reservation_release(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    run_id: String,
) -> Result<Option<AgentdReservationWaitEntry>, String> {
    agentd_connect(&app, &state)?;
    let result = rpc_call(
        &state,
        &app,
        "reservation.release",
        json!({ "runId": run_id }),
    )?;
    if result.get("next").map(|v| v.is_null()).unwrap_or(true) {
        return Ok(None);
    }
    serde_json::from_value(result.get("next").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdFeedbackWatchRun {
    pub run_id: String,
    pub task_id: String,
    pub pr_url: String,
    #[serde(default)]
    pub repo_dir: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_feedback_watch(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    runs: Vec<AgentdFeedbackWatchRun>,
) -> Result<u32, String> {
    agentd_connect(&app, &state)?;
    let payload: Vec<Value> = runs
        .into_iter()
        .map(|r| {
            json!({
                "runId": r.run_id,
                "taskId": r.task_id,
                "prUrl": r.pr_url,
                "repoDir": r.repo_dir,
                "gitBranch": r.git_branch,
                "status": r.status,
            })
        })
        .collect();
    let result = rpc_call(&state, &app, "feedback.watch", json!({ "runs": payload }))?;
    Ok(result
        .get("watched")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentdNotifyConfig {
    enabled: bool,
    provider: String,
    pushover_user_key: Option<String>,
    pushover_api_token: Option<String>,
    webhook_url: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn agentd_notify_config_set(
    app: AppHandle,
    config: AgentdNotifyConfig,
) -> Result<bool, String> {
    // Run off the UI/IPC thread — rpc_call can block up to 30s and used to freeze
    // the main event loop when the agentd reader was orphaned on reconnect.
    tokio::task::spawn_blocking(move || {
        let state = app.state::<AgentdState>();
        agentd_connect(&app, &state)?;
        let mut params = json!({
            "enabled": config.enabled,
            "provider": config.provider,
        });
        if let Some(v) = config.pushover_user_key {
            params["pushoverUserKey"] = json!(v);
        }
        if let Some(v) = config.pushover_api_token {
            params["pushoverApiToken"] = json!(v);
        }
        if let Some(v) = config.webhook_url {
            params["webhookUrl"] = json!(v);
        }
        let result = rpc_call(&state, &app, "notify.config.set", params)?;
        Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
    })
    .await
    .map_err(|e| format!("notify config task failed: {e}"))?
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentdSchedulerIntent {
    pub run_id: String,
    #[serde(default)]
    pub local_run_id: Option<String>,
    pub task_id: String,
    pub agent_id: String,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub resume_session_id: Option<String>,
    #[serde(default)]
    pub dev_council_verify: Option<bool>,
    #[serde(default)]
    pub max_retries: Option<i64>,
    #[serde(default)]
    pub auto_repair_ci: Option<bool>,
    #[serde(default)]
    pub auto_repair_review: Option<bool>,
    #[serde(default)]
    pub auto_repair_max: Option<i64>,
    #[serde(default)]
    pub pr_url: Option<String>,
    #[serde(default)]
    pub repo_dir: Option<String>,
    #[serde(default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub start_params: Option<Value>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_scheduler_intent_set(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    intent: AgentdSchedulerIntent,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({
        "runId": intent.run_id,
        "taskId": intent.task_id,
        "agentId": intent.agent_id,
    });
    if let Some(v) = intent.local_run_id {
        params["localRunId"] = json!(v);
    }
    if let Some(v) = intent.runtime {
        params["runtime"] = json!(v);
    }
    if let Some(v) = intent.cwd {
        params["cwd"] = json!(v);
    }
    if let Some(v) = intent.prompt {
        params["prompt"] = json!(v);
    }
    if let Some(v) = intent.model {
        params["model"] = json!(v);
    }
    if let Some(v) = intent.resume_session_id {
        params["resumeSessionId"] = json!(v);
    }
    if let Some(v) = intent.dev_council_verify {
        params["devCouncilVerify"] = json!(v);
    }
    if let Some(v) = intent.max_retries {
        params["maxRetries"] = json!(v);
    }
    if let Some(v) = intent.auto_repair_ci {
        params["autoRepairCi"] = json!(v);
    }
    if let Some(v) = intent.auto_repair_review {
        params["autoRepairReview"] = json!(v);
    }
    if let Some(v) = intent.auto_repair_max {
        params["autoRepairMax"] = json!(v);
    }
    if let Some(v) = intent.pr_url {
        params["prUrl"] = json!(v);
    }
    if let Some(v) = intent.repo_dir {
        params["repoDir"] = json!(v);
    }
    if let Some(v) = intent.git_branch {
        params["gitBranch"] = json!(v);
    }
    if let Some(v) = intent.session_id {
        params["sessionId"] = json!(v);
    }
    if let Some(v) = intent.start_params {
        params["startParams"] = v;
    }
    let result = rpc_call(&state, &app, "scheduler.intent.set", params)?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}

#[tauri::command(rename_all = "camelCase")]
pub fn agentd_scheduler_config_set(
    app: AppHandle,
    state: tauri::State<'_, AgentdState>,
    max_concurrent_runs: Option<i64>,
    default_max_retries: Option<i64>,
) -> Result<bool, String> {
    agentd_connect(&app, &state)?;
    let mut params = json!({});
    if let Some(v) = max_concurrent_runs {
        params["maxConcurrentRuns"] = json!(v);
    }
    if let Some(v) = default_max_retries {
        params["defaultMaxRetries"] = json!(v);
    }
    let result = rpc_call(&state, &app, "scheduler.config.set", params)?;
    Ok(result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true))
}
