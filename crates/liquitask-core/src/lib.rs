//! # liquitask-core
//!
//! Pure, framework-free business logic for LiquiTask, ported from the
//! TypeScript services in `src/services/`. This crate has **no** dependency on
//! Tauri, the filesystem, the network, or the system clock, which makes every
//! function here trivially unit-testable and buildable on any platform.
//!
//! ## Conventions
//! * All time crosses the boundary as **epoch milliseconds** (`i64`). Callers
//!   (the TS bridge or the Tauri command layer) convert `Date <-> number`.
//! * Functions are deterministic: any "now" is passed in explicitly.
//! * Types mirror `types.ts` (see [`model`]).
//!
//! The thin `#[tauri::command]` wrappers that expose these functions to the
//! renderer live in `src-tauri/src/logic/*.rs`, not here.

pub mod dateutil;
pub mod model;

// One module per migrated service. Each is a faithful port of the deterministic
// core of the matching `src/services/*.ts` file.
pub mod recurring;
pub mod risk;
pub mod time_reporting;
pub mod cleanup;
pub mod automation;
pub mod auto_organize;

// Convenient re-exports for the Tauri wrapper crate.
pub use model::{RecurringConfig, Subtask, Task, TaskLink};
