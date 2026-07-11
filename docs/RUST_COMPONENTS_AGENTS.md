# Agent Guide — Building New Rust Components

Use this doc when porting deterministic logic from TypeScript into Rust or adding
new pure logic to `liquitask-core`. It complements `docs/RUST_MIGRATION.md`
(history of the first six services) with a **repeatable checklist** for new
components.

**Do not use this for UI.** React components stay in `src/components/`. This path
is for **framework-free business logic** that can run in the Tauri backend and
be called from the renderer via `callNative`.

---

## When to add a Rust component

| Move to Rust | Keep in TypeScript |
|---|---|
| Pure date math, scoring, aggregation, string heuristics | React UI, hooks, modals, DnD |
| Deterministic reducers (automation actions, tag remap) | AI / LLM calls and merge logic (gated by `aiFeatures.ts`) | Gated by `src/utils/aiFeatures.ts` in TS orchestration |
| Board guards, event replay, query evaluation (planned) | IndexedDB / file I/O orchestration |
| Logic shared by desktop backend **and** renderer | Non-deterministic ids (`Date.now`, `Math.random`) |
| Hot paths used by agent runs or DevCouncil | Web/PWA fallback implementations |

**Rule of thumb:** if a function can be tested with fixed inputs and no mocks, it
belongs in `liquitask-core`. If it needs `fetch`, React, timers, or a model API,
keep the orchestration in TS and call Rust for the deterministic slice.

---

## Architecture (three layers)

```
src/services/*.ts          Renderer: I/O, AI, React callbacks
        │ callNative(command, args, jsFallback)
        ▼
src-tauri/src/logic/*.rs   Thin #[tauri::command] wrappers (serde boundary)
        │
        ▼
crates/liquitask-core/     Pure functions + unit tests (no Tauri, no I/O)
```

Supporting seams:

| File | Role |
|---|---|
| `src/runtime/runtimeEnvironment.ts` | `callNative` — Tauri invoke with JS fallback |
| `src/runtime/coreDto.ts` | `Date` → epoch-ms DTOs before `invoke` |
| `src/services/nativeBridge.ts` | Optional typed `invoke` helpers |
| `crates/liquitask-core/src/model.rs` | Shared `Task`, `RecurringConfig`, … |
| `crates/liquitask-core/src/dateutil.rs` | UTC civil-date math (no `chrono`) |
| `scripts/rust-migration-oracle/` | Differential TS-vs-Rust correctness gate |
| `scripts/verify-migration.sh` | One-shot verify script |

Read `.claude/skills/generated/logic/SKILL.md` and `.claude/skills/generated/runtime/SKILL.md`
before editing wrappers or bridge code.

---

## Checklist — new component

Replace `{name}` with snake_case (e.g. `board_transition`, `query_eval`).

### 1. Core module (`crates/liquitask-core/src/{name}.rs`)

- [ ] Add `//! Port of src/services/{name}Service.ts` (or `src/core/...`) at top.
- [ ] Export pure functions only — no `std::fs`, no `std::time::SystemTime`, no network.
- [ ] Pass `now_ms: i64` for any clock dependency; never read the system clock.
- [ ] Mirror JS semantics exactly (truthiness, `undefined` → `Option`, month overflow).
- [ ] Use `#[serde(rename_all = "camelCase")]` on return structs the renderer consumes.
- [ ] Reuse `model::Task` / add fields to `model.rs` if the TS type is shared.
- [ ] Add `#[cfg(test)]` module with hand-picked edge cases.
- [ ] Register `pub mod {name};` in `crates/liquitask-core/src/lib.rs`.

### 2. Tauri wrapper (`src-tauri/src/logic/{name}.rs`)

- [ ] One `#[tauri::command]` per exported operation.
- [ ] Command names: `{prefix}_{verb}` in snake_case (e.g. `board_validate_transition`).
- [ ] Document the JS `invoke` shape in the module doc comment (camelCase args).
- [ ] Delegate to `liquitask_core::{name}::...` — no business logic here.
- [ ] Add wrapper round-trip test if serialization is non-trivial.
- [ ] Register `pub mod {name};` in `src-tauri/src/logic/mod.rs`.

### 3. Tauri registration (`src-tauri/src/main.rs`)

- [ ] `use logic::{name}::{command_a, command_b};`
- [ ] Add commands to `tauri::generate_handler![ ... ]`.
- [ ] Mark block with `// --- liquitask-core migration: {name} ---` if co-managed.

### 4. TypeScript bridge

- [ ] Keep the **original JS implementation** as the web/fallback path.
- [ ] Route desktop calls through `callNative` in the owning service:

```typescript
import { callNative } from "../runtime/runtimeEnvironment";
import { toCoreTask } from "../runtime/coreDto";

const result = await callNative<MyResult>(
  "my_command",
  { task: toCoreTask(task), nowMs: Date.now() },
  () => jsFallbackImplementation(task),
);
```

- [ ] Convert dates with `dateToMs` / `msToDate` from `coreDto.ts` at the boundary.
- [ ] Add typed helpers to `nativeBridge.ts` only when multiple call sites need them.
- [ ] For formerly sync APIs, add async `…Native` variants; flip callers incrementally.

### 5. Validation

- [ ] Oracle module: `scripts/rust-migration-oracle/services/{name}.cjs`
  - `reference(...args)` — stripped original TS logic
  - `port(...args)` — JS mirror of the Rust port
  - `cases()` + `fuzz(rng)` — thousands of inputs, stable JSON compare
- [ ] `cargo test --manifest-path crates/liquitask-core/Cargo.toml`
- [ ] Extend `scripts/verify-migration.sh` vitest list if new service tests exist
- [ ] Run: `bash scripts/verify-migration.sh`

### 6. Documentation

- [ ] Row in `docs/RUST_MIGRATION.md` “What moved” table
- [ ] Note what **stayed in TS** (honest split)

---

## Conventions

### Time and determinism

- All dates cross as **`i64` epoch milliseconds** (UTC civil math in `dateutil.rs`).
- Generate random ids and read `Date.now()` in TS **after** the Rust call returns.
- Tauri converts camelCase JS keys → snake_case Rust params automatically.

### Serde / DTO lenience

- `model.rs` uses lenient string deserializers — match `src/utils/coerce.ts` behavior.
- Prefer `#[serde(default)]` on struct fields so partial payloads deserialize.
- Return `Option<T>` where TS returns `undefined`.

### Naming

| Layer | Pattern | Example |
|---|---|---|
| Core fn | `snake_case` | `next_occurrence` |
| Tauri command | `{service}_{verb}` | `recurring_next_occurrence` |
| Core file | `{topic}.rs` | `recurring.rs` |
| TS fallback | existing method name | `calculateNextOccurrence` |

### Sync vs async

Tauri `invoke` is always async. Preserve sync signatures for web parity; add
`…Native` async variants for desktop call sites that should await Rust.

---

## Reference implementations

Copy structure from these completed ports:

| Component | Core | Wrapper | TS service |
|---|---|---|---|
| Recurrence | `crates/liquitask-core/src/recurring.rs` | `src-tauri/src/logic/recurring.rs` | `src/services/recurringTaskService.ts` |
| Automation reducer | `crates/liquitask-core/src/automation.rs` | `src-tauri/src/logic/automation.rs` | `src/services/automationService.ts` |
| Cleanup heuristics | `crates/liquitask-core/src/cleanup.rs` | `src-tauri/src/logic/cleanup.rs` | `src/services/taskCleanupService.ts` |

Partial port (deterministic slice only):

- `autoOrganizeService.ts` — only filter/dedup/tag remap moved; AI orchestration stays in TS.

---

## Planned high-value ports

Prioritize pure modules with no React coupling:

1. `src/core/board/boardStateMachine.ts` → `board.rs`
2. `src/core/events/taskEventReducer.ts` → `events.rs`
3. Query engine (used by automation conditions) → `query.rs`
4. `src/services/agents/agentStreamParser.ts` (partial — parsing only; UI stays TS)

Trace impact with GitNexus before moving board/event logic — many hooks and MCP
tools depend on identical verdict shapes.

---

## Out of scope for this guide

| Area | Location | Notes |
|---|---|---|
| Agent runtime spawn | `liquitask-agentd/` (Go) | Sidecar; do not fold into core without a dedicated rewrite plan |
| DevCouncil / agentd bridges | `src-tauri/src/agent_*.rs` | Backend I/O; different pattern from `liquitask-core` |
| Semantic search | `semantic_layer/` (Python) | Optional sidecar |
| React UI | `src/components/`, `src/views/` | Never port to Rust in this stack |
| AI features gate | `src/utils/aiFeatures.ts` | User preference; TS services call `assertAiFeaturesEnabled` before LLM entry points |

---

## Verify before opening a PR

```bash
# Correctness (no Rust toolchain required for oracle)
node scripts/rust-migration-oracle/run.cjs

# Core unit tests
cargo test --manifest-path crates/liquitask-core/Cargo.toml

# Full gate
bash scripts/verify-migration.sh
```

Expected oracle output: **0 mismatches** across all `services/*.cjs` modules.

---

## Agent workflow summary

1. Read the TS source and list **pure** vs **I/O** functions.
2. Port pure functions to `liquitask-core` with explicit `now_ms` parameters.
3. Add thin Tauri commands + `callNative` wiring with JS fallback retained.
4. Prove equivalence with the differential oracle + Rust unit tests.
5. Document the split (what moved vs what stayed in TS).

If ownership is unclear, use GitNexus `context` / `impact` on the TS entry symbol
before creating files.
