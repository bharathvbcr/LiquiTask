//! Tauri command layer for logic ported into the `liquitask-core` crate.
//! Each submodule holds thin `#[tauri::command]` wrappers that (de)serialize at
//! the boundary and delegate to the pure `liquitask_core` functions.

pub mod recurring;
pub mod risk;
pub mod time_reporting;
pub mod cleanup;
pub mod automation;
pub mod auto_organize;
