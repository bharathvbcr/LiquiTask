# Agent Teammates

Multica-inspired managed agents inside LiquiTask: assign a board task to a
coding agent like you'd assign it to a colleague. The agent picks up the work in
your repo, streams progress into the card's activity trail, and the card moves
across the board as the run progresses.

> **AI features gate.** Agent surfaces (Inbox/Agents tabs, dispatch entry points,
> agent dock, semantic sidecar) are only active when **Enable AI Features** is on
> in Settings → General (`src/utils/aiFeatures.ts`). Simple mode keeps the board
> and task manager intact without agent UI. The first-run choice is made in
> `ExperienceChoiceGate` on fresh installs.

## The agentic board: Task → In Progress → Completed → Commit

The kanban board is the agent lifecycle:

| Column          | Meaning                                                                    | Who moves the card                          |
| --------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| **Task**        | Backlog. Auto-pickup only triggers from here.                               | You (create/assign)                         |
| **In Progress** | An agent (or you) is working the card — in an isolated git worktree.        | Run start, or the agent via MCP             |
| **Completed**   | The agent finished (`complete_task` MCP tool / run result + gates passed). | The agent via MCP, or the run lifecycle     |
| **Commit**      | Human-gated terminal stage: review the diff, then commit & merge the worktree back. | You — Approve button, or drag the card here |

Every assignment gets its **own git worktree + branch** (`.worktrees/<runId>`,
branch `agent/<runId>-<slug>`) by default, so parallel agents never collide.
The Commit stage auto-commits any changes the agent left uncommitted, merges
the branch (`--no-ff`) into your current branch, and removes the worktree;
merge conflicts keep the card in Completed with the branch preserved for
manual resolution. Every run — all 15 runtimes, not just Claude Code — gets
the `liquitask` MCP server injected, with board tools: `get_task`,
`update_status`, `complete_task`, `post_comment`, `create_subtask`,
`toggle_subtask`, `report_blocker`, and `get_user_guidance`.

Agents are not limited to Claude Code. Runs are dispatched through the
`liquitask-agentd` Go sidecar, which drives **15 coding-agent runtimes** — Claude
Code, Codex, Cursor, Grok Build, Antigravity, GitHub Copilot, OpenCode, Kimi, Kiro, Qoder,
CodeBuddy, Hermes (ACP), Pi, Trae, and OpenClaw — whichever CLIs you have
installed and authenticated. Each agent profile binds to one runtime.

## How it works

```
Board (assign task to agent)
  └─ useAgentTeammates ── auto-pickup / drag-to-roster / Start button
       └─ agentRunService (lifecycle: queued → running → verifying → done)
            ├─ prompt: buildTaskPrompt(task, compounded skills)
            ├─ agentd (default, AGENTD_SIDECAR_ENABLED):
            │      src-tauri/agentd.rs ── JSON-RPC run.start ──▶ liquitask-agentd
            │        └─ 15 runtimes: claude · codex · cursor · grok · antigravity · copilot ·
            │           opencode · kimi · kiro · qoder · codebuddy · hermes · pi · trae · openclaw
            ├─ council subprocesses: agent_council_runner.rs
            │      dev e2e / dev check --verify (+ agent_cli_util.rs for PATH/CLI resolution)
            ├─ sandbox:  container run -v repo:/work liquitask-agent ...   (opt-in)
            └─ council:  dev plan → scoped run (agentd) → dev verify     (DevCouncil)
```

`agentd` owns runtime detection, spawn, JSON-stream parsing, resume sessions,
MCP config injection, per-agent thinking levels, and per-OS invocation quirks
for all direct runs (including Claude Code). Council-mode `dev` subprocesses and
their durable journal/reattach path live in `agent_council_runner.rs`, with
shared CLI resolution in `agent_cli_util.rs`.

## Sending work to agents (one action from anywhere)

Every entry point funnels through `agentDispatchService` (the send singleton;
the board registers its assign/toast handlers once, so no prop drilling):

- **Hover button**: hovering a card reveals a bot button (top-right) — one
  click smart-matches and sends. Hidden while a run is active or the card is
  in Completed/Commit.
- **Context menu**: right-click → Send to Agent. Click smart-matches; the
  submenu lists Best Match plus each agent by name.
- **Keyboard**: focus a card and press `A` (rebindable: `task:send-agent`).
- **Drag**: the tray that slides up now leads with a **Best Match** chip (no
  aiming), and each agent chip shows live availability — "ready",
  "busy — queues #2", "over daily cap".
- **Bulk**: multi-select → "Send to Agents" fans the batch out, spreading
  load across agents; one summary toast reports sent / queued / skipped.

**Smart match** picks the task's own assignee when it already names an agent,
otherwise the least-loaded coder-role agent with a working directory and
budget headroom (ties: oldest profile). The pick is never a black box — the
card's activity trail records "handed this task off to Rex (smart match:
idle)".

**Acknowledgment on the card**: "sending to agent" appears instantly, then
"queued #N" → "working" → "verifying". A stalled permission shows a
"needs approval" badge **plus an inline Approve / Deny bar on the card**, and
hovering an active card reveals a stop control to cancel the run — no dock
hunting for any of it.

**First run**: with no agents configured, the same entry points offer "Set Up
an Agent" and deep-link to Settings → Agents, where the working directory is
prefilled from your workspace folder.

- **Agent profiles** live in Settings → Agents (or `AgentFormModal` from the
  roster / first-run setup flow). The agent's *name* is its assignee label: any
  task assigned to that name routes to the agent.
- **Working directory** must be an authorised workspace folder (the same
  security boundary as workspace file access). It defaults to the active
  workspace's linked folder (or the first authorised workspace path) — leave
  the field empty and the save resolves + allowlists it automatically; Browse
  is only for overriding.
- **Auto-pickup** (per agent, default off): runs start the moment a task is
  assigned. Otherwise use the Start button in the Agent Teammates dock
  (bottom-right).
- **Drag-and-drop handoff**: start dragging any card and an agent tray slides
  up from the bottom of the board. Drop the card on an agent chip to assign it
  and start the run immediately (explicit handoff overrides auto-pickup).
- **Lifecycle on the board**: run start moves the card to In Progress and posts
  an activity entry; completion posts the agent's summary; failures land in the
  card's error logs.
- **Queueing**: one run per agent at a time; further assignments queue.
- **Runtime** (per agent): the profile picks one of the 15 supported CLIs plus a
  model and thinking level. `Settings → Agents` shows live detection (installed /
  version) per runtime; runs route to that runtime through `agentd`.
- **Run mode** (per agent): `direct` runs the task on the chosen runtime and
  streams the result to the card; `council` routes the whole run through
  DevCouncil (plan → scoped run → verify) — debate planning, scope enforcement,
  permission hooks, and evidence gates. The final council report (blocking gaps,
  verdict) lands on the card.
- **Claude Code advisor** (optional worker config): set an advisor model on a
  Claude Code coding profile to pass `--advisor` (Claude Code ≥2.1.98, Anthropic
  API only). It stacks with DevCouncil plan/verify and does **not** replace them.
  Planner-role profiles ignore the field.
- **Skills compounding**: every successful run is captured as a reusable skill
  (task + solution summary, scoped to the repo). The five most recent skills
  for a repo are injected into future prompts as "Team knowledge", so agents
  get better at your codebase over time.
- **Terminal handoff**: any run with a session id has a terminal button in the
  dock — it opens Terminal.app in the agent's repo and resumes the exact same
  Claude Code session (`claude --resume <session-id>`), so you can take over
  interactively where the agent left off.
- **Board presence**: cards assigned to agents show a bot avatar; a pulsing
  badge appears while the agent is working or the DevCouncil gate is running.

## Requirements

| Capability | Requirement |
|---|---|
| Agent runs (host) | The chosen runtime's CLI installed and authenticated — `claude`, `codex`, `agent`/`cursor-agent`, `grok`, or any of the 15 supported CLIs |
| Sidecar | `liquitask-agentd` (bundled with the app; built via `npm run build:agentd`) |
| DevCouncil gate | `dev` CLI on PATH (DevCouncil repo, via uv) |
| Container sandbox | macOS 26+, Apple silicon, `container system start`, image built from `agent-sandbox/Dockerfile` |

Settings → Agents shows live detection for the runtimes, the sidecar, and DevCouncil.

## DevCouncil integration

DevCouncil makes a run *prove* it satisfied intent rather than claim success. The
bridge lives in `src-tauri/src/agent_devcouncil.rs` (plan / verify / repair) and
`agent_devcouncil_evidence.rs` (evidence mirror); it shells out to the `dev` CLI,
detected by `agent_dev_cli_available()`.

- **Plan gate (opt-in per task).** "Assign to council" runs `dev plan`
  (`run_dev_plan`), producing typed Tasks/Requirements and a `PlannedFile` scope
  whitelist rendered as an Inbox approval card. Approving spawns agent runs bound
  to that scope.
- **Scope enforcement (MCP bridge).** The whitelist is passed into `run.start`;
  the runtime receives it via its permission mechanism (MCP permission server for
  Claude Code, config injection for others). Out-of-scope mutating tool calls are
  denied by `agentScopeService.ts` on the MCP permission-prompt path
  (`agentMcpService.ts`). **`agent_policy.rs` is not scope enforcement** — it
  only handles spawn-time model routing and per-agent daily budget caps.
- **Verify gate.** Each successful run is followed by `dev verify`
  (`run_dev_verify`) — a 4-tier proof (scope compliance, tests, coverage, rigor).
  Blocking gaps post to the card and mark the run failed until they clear. The
  verdict card carries typed `next_actions`; "Repair" spawns a follow-up run
  seeded with structured repair instructions (`run_dev_repair`).
- **Evidence graph.** `mirror_evidence_graph` polls `.devcouncil/state.db` and
  mirrors the Requirement → Task → Diff → Evidence links into LiquiTask's
  artifact tables, so provenance renders on the task card.
- **MCP.** `dev mcp-server` is registered in the MCP config `agentd` passes to
  runs, so agents can self-serve checkout → verify → repair loops.

For the full council pipeline (debate planning, permission hooks, evidence gates),
run `dev integrate claude --apply` in the target repo so Claude Code picks up
DevCouncil's MCP tools and hook policies during runs. The legacy one-shot gate
(`dev check --verify --json`) remains available for a quick post-run check.

## apple/container sandbox

Opt-in per agent. Runs execute inside a lightweight Linux VM with only the
repo mounted at `/work`:

```bash
cd docs/archive/agent-sandbox   # Dockerfile lives here today
container build -t liquitask-agent:latest .
container system start   # once per boot
```

The runner passes `ANTHROPIC_API_KEY` through when set; inside the VM the run
uses `--dangerously-skip-permissions` since the VM itself is the sandbox.

**Current state.** Per-agent opt-in via `AgentForm` (`sandbox: "container"`) →
`agentRunService` → Rust `agentd.rs` → `liquitask-agentd` `run.start`
(`ContainerImage` on `StartParams`) → `PrepareManagedCommand` /
`wrapContainerRun` in `container.go`. `run.start` fails immediately when
`containerImage` is set but the apple/container system is unavailable; the
error surfaces on the failed run card in the dock. Agent Settings exposes
`agent_container_build` / `agent_container_system_status` (`agent_git.rs`); the
AgentForm container toggle is enabled when `container system status` succeeds
on macOS 26+ Apple silicon.

**Remaining polish:**

1. Journal / reattach semantics for VM-backed runs (PID is the `container` CLI
   parent; reconcile on exit like `claude-container` mode in `run_store.rs`).
2. Move or symlink `docs/archive/agent-sandbox/` back to repo-root
   `agent-sandbox/` if the build UX should match AGENT_TEAMMATES examples.

## Security model

- The renderer never passes a raw command line — the Rust runner assembles
  argv from structured, validated parameters (modes: `claude`,
  `claude-container`, `devcouncil-verify`, `devcouncil-e2e`).
- Working directories are validated against the workspace allowlist.
- Flag-shaped values (e.g. a model named `--dangerously-skip-permissions`) are
  rejected.
- Every process is tracked and cancellable; on relaunch, runs are reconciled
  against the durable journal (see below) rather than blanket-failed.

### OS sandbox (`sandboxMode: os`)

Per-agent opt-in (`AgentForm` → `agentRunService` → `liquitask-agentd`
`PrepareManagedCommand` / Rust `agent_sandbox.rs`). macOS uses `sandbox-exec`
with `(deny default)`, global `(allow file-read*)`, and `(allow file-write*
(subpath …))` only for the worktree cwd, git metadata, MCP bridge dir, agent
CLI config homes, and `TMPDIR`. Linux uses `bwrap` with an equivalent bind
list.

Live smoke tests: `liquitask-agentd/internal/agent/sandbox_darwin_test.go`
(`TestOSSandboxWriteContainment`, `TestOSSandboxMcpSecretReadable`). On macOS,
writes inside the worktree succeed; writes to `~/Documents` are denied. Writable
roots must be symlink-resolved (`/var` → `/private/var`) — see
`canonicalSandboxRoot` in `sandbox_profile.go`.

### MCP bridge containment (Phase A + gaps)

**Phase A (done):** `LIQUITASK_MCP_SECRET` and `LIQUITASK_RESPONSE_SECRET`
are scrubbed from every `mcpServers.*.env` block before configs hit disk or
agent CLIs (`ScrubMcpConfigSecrets` in agentd). The Node bridge
(`scripts/liquitask-mcp-bridge.mjs`) reads signing keys from
`<LIQUITASK_MCP_DIR>/.secret` (guidance MAC) and
`<LIQUITASK_MCP_DIR>/response-secret` (bound response MAC) — both mode 0600,
never from env. `agent_mcp_init` returns only `mcpDir` to the renderer. The
OS sandbox profile denies read of both secret files (and the agentd RPC
token/socket) when `sandboxMode: os`.

**Remaining same-user read gap:** The OS sandbox profile still has `(allow
file-read*)`, so a sandboxed agent CLI (or any code it runs) can read
`<mcpDir>/.secret` if it learns the path from the MCP config env
(`LIQUITASK_MCP_DIR`). Writes outside the allowlist remain blocked.

**Phase B (partial — FD handoff MVP):** `scripts/liquitask-mcp-bridge.mjs`
now accepts `LIQUITASK_MCP_SECRET_FD` / `LIQUITASK_RESPONSE_SECRET_FD` so an
agentd-owned bridge child can receive signing keys via inherited file
descriptors instead of reading `<mcpDir>/.secret` / `response-secret`. Full
containment still needs agentd to spawn the bridge directly (stdio/socket) and
stop writing secrets to agent-readable files — tracked for a follow-up when
runtime MCP launch is restructured.

## Durable / headless runs (Runtime v2, phase 1)

Runs used to die with the app: the child was a piped child of the Tauri
process, so quitting closed the pipes, `claude` took a SIGPIPE, and on relaunch
everything active was marked "Interrupted by app restart". Now a run keeps
working with the window closed and the UI reattaches on launch.

**On disk.** Each run owns `<app_data>/agent-runs/<runId>/`:

```
meta.json      run metadata: status, pid/pgid, mode, cwd, timing, stdout cursor
stdout.ndjson  the agent's raw stream-json stdout (the durable event log)
stderr.log     captured stderr
```

**Survival mechanism.** Sidecar runs reattach via `agentd_run_reattach` /
`run.reattach` in the Go daemon (journal + in-memory runs; reconciles dead PIDs
with process start-time identity checks matching the council path).
Council subprocesses use the durable journal in
`run_store.rs` + `agent_council_runner.rs`: the child is spawned **detached**
with stdout/stderr redirected to those files instead of parent-owned pipes:

- **unix** — its **own process group** (`process_group(0)`), so an app-quit
  signal to our group misses it, and with stdout on a file it never takes a
  SIGPIPE.
- **windows** — `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, so it inherits no
  console and is immune to CTRL events aimed at the app.

Either way `pgid == pid`, which the liveness/kill paths rely on. A reaper thread
reaps the process (owned children via `try_wait`, re-adopted pids via a liveness
poll — `kill -0` on unix, `tasklist` on windows); a tailer thread follows
`stdout.ndjson` and re-emits the same `agent-run-event` stream the UI already
consumes, persisting a byte cursor as it goes. Cancel kills the whole subtree
(`kill(-pgid)` / `taskkill /T /F`).

**Reattach on relaunch (`agent_runs_reattach`).** For every run the journal
still marks `running`:

- **PID alive** → re-adopt it: resume tailing from the persisted cursor, so the
  live stream and the board pick up where they left off. Council reattach also
  verifies process start-time to guard against PID reuse.
- **PID dead** → it finished while the app was closed: reconcile the outcome
  from `stdout.ndjson` and finalize the record. Reconciliation is **mode-aware**
  — Claude/container runs parse the `result` line, council runs
  (`devcouncil-e2e`/`-verify`) parse the DevCouncil report (passes only when
  explicitly `passed`/`ok` *and* it has no blocking gaps).
- **Unknown to the journal** (older runs) → interrupted, as before.

The TS side (`agentRunService.reconcileWithJournal`) applies these outcomes to
its persisted `AgentRun` records instead of failing them:

- `rehydrateActiveRuns` restores each still-live run's task/agent context so its
  eventual completion still moves the card, captures a skill, and advances the
  agent's queue.
- `flushPendingBoardSync` **retro-drives the board** for runs that *finished*
  while the app was closed: on relaunch it replays the `onRunFinished` hook so
  their cards move to Completed, activity/error logs are written, and the user is
  notified — the same treatment a live completion gets. It runs once per run
  (the reconciled status is persisted, so a later relaunch won't repeat it).

**Platform support.** Durable runs work on **macOS/Linux and Windows**. Only
truly exotic targets (neither unix nor windows) fall back to the old piped
behaviour where runs end on app close.

**Notes:**

- When the app is open at exit, the real process exit code drives the outcome;
  the mode-aware log reconciliation above is the fallback for runs that finish
  while the app is closed.
- Old run directories are pruned to the newest ~50 finished runs.
- **Follow-up:** promote this to a true supervisor daemon so post-run
  orchestration (queue, verify gates) continues even while the app is fully
  closed, rather than resuming on relaunch.
