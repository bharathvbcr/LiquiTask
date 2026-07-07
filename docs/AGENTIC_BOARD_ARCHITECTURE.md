# The Agentic Board: Git-Aligned State Machine, Event Sourcing & Failure Containment

Status: implemented 2026-07-06 on `feature/multica-integration`.
Companion docs: `docs/AGENT_TEAMMATES.md` (run lifecycle), `docs/REWORK_PLAN_MULTICA.md` (direction).

LiquiTask's board is not a sticky-note wall — it is a **strict, git-aligned state
machine** whose durable source of truth is an **append-only event log**, whose
side effects (worktrees, merges) are **transactional with rollback**, and whose
failures land in a **persistent dead-letter queue** instead of a console.

```
   Task ────────────▶ In Progress ───────────▶ Completed ───────────▶ Commit
 (backlog)          (run + isolated           (work staged,          (merged via
                     worktree/branch)          awaiting review)       tx pipeline;
                                                                      terminal)
        ◀── abort ──┘            ◀── rework ──┘
```

## 1. Board schema — the four-state machine

Module: `src/core/board/boardStateMachine.ts` (pure; no IO).
Every mutation path validates through `validateTransition(from, to, ctx)`:
drag & drop (`useBoardDnDController` → `canMoveTask`), programmatic moves
(`useTaskController.moveTask`), field updates that smuggle a status change
(`handleUpdateTask`), MCP tools (`agentMcpService`), and the run lifecycle
hooks (`useAgentTeammates`).

Canonical edges: `Task → InProgress`, `InProgress → Completed | Task`,
`Completed → Commit | InProgress | Task`, `Commit → ∅` (terminal; explicit
`reopen` lands in Task). Custom columns are parking lanes: they trade cards
with Task/InProgress but can never bypass the guards into Completed/Commit.

Actors get different edge sets:

| Actor | May do | May never do |
|---|---|---|
| `user` | all canonical edges + custom lanes | enter Commit past unmerged work without the pipeline |
| `agent` (MCP) | `Task→InProgress` (pickup), `InProgress→Completed` (complete) | enter Commit, park cards, skip stages |
| `automation` | same as user | — |
| `system` (run lifecycle) | structural edges with blockers/WIP relaxed (the run already happened) | skip stages, enter Commit |

Contextual guards: unresolved `blocked-by` links, WIP limits, `hasActiveRun`
(blocks Commit while a run is live), `hasUnmergedWork` (forces the merge
pipeline). A verdict may be `allowed` with `requires: "merge-pipeline"` or
`"agent-run"` — legal moves that must be executed by a side-effecting pipeline
rather than a plain status write.

## 2. Event sourcing — the task event log

Modules: `src/core/events/{taskEvents,taskEventReducer,taskEventStore}.ts`;
durable log: `task_events` table in `src-tauri/src/task_store.rs` (SQLite,
app-data dir) on desktop, IndexedDB (`liquitask-events`) on web.

**Write path (strict order).** `useTaskController.commitTaskMutation`:
1. optimistic React update;
2. `taskEventStore.append(batch)` — the write-ahead step. Appends are
   serialized in-process and **transactional in SQLite** (any invalid /
   duplicate event aborts the whole batch);
3. only after the log accepts the batch are the derived read models updated
   (SQLite snapshot via `nativeMutateTasks`, IndexedDB mirror, search index);
4. if the append fails, the optimistic update is **rolled back** and the
   mutation is dead-lettered (`kind: "event-log"`).

**Read path (boot).** `useAppInitialization` calls
`taskEventStore.initialize(legacySnapshot)`:
- empty log + existing tasks → one-time **genesis import** (`task.imported`);
- populated log → **replay** (`replayTaskEvents`) — the log wins over any
  snapshot; snapshots are rebuild accelerators, deletable at any time;
- unusable log (e.g. private browsing) → degraded mode: legacy stores serve,
  every mutation still works, degradation is reported once.

**Event envelope** (`v: 1`): `{ id, seq, streamId, type, payload, actor,
runId?, ts }`. Mutation events are **state-carrying** (payload embeds the full
serialized task) so replay is a deterministic replace/delete fold with no
patch-merge semantics to version. `payload.changed` keeps the human-readable
delta for audit. Event types:

- mutations (replayed): `task.created`, `task.imported`, `task.updated`,
  `task.moved` (with `from`/`to`/`viaMergePipeline`), `task.deleted`
- audit facts (not replayed): `run.started`, `run.finished`,
  `worktree.provisioned`, `worktree.merged`, `worktree.discarded`,
  `merge.failed`, `action.dead-lettered`, `action.retried`, `action.discarded`

**Sync fan-out.** Every append notifies in-process subscribers AND broadcasts
on the Tauri event bus (`liquitask://task-events-appended`, origin-tagged), so
the board UI, terminal shell, and any additional windows converge on the same
history. This is CQRS in effect: one write model (the log), several read
models (React state, SQLite snapshot, IndexedDB, search index, inbox counts).

## 3. Concurrent task isolation — worktree lifecycle

Owner: `src-tauri/src/agent_git.rs` (single owner; the Go sidecar's execenv
worktree code is only used by in-run `repo checkout`, never for task
isolation).

Lifecycle hooks:

1. **Creation** — on run start (i.e. the transition that puts the card in
   In Progress), `agent_git_create_worktree(workingDir, runId, taskTitle,
   taskId)` provisions `<repo>/.worktrees/<runId>/` on branch
   `agent/<runId>-<slug>`. Worktrees are now **on by default** for every agent
   run (`gitWorktree !== false`) — parallel agents can never contaminate the
   main checkout or each other.
2. **Metadata synchronization** — a sidecar file
   `.worktrees/<runId>.liquitask.json` (`{runId, taskId, branch, createdAt}`)
   binds the worktree to its run/task, outside the worktree so it never
   pollutes diffs; `.worktrees/` is auto-added to `.git/info/exclude`. A
   `worktree.provisioned` event lands in the task log.
3. **Lock management** — all mutating pipelines (merge, prune) serialize on a
   per-repo in-process lock (`busy_repos`); a second concurrent merge fails
   fast with a retryable error instead of interleaving git operations.
4. **State queries** — `agent_git_worktree_state` (branch, dirty files,
   commits ahead, last commit, owner run/task) and `agent_git_list_worktrees`
   power the MCP tools and UI.
5. **Cleanup/pruning** — merge and discard remove worktree + branch + meta;
   `agent_git_prune_worktrees(repo, keepRunIds)` reaps orphans (crashed runs,
   force-quits) and is invoked on every app boot
   (`agentRunService.pruneStaleWorktrees`).

## 4. Commit stage — the transactional merge pipeline

Rust: `agent_git_merge_worktree_tx`; TS orchestration:
`src/services/agents/mergePipelineService.ts`. Both entry points — the
**Approve** action and **dragging a card into Commit** — run the same pipeline
(`App.handleMoveTask` intercepts the drop):

```
verify (DevCouncil gate, when enabled)
  → acquire per-repo lock
  → capture pre-merge HEAD SHA            (rollback anchor)
  → refuse dirty main checkout
  → auto-commit pending worktree changes  (agents leave work unstaged)
  → git merge --no-ff --no-edit <branch>
      conflict → git merge --abort; branch + worktree kept  → DLQ
  → cleanup: worktree remove + branch delete + metadata
      failure after merge → git reset --hard <pre-merge-sha> (ROLLBACK) → DLQ
  → worktree.merged event → card moves to Commit (viaMergePipeline)
```

The repo can never land half-committed: either the merge completes and the
worktree is pruned, or HEAD is exactly where it started and the branch
survives for a retry. Every failure is recorded as a `merge.failed` event AND
a dead letter whose payload re-runs the pipeline on retry (a successful Inbox
retry also advances the card to Commit).

## 5. MCP compliance — how agents drive the board

Transport: stdio MCP server (`scripts/liquitask-mcp-bridge.mjs`, JSON-RPC 2.0,
protocol `2024-11-05`), injected into **all 14 runtimes** (Claude Code via
`--mcp-config`; every agentd runtime via execenv's native-format rendering).
Tool calls round-trip through a per-run request/response directory
(`agent_mcp.rs`) polled by `agentMcpService`.

Tools (schemas in the bridge script):

| Tool | Guard |
|---|---|
| `get_task` | — board snapshot (card + columns) |
| `get_worktree_state` | — branch, dirty files, commits ahead, last commit |
| `update_status` | state machine, actor `agent` (denials return the REASON) |
| `complete_task` | state machine + **context-aware verification**: a run that owns a worktree must contain actual work (dirty files or commits ahead) unless the agent declares `no_changes: true`; open subtasks echoed back |
| `post_comment`, `create_subtask`, `toggle_subtask`, `report_blocker` | input validation |
| `get_user_guidance` | mid-run user injections (guidance.jsonl) |
| `permission_prompt` | approve/deny UI + DevCouncil scope enforcement (scope denial overrides auto-approve) |

Deliberate denials (`McpDenial`) are returned to the agent as tool errors;
**infrastructure failures** on mutating tools are dead-lettered with the exact
arguments for replay. This is how a card moves In Progress → Completed
programmatically and securely; Commit remains human-gated by construction.

## 6. Dead-letter queue — failed agent actions

`src/services/deadLetterService.ts`, persisted under
`liquitask-dead-letters`, surfaced in the **Inbox** with Retry/Discard, and
mirrored into the event log. Letter kinds and retry strategies:

| Kind | Producer | Retry handler |
|---|---|---|
| `merge` | merge pipeline | re-run `agent_git_merge_worktree_tx`, advance card on success |
| `mcp-action` | agentMcpService | re-execute the tool with original args |
| `run` | run-finished hook | re-dispatch task to its agent |
| `event-log` | commitTaskMutation | (manual) — optimistic update was rolled back |
| `automation` | reserved | — |

Failed retries stay open with the error appended (`attempts` counted);
`action.retried` / `action.discarded` events keep the audit trail complete.

## 7. DevCouncil integration

- **Auto-discovery** (`agent_dev_discover` / `resolve_dev_cli`):
  `LIQUITASK_DEV_CLI` env override → PATH (`dev`, `devcouncil`) →
  `~/.local/bin` shims → local checkout venvs (`~/Code/DevCouncil`, …).
- **Lazy install** (`agent_dev_install_local`): verified local checkout
  (pyproject `name = "devcouncil"`) via `uv tool install --from` → `pipx
  install` → `npm install -g devcouncil` registry fallback. One-click
  **bootstrap** in Settings → Agents → DevCouncil runs discover → install →
  `dev init` → `dev map` (`devcouncilService.bootstrap`).
- **Context injection**: the repo map summary (subsystems, entry points,
  critical files) is appended to every agent prompt (`withRepoContext`);
  `devcouncilService.ensureFreshMap` regenerates stale maps (>7 days) in the
  background at run start. DevCouncil's own MCP server (`devcouncil
  mcp-server`) is registered for runs in initialised workspaces.
- **Gates**: `dev plan` (plan gate, Inbox approval) → scope enforcement
  (PlannedFile whitelist checked on every permission prompt) → `dev verify`
  (post-run gate and pre-merge gate in the pipeline) → repair loop
  (blocking gaps → linked repair tasks).

## 8. Error boundaries

- React: `ErrorBoundary` at the app root; `PanelBoundary` around each v3
  surface (Inbox / Agents / Board) — one crashing surface renders an inline
  retryable card instead of taking down the shell.
- Git: every merge is bracketed by pre-merge SHA capture with
  `merge --abort` / `reset --hard` rollback; repo lock prevents interleaving.
- Events: append is all-or-nothing; UI rolls back on log rejection.
- Agents: failed runs, failed MCP writes and failed merges are dead-lettered,
  never silently dropped.

## 9. Invariants (enforced, not aspirational)

1. A card is in **Commit ⇒ its branch is merged** (or it never had a worktree).
2. A card enters **In Progress with an agent ⇒ an isolated worktree exists**
   for that run (unless the profile opts out).
3. **The event log is the source of truth**: deleting every snapshot/read
   model and replaying the log reproduces the board.
4. **No stage skipping**, for any actor, through any code path.
5. **Nothing fails silently** after intent capture: it is in the log, in the
   DLQ, or both.
