package daemon

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/execenv"
)

// gcLoop periodically scans local workspace directories and removes those
// whose issue is done/cancelled and hasn't been updated within the configured TTL.
func (d *Daemon) gcLoop(ctx context.Context) {
	if !d.cfg.GCEnabled {
		d.logger.Info("gc: disabled")
		return
	}
	d.logger.Info("gc: started",
		"interval", d.cfg.GCInterval,
		"ttl", d.cfg.GCTTL,
		"orphan_ttl", d.cfg.GCOrphanTTL,
		"artifact_ttl", d.cfg.GCArtifactTTL,
		"artifact_patterns", d.cfg.GCArtifactPatterns,
	)

	// Run once at startup after a short delay (let the daemon finish initializing).
	if err := sleepWithContext(ctx, 30*time.Second); err != nil {
		return
	}
	d.runGC(ctx)

	ticker := time.NewTicker(d.cfg.GCInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.runGC(ctx)
		}
	}
}

// gcStats accumulates byte counts and per-pattern hit counts for one GC cycle.
type gcStats struct {
	cleaned         int            // whole task dirs removed (done and stale)
	orphaned        int            // whole task dirs removed (no meta / unreachable and old)
	skipped         int            // task dirs left untouched
	artifactDirs    int            // task dirs that had at least one artifact reclaimed
	artifactRemoved int            // count of removed artifact subdirs
	bytesReclaimed  int64          // total bytes freed in this cycle
	byPattern       map[string]int // basename -> reclaim count, for visibility
}

// runGC performs a single GC scan across all workspace directories.
func (d *Daemon) runGC(ctx context.Context) {
	root := d.cfg.WorkspacesRoot
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		d.logger.Warn("gc: read workspaces root failed", "error", err)
		return
	}

	stats := &gcStats{byPattern: map[string]int{}}
	for _, wsEntry := range entries {
		if !wsEntry.IsDir() || wsEntry.Name() == ".repos" {
			continue
		}
		wsDir := filepath.Join(root, wsEntry.Name())
		d.gcWorkspace(ctx, wsDir, stats)
	}

	// Prune stale worktree references from all bare repo caches.
	d.pruneRepoWorktrees(root)

	if stats.cleaned > 0 || stats.orphaned > 0 || stats.artifactDirs > 0 {
		d.logger.Info("gc: cycle complete",
			"cleaned", stats.cleaned,
			"orphaned", stats.orphaned,
			"skipped", stats.skipped,
			"artifact_dirs", stats.artifactDirs,
			"artifact_removed", stats.artifactRemoved,
			"bytes_reclaimed", stats.bytesReclaimed,
			"by_pattern", stats.byPattern,
		)
	}
}

// gcWorkspace scans task directories inside a single workspace directory.
func (d *Daemon) gcWorkspace(ctx context.Context, wsDir string, stats *gcStats) {
	taskEntries, err := os.ReadDir(wsDir)
	if err != nil {
		d.logger.Warn("gc: read workspace dir failed", "dir", wsDir, "error", err)
		return
	}

	cleanedHere := 0
	for _, entry := range taskEntries {
		if ctx.Err() != nil {
			return
		}
		if !entry.IsDir() {
			continue
		}
		taskDir := filepath.Join(wsDir, entry.Name())
		action := d.shouldCleanTaskDir(ctx, taskDir)
		switch action {
		case gcActionClean:
			bytes := dirSize(taskDir)
			d.cleanTaskDir(taskDir)
			stats.cleaned++
			stats.bytesReclaimed += bytes
			cleanedHere++
		case gcActionOrphan:
			bytes := dirSize(taskDir)
			d.cleanTaskDir(taskDir)
			stats.orphaned++
			stats.bytesReclaimed += bytes
			cleanedHere++
		case gcActionCleanArtifacts:
			removed, bytes, perPattern := d.cleanTaskArtifacts(taskDir, d.cfg.GCArtifactPatterns)
			if removed > 0 {
				stats.artifactDirs++
				stats.artifactRemoved += removed
				stats.bytesReclaimed += bytes
				for k, v := range perPattern {
					stats.byPattern[k] += v
				}
			}
			stats.skipped++ // task dir itself preserved
		default:
			stats.skipped++
		}
	}

	// Remove the workspace directory itself if it's now empty.
	if cleanedHere > 0 {
		remaining, _ := os.ReadDir(wsDir)
		if len(remaining) == 0 {
			os.Remove(wsDir)
		}
	}
}

type gcAction int

const (
	gcActionSkip           gcAction = iota
	gcActionClean                   // task is done/cancelled and stale
	gcActionOrphan                  // no meta or unknown parent and dir is old
	gcActionCleanArtifacts          // task completed long enough ago; drop regenerable artifacts only
)

// shouldCleanTaskDir decides whether a task directory should be removed.
//
// STUBBED FOR LOCAL-ONLY OPERATION (see gcDecisionByAge below): upstream this
// method dispatches on meta.Kind to one of four gcDecision* helpers
// (gcDecisionIssue / gcDecisionChat / gcDecisionAutopilotRun /
// gcDecisionQuickCreate), each of which calls a remote "/{kind}/{id}/gc-check"
// HTTP endpoint on the Multica server to ask whether the parent issue/chat
// session/autopilot run/task has reached a terminal state, and gates cleanup
// on that remote answer (with a 404-vs-mtime-TTL fallback for cross-workspace
// safety — see isAccessNotFound in the original). This sidecar has no server
// to ask: there is no remote issue/chat-session/autopilot-run/task record to
// poll a status from. Per the porting instructions, the remote status gate is
// replaced with a simple local policy: GC purely by directory age against the
// configured TTLs (GCTTL / GCArtifactTTL / GCOrphanTTL), using the completion
// timestamp recorded in .gc_meta.json (or the directory's mtime when that's
// unavailable) as the age source. The GCMetaKind-based dispatch, the
// LocalDirectory carve-out, and the active-env-root guard are all preserved
// verbatim since they are pure local logic.
func (d *Daemon) shouldCleanTaskDir(ctx context.Context, taskDir string) gcAction {
	// A task currently running on this env root must never be reclaimed —
	// not even on the stale or orphan path. A new comment on an already-done
	// issue can dispatch a follow-up task that reuses the prior workdir
	// without bumping any "updated_at", so the regular TTL check alone
	// wouldn't notice the resumed activity.
	if d.isActiveEnvRoot(taskDir) {
		return gcActionSkip
	}

	meta, err := execenv.ReadGCMeta(taskDir)
	if err != nil {
		return d.orphanByMTime(taskDir, "no meta")
	}

	action := d.gcDecisionByAge(taskDir, meta)
	if !meta.LocalDirectory {
		return action
	}
	// local_directory tasks keep their envRoot indefinitely so the user
	// can inspect output/ and logs/ for forensic context. The WorkDir is
	// the user's own path and lives outside taskDir, so the envRoot
	// itself is just the daemon's logbook for the run — never large, and
	// safe to keep.
	//
	//   gcActionClean   → demote to artifact-pattern cleanup so envRoot
	//                     (and especially the logbook) survives.
	//   gcActionOrphan  → skip outright; we don't ever wipe a
	//                     local_directory envRoot via the mtime path,
	//                     since stale/missing parent metadata should not
	//                     collateral-delete the user's own audit trail.
	//
	// gcActionCleanArtifacts and gcActionSkip already obey the
	// "no full envRoot RemoveAll" rule.
	switch action {
	case gcActionClean:
		return gcActionCleanArtifacts
	case gcActionOrphan:
		return gcActionSkip
	default:
		return action
	}
}

// gcDecisionByAge is the local-only replacement for upstream's four
// gcDecision{Issue,Chat,AutopilotRun,QuickCreate} helpers. Those each asked a
// remote gc-check endpoint whether the parent record (issue/chat
// session/autopilot run/task) had reached a terminal state, and used that
// remote answer — not local time — as the primary cleanup signal. Without a
// server, "has the parent record finished" isn't a question this daemon can
// answer, so the policy collapses to: has enough wall-clock time passed
// since the task completed. This applies uniformly across GCMetaKind values
// (issue/chat/autopilot_run/quick_create, plus legacy no-Kind meta, which
// execenv.ReadGCMeta already normalizes to GCKindIssue) since there is no
// longer a per-kind remote status shape to distinguish them by.
func (d *Daemon) gcDecisionByAge(taskDir string, meta *execenv.GCMeta) gcAction {
	if meta.CompletedAt.IsZero() {
		// No completion timestamp recorded (e.g. crash before WriteGCMeta
		// finished, or a hand-edited meta file) — fall back to the same
		// mtime-vs-GCOrphanTTL check used for missing/unreadable meta.
		return d.orphanByMTime(taskDir, "meta has no completed_at")
	}

	age := time.Since(meta.CompletedAt)
	if age > d.cfg.GCTTL {
		d.logger.Info("gc: eligible for cleanup",
			"dir", filepath.Base(taskDir),
			"kind", string(meta.Kind),
			"completed_at", meta.CompletedAt.Format(time.RFC3339),
			"age", age.Round(time.Hour),
		)
		return gcActionClean
	}

	if d.cfg.GCArtifactTTL > 0 && len(d.cfg.GCArtifactPatterns) > 0 && age > d.cfg.GCArtifactTTL {
		d.logger.Info("gc: eligible for artifact cleanup",
			"dir", filepath.Base(taskDir),
			"kind", string(meta.Kind),
			"completed_at", meta.CompletedAt.Format(time.RFC3339),
			"age", age.Round(time.Hour),
		)
		return gcActionCleanArtifacts
	}

	return gcActionSkip
}

// orphanByMTime returns gcActionOrphan if the directory is older than
// GCOrphanTTL, gcActionSkip otherwise. Centralizes the "we have no parent
// record signal so just look at the disk" fallback used for missing/invalid
// meta.
func (d *Daemon) orphanByMTime(taskDir, reason string) gcAction {
	info, err := os.Stat(taskDir)
	if err != nil {
		return gcActionSkip
	}
	if time.Since(info.ModTime()) > d.cfg.GCOrphanTTL {
		d.logger.Info("gc: orphan directory", "dir", taskDir, "reason", reason, "age", time.Since(info.ModTime()).Round(time.Hour))
		return gcActionOrphan
	}
	return gcActionSkip
}

// cleanTaskDir removes a task directory and logs the result.
func (d *Daemon) cleanTaskDir(taskDir string) {
	if err := os.RemoveAll(taskDir); err != nil {
		d.logger.Warn("gc: remove task dir failed", "dir", taskDir, "error", err)
	} else {
		d.logger.Info("gc: removed", "dir", taskDir)
	}
}

// cleanTaskArtifacts walks taskDir and deletes every directory whose basename
// matches one of patterns. Returns (removedCount, bytesReclaimed, perPattern).
//
// Safety contract:
//   - patterns are basename-only; entries with a path separator are dropped.
//   - .git subtrees are never descended into, so the agent's git history stays
//     intact even if a pattern would otherwise match.
//   - symlinks are skipped entirely — neither the link nor its target is
//     touched, so a malicious or stale link can't redirect the GC outside the
//     workdir.
//   - every removal target is verified to live inside taskDir, so a tampered
//     .gc_meta.json can't trick the daemon into deleting outside its sandbox.
func (d *Daemon) cleanTaskArtifacts(taskDir string, patterns []string) (removed int, bytes int64, perPattern map[string]int) {
	perPattern = map[string]int{}
	if taskDir == "" || len(patterns) == 0 {
		return
	}
	patternSet := make(map[string]struct{}, len(patterns))
	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" || strings.ContainsAny(p, "/\\") {
			continue
		}
		patternSet[p] = struct{}{}
	}
	if len(patternSet) == 0 {
		return
	}

	absRoot, err := filepath.Abs(taskDir)
	if err != nil {
		return
	}

	walkErr := filepath.WalkDir(absRoot, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil // best-effort — keep walking
		}
		if path == absRoot {
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		// Never descend into .git — preserves agent commits even if a pattern
		// like "objects" would otherwise match.
		if entry.Name() == ".git" {
			return filepath.SkipDir
		}
		// Refuse to follow symlinked directories. WalkDir reports them as type
		// Dir on some platforms; lstat to be sure.
		info, statErr := os.Lstat(path)
		if statErr != nil {
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return filepath.SkipDir
		}
		if _, ok := patternSet[entry.Name()]; !ok {
			return nil
		}
		// Containment check: target must remain inside taskDir.
		rel, relErr := filepath.Rel(absRoot, path)
		if relErr != nil || rel == "" || rel == "." || strings.HasPrefix(rel, "..") {
			return filepath.SkipDir
		}
		size := dirSize(path)
		if rmErr := os.RemoveAll(path); rmErr != nil {
			d.logger.Warn("gc: artifact remove failed", "path", path, "error", rmErr)
			return filepath.SkipDir
		}
		removed++
		bytes += size
		perPattern[entry.Name()]++
		d.logger.Info("gc: artifact removed", "path", path, "bytes", size)
		// Don't descend into the now-deleted subtree.
		return filepath.SkipDir
	})
	if walkErr != nil {
		d.logger.Warn("gc: artifact walk failed", "dir", taskDir, "error", walkErr)
	}
	return
}

// dirSize returns the total size of all regular files under root, in bytes.
// Non-fatal: errors during the walk are ignored so callers can report a
// best-effort byte count without aborting the whole GC cycle.
func dirSize(root string) int64 {
	var total int64
	_ = filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total
}

const (
	gitCmdTimeout         = 30 * time.Second
	gitMaintenanceTimeout = 10 * time.Minute
)

// pruneRepoWorktrees runs `git worktree prune` on all bare repos in the cache.
func (d *Daemon) pruneRepoWorktrees(workspacesRoot string) {
	reposRoot := filepath.Join(workspacesRoot, ".repos")
	wsEntries, err := os.ReadDir(reposRoot)
	if err != nil {
		return
	}

	for _, wsEntry := range wsEntries {
		if !wsEntry.IsDir() {
			continue
		}
		wsRepoDir := filepath.Join(reposRoot, wsEntry.Name())
		repoEntries, err := os.ReadDir(wsRepoDir)
		if err != nil {
			continue
		}
		for _, repoEntry := range repoEntries {
			if !repoEntry.IsDir() {
				continue
			}
			barePath := filepath.Join(wsRepoDir, repoEntry.Name())
			if !isBareRepo(barePath) {
				continue
			}
			d.pruneWorktree(barePath)
		}
	}
}

func (d *Daemon) pruneWorktree(barePath string) {
	if d.repoCache != nil {
		if err := d.repoCache.WithRepoLock(barePath, func() error {
			d.pruneWorktreeLocked(barePath)
			return nil
		}); err != nil {
			d.logger.Warn("gc: repo lock failed", "repo", barePath, "error", err)
			return
		}
		return
	}

	d.pruneWorktreeLocked(barePath)
}

func (d *Daemon) pruneWorktreeLocked(barePath string) {
	if out, err := runGitGCCommand(barePath, "worktree", "prune"); err != nil {
		d.logger.Warn("gc: worktree prune failed",
			"repo", barePath,
			"output", out,
			"error", err,
		)
	}

	activeBranches, err := agentWorktreeBranches(barePath)
	if err != nil {
		d.logger.Warn("gc: worktree branch scan failed", "repo", barePath, "error", err)
		return
	}

	agentBranches, err := listAgentBranches(barePath)
	if err != nil {
		d.logger.Warn("gc: agent branch scan failed", "repo", barePath, "error", err)
		return
	}

	deleted := 0
	for _, branch := range agentBranches {
		if _, ok := activeBranches[branch]; ok {
			continue
		}
		if out, err := runGitGCCommand(barePath, "branch", "-D", "--", branch); err != nil {
			d.logger.Warn("gc: agent branch delete failed",
				"repo", barePath,
				"branch", branch,
				"output", out,
				"error", err,
			)
			continue
		}
		deleted++
	}
	if deleted == 0 {
		return
	}
	d.logger.Info("gc: deleted stale agent branches", "repo", barePath, "count", deleted)

	// Heavier maintenance only runs when we actually removed refs, so we don't
	// turn every GC tick into a full `git gc --prune` on every cached repo. The
	// prune step gets its own longer timeout because it can take minutes on a
	// real bare cache; under the shared 30s budget it would be killed mid-run.
	maintenance := []struct {
		args    []string
		timeout time.Duration
	}{
		{args: []string{"reflog", "expire", "--expire=30.days", "--all"}, timeout: gitCmdTimeout},
		{args: []string{"gc", "--prune=30.days"}, timeout: gitMaintenanceTimeout},
	}
	for _, step := range maintenance {
		if out, err := runGitCommand(barePath, step.timeout, step.args...); err != nil {
			d.logger.Warn("gc: git maintenance failed",
				"repo", barePath,
				"command", strings.Join(step.args, " "),
				"output", out,
				"error", err,
			)
		}
	}
}

func runGitGCCommand(barePath string, args ...string) (string, error) {
	return runGitCommand(barePath, gitCmdTimeout, args...)
}

func runGitCommand(barePath string, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmdArgs := append([]string{"-C", barePath}, args...)
	cmd := exec.CommandContext(ctx, "git", cmdArgs...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func agentWorktreeBranches(barePath string) (map[string]struct{}, error) {
	out, err := runGitGCCommand(barePath, "worktree", "list", "--porcelain")
	if err != nil {
		return nil, err
	}

	branches := make(map[string]struct{})
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "branch refs/heads/") {
			continue
		}
		branch := strings.TrimPrefix(line, "branch refs/heads/")
		if strings.HasPrefix(branch, "agent/") {
			branches[branch] = struct{}{}
		}
	}
	return branches, nil
}

func listAgentBranches(barePath string) ([]string, error) {
	// Trailing slash narrows the pattern to the `agent/` namespace only. Without
	// it, `for-each-ref` would also return a branch literally named `agent`,
	// which `agentWorktreeBranches` ignores — that branch would then be deleted.
	out, err := runGitGCCommand(barePath, "for-each-ref", "--format=%(refname:short)", "refs/heads/agent/")
	if err != nil {
		return nil, err
	}
	if out == "" {
		return nil, nil
	}

	var branches []string
	for _, line := range strings.Split(out, "\n") {
		branch := strings.TrimSpace(line)
		if branch == "" {
			continue
		}
		branches = append(branches, branch)
	}
	return branches, nil
}

// isBareRepo checks if a path looks like a bare git repository.
func isBareRepo(path string) bool {
	if _, err := os.Stat(filepath.Join(path, "HEAD")); err != nil {
		return false
	}
	if _, err := os.Stat(filepath.Join(path, "objects")); err != nil {
		return false
	}
	return true
}
