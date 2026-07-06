//! Agent execution engine (Multica-inspired).
//!
//! Spawns coding-agent CLI processes (Claude Code, DevCouncil, apple/container)
//! on behalf of the renderer and streams their output back as Tauri events.
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
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agent_policy;
use crate::run_store;
use crate::{is_path_authorized, read_storage, safe_workspace_paths};

pub const AGENT_RUN_EVENT: &str = "agent-run-event";

/// User injected mid-run guidance via MCP `get_user_guidance`.
pub const AGENT_GUIDANCE_EVENT: &str = "agent-guidance-injected";

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
// Executable resolution
// ---------------------------------------------------------------------------

/// GUI apps on macOS inherit a minimal PATH, so augment it with the common
/// install locations for Homebrew, npm globals and per-user bins.
pub(crate) fn augmented_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    let extras = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
        format!("{home}/.claude/local"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/bin"),
    ];
    let mut parts: Vec<String> = base.split(':').map(str::to_string).collect();
    for extra in extras {
        if !extra.is_empty() && !parts.iter().any(|p| p == &extra) {
            parts.push(extra);
        }
    }
    parts.join(":")
}

pub(crate) fn find_executable(name: &str) -> Option<PathBuf> {
    for dir in augmented_path().split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Command assembly
// ---------------------------------------------------------------------------

const ALLOWED_PERMISSION_MODES: &[&str] = &["default", "plan", "acceptEdits", "bypassPermissions"];

fn validate_flag_value(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 200 || value.starts_with('-') {
        return Err(format!("Invalid {label}: {value}"));
    }
    Ok(())
}

fn validate_mcp_config_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.len() > 512 || path.starts_with('-') {
        return Err(format!("Invalid mcp config path: {path}"));
    }
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("MCP config path must be absolute".to_string());
    }
    Ok(())
}

struct AssembledCommand {
    program: PathBuf,
    args: Vec<String>,
}

fn append_permission_prompt(args: &mut Vec<String>, permission_prompt_tool: &Option<String>) -> Result<(), String> {
    if let Some(tool) = permission_prompt_tool {
        validate_flag_value("permission prompt tool", tool)?;
        args.push("--permission-prompt-tool".to_string());
        args.push(tool.clone());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn assemble_command(
    mode: &str,
    prompt: &str,
    working_dir: &str,
    model: &Option<String>,
    permission_mode: &Option<String>,
    max_turns: &Option<u32>,
    container_image: &Option<String>,
    session_id: &Option<String>,
    mcp_config_path: &Option<String>,
    permission_prompt_tool: &Option<String>,
) -> Result<AssembledCommand, String> {
    match mode {
        // Resume an existing Claude Code session with a follow-up prompt.
        "claude-resume" => {
            let program = find_executable("claude")
                .ok_or_else(|| "Claude Code CLI not found. Install it and try again.".to_string())?;
            let sid = session_id
                .as_ref()
                .ok_or_else(|| "session id required for claude-resume mode".to_string())?;
            validate_flag_value("session id", sid)?;
            let mut args = vec![
                "--resume".to_string(),
                sid.clone(),
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
            ];
            if let Some(m) = model {
                validate_flag_value("model", m)?;
                args.push("--model".to_string());
                args.push(m.clone());
            }
            if let Some(pm) = permission_mode {
                if !ALLOWED_PERMISSION_MODES.contains(&pm.as_str()) {
                    return Err(format!("Invalid permission mode: {pm}"));
                }
                args.push("--permission-mode".to_string());
                args.push(pm.clone());
            }
            if let Some(cfg) = mcp_config_path {
                validate_mcp_config_path(cfg)?;
                args.push("--mcp-config".to_string());
                args.push(cfg.clone());
            }
            append_permission_prompt(&mut args, permission_prompt_tool)?;
            Ok(AssembledCommand { program, args })
        }
        // Claude Code directly on the host, streaming NDJSON.
        "claude" => {
            let program = find_executable("claude")
                .ok_or_else(|| "Claude Code CLI not found. Install it and try again.".to_string())?;
            let mut args = vec![
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
            ];
            if let Some(m) = model {
                validate_flag_value("model", m)?;
                args.push("--model".to_string());
                args.push(m.clone());
            }
            if let Some(pm) = permission_mode {
                if !ALLOWED_PERMISSION_MODES.contains(&pm.as_str()) {
                    return Err(format!("Invalid permission mode: {pm}"));
                }
                args.push("--permission-mode".to_string());
                args.push(pm.clone());
            }
            if let Some(turns) = max_turns {
                args.push("--max-turns".to_string());
                args.push(turns.to_string());
            }
            if let Some(sid) = session_id {
                validate_flag_value("session id", sid)?;
                args.push("--session-id".to_string());
                args.push(sid.clone());
            }
            if let Some(cfg) = mcp_config_path {
                validate_mcp_config_path(cfg)?;
                args.push("--mcp-config".to_string());
                args.push(cfg.clone());
            }
            append_permission_prompt(&mut args, permission_prompt_tool)?;
            Ok(AssembledCommand { program, args })
        }
        // Claude Code inside an apple/container Linux VM (opt-in sandbox).
        "claude-container" => {
            let program = find_executable("container").ok_or_else(|| {
                "apple/container CLI not found. Requires macOS 26 on Apple silicon.".to_string()
            })?;
            let image = container_image
                .clone()
                .unwrap_or_else(|| "liquitask-agent:latest".to_string());
            validate_flag_value("container image", &image)?;
            let mut args = vec![
                "run".to_string(),
                "--rm".to_string(),
                "--volume".to_string(),
                format!("{working_dir}:/work"),
                "--workdir".to_string(),
                "/work".to_string(),
            ];
            if std::env::var("ANTHROPIC_API_KEY").is_ok() {
                args.push("--env".to_string());
                args.push("ANTHROPIC_API_KEY".to_string());
            }
            args.push(image);
            args.extend([
                "claude".to_string(),
                "-p".to_string(),
                prompt.to_string(),
                "--output-format".to_string(),
                "stream-json".to_string(),
                "--verbose".to_string(),
                // The VM is the sandbox; skip interactive permission prompts.
                "--dangerously-skip-permissions".to_string(),
            ]);
            Ok(AssembledCommand { program, args })
        }
        // DevCouncil deterministic verification gate (`dev check --verify --json`).
        "devcouncil-verify" => {
            let program = find_executable("dev")
                .or_else(|| find_executable("devcouncil"))
                .ok_or_else(|| "DevCouncil CLI (`dev`) not found on PATH.".to_string())?;
            Ok(AssembledCommand {
                program,
                args: vec![
                    "check".to_string(),
                    "--verify".to_string(),
                    "--json".to_string(),
                ],
            })
        }
        // Full DevCouncil pipeline: council planning + Claude Code execution + gates.
        "devcouncil-e2e" => {
            let program = find_executable("dev")
                .or_else(|| find_executable("devcouncil"))
                .ok_or_else(|| "DevCouncil CLI (`dev`) not found on PATH.".to_string())?;
            Ok(AssembledCommand {
                program,
                args: vec![
                    "e2e".to_string(),
                    prompt.to_string(),
                    "--executor".to_string(),
                    "claude".to_string(),
                    "--json".to_string(),
                ],
            })
        }
        other => Err(format!("Unknown agent run mode: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command(rename_all = "camelCase")]
pub fn agent_detect_clis() -> Vec<AgentCliStatus> {
    ["claude", "dev", "container"]
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
    daily_cost_cap_usd: Option<f64>,
    max_runs_per_day: Option<u32>,
    today_spend_usd: Option<f64>,
    today_run_count: Option<u32>,
    model_routing: Option<String>,
    task_priority: Option<String>,
    task_time_estimate_min: Option<u32>,
    profile_model: Option<String>,
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
    )?;

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
    track_and_stream(app, registry, run_id, mode, cwd, child, paths)
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

    track_and_stream(app, registry, run_id, mode, cwd, child, paths)
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
            TrackedRun { pid, pgid: 0, child: Some(child), signals: Some(signals) },
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
                            Ok(Some(status)) => Some(status.code().unwrap_or(-1)),
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
        "cancelled"
    } else {
        match code {
            Some(0) => "completed",
            Some(_) => "failed",
            // Re-adopted run (no waited code): trust the log's result line.
            None => rec.status.as_str(),
        }
    };
    let _ = run_store::finalize(app, run_id, status, code, rec.session_id);
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
        if is_pid_alive(pid) {
            let pgid = meta.pgid.unwrap_or(pid);
            let Ok(paths) = run_store::run_paths(app, &run_id) else {
                continue;
            };
            let signals = Arc::new(RunSignals::default());
            {
                if let Ok(mut guard) = registry.0.lock() {
                    guard.insert(
                        run_id.clone(),
                        TrackedRun { pid, pgid, child: None, signals: Some(signals.clone()) },
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
            // Finished while the app was away — reconcile from the durable log.
            let rec = run_store::reconcile_from_stdout(app, &run_id);
            let _ = run_store::finalize(app, &run_id, &rec.status, meta.exit_code, rec.session_id.clone());
            out.push(RunReattachInfo {
                run_id: run_id.clone(),
                alive: false,
                status: rec.status,
                session_id: rec.session_id,
                summary: rec.summary,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentGuidancePayload {
    pub run_id: String,
    pub message: String,
}

#[tauri::command(rename_all = "camelCase")]
pub fn agent_runner_pause(
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
pub fn agent_runner_resume(
    app: AppHandle,
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
) -> Result<bool, String> {
    do_resume(&app, &registry, &run_id)?;
    Ok(true)
}

/// Queue mid-run user guidance for Claude Code to fetch via MCP `get_user_guidance`.
/// Optionally auto-resumes a paused run so the agent can act on the message.
#[tauri::command(rename_all = "camelCase")]
pub fn agent_runner_inject_guidance(
    app: AppHandle,
    registry: State<'_, AgentProcessRegistry>,
    run_id: String,
    message: String,
    resume_if_paused: Option<bool>,
) -> Result<bool, String> {
    {
        let guard = registry.0.lock().map_err(|_| "Registry lock poisoned".to_string())?;
        if !guard.contains_key(&run_id) {
            return Err(format!("Run {run_id} is not active"));
        }
    }

    crate::agent_mcp::append_guidance(&run_id, &message)?;

    let _ = app.emit(
        AGENT_GUIDANCE_EVENT,
        AgentGuidancePayload {
            run_id: run_id.clone(),
            message: message.trim().to_string(),
        },
    );

    if resume_if_paused.unwrap_or(true) {
        let paused = registry
            .0
            .lock()
            .ok()
            .and_then(|g| g.get(&run_id).and_then(|t| t.signals.clone()))
            .is_some_and(|s| s.paused.load(Ordering::Acquire));
        if paused {
            let _ = do_resume(&app, &registry, &run_id);
        }
    }
    Ok(true)
}

/// Reattach to durable runs on relaunch (Runtime v2 headless runs). Returns one
/// entry per previously-active run: alive ones keep streaming; finished-while-
/// away ones are reconciled from their durable log.
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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn augmented_path_includes_homebrew() {
        assert!(augmented_path().contains("/opt/homebrew/bin"));
    }

    #[test]
    fn rejects_unknown_mode() {
        let err = assemble_command("rm-rf", "hi", "/tmp", &None, &None, &None, &None, &None, &None, &None);
        assert!(err.is_err());
    }

    #[test]
    fn adds_permission_prompt_tool_flag() {
        if find_executable("claude").is_none() {
            return;
        }
        let cmd = assemble_command(
            "claude",
            "hi",
            "/tmp",
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
            &Some("mcp__liquitask__permission_prompt".to_string()),
        )
        .expect("assemble");
        assert!(cmd.args.contains(&"--permission-prompt-tool".to_string()));
        assert!(cmd
            .args
            .contains(&"mcp__liquitask__permission_prompt".to_string()));
    }

    #[test]
    fn rejects_flag_injection_in_model() {
        let err = assemble_command(
            "claude",
            "hi",
            "/tmp",
            &Some("--dangerously-skip-permissions".to_string()),
            &None,
            &None,
            &None,
            &None,
            &None,
            &None,
        );
        // Either claude is missing (Err) or the model flag is rejected (Err) —
        // both must fail; a flag-shaped model can never produce Ok.
        assert!(err.is_err());
    }

    #[test]
    fn rejects_invalid_permission_mode() {
        if find_executable("claude").is_some() {
            let err = assemble_command(
                "claude",
                "hi",
                "/tmp",
                &None,
                &Some("yolo".to_string()),
                &None,
                &None,
                &None,
                &None,
                &None,
            );
            assert!(err.is_err());
        }
    }

    #[test]
    fn control_target_prefers_pgid() {
        let tracked = TrackedRun {
            pid: 100,
            pgid: 200,
            child: None,
            signals: None,
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
        };
        assert_eq!(control_target(&tracked), 100);
    }
}
