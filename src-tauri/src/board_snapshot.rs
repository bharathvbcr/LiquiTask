//! Board snapshot export for the liquitask CLI (Refactor 6).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSnapshot {
    pub exported_at: String,
    pub tasks: serde_json::Value,
    pub columns: serde_json::Value,
    pub agents: serde_json::Value,
}

fn snapshot_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Unable to resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join(".liquitask").join("board-snapshot.json"))
}

/// Write the board snapshot JSON consumed by `liquitask board` CLI commands.
#[tauri::command(rename_all = "camelCase")]
pub fn board_export_snapshot(
    _app: AppHandle,
    snapshot: BoardSnapshot,
) -> Result<String, String> {
    let path = snapshot_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create snapshot dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("Failed to encode board snapshot: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write board snapshot: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}
