package detect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDecodeClaudeProjectDir(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"-Users-bharath-Code-LiquiTask", filepath.Join("Users", "bharath", "Code", "LiquiTask")},
		{
			"-Users-bharath-Code-Portfolio--worktrees-run-123-abc",
			filepath.Join("Users", "bharath", "Code", "Portfolio", ".claude", "worktrees", "run-123-abc"),
		},
	}
	for _, tc := range tests {
		got := decodeClaudeProjectDir(tc.in)
		if got != tc.want {
			t.Fatalf("decodeClaudeProjectDir(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestDiscoverSessions_FiltersKnownAndReadsClaudeMeta(t *testing.T) {
	root := t.TempDir()
	projDir := filepath.Join(root, "-tmp-test-repo")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	knownID := "11111111-1111-1111-1111-111111111111"
	unknownID := "22222222-2222-2222-2222-222222222222"
	writeFile(t, filepath.Join(projDir, knownID+".jsonl"), `{"type":"user","gitBranch":"feature/x","message":{"role":"user","content":"known session"}}`+"\n")
	writeFile(t, filepath.Join(projDir, unknownID+".jsonl"), `{"type":"user","gitBranch":"feature/y","message":{"role":"user","content":"orphan session prompt"}}`+"\n")

	origHome := os.Getenv("HOME")
	t.Setenv("HOME", root)
	// Redirect claude projects root by placing under HOME/.claude/projects
	claudeRoot := filepath.Join(root, ".claude", "projects")
	if err := os.MkdirAll(claudeRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(projDir, filepath.Join(claudeRoot, "-tmp-test-repo")); err != nil {
		t.Fatal(err)
	}
	_ = origHome

	got := DiscoverSessions([]string{knownID})
	if len(got.Sessions) != 1 {
		t.Fatalf("sessions = %d, want 1", len(got.Sessions))
	}
	s := got.Sessions[0]
	if s.SessionID != unknownID {
		t.Fatalf("sessionId = %q", s.SessionID)
	}
	if s.Runtime != "claude" {
		t.Fatalf("runtime = %q", s.Runtime)
	}
	if s.GitBranch != "feature/y" {
		t.Fatalf("gitBranch = %q", s.GitBranch)
	}
	if !strings.Contains(s.Preview, "orphan session") {
		t.Fatalf("preview = %q", s.Preview)
	}
}

func TestDiscoverSessions_CodexSessionMeta(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	codexDir := filepath.Join(root, ".codex", "sessions", "2026", "07", "06")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	id := "019f3905-6ed3-73b1-96de-42e347bb2131"
	path := filepath.Join(codexDir, "rollout-"+id+".jsonl")
	writeFile(t, path, `{"type":"session_meta","payload":{"session_id":"`+id+`","cwd":"/tmp/repo","git_branch":"feature/codex"}}`+"\n")

	got := DiscoverSessions(nil)
	var found *DiscoveredSession
	for i := range got.Sessions {
		if got.Sessions[i].SessionID == id {
			found = &got.Sessions[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("codex session not discovered: %+v", got.Sessions)
	}
	if found.Runtime != "codex" || found.ProjectPath != "/tmp/repo" || found.GitBranch != "feature/codex" {
		t.Fatalf("unexpected codex session: %+v", found)
	}
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
