//! DevCouncil pipeline runner (slimmed legacy executor).
//!
//! Spawns `dev e2e` / `dev check --verify` subprocesses for council-mode runs
//! and the post-run verification gate. Direct Claude Code runs route through
//! liquitask-agentd instead.
//!
//! Security model:
//! * The renderer never supplies a raw command line. It picks a `mode` and the
//!   command is assembled here from structured parameters.
//! * The working directory must live inside the user's authorised workspace
//!   allowlist (the same boundary used by the workspace file commands).
//! * Every spawned process is tracked in a registry so it can be cancelled and
//!   is reaped on exit.
//!
//! Event contract (renderer listens on `agent-run-event`):
//! `{ runId, stream: "stdout" | "stderr" | "exit" | "error", line?, code? }`

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_yaml::Value as YamlValue;
use tauri::{AppHandle, Emitter, Manager, State};

/// Reserved DevCouncil CLI profile name for LiquiTask-managed Claude advisor.
const LIQUITASK_ADVISOR_PROFILE: &str = "liquitask-advisor";

use crate::agent_cli_util::{augmented_path, find_executable, resolve_dev_cli};
use crate::agent_policy;
use crate::run_store;
use crate::{is_path_authorized, read_storage, safe_workspace_paths};

pub const AGENT_RUN_EVENT: &str = "agent-run-event";

/// A tracked agent process. `child` is present for runs we spawned this session
/// (owned handle for reaping); it is `None` for runs re-adopted from the durable
/// journal on relaunch, where we only hold the pid/pgid. `signals` coordinates
/// the reaper and tailer threads for durable (unix) runs.
pub struct TrackedRun {
    pub pid: u32,
    /// Process-group id on unix (0 = unknown / not detached). Kills the subtree.
    pub pgid: u32,
    pub child: Option<Child>,
    pub signals: Option<Arc<RunSignals>>,
    /// macOS sandbox-exec profile temp dir; kept until the child exits.
    #[allow(dead_code)]
    pub(crate) sandbox_profile_dir: Option<tempfile::TempDir>,
}

/// Cross-thread coordination for one durable run: the reaper flips `finished`
/// (recording the exit code) and the tailer drains the log, then finalizes.
#[derive(Default)]
pub struct RunSignals {
    finished: AtomicBool,
    cancelled: AtomicBool,
    paused: AtomicBool,
    exit_code: Mutex<Option<i32>>,
}

/// Running agent processes keyed by run id.
pub struct AgentProcessRegistry(pub Mutex<HashMap<String, TrackedRun>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunEventPayload {
    pub run_id: String,
    pub stream: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliStatus {
    pub name: String,
    pub available: bool,
    pub path: Option<String>,
}

/// What relaunch found for a previously-active run in the durable journal.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunReattachInfo {
    pub run_id: String,
    /// The agent process is still running headless — the UI stays live.
    pub alive: bool,
    /// `running` | `completed` | `failed` | `cancelled`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub paused: bool,
}

// ---------------------------------------------------------------------------
// Event emission + process control
// ---------------------------------------------------------------------------

fn emit_run_event(app: &AppHandle, run_id: &str, stream: &str, line: Option<String>, code: Option<i32>) {
    let _ = app.emit(
        AGENT_RUN_EVENT,
        AgentRunEventPayload {
            run_id: run_id.to_string(),
            stream: stream.to_string(),
            line,
            code,
        },
    );
}

#[cfg(unix)]
fn is_pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    // kill(pid, 0): 0 => signalable (alive); EPERM => alive but not ours.
    let ret = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if ret == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Force-kill the whole process group (agent + any tools it spawned).
#[cfg(unix)]
fn kill_process_group(pgid: u32) {
    if pgid == 0 {
        return;
    }
    // A negative pid targets the entire process group.
    unsafe {
        libc::kill(-(pgid as libc::pid_t), libc::SIGKILL);
    }
}

/// Suspend the whole process group (SIGSTOP). The child stops producing output
/// until resumed with SIGCONT.
#[cfg(unix)]
fn suspend_process_group(pgid: u32) -> Result<(), String> {
    if pgid == 0 {
        return Err("Process group unknown".to_string());
    }
    let ret = unsafe { libc::kill(-(pgid as libc::pid_t), libc::SIGSTOP) };
    if ret == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to pause process group: {}",
            std::io::Error::last_os_error()
        ))
    }
}

/// Resume a previously SIGSTOP'd process group.
#[cfg(unix)]
fn resume_process_group(pgid: u32) -> Result<(), String> {
    if pgid == 0 {
        return Err("Process group unknown".to_string());
    }
    let ret = unsafe { libc::kill(-(pgid as libc::pid_t), libc::SIGCONT) };
    if ret == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to resume process group: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
fn suspend_process_group(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("Process id unknown".to_string());
    }
    for_each_thread(pid, |handle| {
        unsafe {
            windows::Win32::System::Threading::SuspendThread(handle)
                .map_err(|e| format!("SuspendThread: {e}"))?;
        }
        Ok(())
    })
}

#[cfg(windows)]
fn resume_process_group(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Err("Process id unknown".to_string());
    }
    for_each_thread(pid, |handle| {
        unsafe {
            windows::Win32::System::Threading::ResumeThread(handle);
        }
        Ok(())
    })
}

#[cfg(windows)]
fn for_each_thread(
    pid: u32,
    mut action: impl FnMut(windows::Win32::Foundation::HANDLE) -> Result<(), String>,
) -> Result<(), String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows::Win32::System::Threading::{OpenThread, THREAD_SUSPEND_RESUME};

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
            .map_err(|e| format!("CreateToolhelp32Snapshot: {e}"))?;
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..Default::default()
        };
        if Thread32First(snap, &mut entry).is_ok() {
            loop {
                if entry.th32OwnerProcessID == pid {
                    if let Ok(handle) = OpenThread(THREAD_SUSPEND_RESUME, false, entry.th32ThreadID)
                    {
                        action(handle)?;
                        let _ = CloseHandle(handle);
                    }
                }
                if Thread32Next(snap, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
fn suspend_process_group(_pgid: u32) -> Result<(), String> {
    Err("Pause is not supported on this platform".to_string())
}

#[cfg(not(any(unix, windows)))]
fn resume_process_group(_pgid: u32) -> Result<(), String> {
    Err("Resume is not supported on this platform".to_string())
}

/// Windows liveness/kill go through `tasklist`/`taskkill` rather than the
/// `windows` crate: they're rare (reattach + cancel) and keep this file's
/// unsafe surface small. `CREATE_NO_WINDOW` stops a console flashing.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
fn is_pid_alive(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    if pid == 0 {
        return false;
    }
    // Bind owned strings first: array literals must be homogeneous (`&str`), and
    // the temporaries must outlive the `.output()` call.
    let filter = format!("PID eq {pid}");
    let needle = format!("\"{pid}\"");
    match Command::new("tasklist")
        .args(["/FI", filter.as_str(), "/NH", "/FO", "CSV"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .output()
    {
        // tasklist prints the pid quoted in its CSV row when the process exists.
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains(needle.as_str()),
        Err(_) => false,
    }
}

/// Kill the whole process tree (`taskkill /T`) — the group leader plus children.
#[cfg(windows)]
fn kill_process_group(pgid: u32) {
    use std::os::windows::process::CommandExt;
    if pgid == 0 {
        return;
    }
    let pid_arg = pgid.to_string();
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", pid_arg.as_str()])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

#[cfg(not(any(unix, windows)))]
fn is_pid_alive(_pid: u32) -> bool {
    false
}

#[cfg(not(any(unix, windows)))]
fn kill_process_group(_pgid: u32) {}

// ---------------------------------------------------------------------------
// PID identity (detect PID reuse on reattach)
// ---------------------------------------------------------------------------

/// Best-effort process start time in epoch milliseconds. Used to verify that a
/// re-adopted PID is the same process we originally spawned, not a reused id.
fn process_start_time_ms(pid: u32) -> Option<u64> {
    if pid == 0 {
        return None;
    }
    process_start_time_ms_impl(pid)
}

#[cfg(target_os = "linux")]
fn process_start_time_ms_impl(pid: u32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // Field 22 (1-indexed) is starttime; comm (field 2) may contain spaces.
    let rparen = stat.rfind(')')?;
    let rest = stat[rparen + 2..].split_whitespace().collect::<Vec<_>>();
    let start_ticks: u64 = rest.get(19)?.parse().ok()?;
    let clk_tck = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if clk_tck <= 0 {
        return None;
    }
    let boot = linux_boot_time_ms()?;
    Some(boot + (start_ticks * 1000) / clk_tck as u64)
}

#[cfg(target_os = "linux")]
fn linux_boot_time_ms() -> Option<u64> {
    let raw = std::fs::read_to_string("/proc/stat").ok()?;
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("btime ") {
            let secs: u64 = rest.trim().parse().ok()?;
            return Some(secs * 1000);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn process_start_time_ms_impl(pid: u32) -> Option<u64> {
    use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        return None;
    }
    // ps lstart: "Day Mon DD HH:MM:SS YYYY" (day may be space-padded).
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 5 {
        return None;
    }
    let day: u32 = parts[2].parse().ok()?;
    let time = NaiveTime::parse_from_str(parts[3], "%H:%M:%S").ok()?;
    let year: i32 = parts[4].parse().ok()?;
    let month = match parts[1] {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let dt = NaiveDateTime::new(date, time);
    Some(dt.and_utc().timestamp_millis() as u64)
}

#[cfg(windows)]
fn process_start_time_ms_impl(pid: u32) -> Option<u64> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut created = Default::default();
        let mut exited = Default::default();
        let mut kernel = Default::default();
        let mut user = Default::default();
        if GetProcessTimes(handle, &mut created, &mut exited, &mut kernel, &mut user).is_err() {
            let _ = CloseHandle(handle);
            return None;
        }
        let _ = CloseHandle(handle);
        filetime_to_epoch_ms(created)
    }
}

#[cfg(windows)]
fn filetime_to_epoch_ms(ft: windows::Win32::Foundation::FILETIME) -> Option<u64> {
    let low = ft.dwLowDateTime as u64;
    let high = ft.dwHighDateTime as u64;
    let ticks = (high << 32) | low;
    // FILETIME is 100-ns intervals since 1601-01-01; Unix epoch offset in same units.
    const EPOCH_DIFF: u64 = 11_644_473_600_000_000_000;
    if ticks < EPOCH_DIFF {
        return None;
    }
    Some((ticks - EPOCH_DIFF) / 10_000)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn process_start_time_ms_impl(_pid: u32) -> Option<u64> {
    None
}

fn pid_identity_matches(pid: u32, expected_start_ms: u64) -> bool {
    match process_start_time_ms(pid) {
        Some(actual) => actual == expected_start_ms,
        None => false,
    }
}

// ---------------------------------------------------------------------------
// Command assembly (DevCouncil modes only)
// ---------------------------------------------------------------------------

struct AssembledCommand {
    program: PathBuf,
    args: Vec<String>,
    sandbox_profile_dir: Option<tempfile::TempDir>,
}

#[allow(clippy::too_many_arguments)]
fn assemble_command(
    mode: &str,
    prompt: &str,
    working_dir: &str,
    model: &Option<String>,
    _permission_mode: &Option<String>,
    _max_turns: &Option<u32>,
    _container_image: &Option<String>,
    _session_id: &Option<String>,
    _mcp_config_path: &Option<String>,
    _permission_prompt_tool: &Option<String>,
    advisor_model: &Option<String>,
) -> Result<AssembledCommand, String> {
    match mode {
        // DevCouncil deterministic verification gate (`dev check --verify --json`).
        "devcouncil-verify" => {
            let program = resolve_dev_cli()
                .ok_or_else(|| "DevCouncil CLI (`dev`) not found on PATH.".to_string())?;
            Ok(AssembledCommand {
                program,
                args: vec![
                    "check".to_string(),
                    "--verify".to_string(),
                    "--json".to_string(),
                ],
                sandbox_profile_dir: None,
            })
        }
        // Full DevCouncil pipeline: council planning + Claude Code execution + gates.
        "devcouncil-e2e" => {
            let program = resolve_dev_cli()
                .ok_or_else(|| "DevCouncil CLI (`dev`) not found on PATH.".to_string())?;
            let mut args = vec![
                "e2e".to_string(),
                prompt.to_string(),
                "--executor".to_string(),
                "claude".to_string(),
                "--json".to_string(),
            ];
            if let Some(advisor) = advisor_model
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                ensure_liquitask_advisor_profile(Path::new(working_dir), advisor, model.as_deref())?;
                args.push("--profile".to_string());
                args.push(LIQUITASK_ADVISOR_PROFILE.to_string());
            }
            Ok(AssembledCommand {
                program,
                args,
                sandbox_profile_dir: None,
            })
        }
        other => Err(format!("Unknown agent run mode: {other}")),
    }
}

/// Ensure `parent[key]` exists as a YAML mapping and return a mutable borrow.
fn ensure_yaml_mapping<'a>(
    parent: &'a mut serde_yaml::Mapping,
    key: &str,
) -> Result<&'a mut serde_yaml::Mapping, String> {
    let yaml_key = YamlValue::String(key.into());
    if !parent.contains_key(&yaml_key) {
        parent.insert(
            yaml_key.clone(),
            YamlValue::Mapping(serde_yaml::Mapping::new()),
        );
    }
    parent
        .get_mut(&yaml_key)
        .and_then(YamlValue::as_mapping_mut)
        .ok_or_else(|| format!("{key} must be a YAML mapping"))
}

/// Merge-only write of the reserved `liquitask-advisor` CLI profile into
/// `.devcouncil/config.yaml` under `integrations.cli_agents.profiles`
/// (DevCouncil's load path). Creates the file/tree when missing; never wipes
/// other profiles or unrelated keys.
///
/// Profile fields: `description`, `advisor_model`, optional `model`.
/// No `extra_args` — DevCouncil applies `--advisor` from `advisor_model`.
fn ensure_liquitask_advisor_profile(
    working_dir: &Path,
    advisor_model: &str,
    coding_model: Option<&str>,
) -> Result<(), String> {
    let config_dir = working_dir.join(".devcouncil");
    let config_path = config_dir.join("config.yaml");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create .devcouncil directory: {e}"))?;

    let mut root = if config_path.is_file() {
        let raw = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read {}: {e}", config_path.display()))?;
        if raw.trim().is_empty() {
            YamlValue::Mapping(serde_yaml::Mapping::new())
        } else {
            serde_yaml::from_str::<YamlValue>(&raw)
                .map_err(|e| format!("Failed to parse {}: {e}", config_path.display()))?
        }
    } else {
        YamlValue::Mapping(serde_yaml::Mapping::new())
    };

    let root_map = root.as_mapping_mut().ok_or_else(|| {
        format!(
            "{} root must be a YAML mapping",
            config_path.display()
        )
    })?;

    // DevCouncil loads profiles from integrations.cli_agents.profiles only.
    let integrations = ensure_yaml_mapping(root_map, "integrations")?;
    let cli_agents = ensure_yaml_mapping(integrations, "cli_agents")?;
    let profiles = ensure_yaml_mapping(cli_agents, "profiles")?;

    let mut profile = serde_yaml::Mapping::new();
    profile.insert(
        YamlValue::String("description".into()),
        YamlValue::String(
            "LiquiTask-managed Claude Code advisor (merge-only; do not hand-edit)"
                .into(),
        ),
    );
    profile.insert(
        YamlValue::String("advisor_model".into()),
        YamlValue::String(advisor_model.to_string()),
    );
    if let Some(model) = coding_model.map(str::trim).filter(|s| !s.is_empty()) {
        profile.insert(
            YamlValue::String("model".into()),
            YamlValue::String(model.to_string()),
        );
    }

    profiles.insert(
        YamlValue::String(LIQUITASK_ADVISOR_PROFILE.into()),
        YamlValue::Mapping(profile),
    );

    let serialized = serde_yaml::to_string(&root)
        .map_err(|e| format!("Failed to serialize {}: {e}", config_path.display()))?;
    fs::write(&config_path, serialized)
        .map_err(|e| format!("Failed to write {}: {e}", config_path.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn agent_detect_clis() -> Vec<AgentCliStatus> {
    ["dev", "container"]
        .iter()
        .map(|name| {
            let path = find_executable(name);
            AgentCliStatus {
                name: (*name).to_string(),
                available: path.is_some(),
                path: path.map(|p| p.to_string_lossy().to_string()),
            }
        })
        .collect()
}

#[tauri::command(rename_all = "camelCase")]
#[allow(clippy::too_many_arguments)]
pub fn agent_run_start(
    app: AppHandle,
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
    mode: String,
    prompt: String,
    working_dir: String,
    model: Option<String>,
    permission_mode: Option<String>,
    max_turns: Option<u32>,
    container_image: Option<String>,
    session_id: Option<String>,
    mcp_config_path: Option<String>,
    permission_prompt_tool: Option<String>,
    sandbox_mode: Option<String>,
    daily_cost_cap_usd: Option<f64>,
    max_runs_per_day: Option<u32>,
    today_spend_usd: Option<f64>,
    today_run_count: Option<u32>,
    model_routing: Option<String>,
    task_priority: Option<String>,
    task_time_estimate_min: Option<u32>,
    profile_model: Option<String>,
    advisor_model: Option<String>,
) -> Result<(), String> {
    if run_id.is_empty() || run_id.len() > 128 {
        return Err("Invalid run id".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("Prompt must not be empty".to_string());
    }
    if prompt.len() > 200_000 {
        return Err("Prompt exceeds the maximum size (200 KB)".to_string());
    }

    // The working directory must be inside the user's authorised workspace.
    let data = read_storage(&app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(&working_dir, &authorized) {
        return Err(format!(
            "Working directory is not an authorised workspace path: {working_dir}. Add it under workspace settings first."
        ));
    }
    let cwd = dunce::canonicalize(&working_dir)
        .map_err(|e| format!("Working directory not accessible: {e}"))?;

    {
        let guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        if guard.contains_key(&run_id) {
            return Err(format!("Run {run_id} is already active"));
        }
    }

    // Budget guards (spawn gate) — only when the renderer supplies today's stats.
    if today_spend_usd.is_some() || today_run_count.is_some() {
        agent_policy::check_budget(
            daily_cost_cap_usd,
            max_runs_per_day,
            today_spend_usd.unwrap_or(0.0),
            today_run_count.unwrap_or(0),
        )?;
    }

    let resolved_model = agent_policy::resolve_model(
        model_routing.as_deref().unwrap_or("fixed"),
        profile_model.as_deref().or(model.as_deref()),
        task_priority.as_deref(),
        task_time_estimate_min,
    );

    let assembled = assemble_command(
        &mode,
        &prompt,
        &cwd.to_string_lossy(),
        &resolved_model,
        &permission_mode,
        &max_turns,
        &container_image,
        &session_id,
        &mcp_config_path,
        &permission_prompt_tool,
        &advisor_model,
    )?;

    let mut extra_roots: Vec<String> = safe_workspace_paths(&data);
    if let Some(ref mcp_path) = mcp_config_path {
        let parent = std::path::Path::new(mcp_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string());
        if let Some(p) = parent {
            extra_roots.push(p);
        }
    }

    let wrapped = crate::agent_sandbox::maybe_wrap_os_sandbox(
        assembled.program,
        assembled.args,
        &cwd,
        sandbox_mode.as_deref(),
        &extra_roots,
    )?;
    let assembled = AssembledCommand {
        program: wrapped.program,
        args: wrapped.args,
        sandbox_profile_dir: wrapped.profile_dir,
    };

    launch_run(&app, &registry, &run_id, &mode, assembled, &cwd)
}

// ---------------------------------------------------------------------------
// Launch: durable (unix) vs piped fallback (non-unix)
// ---------------------------------------------------------------------------

/// Durable launch (unix): detach into its own process group and redirect
/// stdout/stderr to on-disk log files, so the agent keeps running after the
/// app/window closes. A reaper thread reaps the child; a tailer thread follows
/// the stdout log and re-emits the `agent-run-event` stream the UI expects.
#[cfg(unix)]
fn launch_run(
    app: &AppHandle,
    registry: &State<'_, AgentProcessRegistry>,
    run_id: &str,
    mode: &str,
    assembled: AssembledCommand,
    cwd: &Path,
) -> Result<(), String> {
    use std::os::unix::process::CommandExt;

    let (paths, stdout_file, stderr_file) = run_store::prepare_run_files(app, run_id)?;

    let child = Command::new(&assembled.program)
        .args(&assembled.args)
        .current_dir(cwd)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        // Own process group => an app-quit signal to our group misses the child,
        // and with stdout on a file it never takes a SIGPIPE either.
        .process_group(0)
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", assembled.program.display()))?;

    // process_group(0) makes the child its own group leader, so pgid == pid.
    track_and_stream(app, registry, run_id, mode, cwd, child, paths, assembled.sandbox_profile_dir)
}

/// Durable launch (windows): detach with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`
/// and redirect stdout/stderr to on-disk log files, so the agent survives the
/// app closing. `CREATE_NEW_PROCESS_GROUP` makes the child its own group leader
/// (group id == pid), matching the unix `pgid` contract used by kill/liveness.
#[cfg(windows)]
fn launch_run(
    app: &AppHandle,
    registry: &State<'_, AgentProcessRegistry>,
    run_id: &str,
    mode: &str,
    assembled: AssembledCommand,
    cwd: &Path,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // DETACHED_PROCESS: no inherited console (stdio goes to our files anyway).
    // CREATE_NEW_PROCESS_GROUP: immune to CTRL events sent to the app's group.
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let (paths, stdout_file, stderr_file) = run_store::prepare_run_files(app, run_id)?;

    let child = Command::new(&assembled.program)
        .args(&assembled.args)
        .current_dir(cwd)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", assembled.program.display()))?;

    track_and_stream(app, registry, run_id, mode, cwd, child, paths, assembled.sandbox_profile_dir)
}

/// Record the journal entry, register the tracked process, and start the reaper
/// + tailer threads. Shared by the unix and windows durable launch paths (the
/// group id equals the pid on both).
#[cfg(any(unix, windows))]
fn track_and_stream(
    app: &AppHandle,
    registry: &State<'_, AgentProcessRegistry>,
    run_id: &str,
    mode: &str,
    cwd: &Path,
    child: Child,
    paths: run_store::RunPaths,
    sandbox_profile_dir: Option<tempfile::TempDir>,
) -> Result<(), String> {
    let pid = child.id();
    let pgid = pid;

    run_store::write_meta(
        app,
        &run_store::RunMeta {
            run_id: run_id.to_string(),
            mode: mode.to_string(),
            working_dir: cwd.to_string_lossy().to_string(),
            status: "running".to_string(),
            pid: Some(pid),
            pgid: Some(pgid),
            started_at_ms: run_store::now_ms(),
            finished_at_ms: None,
            exit_code: None,
            stdout_offset: 0,
            session_id: None,
            paused: false,
            process_start_time_ms: process_start_time_ms(pid),
        },
    )?;

    let signals = Arc::new(RunSignals::default());
    {
        let mut guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        guard.insert(
            run_id.to_string(),
            TrackedRun {
                pid,
                pgid,
                child: Some(child),
                signals: Some(signals.clone()),
                sandbox_profile_dir,
            },
        );
    }

    spawn_reaper(app.clone(), run_id.to_string(), signals.clone());
    spawn_stdout_tailer(app.clone(), run_id.to_string(), paths.stdout, 0, signals.clone());
    spawn_stderr_tailer(app.clone(), run_id.to_string(), paths.stderr, 0, signals);
    Ok(())
}

/// Piped fallback (no durable journal): pipe stdout/stderr through in-process
/// reader threads. Runs do not survive app close here. Reached only on exotic
/// targets that are neither unix nor windows.
#[cfg(not(any(unix, windows)))]
fn launch_run(
    app: &AppHandle,
    registry: &State<'_, AgentProcessRegistry>,
    run_id: &str,
    _mode: &str,
    assembled: AssembledCommand,
    cwd: &Path,
) -> Result<(), String> {
    let mut child = Command::new(&assembled.program)
        .args(&assembled.args)
        .current_dir(cwd)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", assembled.program.display()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let pid = child.id();

    let signals = Arc::new(RunSignals::default());
    {
        let mut guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        guard.insert(
            run_id.to_string(),
            TrackedRun {
                pid,
                pgid: 0,
                child: Some(child),
                signals: Some(signals),
                sandbox_profile_dir: assembled.sandbox_profile_dir,
            },
        );
    }

    if let Some(err_pipe) = stderr {
        let app_err = app.clone();
        let id = run_id.to_string();
        std::thread::spawn(move || {
            for line in BufReader::new(err_pipe).lines().map_while(Result::ok) {
                emit_run_event(&app_err, &id, "stderr", Some(line), None);
            }
        });
    }

    let app_out = app.clone();
    let id = run_id.to_string();
    std::thread::spawn(move || {
        if let Some(out_pipe) = stdout {
            for line in BufReader::new(out_pipe).lines().map_while(Result::ok) {
                emit_run_event(&app_out, &id, "stdout", Some(line), None);
            }
        }
        let code = {
            let state: State<'_, AgentProcessRegistry> = app_out.state();
            let tracked = {
                let mut guard = match state.0.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                guard.remove(&id)
            };
            match tracked.and_then(|t| t.child) {
                Some(mut c) => c.wait().ok().and_then(|s| s.code()).unwrap_or(-1),
                None => -1,
            }
        };
        emit_run_event(&app_out, &id, "exit", None, Some(code));
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Reaper + tailers (durable runs, unix + windows)
// ---------------------------------------------------------------------------

/// Waits for the run's process to exit, records the exit code, flips `finished`
/// and reaps the registry entry. Owned children are polled with `try_wait`;
/// re-adopted runs (no `Child`) are polled with a pid liveness check.
/// Normalise a process exit into an integer code. On Unix a signal death has no
/// `code()`, so encode it as `128 + signal` (shell convention: 137 = SIGKILL,
/// 143 = SIGTERM) rather than a bare `-1`, so the UI can name what killed it
/// instead of showing the misleading "exited with code -1".
#[cfg(unix)]
fn status_exit_code(status: &std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    status
        .code()
        .or_else(|| status.signal().map(|s| 128 + s))
        .unwrap_or(-1)
}

#[cfg(not(unix))]
fn status_exit_code(status: &std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(-1)
}

#[cfg(any(unix, windows))]
fn spawn_reaper(app: AppHandle, run_id: String, signals: Arc<RunSignals>) {
    std::thread::spawn(move || {
        let registry: State<'_, AgentProcessRegistry> = app.state();
        let mut last_liveness = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(300));
            let exit = {
                let mut guard = match registry.0.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                match guard.get_mut(&run_id) {
                    None => return, // cancelled + reaped elsewhere
                    Some(tracked) => match tracked.child.as_mut() {
                        Some(child) => match child.try_wait() {
                            Ok(Some(status)) => Some(status_exit_code(&status)),
                            Ok(None) => None,
                            Err(_) => Some(-1),
                        },
                        // Re-adopted run: we never held the Child, so poll the pid.
                        // Liveness can be costly (tasklist on Windows), so check
                        // at a slower cadence than the owned try_wait loop.
                        None => {
                            if last_liveness.elapsed() < Duration::from_millis(1500) {
                                None
                            } else {
                                last_liveness = Instant::now();
                                if is_pid_alive(tracked.pid) {
                                    None
                                } else {
                                    Some(-1)
                                }
                            }
                        }
                    },
                }
            };
            if let Some(code) = exit {
                *signals.exit_code.lock().unwrap_or_else(|p| p.into_inner()) = Some(code);
                signals.finished.store(true, Ordering::Release);
                if let Ok(mut guard) = registry.0.lock() {
                    guard.remove(&run_id);
                }
                return;
            }
        }
    });
}

/// Follows the run's stdout log (`tail -f` style), re-emitting each complete
/// NDJSON line as a `stdout` event and persisting how far it has streamed. When
/// the reaper reports the process gone and the log is fully drained, it emits
/// the terminal `exit` event and finalizes the journal entry.
#[cfg(any(unix, windows))]
fn spawn_stdout_tailer(
    app: AppHandle,
    run_id: String,
    path: PathBuf,
    start_offset: u64,
    signals: Arc<RunSignals>,
) {
    std::thread::spawn(move || {
        // The log is created before the child spawns, so it should open at once;
        // retry briefly to tolerate a transient failure rather than prematurely
        // finalizing a run whose process is still very much alive.
        let file = {
            let mut opened = None;
            for _ in 0..20 {
                match File::open(&path) {
                    Ok(f) => {
                        opened = Some(f);
                        break;
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(50)),
                }
            }
            opened
        };
        let Some(file) = file else {
            finalize_run(&app, &run_id, &signals);
            return;
        };
        let mut reader = BufReader::new(file);
        if start_offset > 0 {
            let _ = reader.seek(SeekFrom::Start(start_offset));
        }
        let mut emitted: u64 = start_offset;
        let mut pending = String::new();
        let mut last_persist = Instant::now();

        loop {
            let mut buf = String::new();
            match reader.read_line(&mut buf) {
                Ok(0) => {
                    // True EOF. If the process is gone, the log is fully drained.
                    if signals.finished.load(Ordering::Acquire) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
                Ok(_) => {
                    pending.push_str(&buf);
                    // Only emit once a full line has arrived; a trailing partial
                    // write is held until its newline is appended.
                    if pending.ends_with('\n') {
                        emitted += pending.as_bytes().len() as u64;
                        let line = pending.trim_end_matches(['\n', '\r']).to_string();
                        if !line.is_empty() {
                            emit_run_event(&app, &run_id, "stdout", Some(line), None);
                        }
                        pending.clear();
                    }
                }
                Err(_) => break,
            }
            // Persist the cursor at a fixed cadence in *both* the streaming and
            // idle paths. A busy run that never hits EOF must still checkpoint,
            // or reattach would replay every event from a stale (often 0) offset.
            if last_persist.elapsed() >= Duration::from_millis(1000) {
                let _ = run_store::set_offset(&app, &run_id, emitted);
                last_persist = Instant::now();
            }
        }

        // Emit a trailing partial line (no trailing newline) at EOF.
        if !pending.is_empty() {
            emitted += pending.as_bytes().len() as u64;
            let line = pending.trim_end_matches(['\n', '\r']).to_string();
            if !line.is_empty() {
                emit_run_event(&app, &run_id, "stdout", Some(line), None);
            }
            pending.clear();
        }
        let _ = run_store::set_offset(&app, &run_id, emitted);
        finalize_run(&app, &run_id, &signals);
    });
}

/// Follows the run's stderr log, re-emitting lines until the process is gone.
#[cfg(any(unix, windows))]
fn spawn_stderr_tailer(
    app: AppHandle,
    run_id: String,
    path: PathBuf,
    start_offset: u64,
    signals: Arc<RunSignals>,
) {
    std::thread::spawn(move || {
        let Ok(file) = File::open(&path) else {
            return;
        };
        let mut reader = BufReader::new(file);
        if start_offset > 0 {
            let _ = reader.seek(SeekFrom::Start(start_offset));
        }
        let mut pending = String::new();
        loop {
            let mut buf = String::new();
            match reader.read_line(&mut buf) {
                Ok(0) => {
                    if signals.finished.load(Ordering::Acquire) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                Ok(_) => {
                    pending.push_str(&buf);
                    if pending.ends_with('\n') {
                        let line = pending.trim_end_matches(['\n', '\r']).to_string();
                        if !line.is_empty() {
                            emit_run_event(&app, &run_id, "stderr", Some(line), None);
                        }
                        pending.clear();
                    }
                }
                Err(_) => break,
            }
        }
    });
}

/// Compute the coarse process-level outcome, persist it to the journal, and
/// emit the terminal `exit` event so the TS lifecycle can finish the run.
#[cfg(any(unix, windows))]
fn finalize_run(app: &AppHandle, run_id: &str, signals: &Arc<RunSignals>) {
    let code = *signals.exit_code.lock().unwrap_or_else(|p| p.into_inner());
    let cancelled = signals.cancelled.load(Ordering::Acquire);
    let rec = run_store::reconcile_from_stdout(app, run_id);
    let status = if cancelled {
        "cancelled".to_string()
    } else if rec.status == "completed" || rec.status == "failed" {
        // Prefer the durable stream's terminal result over a bare exit code —
        // agents can exit 0 after reporting an error result line.
        rec.status
    } else {
        match code {
            Some(0) => "completed".to_string(),
            Some(_) => "failed".to_string(),
            None => rec.status,
        }
    };
    let session_id = rec.session_id.or_else(|| run_store::read_meta(app, run_id).and_then(|m| m.session_id));
    let _ = run_store::finalize(app, run_id, &status, code, session_id);
    emit_run_event(app, run_id, "exit", None, Some(code.unwrap_or(-1)));
}

// ---------------------------------------------------------------------------
// Reattach on relaunch
// ---------------------------------------------------------------------------

/// Scan the durable journal on launch. Re-adopt still-live PIDs (resuming their
/// live event stream from the persisted cursor) and reconcile runs that finished
/// while the app was closed. Returns one entry per previously-active run.
#[cfg(any(unix, windows))]
pub fn reattach_runs(app: &AppHandle) -> Vec<RunReattachInfo> {
    let registry: State<'_, AgentProcessRegistry> = app.state();
    let mut out = Vec::new();

    for run_id in run_store::list_run_ids(app) {
        let Some(meta) = run_store::read_meta(app, &run_id) else {
            continue;
        };
        if !meta.is_active() {
            continue; // already terminal — the TS store owns its record
        }

        // Idempotency: a re-adopted run must not be adopted twice.
        {
            let guard = match registry.0.lock() {
                Ok(g) => g,
                Err(_) => continue,
            };
            if guard.contains_key(&run_id) {
                out.push(RunReattachInfo {
                    run_id: run_id.clone(),
                    alive: true,
                    status: "running".to_string(),
                    session_id: meta.session_id.clone(),
                    summary: None,
                    exit_code: None,
                    paused: false,
                });
                continue;
            }
        }

        let pid = meta.pid.unwrap_or(0);
        let identity_ok = meta
            .process_start_time_ms
            .map(|start| pid_identity_matches(pid, start))
            .unwrap_or(false);
        if is_pid_alive(pid) && identity_ok {
            let pgid = meta.pgid.unwrap_or(pid);
            let Ok(paths) = run_store::run_paths(app, &run_id) else {
                continue;
            };
            let signals = Arc::new(RunSignals::default());
            {
                if let Ok(mut guard) = registry.0.lock() {
                    guard.insert(
                        run_id.clone(),
                        TrackedRun {
                            pid,
                            pgid,
                            child: None,
                            signals: Some(signals.clone()),
                            sandbox_profile_dir: None,
                        },
                    );
                }
            }
            // Only surface stderr written after relaunch, not the whole history.
            let stderr_start = std::fs::metadata(&paths.stderr).map(|m| m.len()).unwrap_or(0);
            spawn_reaper(app.clone(), run_id.clone(), signals.clone());
            spawn_stdout_tailer(app.clone(), run_id.clone(), paths.stdout, meta.stdout_offset, signals.clone());
            spawn_stderr_tailer(app.clone(), run_id.clone(), paths.stderr, stderr_start, signals);
            if meta.paused {
                if let Ok(mut guard) = registry.0.lock() {
                    if let Some(tracked) = guard.get_mut(&run_id) {
                        if let Some(signals) = &tracked.signals {
                            signals.paused.store(true, Ordering::Release);
                        }
                    }
                }
            }
            out.push(RunReattachInfo {
                run_id: run_id.clone(),
                alive: true,
                status: "running".to_string(),
                session_id: meta.session_id.clone(),
                summary: None,
                exit_code: None,
                paused: meta.paused,
            });
        } else {
            // Finished while the app was away — or PID was reused — reconcile from the durable log.
            let rec = run_store::reconcile_from_stdout(app, &run_id);
            let status = if is_pid_alive(pid) && !identity_ok {
                "failed".to_string()
            } else {
                rec.status
            };
            let summary = if status == "failed" && is_pid_alive(pid) && !identity_ok {
                Some("Process identity mismatch on reattach (possible PID reuse)".to_string())
            } else {
                rec.summary
            };
            let _ = run_store::finalize(app, &run_id, &status, meta.exit_code, rec.session_id.clone());
            out.push(RunReattachInfo {
                run_id: run_id.clone(),
                alive: false,
                status,
                session_id: rec.session_id,
                summary,
                exit_code: meta.exit_code,
                paused: false,
            });
        }
    }

    run_store::prune(app);
    out
}

#[cfg(not(any(unix, windows)))]
pub fn reattach_runs(_app: &AppHandle) -> Vec<RunReattachInfo> {
    // Exotic targets have no durable journal; the TS store falls back to
    // marking previously-active runs as interrupted, as before.
    Vec::new()
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_run_cancel(
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
) -> Result<bool, String> {
    let mut guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
    if let Some(tracked) = guard.get_mut(&run_id) {
        if let Some(signals) = &tracked.signals {
            signals.cancelled.store(true, Ordering::Release);
        }
        // Kill the whole subtree (unix); fall back to the owned child handle.
        kill_process_group(tracked.pgid);
        if let Some(child) = tracked.child.as_mut() {
            let _ = child.kill();
        }
        // The reaper/tailer (or the piped reader thread) reaps the process,
        // marks the journal entry cancelled, and emits the terminal exit event.
        return Ok(true);
    }
    Ok(false)
}

/// Process-group id on unix; on Windows piped runs fall back to pid.
fn control_target(tracked: &TrackedRun) -> u32 {
    if tracked.pgid != 0 {
        tracked.pgid
    } else {
        tracked.pid
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_council_pause(
    app: AppHandle,
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
) -> Result<bool, String> {
    let (target, already_paused, signals) = {
        let guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        let tracked = guard
            .get(&run_id)
            .ok_or_else(|| format!("Run {run_id} is not active"))?;
        let already = tracked
            .signals
            .as_ref()
            .is_some_and(|s| s.paused.load(Ordering::Acquire));
        (control_target(tracked), already, tracked.signals.clone())
    };
    if already_paused {
        return Ok(true);
    }

    suspend_process_group(target)?;
    if let Some(signals) = signals {
        signals.paused.store(true, Ordering::Release);
    }
    let _ = run_store::set_paused(&app, &run_id, true);
    Ok(true)
}

fn do_resume(
    app: &AppHandle,
    registry: &State<'_, AgentProcessRegistry>,
    run_id: &str,
) -> Result<(), String> {
    let (target, was_paused, signals) = {
        let guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        let tracked = guard
            .get(run_id)
            .ok_or_else(|| format!("Run {run_id} is not active"))?;
        let paused = tracked
            .signals
            .as_ref()
            .is_some_and(|s| s.paused.load(Ordering::Acquire));
        (
            control_target(tracked),
            paused,
            tracked.signals.clone(),
        )
    };
    if !was_paused {
        return Ok(());
    }
    resume_process_group(target)?;
    if let Some(signals) = signals {
        signals.paused.store(false, Ordering::Release);
    }
    let _ = run_store::set_paused(app, run_id, false);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_council_resume(
    app: AppHandle,
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
) -> Result<bool, String> {
    do_resume(&app, &registry, &run_id)?;
    Ok(true)
}

/// Reattach to durable council runs on relaunch. Returns one entry per
/// previously-active run: alive ones keep streaming; finished-while-away ones
/// are reconciled from their durable log.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_runs_reattach(app: AppHandle) -> Vec<RunReattachInfo> {
    reattach_runs(&app)
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_run_active(registry: State<'_, AgentProcessRegistry>) -> Result<Vec<String>, String> {
    let guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
    Ok(guard.keys().cloned().collect())
}

/// Escape a string for embedding inside a double-quoted AppleScript string.
fn applescript_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Escape a string for embedding inside single quotes in a shell command.
fn shell_single_quote(input: &str) -> String {
    format!("'{}'", input.replace('\'', r"'\''"))
}

/// Hand a finished/interrupted run over to Terminal.app so the user can keep
/// talking to the same Claude Code session (`claude --resume <session-id>`).
#[tauri::command(rename_all = "camelCase")]
pub fn agent_open_in_terminal(
    app: AppHandle,
    working_dir: String,
    session_id: String,
) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Terminal handoff is only supported on macOS.".to_string());
    }
    // Session ids are UUID-shaped; reject anything that could smuggle shell syntax.
    if session_id.is_empty()
        || session_id.len() > 64
        || !session_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(format!("Invalid session id: {session_id}"));
    }

    let data = read_storage(&app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(&working_dir, &authorized) {
        return Err(format!(
            "Working directory is not an authorised workspace path: {working_dir}"
        ));
    }

    let shell_cmd = format!(
        "cd {} && claude --resume {}",
        shell_single_quote(&working_dir),
        session_id
    );
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        applescript_escape(&shell_cmd)
    );

    Command::new("osascript")
        .arg("-e")
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to open Terminal: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Developer tool detection & launch (IDEs / editors)
// ---------------------------------------------------------------------------

/// A locally installed IDE / editor launcher discovered on PATH. Distinct from
/// `AgentCliStatus` (agent CLIs): these are GUI editors the user can open a repo
/// in. Detection is best-effort — a missing launcher simply reports
/// `available: false` rather than erroring.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DevTool {
    /// Stable id used by the frontend (e.g. "vscode").
    pub id: String,
    /// Human label (e.g. "Visual Studio Code").
    pub name: String,
    /// The PATH binary that was found (or the first candidate when none exists).
    pub binary: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Always "ide" for now; lets the UI group tools by kind.
    pub kind: String,
    /// How the tool should be launched: "path" (PATH launcher via `<bin> <dir>`),
    /// "bundle" (macOS .app via `open -a <appName> <dir>`), or "none".
    pub launch: String,
    /// macOS app display name for `open -a`, when `launch == "bundle"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
}

/// Curated IDE / editor launchers. Each entry lists candidate PATH binary names
/// (priority order) and candidate macOS `.app` bundle names. Detection prefers a
/// PATH launcher (reliable `<bin> <dir>` folder-open) and falls back to the app
/// bundle so editors still appear when the CLI launcher was never installed.
const IDE_TOOLS: &[(&str, &str, &[&str], &[&str])] = &[
    ("vscode", "Visual Studio Code", &["code"], &["Visual Studio Code"]),
    (
        "vscode-insiders",
        "VS Code Insiders",
        &["code-insiders"],
        &["Visual Studio Code - Insiders"],
    ),
    ("cursor", "Cursor", &["cursor"], &["Cursor"]),
    ("windsurf", "Windsurf", &["windsurf"], &["Windsurf"]),
    ("zed", "Zed", &["zed"], &["Zed"]),
    ("sublime", "Sublime Text", &["subl"], &["Sublime Text"]),
    (
        "jetbrains",
        "JetBrains (IntelliJ IDEA)",
        &["idea"],
        &["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Community Edition"],
    ),
];

/// Directories scanned for `.app` bundles. Empty on non-macOS so bundle
/// detection is a no-op there (PATH detection still runs).
fn ide_app_search_dirs() -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let mut dirs = vec![PathBuf::from("/Applications")];
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            dirs.push(PathBuf::from(home).join("Applications"));
        }
    }
    dirs
}

/// Find the first `<app>.app` bundle that exists in any search dir. Returns the
/// matched app display name and the bundle path.
fn resolve_app_bundle(apps: &[&str], dirs: &[PathBuf]) -> Option<(String, String)> {
    for app in apps {
        for dir in dirs {
            let bundle = dir.join(format!("{app}.app"));
            if bundle.exists() {
                return Some(((*app).to_string(), bundle.to_string_lossy().into_owned()));
            }
        }
    }
    None
}

/// Detect installed IDE / editor launchers. Prefers a PATH launcher, then falls
/// back to a macOS `.app` bundle so an editor still shows up (and stays
/// launchable via `open -a`) even without its `code`/`cursor`/… CLI shim.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_detect_ide_tools() -> Vec<DevTool> {
    let app_dirs = ide_app_search_dirs();
    IDE_TOOLS
        .iter()
        .map(|(id, name, bins, apps)| {
            // 1) PATH launcher — most reliable.
            for bin in bins.iter() {
                if let Some(found) = find_executable(bin) {
                    return DevTool {
                        id: (*id).to_string(),
                        name: (*name).to_string(),
                        binary: (*bin).to_string(),
                        available: true,
                        path: Some(found.to_string_lossy().into_owned()),
                        kind: "ide".to_string(),
                        launch: "path".to_string(),
                        app_name: None,
                    };
                }
            }
            // 2) macOS .app bundle fallback.
            if let Some((app_name, bundle)) = resolve_app_bundle(apps, &app_dirs) {
                return DevTool {
                    id: (*id).to_string(),
                    name: (*name).to_string(),
                    binary: bins.first().map(|b| (*b).to_string()).unwrap_or_default(),
                    available: true,
                    path: Some(bundle),
                    kind: "ide".to_string(),
                    launch: "bundle".to_string(),
                    app_name: Some(app_name),
                };
            }
            // 3) Not found.
            DevTool {
                id: (*id).to_string(),
                name: (*name).to_string(),
                binary: bins.first().map(|b| (*b).to_string()).unwrap_or_default(),
                available: false,
                path: None,
                kind: "ide".to_string(),
                launch: "none".to_string(),
                app_name: None,
            }
        })
        .collect()
}

/// Reject anything that isn't a bare executable name — guards the PATH-launch
/// modes against smuggled shell syntax or absolute paths.
fn validate_tool_name(tool: &str) -> Result<(), String> {
    if tool.is_empty()
        || tool.len() > 64
        || tool.starts_with('-')
        || !tool
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("Invalid tool name: {tool}"));
    }
    Ok(())
}

/// Validate a macOS app display name for `open -a`. Spaces are allowed (e.g.
/// "Visual Studio Code") but a leading '-' (flag injection into `open`), path
/// separators, and control chars are rejected. `open -a` is exec'd without a
/// shell, so this only needs to block those specific footguns.
fn validate_app_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 128
        || name.starts_with('-')
        || name.contains('/')
        || name.chars().any(char::is_control)
    {
        return Err(format!("Invalid application name: {name}"));
    }
    Ok(())
}

/// Launch a detected agent CLI or IDE in an authorised workspace directory.
///
/// - `mode = "app"`: spawn a PATH launcher with the folder (`<bin> <dir>`), e.g.
///   opening the repo in VS Code / Cursor via its `code`/`cursor` shim.
/// - `mode = "bundle"`: open the folder in a macOS `.app` bundle via
///   `open -a <appName> <dir>` (used when no CLI launcher is on PATH).
/// - `mode = "terminal"`: open Terminal.app at the directory and run the tool
///   (macOS only), mirroring `agent_open_in_terminal`.
///
/// The directory must be an authorised workspace path.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_open_in_tool(
    app: AppHandle,
    tool: String,
    working_dir: String,
    mode: String,
) -> Result<(), String> {
    let data = read_storage(&app)?;
    let authorized = safe_workspace_paths(&data);
    if !is_path_authorized(&working_dir, &authorized) {
        return Err(format!(
            "Working directory is not an authorised workspace path: {working_dir}"
        ));
    }

    match mode.as_str() {
        "app" => {
            validate_tool_name(&tool)?;
            let bin =
                find_executable(&tool).ok_or_else(|| format!("Tool not found on PATH: {tool}"))?;
            Command::new(&bin)
                .arg(&working_dir)
                .current_dir(&working_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to launch {tool}: {e}"))?;
            Ok(())
        }
        "bundle" => {
            if !cfg!(target_os = "macos") {
                return Err("Opening an app bundle is only supported on macOS.".to_string());
            }
            validate_app_name(&tool)?;
            Command::new("open")
                .arg("-a")
                .arg(&tool)
                .arg(&working_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to open {tool}: {e}"))?;
            Ok(())
        }
        "terminal" => {
            if !cfg!(target_os = "macos") {
                return Err("Opening a tool in Terminal is only supported on macOS.".to_string());
            }
            validate_tool_name(&tool)?;
            let bin =
                find_executable(&tool).ok_or_else(|| format!("Tool not found on PATH: {tool}"))?;
            let bin_str = bin.to_string_lossy().to_string();
            let shell_cmd = format!(
                "cd {} && {}",
                shell_single_quote(&working_dir),
                shell_single_quote(&bin_str)
            );
            let script = format!(
                "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
                applescript_escape(&shell_cmd)
            );
            Command::new("osascript")
                .arg("-e")
                .arg(script)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to open Terminal: {e}"))?;
            Ok(())
        }
        other => Err(format!("Unknown launch mode: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_ide_tools_reports_every_known_editor() {
        let tools = agent_detect_ide_tools();
        assert_eq!(tools.len(), IDE_TOOLS.len());
        for tool in &tools {
            assert_eq!(tool.kind, "ide");
            // Availability agrees with whether a path was resolved…
            assert_eq!(tool.available, tool.path.is_some());
            // …and with the launch strategy.
            assert_eq!(tool.available, tool.launch != "none");
            assert!(!tool.binary.is_empty());
            // Bundle launches must carry the app name; path launches must not.
            match tool.launch.as_str() {
                "bundle" => assert!(tool.app_name.is_some()),
                _ => assert!(tool.app_name.is_none()),
            }
        }
        assert!(tools.iter().any(|t| t.id == "vscode"));
    }

    #[test]
    fn resolve_app_bundle_finds_dot_app() {
        let base = std::env::temp_dir().join(format!("lt-ide-{}", std::process::id()));
        let apps_dir = base.join("Applications");
        std::fs::create_dir_all(apps_dir.join("Foo.app")).unwrap();

        let found = resolve_app_bundle(&["Foo"], std::slice::from_ref(&apps_dir));
        assert!(found.is_some());
        let (name, path) = found.unwrap();
        assert_eq!(name, "Foo");
        assert!(path.ends_with("Foo.app"));

        assert!(resolve_app_bundle(&["Missing"], std::slice::from_ref(&apps_dir)).is_none());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_app_name_allows_spaces_but_blocks_footguns() {
        assert!(validate_app_name("Visual Studio Code").is_ok());
        assert!(validate_app_name("IntelliJ IDEA CE").is_ok());
        assert!(validate_app_name("").is_err());
        assert!(validate_app_name("-app").is_err());
        assert!(validate_app_name("../../Foo").is_err());
        assert!(validate_app_name("App/../evil").is_err());
    }

    #[test]
    fn validate_tool_name_accepts_plain_binaries() {
        assert!(validate_tool_name("code").is_ok());
        assert!(validate_tool_name("cursor-agent").is_ok());
        assert!(validate_tool_name("code_insiders.1").is_ok());
    }

    #[test]
    fn validate_tool_name_rejects_shell_smuggling() {
        assert!(validate_tool_name("").is_err());
        assert!(validate_tool_name("-rf").is_err());
        assert!(validate_tool_name("code; rm -rf /").is_err());
        assert!(validate_tool_name("/usr/bin/code").is_err());
        assert!(validate_tool_name("code && echo hi").is_err());
    }

    #[test]
    fn rejects_unknown_mode() {
        let err = assemble_command(
            "rm-rf",
            "hi",
            "/tmp",
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
        );
        assert!(err.is_err());
    }

    fn advisor_profiles_map(parsed: &serde_yaml::Value) -> &serde_yaml::Mapping {
        parsed
            .get("integrations")
            .and_then(|v| v.get("cli_agents"))
            .and_then(|v| v.get("profiles"))
            .and_then(|v| v.as_mapping())
            .expect("integrations.cli_agents.profiles map")
    }

    #[test]
    fn e2e_args_include_profile_when_advisor_set() {
        if resolve_dev_cli().is_none() {
            // Still cover the merge path without a local `dev` binary.
            let dir = tempfile::tempdir().unwrap();
            ensure_liquitask_advisor_profile(dir.path(), "opus", Some("sonnet")).unwrap();
            let raw = std::fs::read_to_string(dir.path().join(".devcouncil/config.yaml")).unwrap();
            let parsed: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
            let profiles = advisor_profiles_map(&parsed);
            let profile = profiles
                .get(serde_yaml::Value::String("liquitask-advisor".into()))
                .and_then(|v| v.as_mapping())
                .expect("advisor profile");
            assert_eq!(
                profile
                    .get(serde_yaml::Value::String("advisor_model".into()))
                    .and_then(|v| v.as_str()),
                Some("opus")
            );
            assert!(!profile.contains_key(serde_yaml::Value::String("extra_args".into())));
            return;
        }

        let dir = tempfile::tempdir().unwrap();
        // Seed an unrelated profile so merge stays additive.
        let config_dir = dir.path().join(".devcouncil");
        std::fs::create_dir_all(&config_dir).unwrap();
        std::fs::write(
            config_dir.join("config.yaml"),
            "integrations:\n  cli_agents:\n    profiles:\n      keep-me:\n        description: preserved\n",
        )
        .unwrap();

        let advisor = Some("opus".to_string());
        let model = Some("sonnet".to_string());
        let assembled = assemble_command(
            "devcouncil-e2e",
            "ship it",
            &dir.path().to_string_lossy(),
            &model,
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &advisor,
        )
        .expect("assemble e2e");

        let args = assembled.args;
        assert!(args.windows(2).any(|w| w == ["--profile", "liquitask-advisor"]));
        assert!(args.contains(&"--executor".to_string()));
        assert!(args.contains(&"claude".to_string()));

        let raw = std::fs::read_to_string(config_dir.join("config.yaml")).unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let profiles = advisor_profiles_map(&parsed);
        assert!(
            profiles.contains_key(serde_yaml::Value::String("keep-me".into())),
            "existing profile must survive merge"
        );
        let profile = profiles
            .get(serde_yaml::Value::String("liquitask-advisor".into()))
            .and_then(|v| v.as_mapping())
            .expect("advisor profile");
        assert_eq!(
            profile
                .get(serde_yaml::Value::String("advisor_model".into()))
                .and_then(|v| v.as_str()),
            Some("opus")
        );
        assert_eq!(
            profile
                .get(serde_yaml::Value::String("model".into()))
                .and_then(|v| v.as_str()),
            Some("sonnet")
        );
        assert!(!profile.contains_key(serde_yaml::Value::String("extra_args".into())));
        // Must not write the old root-level nest DevCouncil ignores.
        assert!(parsed.get("cli_agents").is_none());
    }

    #[test]
    fn e2e_args_omit_profile_when_advisor_unset() {
        if resolve_dev_cli().is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let assembled = assemble_command(
            "devcouncil-e2e",
            "ship it",
            &dir.path().to_string_lossy(),
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
        )
        .expect("assemble e2e");
        assert!(!assembled.args.iter().any(|a| a == "--profile"));
        assert!(!dir.path().join(".devcouncil/config.yaml").exists());
    }

    #[test]
    fn advisor_profile_merge_is_additive() {
        let dir = tempfile::tempdir().unwrap();
        ensure_liquitask_advisor_profile(dir.path(), "opus", Some("sonnet")).unwrap();
        ensure_liquitask_advisor_profile(dir.path(), "fable", Some("haiku")).unwrap();

        let raw = std::fs::read_to_string(dir.path().join(".devcouncil/config.yaml")).unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&raw).unwrap();
        let profiles = advisor_profiles_map(&parsed);
        assert_eq!(profiles.len(), 1);
        let profile = profiles
            .get(serde_yaml::Value::String("liquitask-advisor".into()))
            .and_then(|v| v.as_mapping())
            .expect("advisor profile");
        assert_eq!(
            profile
                .get(serde_yaml::Value::String("advisor_model".into()))
                .and_then(|v| v.as_str()),
            Some("fable")
        );
        assert_eq!(
            profile
                .get(serde_yaml::Value::String("model".into()))
                .and_then(|v| v.as_str()),
            Some("haiku")
        );
        assert!(!profile.contains_key(serde_yaml::Value::String("extra_args".into())));
        assert!(parsed.get("cli_agents").is_none());
    }

    #[test]
    fn control_target_prefers_pgid() {
        let tracked = TrackedRun {
            pid: 100,
            pgid: 200,
            child: None,
            signals: None,
            sandbox_profile_dir: None,
        };
        assert_eq!(control_target(&tracked), 200);
    }

    #[test]
    fn control_target_falls_back_to_pid() {
        let tracked = TrackedRun {
            pid: 100,
            pgid: 0,
            child: None,
            signals: None,
            sandbox_profile_dir: None,
        };
        assert_eq!(control_target(&tracked), 100);
    }
}
