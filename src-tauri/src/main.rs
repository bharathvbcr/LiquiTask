// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! LiquiTask Tauri backend.
//!
//! This is a faithful port of the former Electron main process
//! (`electron/main.cts`). It exposes the same capability surface to the
//! renderer through Tauri commands so the existing `window.desktopAPI`
//! contract is preserved 1:1:
//!
//! * KV storage  -> storage_get / storage_set / storage_delete / storage_clear / storage_has
//! * workspace fs -> workspace_get_paths / workspace_set_paths /
//!                   workspace_read_file / workspace_write_file / workspace_search_files
//!
//! Window controls, the folder picker and notifications are handled on the JS
//! side via `@tauri-apps/api/window`, `@tauri-apps/plugin-dialog` and
//! `@tauri-apps/plugin-notification` respectively (the matching Rust plugins are
//! initialised below).
//!
//! The HTTP plugin (`tauri-plugin-http`) is also initialised so the renderer can
//! reach the local Ollama server from the Rust process, bypassing the browser
//! CORS restriction that blocks a direct webview `fetch` to localhost:11434.
//! Its allowed-URL scope is defined in `capabilities/default.json`.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

mod agent_cli_util;
mod agent_council_runner;
mod agentd;
mod agentd_conn;
mod agentd_store;
mod agent_mcp;
mod agent_sandbox;
mod agent_git;
mod board_snapshot;
mod dock_badge;
mod github_sync;
mod sleep_guard;
mod tray;
mod agent_analytics;
mod agent_core;
mod agent_policy;
mod agent_devcouncil;
mod agent_devcouncil_evidence;
mod agent_skills;
mod ai_engine;
mod app_data;
mod encryption;
mod logic;
mod recurring_engine;
mod run_store;
mod secure_key_store;
mod semantic_layer;
mod storage_tasks;
mod task_store;
mod terminal;
use agent_council_runner::{
    agent_detect_clis, agent_detect_ide_tools, agent_open_in_terminal, agent_open_in_tool,
    agent_run_active, agent_run_cancel, agent_council_pause,
    agent_council_resume, agent_run_start, agent_runs_reattach, AgentProcessRegistry,
};
use agentd::{
    agentd_detect, agentd_ensure, agentd_feedback_watch, agentd_notify_config_set, agentd_permission_respond,
    agentd_queue_acquire, agentd_queue_enqueue, agentd_queue_list, agentd_queue_release,
    agentd_reservation_claim, agentd_reservation_list, agentd_reservation_release,
    agentd_queue_remove,     agentd_run_cancel, agentd_run_inject, agentd_run_pause, agentd_run_reattach,
    agentd_run_resume, agentd_run_start, agentd_pty_history, agentd_pty_takeover, agentd_pty_write,
    agentd_scheduler_config_set, agentd_scheduler_intent_set,
    agentd_sessions_discover, agentd_sessions_fork,
    agentd_sessions_message_count, agentd_sessions_truncate, agentd_skill_read, agentd_skills_list, agentd_ssh_health,
    agentd_stop,
    AgentdState,
};
use agentd_store::{
    agentd_store_list_agents, agentd_store_list_devcouncil_evidence, agentd_store_list_devcouncil_requirements,
    agentd_store_list_devcouncil_tasks, agentd_store_list_run_events, agentd_store_list_runs, AgentdStore,
};
use task_store::{
    task_events_append, task_events_count, task_events_latest_snapshot, task_events_read, task_store_commit,
    task_store_export_snapshot, task_store_read_snapshot, task_store_write_snapshot, TaskStore,
};
use terminal::{terminal_close, terminal_open, terminal_resize, terminal_write, TerminalRegistry};
use agent_mcp::{
    agent_mcp_append_guidance, agent_mcp_cleanup, agent_mcp_init, agent_mcp_list_requests,
    agent_mcp_resolve_bridge, agent_mcp_write_config, agent_mcp_write_response,
};
use agent_git::{
    agent_container_build, agent_container_system_status, agent_git_commit_worktree,
    agent_git_create_pr, agent_git_create_worktree, agent_git_diff, agent_git_discard_worktree,
    agent_git_ensure_workspace_gitignore, agent_git_file_diff, agent_git_list_changed_files,
    agent_git_list_worktrees, agent_git_merge_main_into_worktree, agent_git_merge_worktree,
    agent_git_merge_worktree_tx, agent_git_prune_worktrees, agent_git_push,
    agent_git_recover_merge_journal, agent_git_reset_worktree_to, agent_git_worktree_state,
    agent_git_branch_is_ancestor,
};
use board_snapshot::board_export_snapshot;
use github_sync::{
    github_auth_status, github_detect_repo, github_issue_close, github_issue_comment, github_issue_list,
    github_pr_checks, github_pr_failed_logs, github_pr_review_comments,
};
use tray::{on_run_event, setup_tray, tray_update_active_runs, tray_update_dock_badge, tray_update_inbox_count};
use sleep_guard::sleep_prevention_set_active;
use agent_core::{
    agent_build_council_goal, agent_build_task_prompt, agent_parse_council_report,
    agent_parse_stream_line,
};
use agent_analytics::agent_compute_analytics;
use agent_devcouncil::{
    agent_dev_cli_available, agent_dev_discover, agent_dev_init, agent_dev_install,
    agent_resolve_dev_cli_path,
    agent_dev_install_local, agent_dev_map, agent_dev_parse_export, agent_dev_plan,
    agent_dev_repair, agent_dev_repo_files, agent_dev_repo_map_summary, agent_dev_status,
    agent_dev_verify,
};
use agent_devcouncil_evidence::agent_dev_mirror_evidence;
use agent_skills::{agent_skills_capture, agent_skills_delete, agent_skills_filter};
use ai_engine::{ai_claude_chat, ai_claude_health, ai_claude_models, ai_ollama_chat, ai_ollama_generate, ai_ollama_health};
use app_data::{app_data_load, app_data_patch, app_data_save, app_data_storage_path};
use logic::automation::{automation_apply_actions, automation_is_rule_due};
use logic::recurring::{recurring_advance, recurring_next_occurrence};
// --- liquitask-core migration: risk / time_reporting / cleanup / auto_organize ---
// (added by the services→Rust migration; dedupe if the integration agent also adds these)
use logic::risk::risk_heuristics;
use logic::time_reporting::{
    time_export_csv, time_export_json, time_generate_report, time_productivity_metrics,
};
use logic::cleanup::{
    cleanup_analyze_redundancy, cleanup_heuristic_categorize, cleanup_heuristic_cluster,
    cleanup_heuristic_duplicates, cleanup_heuristic_merge,
};
use logic::auto_organize::{
    autoorg_consolidate_tags, autoorg_dedup_candidate_pairs, autoorg_filter_task_ids,
};
use recurring_engine::recurring_calculate_next;
use storage_tasks::{storage_parse_tasks, storage_serialize_tasks, storage_tasks_mutate};
use semantic_layer::{
    semantic_layer_chat, semantic_layer_config, semantic_layer_feedback, semantic_layer_health,
    semantic_layer_spawn, semantic_layer_stats, semantic_layer_stop, stop_on_app_exit,
    SemanticLayerState,
};
use encryption::{
    decrypt_bytes, decrypt_from_envelope, decrypt_from_envelope_auto, disable_encryption_key,
    enable_encryption, encrypt_bytes, encrypt_to_envelope, encrypt_to_envelope_auto,
    encryption_status, is_encrypted_payload, lock_encryption, read_meta, storage_opaque_key,
    unlock_encryption, write_meta, EncryptionStatus,
};

// ---------------------------------------------------------------------------
// Constants (mirrors electron/main.cts)
// ---------------------------------------------------------------------------

const MAX_WORKSPACE_SEARCH_RESULTS: usize = 20;
const MAX_WORKSPACE_FILE_SIZE_BYTES: u64 = 256 * 1024;
const MAX_STORAGE_SIZE_BYTES: usize = 50_000_000;
const STORAGE_FILE_NAME: &str = "storage.json";

/// Keys whose values are encrypted at rest by default (mirrors StorageService.SENSITIVE_KEYS).
const SENSITIVE_STORAGE_KEYS: &[&str] = &[
    "liquitask-ai-config",
    "liquitask-gemini-api-key",
    "liquitask-search-history",
    "liquitask-command-history",
    "liquitask-ai-semantic-cache",
    "liquitask-auto-organize-history",
    "liquitask-ai-organize-cache",
    "liquitask-backups",
    "liquitask-remote-push-config",
    "liquitask-user-mcp-servers",
    "liquitask-agents",
];

const FORBIDDEN_STORAGE_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

const SUPPORTED_WORKSPACE_FILE_EXTENSIONS: &[&str] = &[
    "c", "cc", "cpp", "cs", "css", "cts", "astro", "cfg", "conf", "dart", "go", "gradle", "gql",
    "graphql", "h", "hpp", "html", "java", "js", "json", "jsonc", "jsx", "kt", "kts", "less",
    "log", "lua", "md", "mdx", "mjs", "mts", "php", "properties", "ps1", "py", "r", "rb", "rs",
    "sass", "scala", "scss", "sh", "sql", "svelte", "swift", "toml", "ts", "tsx", "txt", "vue",
    "xml", "yaml", "yml",
];

const SUPPORTED_WORKSPACE_FILE_NAMES: &[&str] =
    &[".dockerignore", ".gitignore", "dockerfile", "makefile", "procfile"];

const SKIPPED_WORKSPACE_DIR_NAMES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".turbo",
    ".vite",
    ".yarn",
    "build",
    "coverage",
    "dist",
    "dist-electron",
    "node_modules",
    "out",
    "release",
];

// ---------------------------------------------------------------------------
// Storage write serialisation
// ---------------------------------------------------------------------------

pub(crate) struct StorageGuard(Mutex<()>);

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {e}"))
}

pub(crate) fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(STORAGE_FILE_NAME))
}

fn storage_encryption_enabled(app: &AppHandle) -> Result<bool, String> {
    let dir = app_data_dir(app)?;
    if read_meta(&dir).map(|m| m.enabled).unwrap_or(false) {
        return Ok(true);
    }
    let path = storage_path(app)?;
    let bytes = fs::read(&path).unwrap_or_default();
    Ok(is_encrypted_payload(&bytes))
}

pub(crate) fn read_storage(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = storage_path(app)?;
    let bytes = match fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("Failed to read storage file: {e}")),
    };

    let json_bytes = if is_encrypted_payload(&bytes) {
        decrypt_bytes(&bytes)?
    } else {
        bytes
    };

    let raw = String::from_utf8(json_bytes).map_err(|e| format!("Invalid UTF-8 in storage: {e}"))?;
    match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(mut map)) => {
            decrypt_sensitive_storage_values(&mut map)?;
            Ok(map)
        }
        Ok(_) => Ok(Map::new()),
        Err(e) => Err(format!("Failed to parse storage file: {e}")),
    }
}

fn is_sensitive_storage_key(key: &str) -> bool {
    SENSITIVE_STORAGE_KEYS.contains(&key)
}

fn is_value_encrypted_envelope(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.starts_with("LTENC1:"))
}

fn decrypt_sensitive_storage_values(map: &mut Map<String, Value>) -> Result<(), String> {
    for key in SENSITIVE_STORAGE_KEYS {
        let Some(value) = map.get(*key).cloned() else {
            continue;
        };
        if !is_value_encrypted_envelope(&value) {
            continue;
        }
        let envelope = value.as_str().unwrap_or_default();
        let bytes = decrypt_from_envelope_auto(envelope)?;
        let decrypted: Value = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Failed to parse decrypted storage value for {key}: {e}"))?;
        map.insert((*key).to_string(), decrypted);
    }
    Ok(())
}

fn encrypt_sensitive_storage_values(map: &mut Map<String, Value>) -> Result<(), String> {
    for key in SENSITIVE_STORAGE_KEYS {
        let Some(value) = map.get(*key).cloned() else {
            continue;
        };
        if value.is_null() || is_value_encrypted_envelope(&value) {
            continue;
        }
        let serialised = serde_json::to_string(&value)
            .map_err(|e| format!("Failed to serialise sensitive storage value for {key}: {e}"))?;
        let envelope = encrypt_to_envelope_auto(serialised.as_bytes())?;
        map.insert((*key).to_string(), Value::String(envelope));
    }
    Ok(())
}

pub(crate) fn write_storage(app: &AppHandle, data: &Map<String, Value>) -> Result<(), String> {
    let mut to_write = data.clone();
    if !storage_encryption_enabled(app)? {
        encrypt_sensitive_storage_values(&mut to_write)?;
    }

    let serialised =
        serde_json::to_string_pretty(&to_write).map_err(|e| format!("Failed to serialise storage: {e}"))?;
    if serialised.len() > MAX_STORAGE_SIZE_BYTES {
        return Err("Storage size limit exceeded".to_string());
    }

    let path = storage_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create storage dir: {e}"))?;
    }

    let payload = if storage_encryption_enabled(app)? {
        encrypt_bytes(serialised.as_bytes())?
    } else {
        serialised.into_bytes()
    };

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, payload).map_err(|e| format!("Failed to write storage file: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to commit storage file: {e}"))
}

/// Validate a renderer-supplied storage key (mirrors VALID_STORAGE_KEY_RE +
/// FORBIDDEN_STORAGE_KEYS from the Electron port).
fn validate_storage_key(key: &str) -> Result<(), String> {
    let valid_len = !key.is_empty() && key.len() <= 256;
    let valid_chars = key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '-' | '.'));
    if !valid_len || !valid_chars {
        return Err(format!("Invalid storage key: {key}"));
    }
    if FORBIDDEN_STORAGE_KEYS.contains(&key) {
        return Err(format!("Forbidden storage key: {key}"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Storage commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn storage_get(app: AppHandle, key: String) -> Result<Value, String> {
    validate_storage_key(&key)?;
    let data = read_storage(&app)?;
    Ok(data.get(&key).cloned().unwrap_or(Value::Null))
}

#[tauri::command(rename_all = "camelCase")]
fn storage_set(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
    key: String,
    value: Value,
) -> Result<(), String> {
    validate_storage_key(&key)?;
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let mut data = read_storage(&app)?;
    data.insert(key, value);
    write_storage(&app, &data)
}

#[tauri::command(rename_all = "camelCase")]
fn storage_delete(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
    key: String,
) -> Result<(), String> {
    validate_storage_key(&key)?;
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let mut data = read_storage(&app)?;
    data.remove(&key);
    write_storage(&app, &data)
}

#[tauri::command(rename_all = "camelCase")]
fn storage_clear(app: AppHandle, guard: State<'_, StorageGuard>) -> Result<(), String> {
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    write_storage(&app, &Map::new())
}

#[tauri::command(rename_all = "camelCase")]
fn storage_has(app: AppHandle, key: String) -> Result<bool, String> {
    validate_storage_key(&key)?;
    let data = read_storage(&app)?;
    Ok(data.contains_key(&key))
}

// ---------------------------------------------------------------------------
// Encryption commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn encryption_status_cmd(app: AppHandle) -> Result<EncryptionStatus, String> {
    let path = storage_path(&app)?;
    let bytes = fs::read(&path).ok();
    let status = encryption_status(
        &app_data_dir(&app)?,
        bytes.as_deref(),
    );
    Ok(status)
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_unlock() -> Result<(), String> {
    unlock_encryption()
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_lock() -> Result<(), String> {
    lock_encryption();
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_enable(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
) -> Result<(), String> {
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let path = storage_path(&app)?;
    let plaintext = match fs::read(&path) {
        Ok(bytes) if is_encrypted_payload(&bytes) => return Ok(()),
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => b"{}".to_vec(),
        Err(e) => return Err(format!("Failed to read storage file: {e}")),
    };

    let encrypted = enable_encryption(&app_data_dir(&app)?, &plaintext)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create storage dir: {e}"))?;
    }
    fs::write(&path, encrypted).map_err(|e| format!("Failed to write encrypted storage: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_encrypt_blob(plaintext: String) -> Result<String, String> {
    encrypt_to_envelope(plaintext.as_bytes())
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_decrypt_blob(envelope: String) -> Result<String, String> {
    let bytes = decrypt_from_envelope(&envelope)?;
    String::from_utf8(bytes).map_err(|e| format!("Decrypted payload is not valid UTF-8: {e}"))
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_opaque_storage_key(store_name: String, logical_id: String) -> Result<String, String> {
    storage_opaque_key(&store_name, &logical_id)
}

#[tauri::command(rename_all = "camelCase")]
fn encryption_disable(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
) -> Result<(), String> {
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let dir = app_data_dir(&app)?;
    let path = storage_path(&app)?;
    let bytes = match fs::read(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            disable_encryption_key()?;
            return write_meta(&dir, false);
        }
        Err(e) => return Err(format!("Failed to read storage file: {e}")),
    };

    if is_encrypted_payload(&bytes) {
        let plaintext = decrypt_bytes(&bytes)?;
        fs::write(&path, plaintext).map_err(|e| format!("Failed to write storage file: {e}"))?;
    }

    disable_encryption_key()?;
    write_meta(&dir, false)
}

// ---------------------------------------------------------------------------
// Workspace path authorisation (mirrors electron/main.cts security boundary)
// ---------------------------------------------------------------------------

/// Lexically normalise a path (resolve `.` and `..` without touching the FS),
/// matching Node's `path.normalize` so traversal attacks collapse the same way.
fn lexical_normalize(input: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in Path::new(input).components() {
        match comp {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn normalize_for_compare(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

/// Canonicalize `dir` and require it to be inside the workspace allowlist.
pub(crate) fn authorize_workspace_dir(app: &AppHandle, dir: &str) -> Result<PathBuf, String> {
    let data = read_storage(app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(dir, &authorized) {
        return Err(format!(
            "Directory is not an authorised workspace path: {dir}"
        ));
    }
    let resolved =
        dunce::canonicalize(dir).map_err(|e| format!("Directory not accessible: {e}"))?;
    let resolved_str = resolved.to_string_lossy().to_string();
    if !is_path_authorized(&resolved_str, &authorized) {
        return Err(format!(
            "Resolved directory escapes the authorised workspace: {resolved_str}"
        ));
    }
    Ok(resolved)
}

/// Exact match or contained within an authorized directory (respecting the
/// directory boundary so `notes-evil` does not match `notes`).
pub(crate) fn is_path_authorized(file_path: &str, authorized_paths: &[String]) -> bool {
    let normalized = lexical_normalize(file_path);
    let b = normalize_for_compare(&normalized);
    let sep = std::path::MAIN_SEPARATOR;

    authorized_paths.iter().any(|p| {
        let authorized = lexical_normalize(p);
        let a = normalize_for_compare(&authorized);
        b == a || b.starts_with(&format!("{a}{sep}"))
    })
}

/// Resolve the effective scope: `None` means "use the full allowlist", an empty
/// list means "deny everything", otherwise keep only requested paths that are
/// themselves inside the global allowlist.
fn resolve_workspace_scope(
    authorized_paths: &[String],
    requested_scope: &Option<Vec<String>>,
) -> Vec<String> {
    match requested_scope {
        None => authorized_paths.to_vec(),
        Some(scope) if scope.is_empty() => Vec::new(),
        Some(scope) => scope
            .iter()
            .filter(|p| is_path_authorized(p, authorized_paths))
            .cloned()
            .collect(),
    }
}

fn is_workspace_text_file(file_path: &str) -> bool {
    let name = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if SUPPORTED_WORKSPACE_FILE_NAMES.contains(&name.as_str()) {
        return true;
    }
    let ext = Path::new(&name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    !ext.is_empty() && SUPPORTED_WORKSPACE_FILE_EXTENSIONS.contains(&ext.as_str())
}

fn is_skipped_workspace_directory(dir_name: &str) -> bool {
    SKIPPED_WORKSPACE_DIR_NAMES.contains(&dir_name.to_lowercase().as_str())
}

/// Storage is untrusted (it can be hand-edited), so only surface string entries
/// from the persisted `workspacePaths` list.
pub(crate) fn safe_workspace_paths(data: &Map<String, Value>) -> Vec<String> {
    match data.get("workspacePaths") {
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect(),
        _ => Vec::new(),
    }
}

/// Validate a renderer-supplied workspace path array (mirrors validateWorkspacePaths).
fn validate_workspace_paths(paths: &[String]) -> Result<(), String> {
    if paths.len() > 20 {
        return Err("workspacePaths exceeds maximum of 20 entries".to_string());
    }
    for (i, p) in paths.iter().enumerate() {
        if p.len() > 512 {
            return Err(format!("workspacePaths[{i}] path is too long"));
        }
        let path = Path::new(p);
        if !path.is_absolute() {
            return Err(format!("workspacePaths[{i}] must be an absolute path"));
        }
        let normalized = lexical_normalize(p);
        // Reject filesystem root paths (no component beyond the prefix/root).
        let beyond_root = normalized
            .components()
            .any(|c| matches!(c, Component::Normal(_)));
        if !beyond_root {
            return Err(format!("workspacePaths[{i}] must not be the filesystem root"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Workspace commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
fn workspace_get_paths(app: AppHandle) -> Result<Vec<String>, String> {
    let data = read_storage(&app)?;
    Ok(safe_workspace_paths(&data))
}

#[tauri::command(rename_all = "camelCase")]
fn workspace_set_paths(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
    paths: Vec<String>,
) -> Result<(), String> {
    validate_workspace_paths(&paths)?;

    // Resolve each path to its canonical form to prevent symlink escapes.
    // Paths that don't exist yet are stored as-is, matching the Electron port.
    let resolved: Vec<String> = paths
        .iter()
        .map(|p| match dunce::canonicalize(p) {
            Ok(real) => real.to_string_lossy().to_string(),
            Err(_) => p.clone(),
        })
        .collect();

    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let mut data = read_storage(&app)?;
    data.insert("workspacePaths".to_string(), Value::from(resolved));
    write_storage(&app, &data)
}

#[tauri::command(rename_all = "camelCase")]
fn workspace_read_file(
    app: AppHandle,
    file_path: String,
    scope_paths: Option<Vec<String>>,
) -> Result<String, String> {
    let data = read_storage(&app)?;
    let paths = resolve_workspace_scope(&safe_workspace_paths(&data), &scope_paths);

    if !is_workspace_text_file(&file_path) {
        return Err(format!(
            "Workspace file reads are limited to supported text/source files: {file_path}"
        ));
    }
    if !is_path_authorized(&file_path, &paths) {
        return Err(format!("Unauthorized access to file: {file_path}"));
    }

    // Resolve symlinks to a canonical path before the read.
    let resolved = dunce::canonicalize(&file_path).map_err(|e| e.to_string())?;
    let resolved_str = resolved.to_string_lossy().to_string();
    if !is_path_authorized(&resolved_str, &paths) {
        return Err(format!(
            "Unauthorized access to resolved file path: {resolved_str}"
        ));
    }

    let meta = fs::metadata(&resolved).map_err(|e| e.to_string())?;
    if meta.len() > MAX_WORKSPACE_FILE_SIZE_BYTES {
        return Err(format!(
            "Workspace file is too large to read safely: {file_path}"
        ));
    }

    fs::read_to_string(&resolved).map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "camelCase")]
fn workspace_write_file(
    app: AppHandle,
    file_path: String,
    content: String,
    scope_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let data = read_storage(&app)?;
    let paths = resolve_workspace_scope(&safe_workspace_paths(&data), &scope_paths);

    if !is_workspace_text_file(&file_path) {
        return Err(format!(
            "Workspace file writes are limited to supported text/source files: {file_path}"
        ));
    }
    if !is_path_authorized(&file_path, &paths) {
        return Err(format!("Unauthorized write access to file: {file_path}"));
    }
    if content.len() as u64 > MAX_WORKSPACE_FILE_SIZE_BYTES {
        return Err(format!(
            "Workspace file is too large to write safely: {file_path}"
        ));
    }

    // Resolve via realpath; for files that don't exist yet, resolve the parent
    // directory and reconstruct the target path.
    let resolved = match dunce::canonicalize(&file_path) {
        Ok(real) => real,
        Err(_) => {
            let parent = Path::new(&file_path)
                .parent()
                .ok_or_else(|| format!("Invalid file path: {file_path}"))?;
            let real_parent = dunce::canonicalize(parent).map_err(|e| e.to_string())?;
            let file_name = Path::new(&file_path)
                .file_name()
                .ok_or_else(|| format!("Invalid file path: {file_path}"))?;
            real_parent.join(file_name)
        }
    };

    let resolved_str = resolved.to_string_lossy().to_string();
    if !is_path_authorized(&resolved_str, &paths) {
        return Err(format!(
            "Unauthorized write access to resolved file path: {resolved_str}"
        ));
    }

    fs::write(&resolved, content).map_err(|e| e.to_string())
}

/// Create a directory (and any missing parents) inside an authorized workspace.
///
/// `workspace_write_file` deliberately refuses to create missing parent dirs, so
/// callers that need a fresh tree (e.g. injecting skills into `.claude/skills/…`)
/// must materialize it first. Authorization mirrors the new-file path in
/// `workspace_write_file`: we canonicalize the nearest existing ancestor and
/// require it to sit inside an authorized path, blocking symlink/`..` escapes
/// before anything is created, then re-check the resolved tree afterwards.
#[tauri::command(rename_all = "camelCase")]
fn workspace_ensure_dir(
    app: AppHandle,
    dir_path: String,
    scope_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let data = read_storage(&app)?;
    let paths = resolve_workspace_scope(&safe_workspace_paths(&data), &scope_paths);

    if !is_path_authorized(&dir_path, &paths) {
        return Err(format!("Unauthorized directory access: {dir_path}"));
    }

    // Walk up to the nearest existing ancestor and canonicalize it, so a symlinked
    // or `..`-laden ancestor can't smuggle the target outside the workspace before
    // we create it.
    let mut ancestor = Path::new(&dir_path);
    let real_ancestor = loop {
        if let Ok(real) = dunce::canonicalize(ancestor) {
            break real;
        }
        match ancestor.parent() {
            Some(parent) => ancestor = parent,
            None => return Err(format!("Invalid directory path: {dir_path}")),
        }
    };
    if !is_path_authorized(&real_ancestor.to_string_lossy(), &paths) {
        return Err(format!(
            "Unauthorized directory access to resolved path: {}",
            real_ancestor.to_string_lossy()
        ));
    }

    fs::create_dir_all(&dir_path).map_err(|e| e.to_string())?;

    // Defense in depth: the freshly created tree must still resolve inside the
    // workspace (guards a race where a symlink appeared mid-create).
    let resolved = dunce::canonicalize(&dir_path).map_err(|e| e.to_string())?;
    if !is_path_authorized(&resolved.to_string_lossy(), &paths) {
        return Err(format!(
            "Unauthorized directory access to resolved path: {}",
            resolved.to_string_lossy()
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct WorkspaceSearchResult {
    path: String,
    snippet: String,
}

fn create_snippet(content: &str, query: &str) -> String {
    let normalized: String = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "Empty markdown file".to_string();
    }

    let lower = normalized.to_lowercase();
    match lower.find(query) {
        None => normalized.chars().take(180).collect(),
        Some(match_index) => {
            // Work on char boundaries to stay UTF-8 safe.
            let chars: Vec<char> = normalized.chars().collect();
            // Translate the byte index from the lowercase string into a char index.
            let char_match_index = lower[..match_index].chars().count();
            let start = char_match_index.saturating_sub(80);
            let end = (char_match_index + query.chars().count() + 80).min(chars.len());
            chars[start..end].iter().collect()
        }
    }
}

fn search_workspace_dir(
    dir: &Path,
    query: &str,
    results: &mut Vec<WorkspaceSearchResult>,
    visited: &mut HashSet<PathBuf>,
) {
    // Resolve symlinks before recursing to detect directory cycles.
    let real_dir = match dunce::canonicalize(dir) {
        Ok(d) => d,
        Err(_) => return,
    };
    if visited.contains(&real_dir) {
        return;
    }
    visited.insert(real_dir);

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if results.len() >= MAX_WORKSPACE_SEARCH_RESULTS {
            return;
        }
        let full_path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();

        if file_type.is_dir() {
            if is_skipped_workspace_directory(&name) {
                continue;
            }
            search_workspace_dir(&full_path, query, results, visited);
        } else if file_type.is_file() {
            let full_path_str = full_path.to_string_lossy().to_string();
            if !is_workspace_text_file(&full_path_str) {
                continue;
            }

            if name.to_lowercase().contains(query) {
                results.push(WorkspaceSearchResult {
                    path: full_path_str,
                    snippet: format!("Filename match: {name}"),
                });
                continue;
            }

            let meta = match fs::metadata(&full_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > MAX_WORKSPACE_FILE_SIZE_BYTES {
                continue;
            }

            if let Ok(content) = fs::read_to_string(&full_path) {
                if content.to_lowercase().contains(query) {
                    let snippet = create_snippet(&content, query);
                    results.push(WorkspaceSearchResult {
                        path: full_path_str,
                        snippet,
                    });
                }
            }
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
fn workspace_search_files(
    app: AppHandle,
    query: String,
    scope_paths: Option<Vec<String>>,
) -> Result<Vec<WorkspaceSearchResult>, String> {
    let data = read_storage(&app)?;
    let paths = resolve_workspace_scope(&safe_workspace_paths(&data), &scope_paths);

    let normalized_query = query.trim().to_lowercase();
    if normalized_query.len() < 2 {
        return Ok(Vec::new());
    }

    let mut results: Vec<WorkspaceSearchResult> = Vec::new();
    // Shared across all workspace roots so cross-root cycles are detected too.
    let mut visited: HashSet<PathBuf> = HashSet::new();

    for workspace_path in &paths {
        if results.len() >= MAX_WORKSPACE_SEARCH_RESULTS {
            break;
        }
        let start = lexical_normalize(workspace_path);
        search_workspace_dir(&start, &normalized_query, &mut results, &mut visited);
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        // Single-instance must be registered first. When a second launch is
        // attempted, focus the existing window instead of opening another
        // (mirrors the Electron requestSingleInstanceLock behaviour).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .manage(StorageGuard(Mutex::new(())))
        .manage(SemanticLayerState(tokio::sync::Mutex::new(
            semantic_layer::SemanticLayerRuntime::default(),
        )))
        .manage(AgentProcessRegistry(Mutex::new(std::collections::HashMap::new())))
        .manage(AgentdState::default())
        .manage(AgentdStore::default())
        .manage(TaskStore::default())
        .manage(TerminalRegistry::default())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage_get,
            storage_set,
            storage_delete,
            storage_clear,
            storage_has,
            storage_parse_tasks,
            storage_serialize_tasks,
            storage_tasks_mutate,
            encryption_status_cmd,
            encryption_unlock,
            encryption_lock,
            encryption_enable,
            encryption_encrypt_blob,
            encryption_decrypt_blob,
            encryption_opaque_storage_key,
            encryption_disable,
            workspace_get_paths,
            workspace_set_paths,
            workspace_read_file,
            workspace_write_file,
            workspace_ensure_dir,
            workspace_search_files,
            semantic_layer_spawn,
            semantic_layer_stop,
            semantic_layer_health,
            semantic_layer_chat,
            semantic_layer_config,
            semantic_layer_feedback,
            semantic_layer_stats,
            agent_detect_clis,
            agent_detect_ide_tools,
            agent_open_in_tool,
            agentd_ensure,
            agentd_stop,
            agentd_detect,
            agentd_skills_list,
            agentd_skill_read,
            agentd_run_start,
            agentd_ssh_health,
            agentd_run_cancel,
            agentd_run_pause,
            agentd_run_resume,
            agentd_run_inject,
            agentd_pty_history,
            agentd_pty_write,
            agentd_pty_takeover,
            agentd_run_reattach,
            agentd_sessions_discover,
            agentd_sessions_fork,
            agentd_sessions_truncate,
            agentd_sessions_message_count,
            agentd_permission_respond,
            agentd_queue_list,
            agentd_queue_enqueue,
            agentd_queue_remove,
            agentd_queue_acquire,
            agentd_queue_release,
            agentd_reservation_list,
            agentd_reservation_claim,
            agentd_reservation_release,
            agentd_feedback_watch,
            agentd_scheduler_intent_set,
            agentd_scheduler_config_set,
            agentd_notify_config_set,
            agentd_store_list_runs,
            agentd_store_list_run_events,
            agentd_store_list_agents,
            agentd_store_list_devcouncil_requirements,
            agentd_store_list_devcouncil_tasks,
            agentd_store_list_devcouncil_evidence,
            task_store_export_snapshot,
            task_store_read_snapshot,
            task_store_write_snapshot,
            task_events_append,
            task_events_read,
            task_events_count,
            task_events_latest_snapshot,
            task_store_commit,
            board_export_snapshot,
            agent_run_start,
            agent_run_cancel,
            agent_council_pause,
            agent_council_resume,
            agent_run_active,
            agent_runs_reattach,
            agent_open_in_terminal,
            agent_mcp_init,
            agent_mcp_list_requests,
            agent_mcp_write_response,
            agent_mcp_write_config,
            agent_mcp_resolve_bridge,
            agent_mcp_append_guidance,
            agent_mcp_cleanup,
            agent_git_create_worktree,
            agent_git_ensure_workspace_gitignore,
            agent_git_merge_worktree,
            agent_git_merge_main_into_worktree,
            agent_git_merge_worktree_tx,
            agent_git_worktree_state,
            agent_git_list_worktrees,
            agent_git_prune_worktrees,
            agent_git_branch_is_ancestor,
            agent_git_commit_worktree,
            agent_git_reset_worktree_to,
            agent_git_discard_worktree,
            agent_git_diff,
            agent_git_list_changed_files,
            agent_git_file_diff,
            agent_git_create_pr,
            agent_git_push,
            agent_git_recover_merge_journal,
            agent_container_build,
            agent_container_system_status,
            agent_build_task_prompt,
            agent_build_council_goal,
            agent_parse_stream_line,
            agent_parse_council_report,
            agent_dev_plan,
            agent_dev_verify,
            agent_dev_repair,
            agent_dev_parse_export,
            agent_dev_cli_available,
            agent_resolve_dev_cli_path,
            agent_dev_status,
            agent_dev_init,
            agent_dev_map,
            agent_dev_install,
            agent_dev_install_local,
            agent_dev_discover,
            agent_dev_repo_map_summary,
            agent_dev_repo_files,
            agent_dev_mirror_evidence,
            ai_ollama_generate,
            ai_ollama_health,
            ai_ollama_chat,
            ai_claude_chat,
            ai_claude_health,
            ai_claude_models,
            app_data_load,
            app_data_save,
            app_data_patch,
            app_data_storage_path,
            automation_apply_actions,
            automation_is_rule_due,
            recurring_calculate_next,
            recurring_next_occurrence,
            recurring_advance,
            // --- liquitask-core migration: risk / time_reporting / cleanup / auto_organize ---
            risk_heuristics,
            time_generate_report,
            time_productivity_metrics,
            time_export_csv,
            time_export_json,
            cleanup_heuristic_duplicates,
            cleanup_heuristic_merge,
            cleanup_analyze_redundancy,
            cleanup_heuristic_categorize,
            cleanup_heuristic_cluster,
            autoorg_filter_task_ids,
            autoorg_dedup_candidate_pairs,
            autoorg_consolidate_tags,
            agent_compute_analytics,
            agent_skills_filter,
            agent_skills_capture,
            agent_skills_delete,
            github_detect_repo,
            github_issue_list,
            github_issue_close,
            github_issue_comment,
            github_auth_status,
            github_pr_checks,
            github_pr_failed_logs,
            github_pr_review_comments,
            tray_update_active_runs,
            tray_update_dock_badge,
            tray_update_inbox_count,
            sleep_prevention_set_active,
            terminal_open,
            terminal_write,
            terminal_resize,
            terminal_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building LiquiTask")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<SemanticLayerState>() {
                    stop_on_app_exit(state.inner());
                }
            }
            on_run_event(app, &event);
        });
}

// ---------------------------------------------------------------------------
// Tests — mirror electron/__tests__/workspaceIpc.test.ts security boundary
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn p(parts: &[&str]) -> String {
        // Build a platform-native absolute path for the test cases.
        let sep = std::path::MAIN_SEPARATOR;
        #[cfg(windows)]
        let mut s = String::from("C:");
        #[cfg(not(windows))]
        let mut s = String::new();
        for part in parts {
            s.push(sep);
            s.push_str(part);
        }
        s
    }

    #[test]
    fn allows_files_directly_inside_authorized_dir() {
        let authorized = vec![p(&["home", "user", "notes"])];
        assert!(is_path_authorized(&p(&["home", "user", "notes", "daily.md"]), &authorized));
    }

    #[test]
    fn allows_nested_subdirectories() {
        let authorized = vec![p(&["home", "user", "projects"])];
        assert!(is_path_authorized(
            &p(&["home", "user", "projects", "app", "src", "README.md"]),
            &authorized
        ));
    }

    #[test]
    fn blocks_files_outside_authorized_dirs() {
        let authorized = vec![p(&["home", "user", "notes"])];
        assert!(!is_path_authorized(&p(&["home", "user", "private", "secret.md"]), &authorized));
    }

    #[test]
    fn blocks_parent_directory() {
        let authorized = vec![p(&["home", "user", "notes"])];
        assert!(!is_path_authorized(&p(&["home", "user"]), &authorized));
    }

    #[test]
    fn blocks_prefix_attack() {
        let authorized = vec![p(&["home", "user", "notes"])];
        assert!(!is_path_authorized(&p(&["home", "user", "notes-evil", "file.md"]), &authorized));
    }

    #[test]
    fn blocks_traversal_escape() {
        let authorized = vec![p(&["home", "user", "notes"])];
        // .../notes/../../etc/passwd collapses outside the authorized root.
        let traversal = format!(
            "{}{}..{}..{}etc{}passwd",
            p(&["home", "user", "notes"]),
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
            std::path::MAIN_SEPARATOR,
        );
        assert!(!is_path_authorized(&traversal, &authorized));
    }

    #[test]
    fn allows_exact_match() {
        let authorized = vec![p(&["home", "user", "notes"])];
        assert!(is_path_authorized(&p(&["home", "user", "notes"]), &authorized));
    }

    #[test]
    fn no_paths_configured_denies() {
        assert!(!is_path_authorized(&p(&["home", "user", "notes", "daily.md"]), &[]));
    }

    #[test]
    fn scope_within_allowlist_allows() {
        let authorized = vec![p(&["workspace", "a"]), p(&["workspace", "b"])];
        let scope = Some(vec![p(&["workspace", "a", "notes"])]);
        let resolved = resolve_workspace_scope(&authorized, &scope);
        assert!(is_path_authorized(&p(&["workspace", "a", "notes", "today.md"]), &resolved));
    }

    #[test]
    fn scope_blocks_sibling_outside_requested_scope() {
        let authorized = vec![p(&["workspace", "a"]), p(&["workspace", "b"])];
        let scope = Some(vec![p(&["workspace", "a", "notes"])]);
        let resolved = resolve_workspace_scope(&authorized, &scope);
        assert!(!is_path_authorized(&p(&["workspace", "b", "notes", "today.md"]), &resolved));
    }

    #[test]
    fn scope_outside_allowlist_is_dropped() {
        let authorized = vec![p(&["workspace", "a"]), p(&["workspace", "b"])];
        let scope = Some(vec![p(&["workspace", "private"])]);
        let resolved = resolve_workspace_scope(&authorized, &scope);
        assert!(!is_path_authorized(&p(&["workspace", "private", "secret.md"]), &resolved));
    }

    #[test]
    fn empty_scope_denies_everything() {
        let authorized = vec![p(&["workspace", "a"])];
        let resolved = resolve_workspace_scope(&authorized, &Some(vec![]));
        assert!(resolved.is_empty());
        assert!(!is_path_authorized(&p(&["workspace", "a", "file.md"]), &resolved));
    }

    #[test]
    fn none_scope_uses_full_allowlist() {
        let authorized = vec![p(&["workspace", "a"])];
        let resolved = resolve_workspace_scope(&authorized, &None);
        assert_eq!(resolved, authorized);
    }

    #[test]
    fn text_file_allowlist() {
        assert!(is_workspace_text_file("/workspace/app/src/App.tsx"));
        assert!(is_workspace_text_file("/workspace/app/scripts/migrate.py"));
        assert!(is_workspace_text_file("/workspace/app/package.json"));
        assert!(is_workspace_text_file("/workspace/app/.gitignore"));
        assert!(is_workspace_text_file("/workspace/app/Dockerfile"));
    }

    #[test]
    fn blocks_binary_and_secret_files() {
        assert!(!is_workspace_text_file("/workspace/app/.env"));
        assert!(!is_workspace_text_file("/workspace/app/cert.pem"));
        assert!(!is_workspace_text_file("/workspace/app/screenshot.png"));
        assert!(!is_workspace_text_file("/workspace/app/archive.zip"));
    }

    #[test]
    fn skips_generated_directories() {
        assert!(is_skipped_workspace_directory("node_modules"));
        assert!(is_skipped_workspace_directory(".git"));
        assert!(is_skipped_workspace_directory("dist"));
        assert!(!is_skipped_workspace_directory("src"));
    }

    #[test]
    fn storage_key_validation() {
        assert!(validate_storage_key("liquitask:tasks").is_ok());
        assert!(validate_storage_key("a.valid-KEY_1").is_ok());
        assert!(validate_storage_key("__proto__").is_err());
        assert!(validate_storage_key("constructor").is_err());
        assert!(validate_storage_key("has space").is_err());
        assert!(validate_storage_key("").is_err());
        assert!(validate_storage_key(&"x".repeat(257)).is_err());
    }

    #[test]
    fn workspace_path_validation() {
        assert!(validate_workspace_paths(&[p(&["home", "user", "notes"])]).is_ok());
        // Relative path rejected.
        assert!(validate_workspace_paths(&["relative/path".to_string()]).is_err());
        // Too many entries rejected.
        let many: Vec<String> = (0..21).map(|i| p(&["dir", &i.to_string()])).collect();
        assert!(validate_workspace_paths(&many).is_err());
    }

    #[test]
    fn sensitive_storage_keys_cover_ai_config() {
        assert!(is_sensitive_storage_key("liquitask-ai-config"));
        assert!(is_sensitive_storage_key("liquitask-gemini-api-key"));
        assert!(!is_sensitive_storage_key("liquitask-tasks"));
    }

    #[test]
    fn encrypted_envelope_detection() {
        assert!(is_value_encrypted_envelope(&Value::String(
            "LTENC1:YWJj".to_string()
        )));
        assert!(!is_value_encrypted_envelope(&Value::String("plain".to_string())));
        assert!(!is_value_encrypted_envelope(&Value::Null));
    }
}
