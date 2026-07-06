//! Structured app-data helpers on top of the KV storage file.

use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::{read_storage, storage_path, write_storage, StorageGuard};
use tauri::State;

const APP_DATA_KEY: &str = "appData";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataBlobResponse {
    pub data: Value,
    pub version: Option<String>,
}

/// Load the consolidated app data blob from native storage.
#[tauri::command(rename_all = "camelCase")]
pub fn app_data_load(app: AppHandle) -> Result<AppDataBlobResponse, String> {
    let map = read_storage(&app)?;
    let data = map.get(APP_DATA_KEY).cloned().unwrap_or(Value::Null);
    let version = data
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(AppDataBlobResponse { data, version })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataSaveRequest {
    pub data: Value,
}

/// Persist the consolidated app data blob atomically.
#[tauri::command(rename_all = "camelCase")]
pub fn app_data_save(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
    request: AppDataSaveRequest,
) -> Result<(), String> {
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let mut map = read_storage(&app)?;
    map.insert(APP_DATA_KEY.to_string(), request.data);
    write_storage(&app, &map)
}

/// Return on-disk storage file path (for diagnostics/export).
#[tauri::command(rename_all = "camelCase")]
pub fn app_data_storage_path(app: AppHandle) -> Result<String, String> {
    Ok(storage_path(&app)?.to_string_lossy().to_string())
}

/// Merge a partial patch into the stored app data object.
#[tauri::command(rename_all = "camelCase")]
pub fn app_data_patch(
    app: AppHandle,
    guard: State<'_, StorageGuard>,
    patch: Map<String, Value>,
) -> Result<Value, String> {
    let _lock = guard.0.lock().map_err(|_| "Storage lock poisoned".to_string())?;
    let mut map = read_storage(&app)?;
    let mut data = map
        .get(APP_DATA_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (key, value) in patch {
        data.insert(key, value);
    }
    let merged = Value::Object(data.clone());
    map.insert(APP_DATA_KEY.to_string(), merged.clone());
    write_storage(&app, &map)?;
    Ok(merged)
}
