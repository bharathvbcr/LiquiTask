# LiquiTask is deprecated

**Date:** 2026-09-11
**Status:** Deprecated. Frozen except for security and data-loss fixes.
**Successor:** [GitPulse](https://github.com/bharathvbcr/GitPulse) (`/Users/bharath/Code/devtools/GitPulse`)

LiquiTask is no longer the place to add task-board, agent-run, or DevCouncil
features. GitPulse is the unified, native replacement: Git, tasks, policy, code
maps, and agent handoff in one local-first desktop app.

## Go here instead

| | |
| --- | --- |
| Successor | **GitPulse** 1.0.0 |
| Local checkout | `/Users/bharath/Code/devtools/GitPulse` |
| GitHub | <https://github.com/bharathvbcr/GitPulse> |
| Website | <https://gitpulse.vbcr.dev/> |
| Releases | <https://github.com/bharathvbcr/GitPulse/releases> |
| Tasks / workspaces | [GitPulse `docs/TASKS_AND_WORKSPACES.md`](https://github.com/bharathvbcr/GitPulse/blob/main/docs/TASKS_AND_WORKSPACES.md) |
| Architecture | [GitPulse `docs/ARCHITECTURE.md`](https://github.com/bharathvbcr/GitPulse/blob/main/docs/ARCHITECTURE.md) |
| Data-layer timings | [GitPulse `docs/AGENTIC_WORKSPACES_BENCHMARK.md`](https://github.com/bharathvbcr/GitPulse/blob/main/docs/AGENTIC_WORKSPACES_BENCHMARK.md) |

## Why this tree stopped

LiquiTask grew from a Kanban manager into an agent workbench by stacking
runtimes beside the original board rather than replacing it:

- **Renderer:** React 19 board + liquid-glass UI.
- **Desktop:** Tauri 2 (Rust).
- **Agent runs:** `liquitask-agentd` Go sidecar (15 CLI backends) over JSON-RPC.
- **Search extras:** Python `semantic_layer/` sidecar.
- **Gating:** DevCouncil as an external `dev` CLI, with a Rust bridge that
  mirrors `.devcouncil/state.db`.

Tasks and projects still dual-write. `FEATURE_FLAGS.TASKS_SQLITE_ENABLED` is on
in `src/constants/index.ts`, but `storageService` keeps IndexedDB and the native
key-value store as a seed path and fallback (`src/services/storageService.ts`,
`src/services/sqliteTaskStore.ts`). Agent runs, events, and artifacts live in a
**separate** SQLite tree (`run_store.rs` / `agentd_store.rs`). A single
assign-and-run therefore crosses the renderer, Rust IPC, a Go sidecar, and often
a Python sidecar or DevCouncil process.

That split is the performance problem this deprecation is about: board and search
pay for encryption, dual persistence, and extra process hops that a unified
native store does not. GitPulse's store timings are in its
[workbench benchmark](https://github.com/bharathvbcr/GitPulse/blob/main/docs/AGENTIC_WORKSPACES_BENCHMARK.md).

## What GitPulse is instead

GitPulse is one Tauri 2 process, not a second Kanban app:

- **Svelte 5** UI with four views (Work, Code, History, Insights), Fleet, and
  global/workspace/repository **Tasks**.
- **Rust** backend: git sandbox, GPU-backed commit graph, coverage/health/storage
  analyzers, native PTY, event ledger, in-process DevMap readers.
- **Manvi `dc-store`** owns the profile task schema, revisions, briefs, and
  receipts. GitPulse presents boards and run controls; it does not keep a second
  independent task database.
- **MANVI** 5-verdict policy gate on mutating git actions.
- **`gitpulse-mcp`** for read-only agent insights (worktrees, collisions, ledger,
  code graph).

The 2026-09-09 GitPulse/Manvi checkpoint (10,000 tasks, 100 samples, Apple M5
Pro) reported **4.064 ms mean / 7.129 ms p95** for a global first-200-card page at
the data boundary. Those are store timings, not desktop FPS. Broad search on a
100,000-task stress fixture still misses GitPulse's 100 ms target; see that
benchmark for what is measured and what is not.

## What maps where

| LiquiTask (this repo) | GitPulse |
| --- | --- |
| Kanban board / projects | **Tasks** (global, saved-workspace, repository boards) and **Work → Tasks** |
| Inbox (approvals, verdicts, DLQ) | Work overview, policy, durable ledger, native notifications |
| Agent teammates / `liquitask-agentd` | Task run controls, terminal handoff, managed Codex via Manvi; `gitpulse-mcp` |
| DevCouncil plan / verify / evidence | DevCouncil modules in-process (DevMap, leases) plus Work / Policy |
| Semantic sidecar / GitNexus skills | In-process DevMap (`Code → Map`, palette `:` / `::`) |
| Command Deck | Command palette (eight search modes) |
| Settings → Agents | Work → Policy, Manvi settings, MCP install (`npm run mcp:install`) |

## What did not move 1:1

Do not assume GitPulse has a port of every LiquiTask task-manager feature.
These are **not** claimed as parity:

- Recurring tasks, automation rules, Calendar / Gantt, archive-as-in-LiquiTask
- Quick-add token syntax (`$title`, `!high`, `%agent`, …)
- Image-to-task and the in-app Gemini/Ollama authoring suite
- Encryption-at-rest as implemented in this tree
- The 15-runtime `liquitask-agentd` sidecar as a bundled executor

GitPulse's managed-agent surface is Codex-first, with terminal handoff for other
CLIs. Managed Claude and full crash recovery remain qualification gaps in
GitPulse's [agentic workspaces contract](https://github.com/bharathvbcr/GitPulse/blob/main/docs/AGENTIC_WORKSPACES_PLAN.md).

## Data

There is **no** automated importer from LiquiTask JSON backups into GitPulse's
Manvi profile store. The two products use different schemas and owners.

If you still need the records:

1. Export a LiquiTask backup from **Settings → Data** (or keep the local
   IndexedDB / `tasks_export.sqlite3` files).
2. Recreate active work in GitPulse **Tasks**. A saved GitPulse task needs at
   least one linked repository and a primary repository.

Do not copy LiquiTask's `indexedDB` or `storage.json` into GitPulse app data.

## Existing installs

Installed LiquiTask **2.6.1** builds keep working. There is no forced upgrade and
this GitHub repo is not archived. Prefer GitPulse for new boards and agent runs.

## For contributors and agents

- **Do not** add features, runtimes, or further v3-shell work in this repository.
- [`docs/REWORK_PLAN_MULTICA.md`](REWORK_PLAN_MULTICA.md) is **historical**. The
  successor architecture is GitPulse, not another Multica-style layer on this
  tree.
- New task, agent, DevCouncil, DevMap, and git-workbench work belongs in
  `/Users/bharath/Code/devtools/GitPulse`.
- Leave this tree as a readable archive. Security or data-loss fixes only.

## Related documents in this repo

The README still describes what LiquiTask *was* (board, sidecar, DevCouncil
bridge) so the archive stays intelligible. Those pages are not a roadmap.
