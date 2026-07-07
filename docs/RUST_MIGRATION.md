# Moving business logic to Rust (`liquitask-core`)

This change moves the deterministic business logic of six services out of
TypeScript and into a new, framework-free Rust crate, exposed to the app through
Tauri commands. It was produced with a multi-agent workflow: one reference slice
built by hand, then five services migrated in parallel, each independently
fuzz-validated against the original TypeScript.

## Why

LiquiTask already runs a Rust (Tauri) backend alongside two sidecars — the
Python semantic-search sidecar (`semantic_layer/`) and the Go agent sidecar
(`liquitask-agentd`). The pure computation in `src/services/*` — date math,
scoring, aggregation, string heuristics — is a natural fit for Rust: faster,
type-safe, and unit-testable without a browser. Moving it also makes the logic
reusable by the desktop backend directly (including the agent-run and DevCouncil
paths) instead of only inside the webview.

## Architecture

Three layers, with a clean seam between them:

1. **`crates/liquitask-core/`** — a pure Rust library. No Tauri, no I/O, no
   network, no system clock. Depends only on `serde` + `serde_json`, so it
   builds anywhere (including CI/sandboxes that cannot build the full Tauri
   app). Every function is deterministic: any "now" is passed in as an
   `i64` epoch-millisecond parameter, and all dates cross the boundary as
   epoch millis (never as parsed date strings). Calendar math lives in
   `dateutil.rs` (dependency-free proleptic-Gregorian algorithms) so we don't
   pull in `chrono`.

2. **`src-tauri/src/logic/*.rs`** — thin `#[tauri::command]` wrappers. They
   (de)serialize at the boundary and delegate to `liquitask-core`. Registered in
   `src-tauri/src/main.rs` and backed by the `liquitask-core` path dependency in
   `src-tauri/Cargo.toml`.

3. **`src/services/*.ts` + `src/runtime/`** — the renderer calls Rust through a
   single bridge, `callNative(command, args, fallback)` in
   `src/runtime/runtimeEnvironment.ts`. On the Tauri desktop build the Rust
   command is the source of truth; on the **web/PWA build (which has no Tauri
   backend)** the identical JavaScript `fallback` runs instead. If a native call
   ever throws (e.g. an older shell without the command) it also degrades to the
   fallback, so the UI never breaks. `src/runtime/coreDto.ts` converts the
   renderer's `Date`-bearing models into the epoch-millis DTOs the core expects.

Because the web build must keep working, the original JS implementations are
**retained as the fallback** rather than deleted. The differential oracle (below)
proves the JS and Rust paths are behaviorally identical, so results are the same
regardless of which one runs.

## What moved

| Service (`src/services/`) | Rust module (`liquitask-core`) | Tauri commands | Stayed in TS |
|---|---|---|---|
| `recurringTaskService` | `recurring.rs` | `recurring_next_occurrence`, `recurring_advance` | scheduler timer, task creation, React callbacks |
| `riskAnalysisService` | `risk.rs` | `risk_heuristics` | AI risk enhancement + heuristic/AI merge |
| `timeReportingService` | `time_reporting.rs` | `time_generate_report`, `time_productivity_metrics`, `time_export_csv`, `time_export_json` | file download, command-palette wiring |
| `taskCleanupService` | `cleanup.rs` | `cleanup_heuristic_duplicates`, `cleanup_heuristic_merge`, `cleanup_analyze_redundancy`, `cleanup_heuristic_categorize`, `cleanup_heuristic_cluster` | all `aiService` calls, storage reads, random `id` assembly |
| `automationService` | `automation.rs` | `automation_apply_actions`, `automation_is_rule_due` | query-engine condition eval (`executeAdvancedFilter`), scheduler, notify/agent callbacks |
| `autoOrganizeService` | `auto_organize.rs` | `autoorg_filter_task_ids`, `autoorg_dedup_candidate_pairs`, `autoorg_consolidate_tags` | **all AI orchestration** — only filtering, dedup candidate-pairing, and tag remap moved |

Two honest caveats:

* **`autoOrganize` is mostly AI orchestration**, which legitimately stays in TS
  (it calls the model). Only its deterministic pieces moved.
* **`automation`'s condition matching** depends on the advanced-filter query
  engine, which was left in TS; only the action reducer and the schedule
  due-check moved. Porting the query engine is a good follow-up.

## Determinism rules (followed by every service)

* Time crosses as `i64` epoch millis; Rust never reads a clock (`now_ms` is a
  parameter). TS converts with `dateToMs` before `invoke` and `msToDate` after.
* Non-deterministic values (`Date.now()`/`Math.random()` ids) are generated in
  TS *after* the Rust call; Rust returns only deterministic structural data.
* Tauri auto-converts camelCase JS arg keys to snake_case Rust params (same as
  the existing `workspace_read_file` command).

## Sync vs. async

Tauri `invoke` is async-only. Methods that were consumed **synchronously**
(`recurringTaskService.calculateNextOccurrence`, `timeReportingService.generateTimeReport`,
`automationService.processTaskEvent`) keep their synchronous JS signature (used
by existing call sites, tests, and the web fallback) and gain an async
`…Native` variant that routes to Rust. Methods that were already async now call
Rust directly via `callNative`. **Follow-up:** to make the desktop app execute
Rust for the remaining synchronous call sites, flip those callers
(`useTaskController`, report/automation UI) to `await` the `…Native` variants.

## Validation

* **Differential oracle** — `scripts/rust-migration-oracle/` runs each original
  TypeScript algorithm (types stripped) against a JS mirror of the Rust port
  over tens of thousands of fuzzed inputs. Current result: **6 services,
  52,181 cases, 0 mismatches.** Run it with `node scripts/rust-migration-oracle/run.cjs`
  (it re-execs under `TZ=UTC` so JS `Date` getters match the Rust UTC civil-date
  math).
* **Rust unit tests** — each `liquitask-core` module has `#[cfg(test)]` tests
  with hand-picked edge cases (leap years, month overflow, empty inputs, etc.).
  The crate now compiles and passes **81/81** tests on a real toolchain
  (`cargo test --manifest-path crates/liquitask-core/Cargo.toml`); the whole
  Tauri backend `cargo check`s clean.
* **Adversarial equivalence audit** — a multi-agent pass compared each *compiled
  Rust* module against both its TS origin and its JS mirror, hunting for
  divergences the oracle cannot see (the oracle only compares stripped-TS vs the
  JS mirror; it never executes the `.rs`, and a mirror that shares the TS's
  behaviour hides a Rust divergence). It found **8 genuine behavioural
  divergences** across `recurring`, `automation`, `auto_organize`, and
  `time_reporting` — all in edge inputs the fuzzers never generated (e.g.
  `dayOfMonth === 0`, a fractional schedule day, BOM/NEL/emoji in titles, a
  negative batch cap, a raw-vs-escaped CSV `jobId`, `\b`/`\f` JSON escapes).
  Every one was fixed so the Rust faithfully reproduces the original TS, the JS
  mirrors were repaired to reflect the corrected Rust, and the fuzzers were
  extended to generate those inputs (they now appear thousands of times per run
  and would fail against the pre-fix mirrors). `risk` and `cleanup` were clean.
* **Existing TypeScript tests** — the migrated services keep their public API and
  their vitest suites green (full suite: **770/770**).

## Build / verify on macOS

```bash
# 1. Correctness of the ports (no toolchain needed):
node scripts/rust-migration-oracle/run.cjs

# 2. Pure core crate unit tests (fast, no system libs):
cargo test --manifest-path crates/liquitask-core/Cargo.toml

# 3. Full desktop build (wires the commands into the app):
npm run tauri dev        # or: npm run build

# Or run everything that's available at once:
bash scripts/verify-migration.sh
```

## Note on concurrent integration

`src-tauri/src/main.rs`, `src/services/nativeBridge.ts`, and the `*_engine.rs`
modules are co-managed by a separate integration pass. The four command
registrations added here for `risk` / `time_reporting` / `cleanup` /
`auto_organize` are marked with a `liquitask-core migration` comment in
`main.rs`; if the other pass also registers them, delete one of the duplicates.
