# Agent Teammates

Multica-inspired managed agents inside LiquiTask: assign a board task to a
coding agent like you'd assign it to a colleague. The agent picks up the work in
your repo, streams progress into the card's activity trail, and the card moves
across the board as the run progresses.

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
manual resolution. Every run — all 14 runtimes, not just Claude Code — gets
the `liquitask` MCP server injected, with board tools: `get_task`,
`update_status`, `complete_task`, `post_comment`, `create_subtask`,
`toggle_subtask`, `report_blocker`, and `get_user_guidance`.

Agents are not limited to Claude Code. Runs are dispatched through the
`liquitask-agentd` Go sidecar, which drives **14 coding-agent runtimes** — Claude
Code, Codex, Cursor, Antigravity, GitHub Copilot, OpenCode, Kimi, Kiro, Qoder,
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
            │        └─ 14 runtimes: claude · codex · cursor · antigravity · copilot ·
            │           opencode · kimi · kiro · qoder · codebuddy · hermes · pi · trae · openclaw
            ├─ claude (fallback): agent_runner.rs spawns
            │      claude -p "<task brief>" --output-format stream-json
            ├─ sandbox:  container run -v repo:/work liquitask-agent ...   (opt-in)
            └─ council:  dev plan → scoped run → dev verify                (DevCouncil)
```

`agentd` owns runtime detection, spawn, JSON-stream parsing, resume sessions,
MCP config injection, per-agent thinking levels, and per-OS invocation quirks.
The Rust `agent_runner.rs` path remains as the Claude fallback during migration.

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

- **Agent profiles** live in Settings → Agents. The agent's *name* is its
  assignee label: any task assigned to that name routes to the agent.
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
- **Runtime** (per agent): the profile picks one of the 14 supported CLIs plus a
  model and thinking level. `Settings → Agents` shows live detection (installed /
  version) per runtime; runs route to that runtime through `agentd`.
- **Run mode** (per agent): `direct` runs the task on the chosen runtime and
  streams the result to the card; `council` routes the whole run through
  DevCouncil (plan → scoped run → verify) — debate planning, scope enforcement,
  permission hooks, and evidence gates. The final council report (blocking gaps,
  verdict) lands on the card.
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
| Agent runs (host) | The chosen runtime's CLI installed and authenticated — `claude`, `codex`, `cursor-agent`, or any of the 14 supported CLIs |
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
- **Scope enforcement (two gates).** The whitelist is passed into `run.start`;
  the runtime receives it via its permission mechanism (MCP permission server for
  Claude Code, config injection for others), and the Rust policy layer
  (`agent_policy.rs`) blocks out-of-scope writes as a second, independent gate.
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
cd agent-sandbox
container build -t liquitask-agent:latest .
container system start   # once per boot
```

The runner passes `ANTHROPIC_API_KEY` through when set; inside the VM the run
uses `--dangerously-skip-permissions` since the VM itself is the sandbox.

## Security model

- The renderer never passes a raw command line — the Rust runner assembles
  argv from structured, validated parameters (modes: `claude`,
  `claude-container`, `devcouncil-verify`, `devcouncil-e2e`).
- Working directories are validated against the workspace allowlist.
- Flag-shaped values (e.g. a model named `--dangerously-skip-permissions`) are
  rejected.
- Every process is tracked and cancellable; on relaunch, runs are reconciled
  against the durable journal (see below) rather than blanket-failed.

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

**Survival mechanism (`run_store.rs` + `agent_runner.rs`).** The child is
spawned **detached** with stdout/stderr redirected to those files instead of
parent-owned pipes:

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
  live stream and the board pick up where they left off.
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
