//! Thin `#[tauri::command]` wrappers over `liquitask_core::recurring`.
//!
//! Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
//! the existing `workspace_read_file` command), so the renderer calls:
//!   invoke("recurring_next_occurrence", { config, fromMs })
//!   invoke("recurring_advance",         { config, nowMs })

use liquitask_core::model::RecurringConfig;
use liquitask_core::recurring::{self, RecurringAdvance};

/// Next occurrence (epoch millis) for a recurrence config, from `from_ms`.
#[tauri::command]
pub fn recurring_next_occurrence(config: RecurringConfig, from_ms: i64) -> i64 {
    recurring::next_occurrence(&config, from_ms)
}

/// Next occurrence plus end-date disabling, mirroring the TS update payload.
#[tauri::command]
pub fn recurring_advance(config: RecurringConfig, now_ms: i64) -> RecurringAdvance {
    recurring::advance(&config, now_ms)
}
