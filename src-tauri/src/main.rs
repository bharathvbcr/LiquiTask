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

// ---------------------------------------------------------------------------
// Constants (mirrors electron/main.cts)
// ---------------------------------------------------------------------------

const MAX_WORKSPACE_SEARCH_RESULTS: usize = 20;
const MAX_WORKSPACE_FILE_SIZE_BYTES: u64 = 256 * 1024;
const MAX_STORAGE_SIZE_BYTES: usize = 10_000_000;
const STORAGE_FILE_NAME: &str = "storage.json";

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

/// Guards all *mutating* storage operations so concurrent commands cannot
/// interleave a read-modify-write and lose data (the Electron port used a
/// promise write-queue for the same reason).
struct StorageGuard(Mutex<()>);

fn storage_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {e}"))?;
    Ok(dir.join(STORAGE_FILE_NAME))
}

fn read_storage(app: &AppHandle) -> Result<Map<String, Value>, String> {
    let path = storage_path(app)?;
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(map)) => Ok(map),
            // Corrupt / non-object payload -> treat as empty, matching the
            // defensive behaviour of the Electron implementation.
            Ok(_) => Ok(Map::new()),
            Err(e) => Err(format!("Failed to parse storage file: {e}")),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("Failed to read storage file: {e}")),
    }
}

fn write_storage(app: &AppHandle, data: &Map<String, Value>) -> Result<(), String> {
    let serialised =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialise storage: {e}"))?;
    if serialised.len() > MAX_STORAGE_SIZE_BYTES {
        return Err("Storage size limit exceeded".to_string());
    }
    let path = storage_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create storage dir: {e}"))?;
    }
    fs::write(&path, serialised).map_err(|e| format!("Failed to write storage file: {e}"))
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

/// Exact match or contained within an authorized directory (respecting the
/// directory boundary so `notes-evil` does not match `notes`).
fn is_path_authorized(file_path: &str, authorized_paths: &[String]) -> bool {
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
fn safe_workspace_paths(data: &Map<String, Value>) -> Vec<String> {
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
        .invoke_handler(tauri::generate_handler![
            storage_get,
            storage_set,
            storage_delete,
            storage_clear,
            storage_has,
            workspace_get_paths,
            workspace_set_paths,
            workspace_read_file,
            workspace_write_file,
            workspace_search_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LiquiTask");
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
}
