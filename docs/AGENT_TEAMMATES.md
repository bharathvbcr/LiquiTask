# Agent Teammates

Multica-inspired managed agents inside LiquiTask: assign a board task to a
Claude Code agent like you'd assign it to a colleague. The agent picks up the
work in your repo, streams progress into the card's activity trail, and the
card moves across the board as the run progresses.

## How it works

```
Board (assign task to agent)
  └─ useAgentTeammates ── auto-pickup / Start button
       └─ agentRunService (lifecycle: queued → running → verifying → done)
            ├─ prompt: buildTaskPrompt(task, compounded skills)
            └─ Tauri: agent_runner.rs spawns per run
                 ├─ direct:    claude -p "<task brief>" --output-format stream-json
                 ├─ sandbox:   container run -v repo:/work liquitask-agent claude -p ...
                 ├─ council:   dev e2e "<goal>" --executor claude --json   (DevCouncil)
                 └─ gate:      dev check --verify --json                  (DevCouncil)
```

- **Agent profiles** live in Settings → Agents. The agent's *name* is its
  assignee label: any task assigned to that name routes to the agent.
- **Working directory** must be an authorised workspace folder (the same
  security boundary as workspace file access). The Browse button adds the
  chosen folder to the allowlist automatically.
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
- **Run mode** (per agent): `direct` sends the task straight to Claude Code;
  `council` routes the whole run through DevCouncil's `dev e2e` pipeline —
  multi-agent debate planning, permission hooks, and evidence gates. The final
  council report (blocking gaps, verdict) lands on the card.
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
| Agent runs (host) | `claude` CLI installed and authenticated |
| DevCouncil gate | `dev` CLI on PATH (DevCouncil repo, via uv) |
| Container sandbox | macOS 26+, Apple silicon, `container system start`, image built from `agent-sandbox/Dockerfile` |

Settings → Agents shows live detection for all three.

## DevCouncil verification gate

With the gate enabled, each successful run is followed by
`dev check --verify --json` in the agent's working directory. Blocking gaps are
posted to the card and the run is marked failed until the gaps clear. For the
full council pipeline (debate planning, permission hooks, evidence gates), run
`dev integrate claude --apply` in the target repo so Claude Code picks up
DevCouncil's MCP tools and hook policies during runs.

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
  their cards move to Review, activity/error logs are written, and the user is
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
