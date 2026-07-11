package detect

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestForkSession_ClaudeTruncatesCopy(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	projDir := filepath.Join(root, ".claude", "projects", "-tmp-test-repo")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srcID := "11111111-1111-1111-1111-111111111111"
	srcPath := filepath.Join(projDir, srcID+".jsonl")
	writeFile(t, srcPath,
		`{"type":"user","cwd":"/tmp/repo","message":{"role":"user","content":"one"}}`+"\n"+
			`{"type":"assistant","message":{"role":"assistant","content":"two"}}`+"\n"+
			`{"type":"user","message":{"role":"user","content":"three"}}`+"\n")

	got, err := ForkSession(ForkParams{
		Runtime:      "claude",
		SessionID:    srcID,
		ProjectPath:  "/tmp/repo",
		MessageIndex: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.NewSessionID == srcID {
		t.Fatal("expected new session id")
	}
	if got.MessageIndex != 2 {
		t.Fatalf("messageIndex = %d, want 2", got.MessageIndex)
	}
	data, err := os.ReadFile(got.SessionPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("forked lines = %d, want 2", len(lines))
	}
	if !strings.Contains(lines[1], "two") {
		t.Fatalf("second line = %q", lines[1])
	}
}

func TestTruncateSession_CodexRewind(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	codexDir := filepath.Join(root, ".codex", "sessions", "2026", "07", "09")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	id := "019f3905-6ed3-73b1-96de-42e347bb2131"
	path := filepath.Join(codexDir, "rollout-"+id+".jsonl")
	writeFile(t, path,
		`{"type":"session_meta","payload":{"session_id":"`+id+`","cwd":"/tmp/repo"}}`+"\n"+
			`{"type":"user","payload":{"text":"first"}}`+"\n"+
			`{"type":"assistant","payload":{"text":"second"}}`+"\n")

	got, err := TruncateSession(TruncateParams{
		Runtime:      "codex",
		SessionID:    id,
		ProjectPath:  "/tmp/repo",
		MessageIndex: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.MessageIndex != 1 {
		t.Fatalf("messageIndex = %d", got.MessageIndex)
	}
	count, err := CountSessionMessages(path)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("count after truncate = %d, want 1", count)
	}
}

func TestSessionMessageCount_Claude(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	projDir := filepath.Join(root, ".claude", "projects", "-tmp-repo")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	id := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	writeFile(t, filepath.Join(projDir, id+".jsonl"),
		`{"type":"user","message":{"content":"a"}}`+"\n"+
			`{"type":"assistant","message":{"content":"b"}}`+"\n")

	got, err := SessionMessageCount(MessageCountParams{Runtime: "claude", SessionID: id})
	if err != nil {
		t.Fatal(err)
	}
	if got.MessageIndex != 2 {
		t.Fatalf("count = %d, want 2", got.MessageIndex)
	}
}

func TestForkSupported(t *testing.T) {
	if !ForkSupported("claude") || !ForkSupported("codex") {
		t.Fatal("expected claude/codex supported")
	}
	if ForkSupported("cursor") {
		t.Fatal("cursor should not be supported")
	}
}

func TestForkSession_CodexPatchesSessionMeta(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	codexDir := filepath.Join(root, ".codex", "sessions", "2026", "07", "09")
	if err := os.MkdirAll(codexDir, 0o755); err != nil {
		t.Fatal(err)
	}
	srcID := "019f3905-6ed3-73b1-96de-42e347bb2131"
	writeFile(t, filepath.Join(codexDir, "rollout-"+srcID+".jsonl"),
		`{"type":"session_meta","payload":{"session_id":"`+srcID+`","cwd":"/tmp/repo"}}`+"\n"+
			`{"type":"user","payload":{"text":"hello"}}`+"\n")

	got, err := ForkSession(ForkParams{Runtime: "codex", SessionID: srcID, ProjectPath: "/tmp/repo"})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(got.SessionPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), srcID) {
		t.Fatalf("forked file still references old id: %s", string(data))
	}
	if !strings.Contains(string(data), got.NewSessionID) {
		t.Fatalf("forked file missing new id %q", got.NewSessionID)
	}
}
