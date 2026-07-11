package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/liquitask/liquitask-agentd/internal/runner"
)

func TestGroupRunsByStatus(t *testing.T) {
	runs := []runnerReattach{
		{RunID: "r1", Status: "running", Alive: true},
		{RunID: "r2", Status: "completed"},
	}
	queue := runner.QueueState{
		Queue: []runner.QueueEntry{{RunID: "r3", TaskID: "t3"}},
	}
	groups := groupRunsByStatus(runs, queue)
	if len(groups) < 2 {
		t.Fatalf("expected grouped runs, got %+v", groups)
	}
	if groups[0].Status != "running" || len(groups[0].Runs) != 1 {
		t.Fatalf("running group: %+v", groups[0])
	}
	var queuedFound bool
	for _, g := range groups {
		if g.Status == "queued" {
			queuedFound = true
			if len(g.Runs) != 1 || g.Runs[0].RunID != "r3" {
				t.Fatalf("queued group: %+v", g)
			}
		}
	}
	if !queuedFound {
		t.Fatal("missing queued group")
	}
}

func TestAggregateUsage(t *testing.T) {
	dir := t.TempDir()
	runDir := filepath.Join(dir, "runs", "run-1")
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}
	ev := runner.RunEvent{
		Kind: runner.EventResult,
		Usage: map[string]runner.TokenUsage{
			"claude-sonnet": {InputTokens: 10, OutputTokens: 5},
		},
	}
	line, _ := json.Marshal(ev)
	if err := os.WriteFile(filepath.Join(runDir, "stdout.ndjson"), append(line, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	usage := aggregateUsage(dir)
	got := usage["claude-sonnet"]
	if got.InputTokens != 10 || got.OutputTokens != 5 {
		t.Fatalf("unexpected usage: %+v", got)
	}
}

func TestDiscoverWorktree(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	worktrees := filepath.Join(repo, ".worktrees")
	if err := os.MkdirAll(worktrees, 0o755); err != nil {
		t.Fatal(err)
	}
	runID := "run-abc"
	meta := worktreeSidecar{RunID: runID, Branch: "agent/test/run-abc", CreatedAt: "now"}
	raw, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(worktrees, runID+".liquitask.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(worktrees, runID), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("LIQUITASK_WORKSPACE_ROOTS", root)
	path, branch := discoverWorktree(runID)
	if path != filepath.Join(worktrees, runID) {
		t.Fatalf("worktree path = %q", path)
	}
	if branch != "agent/test/run-abc" {
		t.Fatalf("branch = %q", branch)
	}
}

func TestLoadRunDetailFromMeta(t *testing.T) {
	dir := t.TempDir()
	emptyRoot := filepath.Join(dir, "scan-root")
	if err := os.MkdirAll(emptyRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("LIQUITASK_WORKSPACE_ROOTS", emptyRoot)

	runID := "run-1"
	runDir := filepath.Join(dir, "runs", runID)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}
	meta := runner.RunMeta{
		RunID:       runID,
		TaskID:      "task-1",
		Runtime:     "claude",
		Status:      "completed",
		StartedAtMs: 1000,
	}
	raw, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(runDir, "meta.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	detail, err := loadRunDetail(dir, runID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.TaskID != "task-1" || detail.Runtime != "claude" {
		t.Fatalf("unexpected detail: %+v", detail)
	}
}
