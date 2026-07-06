package daemon

import (
	"context"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/daemon/repocache"
)

// This file defines the minimal Daemon/Config/workspaceState shapes needed
// by health.go, diskusage.go, and gc.go — the three files ported so far from
// vendor/multica-ref/server/internal/daemon/. The upstream project's real
// orchestrator (daemon.go, ~4600 lines: task claiming, WS heartbeats, runtime
// registration, workspace sync against a remote server, auto-update, ...) is
// NOT ported here; it belongs to a separate, much larger porting pass.
//
// Everything below is a local-only stand-in scoped to exactly the fields the
// ported files read or write. It intentionally has no server client, no
// workspace-sync loop, and no registration/heartbeat machinery — this
// sidecar is single-user and local-first, so those cloud concerns simply
// don't exist here. When the real orchestrator is ported, this file should
// be deleted (or merged) and its callers re-pointed at the fuller type.

// AgentEntry (path + optional model override) is declared in types.go and
// reused here for Config.Agents — see that file for the definition.

// Config holds daemon configuration relevant to the ported subsystems
// (health reporting + GC). Trimmed to the fields health.go/diskusage.go/gc.go
// actually use; the full upstream Config additionally carries poll/heartbeat
// intervals, agent watchdogs, auto-update settings, etc., which belong to
// the orchestrator port.
type Config struct {
	DaemonID      string
	DeviceName    string
	ServerBaseURL string
	CLIVersion    string
	HealthPort    int
	Agents        map[string]AgentEntry

	WorkspacesRoot string

	GCEnabled          bool
	GCInterval         time.Duration
	GCTTL              time.Duration
	GCOrphanTTL        time.Duration
	GCArtifactTTL      time.Duration
	GCArtifactPatterns []string
}

// workspaceState tracks registered runtimes for a single workspace.
//
// Upstream, this struct also carries repo-allowlist state and profile
// signatures synced from a remote server on a 30s ticker. This sidecar has
// no remote workspaces to sync from — LiquiTask projects are local records,
// not server-synced workspaces — so this is trimmed to just the fields the
// ported health handler reads (workspace id + its registered runtime ids).
type workspaceState struct {
	workspaceID string
	runtimeIDs  []string
}

// repoCacheBackend is the subset of repocache.Cache the GC loop needs to
// serialize `git worktree prune` / branch cleanup against concurrent
// worktree creation (see pruneWorktree in gc.go). Purely local git-cache
// locking — no server involvement — so it's ported as-is rather than
// stubbed.
type repoCacheBackend interface {
	Lookup(workspaceID, url string) string
	Sync(workspaceID string, repos []repocache.RepoInfo) error
	WithRepoLock(barePath string, fn func() error) error
	CreateWorktree(params repocache.WorktreeParams) (*repocache.WorktreeResult, error)
}

// Daemon is the local-only placeholder for the future ported orchestrator.
// Only the fields touched by health.go/diskusage.go/gc.go are present.
type Daemon struct {
	cfg       Config
	logger    *slog.Logger
	repoCache repoCacheBackend // nil-safe; pruneWorktree falls back to unlocked git calls when nil

	mu sync.Mutex
	// workspaces has at most one implicit entry in this sidecar today: there
	// is no remote workspace list to sync, so nothing currently populates
	// this map. It's kept (rather than deleted) so healthHandler's shape and
	// wire format stay identical to upstream, and so a future local
	// "projects as workspaces" concept has a slot to populate without
	// another handler rewrite. Treat as always-empty / always-fresh — no
	// server uplink means no staleness to reason about.
	workspaces map[string]*workspaceState

	cancelFunc  context.CancelFunc // set by Run(); called by shutdownHandler / triggerRestart-equivalent
	activeTasks atomic.Int64       // number of tasks currently executing; exposed via /health
	ready       atomic.Bool        // false until local startup completes; gates /health status (starting -> running)

	// activeEnvRoots refcounts env roots with a task currently running
	// against them, so the GC loop never reclaims a directory out from under
	// live work. Mirrors upstream Daemon.activeEnvRoots/isActiveEnvRoot.
	activeEnvRootsMu sync.Mutex
	activeEnvRoots   map[string]int
}

// NewLocalDaemon constructs the local-only Daemon shim. Named distinctly
// from upstream's New() because this is not the full orchestrator
// constructor — it exists only to give the ported health/GC code a
// receiver to hang off of.
func NewLocalDaemon(cfg Config, logger *slog.Logger) *Daemon {
	return &Daemon{
		cfg:            cfg,
		logger:         logger,
		workspaces:     make(map[string]*workspaceState),
		activeEnvRoots: make(map[string]int),
	}
}

// markActiveEnvRoot/unmarkActiveEnvRoot/isActiveEnvRoot mirror the upstream
// refcounted active-env-root tracking (daemon.go). Local logic only — no
// stubbing needed.

func (d *Daemon) markActiveEnvRoot(envRoot string) {
	d.activeEnvRootsMu.Lock()
	defer d.activeEnvRootsMu.Unlock()
	d.activeEnvRoots[envRoot]++
}

func (d *Daemon) unmarkActiveEnvRoot(envRoot string) {
	d.activeEnvRootsMu.Lock()
	defer d.activeEnvRootsMu.Unlock()
	if d.activeEnvRoots[envRoot] <= 1 {
		delete(d.activeEnvRoots, envRoot)
		return
	}
	d.activeEnvRoots[envRoot]--
}

func (d *Daemon) isActiveEnvRoot(envRoot string) bool {
	d.activeEnvRootsMu.Lock()
	defer d.activeEnvRootsMu.Unlock()
	return d.activeEnvRoots[envRoot] > 0
}

// sleepWithContext blocks for d or until ctx is cancelled, whichever comes
// first. Ported verbatim from upstream helpers.go (pure local logic, no
// stubbing needed) since helpers.go itself is not part of this porting pass.
func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
