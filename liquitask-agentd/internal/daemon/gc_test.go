package daemon

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/daemon/repocache"
	"github.com/liquitask/liquitask-agentd/internal/execenv"
)

// newGCTestDaemon creates a minimal Daemon for GC testing.
//
// STUBBED: upstream newGCTestDaemon also stands up an httptest server and
// wires d.client to it, because shouldCleanTaskDir upstream calls out to the
// server's gc-check endpoints. This sidecar's GC policy is local-only (see
// gc.go's gcDecisionByAge), so there is no client/server to construct here.
func newGCTestDaemon(t *testing.T) *Daemon {
	t.Helper()

	root := t.TempDir()
	cfg := Config{
		WorkspacesRoot:     root,
		GCEnabled:          true,
		GCInterval:         1 * time.Hour,
		GCTTL:              5 * 24 * time.Hour,
		GCOrphanTTL:        30 * 24 * time.Hour,
		GCArtifactTTL:      12 * time.Hour,
		GCArtifactPatterns: []string{"node_modules", ".next", ".turbo"},
	}
	return NewLocalDaemon(cfg, slog.Default())
}

// createTaskDir creates a task directory with optional GC metadata.
func createTaskDir(t *testing.T, root, wsID, dirName string, meta *execenv.GCMeta) string {
	t.Helper()
	taskDir := filepath.Join(root, wsID, dirName)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if meta != nil {
		data, _ := json.Marshal(meta)
		if err := os.WriteFile(filepath.Join(taskDir, ".gc_meta.json"), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return taskDir
}

// TestShouldCleanTaskDir_DoneOverTTL is the local-policy replacement for
// upstream's TestShouldCleanTaskDir_DoneIssueOverTTL /
// TestShouldCleanTaskDir_CancelledIssueOverTTL: without a remote "is the
// issue done/cancelled" signal, a task whose CompletedAt is older than GCTTL
// is eligible for cleanup regardless of kind.
func TestShouldCleanTaskDir_DoneOverTTL(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task1", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "11111111-1111-1111-1111-111111111111",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-10 * 24 * time.Hour), // well past GCTTL (5d)
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionClean {
		t.Fatalf("expected gcActionClean, got %d", action)
	}
}

// TestShouldCleanTaskDir_DoneButRecentSkipped is the local-policy replacement
// for upstream's remote-status "in_progress"/"recent done" cases: since there
// is no remote status at all now, only the completed_at-vs-TTL comparison
// governs, and a task completed recently (within GCTTL) is skipped whether or
// not any hypothetical remote parent record would still call itself "open".
func TestShouldCleanTaskDir_DoneButRecentSkipped(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task4", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "44444444-4444-4444-4444-444444444444",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-1 * time.Hour), // within GCTTL (5d) and GCArtifactTTL (12h)
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionSkip {
		t.Fatalf("expected gcActionSkip for recently-completed task, got %d", action)
	}
}

func TestShouldCleanTaskDir_NoMetaRecentSkipped(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	// No meta, fresh directory — should skip.
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task5", nil)

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionSkip {
		t.Fatalf("expected gcActionSkip for recent orphan, got %d", action)
	}
}

func TestShouldCleanTaskDir_NoMetaOldOrphan(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	d.cfg.GCOrphanTTL = 0 // treat all orphans as expired
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task6", nil)

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionOrphan {
		t.Fatalf("expected gcActionOrphan, got %d", action)
	}
}

// TestShouldCleanTaskDir_MetaWithoutCompletedAtFallsBackToMTime covers the
// meta-present-but-CompletedAt-zero edge (e.g. a hand-edited or truncated
// .gc_meta.json). It must fall back to the same mtime-vs-GCOrphanTTL check as
// a missing meta file, not be treated as "just completed".
func TestShouldCleanTaskDir_MetaWithoutCompletedAtFallsBackToMTime(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	d.cfg.GCOrphanTTL = 0 // treat all orphans as expired
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task-no-completed-at", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "11111111-1111-1111-1111-111111111112",
		WorkspaceID: "ws1",
		// CompletedAt intentionally zero.
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionOrphan {
		t.Fatalf("expected gcActionOrphan for meta with zero CompletedAt past orphan TTL, got %d", action)
	}
}

func TestCleanTaskDir_RemovesDirectory(t *testing.T) {
	t.Parallel()
	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "doomed", nil)

	if _, err := os.Stat(taskDir); err != nil {
		t.Fatal("task dir should exist before cleanup")
	}

	d.cleanTaskDir(taskDir)

	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatal("task dir should be removed after cleanup")
	}
}

func TestGcWorkspace_CleansEmptyWorkspaceDir(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	wsDir := filepath.Join(d.cfg.WorkspacesRoot, "ws-empty")
	createTaskDir(t, d.cfg.WorkspacesRoot, "ws-empty", "only-task", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "77777777-7777-7777-7777-777777777777",
		WorkspaceID: "ws-empty",
		CompletedAt: time.Now().Add(-10 * 24 * time.Hour), // past GCTTL
	})

	d.gcWorkspace(context.Background(), wsDir, &gcStats{byPattern: map[string]int{}})

	if _, err := os.Stat(wsDir); !os.IsNotExist(err) {
		t.Fatal("empty workspace dir should be removed after all tasks cleaned")
	}
}

// TestShouldCleanTaskDir_ArtifactCleanupWindow is the local-policy
// replacement for upstream's TestShouldCleanTaskDir_OpenIssueArtifactCleanup:
// a task completed longer ago than GCArtifactTTL but within GCTTL is eligible
// for artifact-only cleanup.
func TestShouldCleanTaskDir_ArtifactCleanupWindow(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "open-task", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "88888888-8888-8888-8888-888888888888",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-24 * time.Hour), // past GCArtifactTTL (12h), within GCTTL (5d)
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionCleanArtifacts {
		t.Fatalf("expected gcActionCleanArtifacts for old completed task within GCTTL, got %d", action)
	}
}

func TestShouldCleanTaskDir_RecentTaskSkipped(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "fresh-task", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "88888888-8888-8888-8888-888888888889",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-1 * time.Minute),
	})

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip for fresh completed_at, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsArtifactCleanup(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-task", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "88888888-8888-8888-8888-88888888888a",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-24 * time.Hour),
	})

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip while task is active, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsFullCleanup(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	// Completed long enough ago to satisfy GCTTL — this would normally return
	// gcActionClean. But the env root is in use (e.g. follow-up comment
	// dispatched a task that reuses the prior workdir). Active-root guard
	// must override.
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-done", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "99999999-9999-9999-9999-999999999999",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-30 * 24 * time.Hour),
	})

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on active env root with completed+stale task, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsNoMetaOrphan(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	d.cfg.GCOrphanTTL = 0
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-no-meta", nil)

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on active env root with no-meta orphan, got %d", action)
	}
}

func TestShouldCleanTaskDir_ArtifactTTLDisabled(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	d.cfg.GCArtifactTTL = 0
	// Age inside GCTTL but past where GCArtifactTTL would normally trigger,
	// so the only thing under test is the disabled flag.
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "no-artifact-gc", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "88888888-8888-8888-8888-88888888888c",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-24 * time.Hour),
	})

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip when artifact GC disabled, got %d", action)
	}
}

func TestCleanTaskArtifacts_RemovesOnlyMatchedDirs(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := t.TempDir()

	// Create a synthetic project layout.
	mustMkdir := func(rel string) string {
		p := filepath.Join(taskDir, rel)
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	mustWrite := func(rel string, content string) {
		p := filepath.Join(taskDir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	mustMkdir("workdir/repo/src")
	mustWrite("workdir/repo/src/index.ts", "console.log('hi')")
	mustMkdir("workdir/repo/.git/objects")
	mustWrite("workdir/repo/.git/objects/pack", "binary")
	mustMkdir("workdir/repo/node_modules/lodash")
	mustWrite("workdir/repo/node_modules/lodash/index.js", "module.exports = {}")
	mustMkdir("workdir/repo/.next/cache")
	mustWrite("workdir/repo/.next/cache/page.html", "<html></html>")
	mustMkdir("workdir/repo/.turbo")
	mustWrite("workdir/repo/.turbo/log", "trace")
	mustMkdir("workdir/repo/dist") // not in default patterns — must be preserved
	mustWrite("workdir/repo/dist/main.js", "compiled")
	mustWrite(".gc_meta.json", `{"issue_id":"x"}`)
	mustMkdir("output")
	mustWrite("output/result.txt", "done")

	removed, bytes, perPattern := d.cleanTaskArtifacts(taskDir, []string{"node_modules", ".next", ".turbo"})

	if removed != 3 {
		t.Fatalf("expected 3 artifact dirs removed, got %d", removed)
	}
	if bytes <= 0 {
		t.Fatalf("expected non-zero bytes reclaimed, got %d", bytes)
	}
	if perPattern["node_modules"] != 1 || perPattern[".next"] != 1 || perPattern[".turbo"] != 1 {
		t.Fatalf("unexpected per-pattern counts: %+v", perPattern)
	}

	// Verify protected paths are intact.
	for _, rel := range []string{
		"workdir/repo/src/index.ts",
		"workdir/repo/.git/objects/pack",
		"workdir/repo/dist/main.js",
		"output/result.txt",
		".gc_meta.json",
	} {
		if _, err := os.Stat(filepath.Join(taskDir, rel)); err != nil {
			t.Errorf("expected %s to be preserved, got %v", rel, err)
		}
	}

	// Verify removed paths are gone.
	for _, rel := range []string{
		"workdir/repo/node_modules",
		"workdir/repo/.next",
		"workdir/repo/.turbo",
	} {
		if _, err := os.Stat(filepath.Join(taskDir, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed, stat err=%v", rel, err)
		}
	}
}

func TestCleanTaskArtifacts_RejectsPatternsWithSeparators(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(taskDir, "workdir", "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}

	removed, _, _ := d.cleanTaskArtifacts(taskDir, []string{"workdir/node_modules", "../etc"})
	if removed != 0 {
		t.Fatalf("expected 0 removals from separator-bearing patterns, got %d", removed)
	}
	if _, err := os.Stat(filepath.Join(taskDir, "workdir", "node_modules")); err != nil {
		t.Fatalf("dir should still exist, got %v", err)
	}
}

func TestCleanTaskArtifacts_DoesNotFollowSymlinks(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := t.TempDir()
	outside := t.TempDir()
	keepFile := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keepFile, []byte("safe"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(filepath.Join(taskDir, "workdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(taskDir, "workdir", "node_modules")
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}

	removed, _, _ := d.cleanTaskArtifacts(taskDir, []string{"node_modules"})
	if removed != 0 {
		t.Fatalf("expected 0 removals (symlinked node_modules), got %d", removed)
	}
	if _, err := os.Stat(keepFile); err != nil {
		t.Fatalf("symlinked target was deleted: %v", err)
	}
}

func TestActiveEnvRootRefcount(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	root := "/tmp/fake/env"

	if d.isActiveEnvRoot(root) {
		t.Fatal("expected inactive before mark")
	}
	d.markActiveEnvRoot(root)
	d.markActiveEnvRoot(root) // second mark from reuse path
	if !d.isActiveEnvRoot(root) {
		t.Fatal("expected active after mark")
	}
	d.unmarkActiveEnvRoot(root)
	if !d.isActiveEnvRoot(root) {
		t.Fatal("expected still active after one unmark")
	}
	d.unmarkActiveEnvRoot(root)
	if d.isActiveEnvRoot(root) {
		t.Fatal("expected inactive after both unmarks")
	}
}

func TestIsBareRepo(t *testing.T) {
	t.Parallel()

	t.Run("valid bare repo", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "HEAD"), []byte("ref: refs/heads/main"), 0o644)
		os.MkdirAll(filepath.Join(dir, "objects"), 0o755)
		if !isBareRepo(dir) {
			t.Fatal("expected isBareRepo=true for dir with HEAD + objects/")
		}
	})

	t.Run("HEAD only", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "HEAD"), []byte("ref: refs/heads/main"), 0o644)
		if isBareRepo(dir) {
			t.Fatal("expected isBareRepo=false for dir with only HEAD")
		}
	})

	t.Run("empty dir", func(t *testing.T) {
		dir := t.TempDir()
		if isBareRepo(dir) {
			t.Fatal("expected isBareRepo=false for empty dir")
		}
	})
}

func TestPruneWorktree_RemovesOnlyStaleAgentBranches(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)

	activeWorktree := filepath.Join(t.TempDir(), "active")
	activeBranch := "agent/live/12345678"
	staleBranch := "agent/stale/87654321"
	keepBranch := "main"

	runGitForGC(t, "", "-C", barePath, "worktree", "add", "-b", activeBranch, activeWorktree, "HEAD")
	runGitForGC(t, "", "-C", barePath, "branch", staleBranch, "HEAD")

	d.pruneWorktree(barePath)

	if gitRefExists(t, barePath, "refs/heads/"+staleBranch) {
		t.Fatalf("expected stale branch %q to be deleted", staleBranch)
	}
	if !gitRefExists(t, barePath, "refs/heads/"+activeBranch) {
		t.Fatalf("expected active branch %q to be preserved", activeBranch)
	}
	if !gitRefExists(t, barePath, "refs/heads/"+keepBranch) {
		t.Fatalf("expected non-agent branch %q to be preserved", keepBranch)
	}
}

// TestPruneWorktree_IgnoresLiteralAgentBranch ensures the GC pattern is scoped
// to the `agent/` namespace. A repo whose only `agent`-shaped ref is the
// literal `refs/heads/agent` (no slash) must be left untouched — the
// `for-each-ref` query is narrowed to `refs/heads/agent/` for that reason.
func TestPruneWorktree_IgnoresLiteralAgentBranch(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)
	runGitForGC(t, "", "-C", barePath, "branch", "agent", "HEAD")

	d.pruneWorktree(barePath)

	if !gitRefExists(t, barePath, "refs/heads/agent") {
		t.Fatal("expected literal `agent` branch outside the daemon namespace to be preserved")
	}
}

// TestPruneWorktree_SkipsMaintenanceWhenNothingDeleted pins the gate that
// keeps the heavy `gc --prune` step from running on every GC tick. Uses an
// unreachable loose blob backdated past the prune horizon as a sentinel: it
// survives when no agent branch was deleted (no maintenance), and disappears
// once a stale agent branch is reaped (maintenance ran).
func TestPruneWorktree_SkipsMaintenanceWhenNothingDeleted(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)

	// Park an active agent worktree so the scan has something to filter, and
	// to make sure pruneWorktree exercises the full code path.
	activeWorktree := filepath.Join(t.TempDir(), "active")
	runGitForGC(t, "", "-C", barePath, "worktree", "add", "-b", "agent/live/12345678", activeWorktree, "HEAD")

	sentinelPath := writeOldLooseBlob(t, barePath, "sentinel-content", 60*24*time.Hour)

	// No stale agent branch → no deletion → no `gc --prune`. The sentinel
	// blob must survive.
	d.pruneWorktree(barePath)
	if _, err := os.Stat(sentinelPath); err != nil {
		t.Fatalf("expected sentinel blob to survive when nothing was deleted: %v", err)
	}

	// Introduce a stale agent branch → deletion happens → maintenance runs →
	// `gc --prune=30.days` reaps the sentinel blob.
	runGitForGC(t, "", "-C", barePath, "branch", "agent/stale/87654321", "HEAD")
	d.pruneWorktree(barePath)
	if _, err := os.Stat(sentinelPath); !os.IsNotExist(err) {
		t.Fatalf("expected sentinel blob to be pruned after maintenance ran, stat err=%v", err)
	}
}

// writeOldLooseBlob writes a dangling loose-object blob to the bare repo and
// backdates its mtime so `git gc --prune=30.days` will consider it prunable.
// Returns the absolute path to the loose object on disk.
func writeOldLooseBlob(t *testing.T, barePath, content string, age time.Duration) string {
	t.Helper()
	cmd := exec.Command("git", "-C", barePath, "hash-object", "-w", "--stdin")
	cmd.Stdin = strings.NewReader(content)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("hash-object failed: %v: %s", err, out)
	}
	sha := strings.TrimSpace(string(out))
	if len(sha) < 4 {
		t.Fatalf("unexpected sha output: %q", sha)
	}
	loose := filepath.Join(barePath, "objects", sha[:2], sha[2:])
	if _, err := os.Stat(loose); err != nil {
		t.Fatalf("expected loose object at %s: %v", loose, err)
	}
	old := time.Now().Add(-age)
	if err := os.Chtimes(loose, old, old); err != nil {
		t.Fatalf("chtimes failed: %v", err)
	}
	return loose
}

func TestPruneWorktree_SerializesWithCreateWorktree(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	sourceRepo := createGCGitRepo(t)
	cache := repocache.New(filepath.Join(d.cfg.WorkspacesRoot, ".repos"), slog.Default())
	if err := cache.Sync("ws1", []repocache.RepoInfo{{URL: sourceRepo}}); err != nil {
		t.Fatalf("cache sync failed: %v", err)
	}

	barePath := cache.Lookup("ws1", sourceRepo)
	if barePath == "" {
		t.Fatal("expected bare repo to be cached")
	}

	runGitForGC(t, "", "-C", barePath, "branch", "agent/stale/87654321", "HEAD")

	blockingCache := &blockingRepoCache{
		inner:   cache,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	d.repoCache = blockingCache

	pruneDone := make(chan struct{})
	go func() {
		d.pruneWorktree(barePath)
		close(pruneDone)
	}()

	select {
	case <-blockingCache.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for pruneWorktree to acquire repo lock")
	}

	createDone := make(chan error, 1)
	go func() {
		_, err := blockingCache.CreateWorktree(repocache.WorktreeParams{
			WorkspaceID: "ws1",
			RepoURL:     sourceRepo,
			WorkDir:     t.TempDir(),
			AgentName:   "tester",
			TaskID:      "11111111-1111-1111-1111-111111111111",
		})
		createDone <- err
	}()

	select {
	case err := <-createDone:
		t.Fatalf("CreateWorktree should wait for GC lock, returned early with err=%v", err)
	case <-time.After(200 * time.Millisecond):
	}

	close(blockingCache.release)

	select {
	case err := <-createDone:
		if err != nil {
			t.Fatalf("CreateWorktree failed after GC lock released: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for CreateWorktree after releasing GC lock")
	}

	select {
	case <-pruneDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for pruneWorktree to finish")
	}
}

type blockingRepoCache struct {
	inner   *repocache.Cache
	entered chan struct{}
	release chan struct{}
}

func (c *blockingRepoCache) Lookup(workspaceID, url string) string {
	return c.inner.Lookup(workspaceID, url)
}

func (c *blockingRepoCache) Sync(workspaceID string, repos []repocache.RepoInfo) error {
	return c.inner.Sync(workspaceID, repos)
}

func (c *blockingRepoCache) WithRepoLock(barePath string, fn func() error) error {
	return c.inner.WithRepoLock(barePath, func() error {
		close(c.entered)
		<-c.release
		return fn()
	})
}

func (c *blockingRepoCache) CreateWorktree(params repocache.WorktreeParams) (*repocache.WorktreeResult, error) {
	return c.inner.CreateWorktree(params)
}

// TestShouldCleanTaskDir_KindDispatch is the local-policy replacement for
// upstream's same-named test. Upstream covered the four GCMeta kinds across
// active/terminal/404/non-terminal remote-status axes via mock HTTP servers.
// Since GC no longer asks a remote server anything, every kind now follows
// the identical age-based policy (gcDecisionByAge) — this test instead
// verifies that all four kinds (plus the legacy no-Kind meta, normalized to
// GCKindIssue by execenv.ReadGCMeta) are dispatched through that same policy
// and produce the same action for the same age, i.e. Kind no longer changes
// the outcome.
func TestShouldCleanTaskDir_KindDispatch(t *testing.T) {
	t.Parallel()

	now := time.Now()
	overTTL := now.Add(-10 * 24 * time.Hour) // past GCTTL (5d)
	withinTTL := now.Add(-1 * time.Hour)     // within GCTTL and GCArtifactTTL (12h)

	cases := []struct {
		name string
		meta *execenv.GCMeta
		want gcAction
	}{
		{
			name: "issue kind over TTL — clean",
			meta: &execenv.GCMeta{Kind: execenv.GCKindIssue, IssueID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01", WorkspaceID: "ws", CompletedAt: overTTL},
			want: gcActionClean,
		},
		{
			name: "chat kind over TTL — clean",
			meta: &execenv.GCMeta{Kind: execenv.GCKindChat, ChatSessionID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01", WorkspaceID: "ws", CompletedAt: overTTL},
			want: gcActionClean,
		},
		{
			name: "autopilot run kind over TTL — clean",
			meta: &execenv.GCMeta{Kind: execenv.GCKindAutopilotRun, AutopilotRunID: "cccccccc-cccc-cccc-cccc-cccccccccc01", WorkspaceID: "ws", CompletedAt: overTTL},
			want: gcActionClean,
		},
		{
			name: "quick_create kind over TTL — clean",
			meta: &execenv.GCMeta{Kind: execenv.GCKindQuickCreate, TaskID: "dddddddd-dddd-dddd-dddd-dddddddddd01", WorkspaceID: "ws", CompletedAt: overTTL},
			want: gcActionClean,
		},
		{
			name: "legacy meta with no kind defaults to issue path — over TTL = clean",
			meta: &execenv.GCMeta{IssueID: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01", WorkspaceID: "ws", CompletedAt: overTTL},
			want: gcActionClean,
		},
		{
			name: "issue kind within TTL — skip",
			meta: &execenv.GCMeta{Kind: execenv.GCKindIssue, IssueID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02", WorkspaceID: "ws", CompletedAt: withinTTL},
			want: gcActionSkip,
		},
		{
			name: "chat kind within TTL — skip",
			meta: &execenv.GCMeta{Kind: execenv.GCKindChat, ChatSessionID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb02", WorkspaceID: "ws", CompletedAt: withinTTL},
			want: gcActionSkip,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d := newGCTestDaemon(t)
			taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", tc.name, tc.meta)
			got := d.shouldCleanTaskDir(context.Background(), taskDir)
			if got != tc.want {
				t.Fatalf("kind dispatch %q: want %d, got %d", tc.name, tc.want, got)
			}
		})
	}
}

// TestShouldCleanTaskDir_EmptyParentIDFallsBackToOrphanMTime is the
// local-policy replacement for upstream's same-named test. Upstream asserted
// that an empty parent ID (IssueID/ChatSessionID/etc.) skips the remote
// gc-check call entirely and falls back to the mtime/orphan-TTL path.
// Locally there is no remote call to skip, but the meta-present-with-no-ID
// case should still behave like "no usable parent identity" and fall back to
// CompletedAt (if set) or mtime — this test pins that an empty parent ID
// alone does not change the outcome versus any other meta, since the local
// policy no longer keys off the ID field at all.
func TestShouldCleanTaskDir_EmptyParentIDFallsBackToOrphanMTime(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		meta *execenv.GCMeta
	}{
		{name: "legacy issue meta", meta: &execenv.GCMeta{WorkspaceID: "ws"}},
		{name: "issue meta", meta: &execenv.GCMeta{Kind: execenv.GCKindIssue, WorkspaceID: "ws"}},
		{name: "chat meta", meta: &execenv.GCMeta{Kind: execenv.GCKindChat, WorkspaceID: "ws"}},
		{name: "autopilot run meta", meta: &execenv.GCMeta{Kind: execenv.GCKindAutopilotRun, WorkspaceID: "ws"}},
		{name: "quick create meta", meta: &execenv.GCMeta{Kind: execenv.GCKindQuickCreate, WorkspaceID: "ws"}},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			d := newGCTestDaemon(t)
			d.cfg.GCOrphanTTL = 365 * 24 * time.Hour
			taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", tc.name, tc.meta)

			// meta.CompletedAt is zero (not set in any case above), so the
			// policy falls back to mtime — same as the missing-meta path.
			got := d.shouldCleanTaskDir(context.Background(), taskDir)
			if got != gcActionSkip {
				t.Fatalf("empty parent id should skip while under orphan TTL, got %d", got)
			}

			old := time.Now().Add(-400 * 24 * time.Hour)
			if err := os.Chtimes(taskDir, old, old); err != nil {
				t.Fatalf("chtimes: %v", err)
			}
			got = d.shouldCleanTaskDir(context.Background(), taskDir)
			if got != gcActionOrphan {
				t.Fatalf("empty parent id over orphan TTL should orphan, got %d", got)
			}
		})
	}
}

func createGCGitRepo(t *testing.T) string {
	t.Helper()

	repoDir := t.TempDir()
	runGitForGC(t, repoDir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	runGitForGC(t, repoDir, "add", "README.md")
	runGitForGC(t, repoDir, "commit", "-m", "initial commit")
	return repoDir
}

func runGitForGC(t *testing.T, dir string, args ...string) string {
	t.Helper()

	fullArgs := args
	if dir != "" {
		fullArgs = append([]string{"-C", dir}, args...)
	}
	cmd := exec.Command("git", fullArgs...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %s: %v", strings.Join(fullArgs, " "), out, err)
	}
	return strings.TrimSpace(string(out))
}

func gitRefExists(t *testing.T, repoPath, ref string) bool {
	t.Helper()

	cmd := exec.Command("git", "-C", repoPath, "show-ref", "--verify", "--quiet", ref)
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// TestShouldCleanTaskDir_LocalDirectoryNeverClean confirms the GC loop
// never removes the envRoot of a local_directory task even when it is long
// past GCTTL. Artifact-pattern cleanup is the most that should ever happen,
// so output/ and logs/ stay around for the user.
func TestShouldCleanTaskDir_LocalDirectoryNeverClean(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "local-task", &execenv.GCMeta{
		Kind:           execenv.GCKindIssue,
		IssueID:        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
		WorkspaceID:    "ws1",
		CompletedAt:    time.Now().Add(-30 * 24 * time.Hour),
		LocalDirectory: true,
	})

	got := d.shouldCleanTaskDir(context.Background(), taskDir)
	if got == gcActionClean {
		t.Fatalf("expected local_directory task to never return gcActionClean, got gcActionClean")
	}
	// Either skip (no patterns configured) or artifact cleanup is OK —
	// what matters is that gcActionClean never fires for local_directory.
	if got != gcActionCleanArtifacts && got != gcActionSkip {
		t.Fatalf("unexpected action for local_directory old completed task: %d", got)
	}
}

// TestShouldCleanTaskDir_LocalDirectoryNeverOrphan confirms that even when
// there's no completed_at signal at all (would normally fall through to
// mtime-based orphan cleanup) a local_directory task's envRoot is preserved.
func TestShouldCleanTaskDir_LocalDirectoryNeverOrphan(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	d.cfg.GCOrphanTTL = 0 // any age is "stale" enough to orphan
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "local-orphan", &execenv.GCMeta{
		Kind:           execenv.GCKindIssue,
		IssueID:        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
		WorkspaceID:    "ws1",
		LocalDirectory: true,
	})

	got := d.shouldCleanTaskDir(context.Background(), taskDir)
	if got == gcActionOrphan || got == gcActionClean {
		t.Fatalf("expected local_directory orphan to be skipped, got %d", got)
	}
}

// TestShouldCleanTaskDir_LocalDirectoryFalsePreservesNormalClean is the
// negative control: a regular (non-local_directory) task completed well past
// GCTTL must still be reclaimed via gcActionClean.
func TestShouldCleanTaskDir_LocalDirectoryFalsePreservesNormalClean(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "normal-task", &execenv.GCMeta{
		Kind:        execenv.GCKindIssue,
		IssueID:     "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
		WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-30 * 24 * time.Hour),
		// LocalDirectory unset (false).
	})

	if got := d.shouldCleanTaskDir(context.Background(), taskDir); got != gcActionClean {
		t.Fatalf("expected gcActionClean for normal task, got %d", got)
	}
}
