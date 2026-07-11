//! macOS sleep prevention while agent runs are active (`caffeinate -i`).

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static CAFFEINATE: Mutex<Option<Child>> = Mutex::new(None);

#[tauri::command(rename_all = "camelCase")]
pub fn sleep_prevention_set_active(active: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut guard = CAFFEINATE
            .lock()
            .map_err(|e| format!("sleep guard lock poisoned: {e}"))?;
        if active {
            if guard.is_some() {
                return Ok(());
            }
            let child = Command::new("caffeinate")
                .arg("-i")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to start caffeinate: {e}"))?;
            *guard = Some(child);
            return Ok(());
        }
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = active;
        Ok(())
    }
}
