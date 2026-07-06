//! Durable run journal for agent runs (Runtime v2, phase 1: headless runs).
//!
//! Each run gets its own directory under `<app_data>/agent-runs/<runId>/`:
//! * `meta.json`     — [`RunMeta`]: status, pid/pgid, mode, cwd, timing, cursor
//! * `stdout.ndjson` — the agent's raw `stream-json` stdout (durable event log)
//! * `stderr.log`    — captured stderr
//!
//! Because the child's stdout/stderr are redirected to these files (not
//! parent-owned pipes) and it is spawned in its own process group, the agent
//! keeps running after the LiquiTask window/app closes. On relaunch,
//! `agent_runner::reattach_runs` re-adopts still-live PIDs (resuming the live
//! event stream from the persisted cursor) and reconciles runs that finished
//! while the app was away from their `stdout.ndjson` — replacing the old
//! "everything active is marked failed on restart" behaviour.
//!
//! This module is deliberately dependency-light (filesystem + serde only): no
//! threads, no Tauri events, no process control. That keeps it unit-testable
//! and lets a future supervisor daemon (roadmap #1/#2) own the same journal.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const RUNS_DIR: &str = "agent-runs";
const META_FILE: &str = "meta.json";
const META_TMP_FILE: &str = "meta.json.tmp";
pub const STDOUT_FILE: &str = "stdout.ndjson";
pub const STDERR_FILE: &str = "stderr.log";

/// Terminal-run directories retained during pruning (newest-first by start).
const MAX_RETAINED_TERMINAL_RUNS: usize = 50;

/// Serialises intra-process `meta.json` read-modify-write so the reaper thread
/// (status/exit) and tailer thread (cursor) cannot clobber each other. Only the
/// app process ever writes meta — the detached child writes stdout/stderr only.
static META_LOCK: Mutex<()> = Mutex::new(());

/// Persisted metadata for a single agent run.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunMeta {
    pub run_id: String,
    /// Runner mode (`claude`, `claude-resume`, `devcouncil-e2e`, …).
    pub mode: String,
    pub working_dir: String,
    /// `running` | `completed` | `failed` | `cancelled`.
    pub status: String,
    #[serde(default)]
    pub pid: Option<u32>,
    /// Process-group id (== pid on unix; used to kill the whole subtree).
    #[serde(default)]
    pub pgid: Option<u32>,
    pub started_at_ms: u64,
    #[serde(default)]
    pub finished_at_ms: Option<u64>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    /// Byte offset in `stdout.ndjson` up to which events were already emitted.
    /// Reattach resumes tailing from here so we don't re-stream old lines.
    #[serde(default)]
    pub stdout_offset: u64,
    #[serde(default)]
    pub session_id: Option<String>,
    /// True while the agent process is SIGSTOP'd / suspended (mid-run pause).
    #[serde(default)]
    pub paused: bool,
}

impl RunMeta {
    pub fn is_active(&self) -> bool {
        self.status == "running"
    }
}

/// Resolved on-disk paths for a run.
pub struct RunPaths {
    pub dir: PathBuf,
    pub meta: PathBuf,
    pub stdout: PathBuf,
    pub stderr: PathBuf,
}

/// Outcome derived from a finished run's `stdout.ndjson`.
pub struct Reconciled {
    pub status: String,
    pub session_id: Option<String>,
    pub summary: Option<String>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn runs_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Unable to resolve app data dir: {e}"))?;
    Ok(dir.join(RUNS_DIR))
}

/// A run id is used verbatim as a directory name, so reject anything that could
/// escape the runs root (defence-in-depth on top of the command-layer checks).
fn validate_run_id(run_id: &str) -> Result<(), String> {
    let ok = !run_id.is_empty()
        && run_id.len() <= 128
        && !run_id.contains("..")
        && run_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(())
    } else {
        Err(format!("Invalid run id: {run_id}"))
    }
}

pub fn run_paths(app: &AppHandle, run_id: &str) -> Result<RunPaths, String> {
    validate_run_id(run_id)?;
    let dir = runs_root(app)?.join(run_id);
    Ok(RunPaths {
        meta: dir.join(META_FILE),
        stdout: dir.join(STDOUT_FILE),
        stderr: dir.join(STDERR_FILE),
        dir,
    })
}

/// Create the run directory and open truncated stdout/stderr log files, ready
/// to be handed to the child process as redirected `Stdio`.
pub fn prepare_run_files(app: &AppHandle, run_id: &str) -> Result<(RunPaths, File, File), String> {
    let paths = run_paths(app, run_id)?;
    fs::create_dir_all(&paths.dir).map_err(|e| format!("Failed to create run dir: {e}"))?;
    let stdout = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&paths.stdout)
        .map_err(|e| format!("Failed to open run stdout log: {e}"))?;
    let stderr = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&paths.stderr)
        .map_err(|e| format!("Failed to open run stderr log: {e}"))?;
    Ok((paths, stdout, stderr))
}

pub fn read_meta(app: &AppHandle, run_id: &str) -> Option<RunMeta> {
    let paths = run_paths(app, run_id).ok()?;
    let bytes = fs::read(&paths.meta).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_meta(app: &AppHandle, meta: &RunMeta) -> Result<(), String> {
    let _guard = META_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    write_meta_locked(app, meta)
}

fn write_meta_locked(app: &AppHandle, meta: &RunMeta) -> Result<(), String> {
    let paths = run_paths(app, &meta.run_id)?;
    fs::create_dir_all(&paths.dir).map_err(|e| format!("Failed to create run dir: {e}"))?;
    let json = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to serialise run meta: {e}"))?;
    // Write-then-rename so a crash mid-write never leaves a torn meta.json.
    let tmp = paths.dir.join(META_TMP_FILE);
    fs::write(&tmp, json).map_err(|e| format!("Failed to write run meta: {e}"))?;
    fs::rename(&tmp, &paths.meta).map_err(|e| format!("Failed to commit run meta: {e}"))
}

/// Mutate the persisted status/exit fields of a run under the meta lock.
pub fn finalize(
    app: &AppHandle,
    run_id: &str,
    status: &str,
    exit_code: Option<i32>,
    session_id: Option<String>,
) -> Result<(), String> {
    let _guard = META_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut meta = read_meta(app, run_id).ok_or_else(|| format!("No meta for run {run_id}"))?;
    meta.status = status.to_string();
    meta.finished_at_ms = Some(now_ms());
    if exit_code.is_some() {
        meta.exit_code = exit_code;
    }
    if session_id.is_some() {
        meta.session_id = session_id;
    }
    write_meta_locked(app, &meta)
}

/// Persist how far the tailer has streamed, so reattach resumes cleanly.
pub fn set_offset(app: &AppHandle, run_id: &str, offset: u64) -> Result<(), String> {
    let _guard = META_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut meta = read_meta(app, run_id).ok_or_else(|| format!("No meta for run {run_id}"))?;
    meta.stdout_offset = offset;
    write_meta_locked(app, &meta)
}

/// Record mid-run pause/resume in the durable journal (unix durable runs).
pub fn set_paused(app: &AppHandle, run_id: &str, paused: bool) -> Result<(), String> {
    let _guard = META_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut meta = read_meta(app, run_id).ok_or_else(|| format!("No meta for run {run_id}"))?;
    meta.paused = paused;
    write_meta_locked(app, &meta)
}

pub fn list_run_ids(app: &AppHandle) -> Vec<String> {
    let Ok(root) = runs_root(app) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect()
}

/// Derive a run's terminal outcome from its durable stdout log. Used when the
/// process is found dead on relaunch (it finished while the app was closed).
///
/// v1 limitation: this understands Claude Code's `stream-json` `result`
/// message. Council/verify (`dev … --json`) and container runs don't emit that
/// shape, so with no result line we fall back to `failed` — their outcome is
/// only fully known when the app is open at exit (the reaper records the code).
pub fn reconcile_from_stdout(app: &AppHandle, run_id: &str) -> Reconciled {
    let Ok(paths) = run_paths(app, run_id) else {
        return failed_reconcile();
    };
    // Council modes (`dev … --json`) emit a DevCouncil report, not Claude
    // `stream-json`, so they need a different parser. Container runs execute
    // `claude … --output-format stream-json` inside the VM, so their log *is*
    // Claude NDJSON and the default path handles them.
    let council = read_meta(app, run_id).map(|m| is_council_mode(&m.mode)).unwrap_or(false);
    if council {
        reconcile_council_path(&paths.stdout)
    } else {
        reconcile_stdout_path(&paths.stdout)
    }
}

fn failed_reconcile() -> Reconciled {
    Reconciled {
        status: "failed".to_string(),
        session_id: None,
        summary: None,
    }
}

/// Modes whose stdout is a DevCouncil `--json` report rather than Claude NDJSON.
fn is_council_mode(mode: &str) -> bool {
    matches!(mode, "devcouncil-e2e" | "devcouncil-verify")
}

/// Reconcile a council run (`dev e2e`/`dev check --verify --json`) from its
/// report. Mirrors the renderer's `parseCouncilReport`: a run passes only when
/// it is explicitly `passed`/`ok` (or has no gaps) *and* has no blocking gaps.
pub fn reconcile_council_path(stdout_path: &Path) -> Reconciled {
    let Ok(raw) = fs::read_to_string(stdout_path) else {
        return failed_reconcile();
    };
    let Some(report) = extract_last_json_object(&raw) else {
        return failed_reconcile();
    };
    let gaps_empty = report
        .get("blocking_gaps")
        .and_then(Value::as_array)
        .map(|a| a.is_empty())
        .unwrap_or(true);
    let flag = report
        .get("passed")
        .and_then(Value::as_bool)
        .or_else(|| report.get("ok").and_then(Value::as_bool))
        .unwrap_or(gaps_empty);
    let passed = flag && gaps_empty;
    Reconciled {
        status: if passed { "completed" } else { "failed" }.to_string(),
        session_id: None,
        summary: report.get("diff_summary").and_then(Value::as_str).map(str::to_string),
    }
}

/// Find a JSON object in `raw`, tolerating leading log noise. Tries the span
/// from the first `{` to the end (the common `--json` shape), then falls back to
/// the last line that parses as an object.
fn extract_last_json_object(raw: &str) -> Option<Value> {
    // Byte-cap on a char boundary so a huge log can't blow up parsing.
    let bounded = raw.get(..200_000).unwrap_or(raw);
    if let Some(idx) = bounded.find('{') {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(bounded[idx..].trim()) {
            return Some(v);
        }
    }
    for line in bounded.lines().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with('{') {
            if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(trimmed) {
                return Some(v);
            }
        }
    }
    None
}

/// Core of [`reconcile_from_stdout`], parsing a stdout log at a path. Split out
/// so the outcome logic is unit-testable without a Tauri `AppHandle`.
pub fn reconcile_stdout_path(stdout_path: &Path) -> Reconciled {
    let mut result = Reconciled {
        status: "failed".to_string(),
        session_id: None,
        summary: None,
    };
    let Ok(file) = File::open(stdout_path) else {
        return result;
    };
    let mut saw_result = false;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(val) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let ty = val.get("type").and_then(Value::as_str);
        if let Some(sid) = val.get("session_id").and_then(Value::as_str) {
            result.session_id = Some(sid.to_string());
        }
        if ty == Some("result") {
            saw_result = true;
            let is_error = val.get("is_error").and_then(Value::as_bool).unwrap_or(false)
                || val
                    .get("subtype")
                    .and_then(Value::as_str)
                    .map(|s| s != "success")
                    .unwrap_or(false);
            result.summary = val.get("result").and_then(Value::as_str).map(str::to_string);
            result.status = if is_error { "failed" } else { "completed" }.to_string();
        }
    }
    if !saw_result {
        result.status = "failed".to_string();
    }
    result
}

/// Best-effort housekeeping: keep every active run plus the newest
/// [`MAX_RETAINED_TERMINAL_RUNS`] finished runs, deleting older run dirs so the
/// stdout logs don't grow without bound. Errors are swallowed.
pub fn prune(app: &AppHandle) {
    let mut terminal: Vec<(u64, String)> = Vec::new();
    for run_id in list_run_ids(app) {
        match read_meta(app, &run_id) {
            Some(meta) if meta.is_active() => {}
            Some(meta) => terminal.push((meta.started_at_ms, run_id)),
            // A dir with no readable meta is junk — drop it.
            None => remove_run_dir(app, &run_id),
        }
    }
    if terminal.len() <= MAX_RETAINED_TERMINAL_RUNS {
        return;
    }
    terminal.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, run_id) in terminal.into_iter().skip(MAX_RETAINED_TERMINAL_RUNS) {
        remove_run_dir(app, &run_id);
    }
}

fn remove_run_dir(app: &AppHandle, run_id: &str) {
    if let Ok(paths) = run_paths(app, run_id) {
        let _ = fs::remove_dir_all(&paths.dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_run_ids() {
        assert!(validate_run_id("../etc").is_err());
        assert!(validate_run_id("a/b").is_err());
        assert!(validate_run_id("run-123-abc..").is_err());
        assert!(validate_run_id("").is_err());
    }

    #[test]
    fn accepts_normal_run_ids() {
        assert!(validate_run_id("run-1720000000000-ab12cd").is_ok());
        assert!(validate_run_id("run_1.2.3").is_ok());
    }

    /// Write NDJSON to a uniquely-named temp file for reconcile tests.
    fn temp_log(tag: &str, contents: &str) -> PathBuf {
        let path = std::env::temp_dir()
            .join(format!("liquitask-reconcile-{}-{tag}.ndjson", std::process::id()));
        fs::write(&path, contents).expect("write temp log");
        path
    }

    #[test]
    fn reconcile_completed_run_extracts_status_session_and_summary() {
        let log = temp_log(
            "ok",
            concat!(
                r#"{"type":"system","subtype":"init","session_id":"sess-1"}"#, "\n",
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}"#, "\n",
                r#"{"type":"result","subtype":"success","is_error":false,"session_id":"sess-1","result":"all done"}"#, "\n",
            ),
        );
        let out = reconcile_stdout_path(&log);
        assert_eq!(out.status, "completed");
        assert_eq!(out.session_id.as_deref(), Some("sess-1"));
        assert_eq!(out.summary.as_deref(), Some("all done"));
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_error_result_is_failed() {
        let log = temp_log(
            "err",
            concat!(
                r#"{"type":"system","subtype":"init","session_id":"sess-2"}"#, "\n",
                r#"{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"sess-2"}"#, "\n",
            ),
        );
        let out = reconcile_stdout_path(&log);
        assert_eq!(out.status, "failed");
        assert_eq!(out.session_id.as_deref(), Some("sess-2"));
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_without_result_line_is_failed_but_keeps_session() {
        // Process died mid-run: no terminal `result`, but the session is known.
        let log = temp_log(
            "partial",
            concat!(
                r#"{"type":"system","subtype":"init","session_id":"sess-3"}"#, "\n",
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"half"}]}}"#, "\n",
                "{ this is not valid json and must be skipped\n",
            ),
        );
        let out = reconcile_stdout_path(&log);
        assert_eq!(out.status, "failed");
        assert_eq!(out.session_id.as_deref(), Some("sess-3"));
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_missing_file_is_failed() {
        let out = reconcile_stdout_path(Path::new("/nonexistent/liquitask/stdout.ndjson"));
        assert_eq!(out.status, "failed");
        assert!(out.session_id.is_none());
    }

    #[test]
    fn reconcile_subtype_non_success_is_failed_even_without_is_error() {
        let log = temp_log(
            "subtype",
            concat!(
                r#"{"type":"result","subtype":"error_during_execution","result":"boom"}"#, "\n",
            ),
        );
        let out = reconcile_stdout_path(&log);
        assert_eq!(out.status, "failed");
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn council_modes_are_recognised() {
        assert!(is_council_mode("devcouncil-e2e"));
        assert!(is_council_mode("devcouncil-verify"));
        assert!(!is_council_mode("claude"));
        assert!(!is_council_mode("claude-container"));
    }

    #[test]
    fn reconcile_council_passed_report_is_completed() {
        let log = temp_log(
            "council-ok",
            r#"{"ok":true,"blocking_gaps":[],"diff_summary":"3 files changed"}"#,
        );
        let out = reconcile_council_path(&log);
        assert_eq!(out.status, "completed");
        assert_eq!(out.summary.as_deref(), Some("3 files changed"));
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_council_with_blocking_gaps_is_failed_even_if_passed_flag_set() {
        // Gaps always veto: a `passed: true` with non-empty gaps still fails.
        let log = temp_log(
            "council-gaps",
            r#"{"passed":true,"blocking_gaps":["missing tests","no error handling"]}"#,
        );
        let out = reconcile_council_path(&log);
        assert_eq!(out.status, "failed");
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_council_tolerates_leading_log_noise() {
        let log = temp_log(
            "council-noise",
            concat!(
                "[info] planning with 3 agents...\n",
                "[info] executor: claude\n",
                r#"{"ok":false,"blocking_gaps":["build failed"]}"#, "\n",
            ),
        );
        let out = reconcile_council_path(&log);
        assert_eq!(out.status, "failed");
        let _ = fs::remove_file(&log);
    }

    #[test]
    fn reconcile_council_without_report_is_failed() {
        let log = temp_log("council-empty", "[info] started\n[info] crashed\n");
        let out = reconcile_council_path(&log);
        assert_eq!(out.status, "failed");
        let _ = fs::remove_file(&log);
    }
}
