# LiquiTask v3 — Multica-Grade Rework Plan

**Date:** 2026-07-06 (updated 2026-07-08)
**Status:** Phase 0 complete · Phase 1 largely shipped (`liquitask-agentd` sidecar + Tauri bridge live; `AGENTD_SIDECAR_ENABLED` on by default) · Phase 2 in progress (run view + Agents surface) · first-run experience choice shipped
**Scope:** Full UI/UX rework around Multica patterns, multi-agent execution (Claude Code, Codex, Antigravity, Cursor, +10 more), DevCouncil integration, red liquid glass theme retained.

---

## 1. Product Thesis

LiquiTask stops being "a smart task manager with an agent bolt-on" and becomes **a local-first agent workbench**: every task is potentially executable, every agent is a teammate with presence, and the board is just one lens over a unified work graph.

Three pillars:

1. **Tasks are executable.** Any task can be assigned to a human, a coding agent, or a council. Assignment to an agent creates a run with scope, streaming output, and an approval gate — not a fire-and-forget prompt.
2. **Agents are first-class residents.** Agent roster with presence (idle/working/blocked/awaiting-approval), per-agent runtime profiles, skills, and allowlists — Multica's model, minus the cloud.
3. **The app is proactive.** An Inbox is the primary surface: runs finishing, approvals needed, DevCouncil verdicts, standup digests. You react to the app; you don't poll it.

**Rebuild verdict: strip, don't rewrite.** The audits show LiquiTask's service/hook architecture, IndexedDB persistence, search indexes, and Tauri runner are solid and real. What's broken is the *surface* (task-manager-first shell, single-agent runner, seams between AI features) and the *loop* (no learning from approved work, silent failures). We strip dead surfaces and rebuild the shell + execution layer; we do not throw away 43 working services.

---

## 2. What the Audits Found

### 2.1 LiquiTask today (`/Users/bharath/Code/LiquiTask`)

- **Stack:** React 19 + TypeScript + Tauri 2 + Tailwind; liquid glass theme in `index.css`/`tailwind.config.js` (dark-first glassmorphism, red accent). IndexedDB persistence (`src/services/indexedDBService.ts`), <5ms inverted-index search (`searchIndexService.ts`).
- **Agent layer is multi-runtime via `liquitask-agentd`.** Go sidecar (`liquitask-agentd/`) drives all 15 coding-agent CLIs for direct runs; Rust bridge (`src-tauri/src/agentd.rs`, `agentd_store.rs`) supervises the sidecar and persists runs/events to SQLite. DevCouncil council-mode subprocesses use `agent_council_runner.rs`; shared CLI helpers (`augmented_path`, `find_executable`) live in `agent_cli_util.rs`. The legacy monolithic `agent_runner.rs` has been deleted. TS side: `src/services/agents/agentRunService.ts` + sibling services, `src/hooks/useAgentTeammates.ts`, UI in `src/components/agents/`.
- **DevCouncil is already wired** (`src-tauri/src/agent_devcouncil.rs`, `agentPlannerService.ts`, `campaignOrchestratorService.ts`) for planning/campaigns — but shallowly.
- **Known debt** (E2E_FLOW_AUDIT, POWER_USER_AUDIT): dense `App.tsx` (~2,900 lines), silent failure modes (automation dead-letter path not yet wired — see workstream 3), DevCouncil verify/repair loop still shallow.
- **Debt cleared since original audit:** root `components/` legacy wrappers removed (`src/components/` is canonical); `electron/`, `conductor/`, `CelestialBackdrop.tsx` stripped; estimate-learning write path partly closed (`recordRunOutcome` on approve/reject in `useAgentTeammates.ts` → `agentEstimateLearningService.ts`; DevCouncil-verified outcomes still TODO).

### 2.2 Multica (`github.com/multica-ai/multica`, cloned for reference)

- **Monorepo:** `apps/{desktop,web,mobile}` (desktop = electron-vite shell over web), `packages/{core,ui,views}`, `server/` (Go + PostgreSQL + WebSockets).
- **Frontend:** React + TanStack Query. `packages/core` = domain logic per feature (`agents/`, `runtimes/`, `inbox/`, `chat/`, `autopilots/`, `skills/`, `squads/`, `permissions/`, `notification-preferences/`...), `packages/views` = feature screens, `packages/ui` = presentational primitives.
- **The crown jewel — `server/pkg/agent` (Go):** unified `Backend` interface (`agent.go`) over **15 coding agents**: Claude Code, Codex, Copilot, Cursor, Grok Build, OpenCode, OpenClaw, Antigravity, Kimi, Kiro, Qoder, CodeBuddy, Hermes (ACP), Pi, Trae. Handles spawn, JSON-stream parsing, resume sessions, MCP config injection, per-agent thinking levels, per-OS invocation quirks, deadlock/cancel edge cases — all battle-tested with per-agent test suites.
- **Daemon (`server/internal/daemon` + `execenv/`):** detects installed CLIs, prepares per-run execution environments (codex home isolation, cursor MCP config, git worktrees via `repocache/`, skill mounting, handoff prompts), reconciles orphaned runs, health checks, GC.
- **Cloud coupling:** everything flows through the Go server (auth, workspaces, realtime WS, billing, Slack/Lark/GitHub/Composio integrations). `packages/core/api` is a REST+WS client. The *daemon and agent package are the least cloud-coupled parts*; the frontend packages are coupled at exactly one seam (the `api` client + TanStack Query).

### 2.3 DevCouncil (`/Users/bharath/Code/DevCouncil`)

- Gated orchestration: council debate (6 LLM roles) → typed `Task`/`Requirement` → **PlannedFile scope whitelist** → executor handoff (Claude Code, Codex, Cursor, Aider CLIs) → **deterministic 4-tier verification** (scope compliance, tests, coverage, rigor) → artifact graph (Requirement → Task → Diff → Evidence) in SQLite (`.devcouncil/state.db`).
- Integration surfaces: CLI (`dev plan|run|verify` with JSON I/O), MCP server (`dev mcp-server`), SQLite polling, Python import. **Recommended: CLI subprocess + JSON + SQLite polling; MCP server exposed to agent runs.**

---

## 3. Target Architecture

```
┌───────────────────────────── LiquiTask (Tauri 2) ─────────────────────────────┐
│  React 19 shell — 4 surfaces: Inbox · Board · Agents · Command Deck           │
│  packages-style layout: ui/ (glass primitives) · core/ (domain) · views/      │
│      TanStack Query ──► localApi adapter (Tauri invoke + events)              │
├───────────────────────────────────────────────────────────────────────────────┤
│  Rust core (src-tauri): storage, search, policy, run store, notifications,    │
│  sidecar supervision, DevCouncil bridge                                       │
├──────────────────────┬────────────────────────────────┬───────────────────────┤
│  liquitask-agentd    │  DevCouncil (Python CLI)       │  Local data           │
│  (Go sidecar from    │  dev plan/run/verify,          │  SQLite: runs, agents,│
│  multica server/pkg/ │  dev mcp-server,               │  events, artifacts    │
│  agent + daemon      │  .devcouncil/state.db          │  IndexedDB: tasks/UI  │
│  execenv, cloud-     │                                │  (migrating → SQLite) │
│  stripped)           │                                │                       │
└──────────┬───────────┴────────────────────────────────┴───────────────────────┘
           ▼
  Claude Code · Codex · Antigravity · Cursor · Copilot · OpenCode · Kimi ·
  Kiro · Qoder · CodeBuddy · Hermes · Pi · Trae · OpenClaw  (user-installed CLIs)
```

### 3.1 Decision: agent execution via Go sidecar, not Rust rewrite

Port Multica's `server/pkg/agent` + the daemon's `execenv`/detection/reconcile logic into a standalone Go binary, **`liquitask-agentd`**, shipped as a [Tauri sidecar](https://tauri.app/develop/sidecar/). Speaks newline-delimited JSON-RPC over stdio to the Rust core.

Why not rewrite in Rust: the agent package encodes hundreds of per-agent, per-OS edge cases (Windows invocation shims for Copilot/Cursor/Pi, Codex home isolation, Claude deadlock handling, ACP for Hermes) with test coverage. Rewriting forfeits that. All direct runs now route through the sidecar (`agentd.rs`); the former monolithic `agent_runner.rs` has been retired.

What gets stripped from the ported daemon code: server client (`daemon/client.go`), auth/identity handshake, workspace registration, WS transport, billing/usage upload, cloud runtimes, auto-update. What remains: CLI detection, `Backend` implementations, `execenv` preparation (incl. git worktree repocache), run lifecycle + reconcile, local skills mounting, health.

`agentd` JSON-RPC surface (v1):

- `detect` → installed runtimes + versions (replaces `agent_detect_clis`)
- `run.start {taskId, runtime, model, cwd, prompt, scope?, mcpConfig?, thinkingLevel?, resumeSessionId?}` → runId
- `run.events` (stream): `message | tool_use | thinking | permission_request | result | error`
- `run.cancel / run.pause / run.resume / run.inject`
- `run.reattach` → orphaned runs after app restart
- `permission.respond {runId, requestId, allow|deny|always}`

### 3.2 Decision: frontend ports from Multica

Adopt Multica's **three-layer frontend layout** inside `src/`: `src/ui` (primitives), `src/core` (domain: queries, stores, types per feature), `src/views` (screens). Port with restyling to liquid glass:

| Port from Multica | Source | Into | Coupling notes |
|---|---|---|---|
| Agent presence/activity derivation | `packages/core/agents/derive-presence.ts`, `use-agent-activity.ts` | `src/core/agents/` | Pure logic — cheap |
| Runtime profiles + health | `packages/core/runtimes/` (`profiles.ts`, `derive-health.ts`, `cli-version.ts`, `models.ts`) | `src/core/runtimes/` | Swap `api.*` calls → `localApi` |
| Inbox (event feed + triage) | `packages/core/inbox/`, `packages/views/inbox/` | `src/core/inbox/`, `src/views/inbox/` | Feed from local event bus instead of WS |
| Chat/session view (streamed run transcript, tool timeline, approval prompts) | `packages/views/chat/`, `packages/core/chat/` | `src/views/run/` | Highest value; moderate rework (WS → Tauri events) |
| Autopilots (recurring agent jobs) | `packages/core/autopilots/`, `packages/views/autopilots/` | `src/core/autopilots/` | Merge with existing `agentRecurrence.ts` |
| Skills management | `packages/core/skills/`, `packages/views/skills/` + daemon `local_skills.go` | `src/core/skills/` | Merge with `agentSkillsService.ts` |
| Squads (agent teams) | `packages/core/squads/`, `packages/views/squads/` | `src/core/squads/` | Maps onto existing campaign roles |
| Permissions/allowlists | `packages/core/permissions/`, `use-update-agent-allowlist.ts` | `src/core/permissions/` | Merge with `agentPolicyService.ts` + `agent_policy.rs` |
| Notification preferences | `packages/core/notification-preferences/` | `src/core/notifications/` | Local only |
| UI primitives (as needed) | `packages/ui/components/` | `src/ui/` | Reskin: glass surfaces, red accent |

**Not ported:** `auth/`, `billing/`, `realtime/` (replaced by Tauri event bus), `composio/`, `slack/`, `lark/`, `analytics/`, `feature-flags/`, `invitations/`, `members/`, multi-workspace plumbing (LiquiTask is single-user, single-workspace-per-window). `github/` port deferred — LiquiTask has its own `githubSyncService.ts`.

**The seam:** Multica's `packages/core` touches the network only through its `api` client and TanStack Query. We keep TanStack Query (add it to LiquiTask) and implement `localApi` with the same method signatures, backed by Tauri `invoke` + event listeners. This preserves ported hooks/components nearly verbatim.

### 3.3 Decision: data layer

- **Runs, agents, events, artifacts move to SQLite** (Tauri side, extending `run_store.rs`). Reasons: the run/event graph is relational, DevCouncil's evidence already lives in SQLite, reattach/reconcile needs durable server-side state, and IndexedDB can't be read by the sidecar.
- **Tasks/projects/views stay in IndexedDB short-term** (working, fast, encrypted), with a migration to SQLite in Phase 4 so the whole work graph is queryable by agents through one store. `migrationService.ts` already provides the pattern.

### 3.4 DevCouncil integration (deep, not shallow)

Extend `agent_devcouncil.rs` into a full bridge:

1. **Plan gate (opt-in per task):** "Assign to council" → `dev plan` subprocess → typed Tasks/Requirements + PlannedFile scope rendered as an approval card in Inbox. Approving spawns agent runs *with that scope*.
2. **Scope enforcement:** pass PlannedFile whitelist into `run.start`; `agentd` mounts it via each backend's permission mechanism (MCP permission server for Claude Code; config injection for others). Out-of-scope mutating tool calls are denied by `agentScopeService.ts` on the MCP permission-prompt path. **`agent_policy.rs` is model routing + budget, not scope.**
3. **Verify gate:** run completion triggers `dev verify` → 4-tier proof (scope/tests/coverage/rigor) → verdict card in Inbox with typed `next_actions`. "Repair" spawns a follow-up run seeded with the structured repair instructions; done-means-proven, not agent-claims-done.
4. **Evidence graph:** poll `.devcouncil/state.db`, mirror Requirement→Task→Diff→Evidence links into LiquiTask's artifact tables; render provenance on the task card.
5. **MCP:** register `dev mcp-server` in the MCP config `agentd` passes to runs, so agents can self-serve checkout→verify→repair loops.
6. **Close the learning loop (existing debt):** verified run outcomes (duration, diff size, verdicts) write back into `agentEstimateLearningService.ts` so estimates and agent-routing improve over time.

### 3.5 The four surfaces (UX rework)

Replace the current view-switcher-of-nine-views shell with four surfaces (board views like Calendar/Gantt/Archive become lenses inside Board):

1. **Inbox (default).** Multica-style triage feed: approvals awaiting you, runs finished, council verdicts, blocked agents, digests. Every card has inline actions (approve/deny, open run, re-run, snooze). Badge on tray icon (`tray.rs`).
2. **Board.** Existing ProjectBoard, decluttered: task cards gain agent chips (assignee avatar = agent, presence ring, live run status), drag-a-task-onto-an-agent in the roster rail to assign+run (existing `AgentDropTray.tsx` generalizes). Views: Kanban / Calendar / Gantt / List.
3. **Agents.** Roster with presence, per-agent: runtime profile (binding to detected CLI + model + thinking level), skills, allowlists, run history, cost/usage. Squad composition. Runtime health (from `derive-health.ts` port + `agentd detect`).
4. **Run view (drawer/full-screen).** Ported Multica chat/session view: streamed transcript, tool-call timeline, diff viewer, permission prompts inline, guidance injection box (existing `agentd_run_inject` command), open-in-terminal escape hatch.

**Command Deck:** the existing `CommandPalette.tsx` grows into the universal entry point (⌘K): create task, assign to agent/council, jump to run, toggle surfaces, run autopilot — every action reachable by keyboard.

**Proactivity rules:** notify only on *user-actionable* events (approval needed, run failed, verdict ready); everything else accrues to Inbox silently. Standup digest (existing `useAgentStandupDigest`) posts to Inbox on schedule.

### 3.6 Liquid glass design system (kept, systematized)

Keep the red liquid glass identity; promote it from ad-hoc CSS to tokens in `src/ui/`:

- **Tokens:** `--glass-{0..3}` elevation surfaces (blur/alpha tiers), `--accent-red` scale (existing), status hues (running=amber pulse, awaiting=red glow, verified=emerald, failed=crimson), spring motion tokens.
- **Primitives:** `GlassPanel`, `GlassCard`, `PresenceRing`, `StatusPill`, `StreamText` (token-streaming shimmer), `ApprovalCard`. Ported Multica `packages/ui` components get reskinned onto these, not used raw.
- **Motion:** liquid transitions between surfaces (existing `ViewTransition.tsx` as the base), agent presence "breathes", run cards ripple on new events. Drop `CelestialBackdrop.tsx` (perf debt) for a cheaper animated red-glass gradient.
- **Density:** collapse the current modal zoo — audits flagged modal-splitting debt; approval/review flows move inline into Inbox cards and the run drawer.

---

## 4. Strip List (before rebuilding)

Delete or archive in Phase 0:

- `electron/` and `components/` legacy wrappers (Tauri is the shell; `src/components` is canonical)
- `conductor/`, `agent-sandbox/` (superseded by `agentd` + execenv worktrees)
- `CelestialBackdrop.tsx`
- Root-level log/audit droppings: `*_log.txt`, `test_results.txt`, `diff.txt`, `tsc_output.txt`, etc. → `docs/archive/`
- ~~Rust `agent_runner.rs`~~ — **done** (retired; direct runs → `agentd.rs`, council mode → `agent_council_runner.rs`, CLI helpers → `agent_cli_util.rs`)
- Any `src/components/AI*.tsx` modal whose function moves into Inbox/run drawer (fold, don't duplicate)

Keep untouched: `indexedDBService.ts`, `searchIndexService.ts`, `encryptionService.ts`, `storageService.ts`, `semantic_layer/`, `githubSyncService.ts`, automation/recurrence engines, board core.

---

## 5. Phased Roadmap

### Phase 0 — Strip & scaffold (≈1 week)
- Execute strip list; move board views under one `src/views/board/`.
- Add TanStack Query; create `src/{ui,core,views}` skeleton and `localApi` adapter stub.
- Vendor Multica reference code into `vendor/multica-ref/` (source of ports; excluded from build). Record attribution in `docs/THIRD_PARTY.md`. **License (verified from repo):** modified Apache 2.0 — personal and internal-organizational use is fine; embedding Multica "in whole or substantial part" in a *commercially distributed* product requires a commercial license. Fine for personal use; revisit before any commercial LiquiTask distribution.
- Exit: app builds and runs with current features intact, new layout in place.

### Phase 1 — `liquitask-agentd` sidecar (≈2–3 weeks)
- Extract `server/pkg/agent` + daemon `execenv`, detection, reconcile, local_skills into a new Go module; strip server client/auth/WS/billing/cloud-runtime code; add stdio JSON-RPC front.
- Tauri: sidecar supervision in Rust core; bridge JSON-RPC ↔ Tauri events; extend `run_store.rs` to SQLite run/event tables.
- Wire `agentRunService.ts` to the new surface behind a feature flag (`AGENTD_SIDECAR_ENABLED`; now on by default).
- Exit: a task runs end-to-end on Claude Code, Codex, Cursor, and Antigravity via `agentd`; cancel/pause/inject/reattach work; CLI detection populates runtime health UI.

### Phase 2 — Run view + Agents surface (≈2 weeks)
- Port chat/session view → run drawer (transcript, tool timeline, diff viewer, inline permission prompts).
- Port runtimes (profiles/health/models) + agents (presence/activity) cores; rebuild Agents surface; generalize AgentDropTray to full roster rail on Board.
- Reskin ported components to liquid glass tokens; build the primitive set.
- Exit: assign-from-board → watch stream → approve permissions → review diff, for any detected runtime. Old run UI deleted.

### Phase 3 — Inbox + proactivity (≈2 weeks)
- Local event bus (Rust → Tauri events → `src/core/inbox`); port inbox views; tray badge + native notifications policy.
- Approval cards, verdict cards, digest cards; Command Deck expansion; notification preferences port.
- Exit: Inbox is the default surface; zero modal-based approvals remain.

### Phase 4 — DevCouncil deep integration (≈2–3 weeks)
- Plan gate, scope-enforced runs, verify gate with typed repairs, evidence mirroring, `dev mcp-server` in run MCP config (per §3.4).
- Close the estimate-learning write loop.
- Exit: council-assigned task goes plan → approve → scoped run → verify → verdict → (repair loop) → done, fully in-app; task cards show evidence provenance.

### Phase 5 — Autopilots, squads, polish (≈2 weeks)
- Port autopilots (merge `agentRecurrence`), squads (merge campaign roles), skills manager (merge `agentSkillsService` + `local_skills.go`).
- Task→SQLite migration; motion polish pass; empty states.
- **Onboarding (partial):** `ExperienceChoiceGate` ships the first-run Simple vs AI Agent Board choice (`src/utils/onboarding.ts`, `src/utils/aiFeatures.ts`); remaining: CLI detection reveal moment on first agent setup.
- Exit: v3.0 release candidate.

**Total: ~10–12 weeks.** Phases 1–2 are the critical path; 3–5 can partially overlap.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Go sidecar bloats bundle / platform builds | `agentd` is a static Go binary (~15–25MB); Tauri sidecar per-target builds in CI. Acceptable for a desktop agent app. |
| Multica code drifts / upstream changes | Vendored snapshot; we own the fork of `pkg/agent`. Periodic manual re-sync only if valuable. |
| Multica license constraints | Verified: modified Apache 2.0. Personal/internal use OK; commercial distribution of LiquiTask embedding substantial Multica code would need a commercial license from Multica. Keep attribution; get written authorization if LiquiTask is ever sold. |
| Agent CLIs change flags (Codex/Cursor churn) | Multica's per-agent version detection (`cli-version.ts`, `version.go`) ports over; pin known-good ranges, surface health warnings. |
| DevCouncil Python dependency friction | Bundle a `uv`-managed environment or document `pipx install`; degrade gracefully (council features hidden if `dev` not found). |
| Scope creep into full rewrite | Strip list is bounded; every phase exits with a working app; feature flags gate new paths. |
| IndexedDB/SQLite dual-store inconsistency | Runs/events are SQLite-only from Phase 1 (no dual write); task migration is a single cutover in Phase 5 with `migrationService` backup. |

---

## 7. Acceptance Criteria (v3.0)

1. Fresh install detects ≥ all installed CLIs among the 15 supported runtimes and shows health per runtime.
2. A board task can be assigned to any detected agent in ≤2 interactions (drag-to-roster or ⌘K), producing a streamed, cancellable, resumable run.
3. Permission requests surface inline within 500ms of the agent emitting them; "always allow" persists per agent policy.
4. Council flow: plan → scoped run → deterministic verify → verdict with typed repairs, no terminal required.
5. App restart reattaches to live runs (reconcile) with no lost events.
6. Inbox is default; no approval or review flows in modals; tray badge reflects actionable count.
7. Red liquid glass system: all new surfaces built from `src/ui` tokens/primitives; Lighthouse-style frame budget — board scroll and stream rendering hold 60fps with 3 concurrent runs.
8. Estimate learning writes back after verified runs; agent routing suggestions cite past performance.
9. `pnpm build && cargo tauri build` green on macOS; existing vitest + Rust test suites pass; new `agentd` carries over Multica's per-agent Go tests.

---

## 8. Immediate Next Steps

1. Review/adjust this plan (especially: Go-sidecar decision §3.1, four-surface shell §3.5, phase order).
2. Confirm Multica license terms fit this use.
3. Phase 0 kickoff: strip list + scaffold PR.
