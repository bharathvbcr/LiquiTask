//! In-app terminal (PTY-backed shell sessions).
//!
//! Powers the bottom terminal drawer: the renderer opens a session, writes
//! keystrokes, and receives raw output as Tauri events. Unlike the agent
//! runner (which assembles commands itself), this is a real interactive shell
//! driven directly by the user — equivalent to them opening Terminal.app.
//!
//! Event contract (renderer listens):
//! * `terminal-output` — `{ id, data }` raw chunk (ANSI escapes included).
//! * `terminal-exit`   — `{ id, code? }` shell process ended.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
pub const TERMINAL_EXIT_EVENT: &str = "terminal-exit";

/// Cap on concurrently open sessions (defense against a runaway renderer loop).
const MAX_SESSIONS: usize = 8;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// Open PTY sessions keyed by terminal id.
#[derive(Default)]
pub struct TerminalRegistry(Mutex<HashMap<String, TerminalSession>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<u32>,
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}

fn next_terminal_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("term-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Open a new PTY shell session. Returns the terminal id.
#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    registry: State<TerminalRegistry>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<String, String> {
    {
        let sessions = registry.0.lock().map_err(|e| e.to_string())?;
        if sessions.len() >= MAX_SESSIONS {
            return Err(format!("Too many open terminals (max {MAX_SESSIONS})"));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.env("TERM", "xterm-256color");
    // Distinguish LiquiTask's embedded shell for user rc-file customisation.
    cmd.env("LIQUITASK_TERMINAL", "1");
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        cmd.cwd(dir);
    } else if let Some(home) = dirs_home() {
        cmd.cwd(home);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;
    // The slave fd stays open in `pair.slave`; drop it so EOF propagates when
    // the shell exits.
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer failed: {e}"))?;

    let id = next_terminal_id();

    // Output pump: raw PTY bytes -> `terminal-output` events.
    let out_app = app.clone();
    let out_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = out_app.emit(
                        TERMINAL_OUTPUT_EVENT,
                        TerminalOutputPayload {
                            id: out_id.clone(),
                            data: String::from_utf8_lossy(&buf[..n]).into_owned(),
                        },
                    );
                }
            }
        }
    });

    // Reaper: waits for shell exit, emits `terminal-exit`, cleans the registry.
    let exit_app = app.clone();
    let exit_id = id.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        if let Some(reg) = exit_app.try_state::<TerminalRegistry>() {
            if let Ok(mut sessions) = reg.0.lock() {
                sessions.remove(&exit_id);
            }
        }
        let _ = exit_app.emit(TERMINAL_EXIT_EVENT, TerminalExitPayload { id: exit_id, code });
    });

    registry.0.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            killer,
        },
    );

    Ok(id)
}

/// Write user input (keystrokes / pasted text) to a session.
#[tauri::command]
pub fn terminal_write(
    registry: State<TerminalRegistry>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = registry.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal {id} not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Resize a session's PTY to match the renderer's grid.
#[tauri::command]
pub fn terminal_resize(
    registry: State<TerminalRegistry>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = registry.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("terminal {id} not found"))?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Kill a session's shell and forget it. The reaper thread emits
/// `terminal-exit` once the process is gone.
#[tauri::command]
pub fn terminal_close(registry: State<TerminalRegistry>, id: String) -> Result<(), String> {
    let mut sessions = registry.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut session) = sessions.remove(&id) {
        let _ = session.killer.kill();
    }
    Ok(())
}

fn dirs_home() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(std::path::PathBuf::from)
    }
}
