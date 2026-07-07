# liquitask-agentd

`liquitask-agentd` is LiquiTask's **local agent-execution sidecar**: a standalone
Go binary that drives 14 coding-agent runtimes (Claude Code, Codex, Cursor,
Antigravity, …) on the user's machine. It is shipped as a
[Tauri sidecar](https://v2.tauri.app/develop/sidecar/) and speaks
newline-delimited **JSON-RPC 2.0 over stdio** to the LiquiTask Rust core
(`src-tauri/src/agentd.rs`).

It is ported from Multica's battle-tested `server/pkg/agent` and daemon, with the
cloud coupling (auth, WebSockets, billing, workspace registration, cloud
runtimes) stripped out. See [`../docs/THIRD_PARTY.md`](../docs/THIRD_PARTY.md) for
attribution and [`../docs/AGENT_TEAMMATES.md`](../docs/AGENT_TEAMMATES.md) for how
runs flow through the app.

> **Status:** Phase 1 of the v3 rework (`docs/REWORK_PLAN_MULTICA.md`). Enabled by
> default via `AGENTD_SIDECAR_ENABLED`; the Rust `agent_runner.rs` path remains as
> the Claude fallback during migration.

## What it does

- **Detects** installed agent CLIs and their versions (drives `Settings → Agents`
  health).
- **Runs** a task on a chosen runtime: spawn, JSON-stream parsing, resume
  sessions, MCP config injection, per-agent thinking levels, and per-OS
  invocation quirks.
- **Controls** live runs: cancel, pause, resume, and mid-run guidance injection.
- **Survives restarts**: reattaches orphaned runs and reconciles their outcomes.
- **Prepares execution environments** per run (`execenv`): Codex home isolation,
  MCP/config injection, skill mounting, sandbox setup.
- **Discovers local skills** for prompt compounding.

The binary owns no UI and no cloud calls. Durable run state, board sync, and the
DevCouncil gate live on the Rust/TypeScript side.

## Supported runtimes (14)

Each backend implements the shared `Backend` interface in `internal/agent/agent.go`
and has its own test suite:

| | | | |
| --- | --- | --- | --- |
| Claude Code (`claude`) | Codex (`codex`) | Cursor (`cursor`) | Antigravity (`antigravity`) |
| GitHub Copilot (`copilot`) | OpenCode (`opencode`) | Kimi (`kimi`) | Kiro (`kiro`) |
| Qoder (`qoder`) | CodeBuddy (`codebuddy`) | Hermes / ACP (`hermes`) | Pi (`pi`) |
| Trae (`traecli`) | OpenClaw (`openclaw`) | | |

## JSON-RPC surface

The process reads JSON-RPC 2.0 requests on stdin and writes responses +
notifications on stdout (one message per line). Request methods registered in
`cmd/liquitask-agentd/main.go`:

| Method | Purpose |
| ------ | ------- |
| `detect` | Installed runtimes + versions |
| `skills.list` | Local skill discovery for prompt compounding |
| `run.start` | Start a run: `{ taskId, runtime, model, cwd, prompt, scope?, mcpConfig?, thinkingLevel?, resumeSessionId? }` → `runId` |
| `run.cancel` | Cancel a run (kills the whole process subtree) |
| `run.pause` / `run.resume` | Suspend / resume a run |
| `run.inject` | Inject mid-run guidance |
| `run.reattach` | Re-adopt runs orphaned by an app restart |
| `permission.respond` | Answer a permission request (`allow` / `deny` / `always`) |

While a run is active the sidecar emits **run-event notifications** (the
`run.events` stream) that the Rust bridge forwards to the UI as
`agent-run-event`s:

```
message | tool_use | thinking | permission_request | result | error
```

## Package layout

```text
liquitask-agentd/
├── cmd/liquitask-agentd/main.go   Entry point: wires RPC methods to the runner
└── internal/
    ├── rpc/         JSON-RPC 2.0 stdio framing (Register + Run)
    ├── runner/      Run manager: handlers for every RPC method, lifecycle
    ├── agent/       The 14 Backend implementations + shared interface,
    │                browser MCP config, thinking levels, per-OS invocation
    │                (copilot/cursor/pi have _windows variants)
    ├── detect/      CLI detection (installed / version)
    ├── execenv/     Per-run execution-environment prep (Codex home isolation,
    │                memory, sandbox, skill strip, user skills, multi-agent)
    ├── daemon/      Portable daemon plumbing: health, reconcile, GC,
    │                disk usage, poisoned-run handling, local skills API
    ├── skill/       Skill frontmatter parsing + reserved names
    ├── skillbundle/ Skill-bundle hashing
    ├── runtimeapps/ Connected-app config
    └── taskfailure/ Failure classification
```

Module: `github.com/liquitask/liquitask-agentd` · Go 1.26 · deps limited to
`google/uuid`, `pelletier/go-toml/v2`, and `gopkg.in/yaml.v3`.

## Build

The sidecar is built as part of the app; you rarely build it by hand:

```bash
# from the repo root — builds into src-tauri/binaries/ with the target-triple
# suffix Tauri's externalBin convention expects
npm run build:agentd
```

`scripts/build-agentd-sidecar.sh` detects the Rust host triple from `rustc`
(override with `AGENTD_TARGET_TRIPLE`) and emits
`src-tauri/binaries/liquitask-agentd-<triple>[.exe]`. Cross-compile with
`AGENTD_GOOS` / `AGENTD_GOARCH`. The binary is declared as an `externalBin` in
`src-tauri/tauri.conf.json` (alongside `binaries/semantic-layer`) so Tauri bundles
it with the app.

Build directly with the Go toolchain if you need to:

```bash
cd liquitask-agentd
go build ./cmd/liquitask-agentd
go test ./...          # per-backend suites + rpc/execenv/daemon
```

Requires Go 1.26+.

## How the app supervises it

`src-tauri/src/agentd.rs` (the "agentd sidecar bridge") resolves the bundled
binary — `liquitask-agentd[.exe]`, packaged next to the app via `externalBin`, or
a dev/`which` fallback — and spawns it directly (no `tauri-plugin-shell`). It
writes JSON-RPC requests to the child's stdin, reads responses/notifications from
stdout, and re-emits run events onto the Tauri event bus. The sidecar persists
its own state under `LIQUITASK_AGENTD_DATA` (default `~/.liquitask/agentd`).

Runs are spawned detached with output redirected to an on-disk event log, so a
run keeps working with the app window closed and the UI reattaches on relaunch —
see [`../docs/AGENT_TEAMMATES.md`](../docs/AGENT_TEAMMATES.md) for the durable-run
and reconcile model, DevCouncil gating, and the terminal-handoff escape hatch.

## License

Part of LiquiTask (MIT). Incorporates patterns/code ported from Multica under its
modified Apache 2.0 terms — see [`../docs/THIRD_PARTY.md`](../docs/THIRD_PARTY.md).
