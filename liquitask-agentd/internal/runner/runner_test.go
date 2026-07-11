package runner

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/agent"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

func TestJournalWriteRead(t *testing.T) {
	dir := t.TempDir()
	j := newJournal(dir)
	meta := &RunMeta{
		RunID:       "run-1",
		TaskID:      "task-1",
		Runtime:     "claude",
		Status:      "running",
		StartedAtMs: nowMs(),
		PID:         1234,
	}
	if err := j.writeMeta(meta); err != nil {
		t.Fatalf("writeMeta: %v", err)
	}
	got, err := j.readMeta("run-1")
	if err != nil {
		t.Fatalf("readMeta: %v", err)
	}
	if got.PID != 1234 || got.Status != "running" {
		t.Fatalf("unexpected meta: %+v", got)
	}
}

func TestReconcileFromStdout(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stdout.ndjson")
	ev := RunEvent{Kind: EventResult, Status: "completed", SessionID: "ses_1", Text: "done"}
	data, _ := json.Marshal(ev)
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	status, sessionID, summary := reconcileFromStdout(dir)
	if status != "completed" || sessionID != "ses_1" || summary != "done" {
		t.Fatalf("reconcile = (%q, %q, %q)", status, sessionID, summary)
	}
}

func TestPermissionBrokerRespond(t *testing.T) {
	b := newPermissionBroker()
	ch, err := b.registerPrompt("run-1", agent.PermissionRequest{RequestID: "req-1", Tool: "Bash"})
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(10 * time.Millisecond)
		_ = b.respond("run-1", "req-1", "allow", "")
	}()
	select {
	case decision := <-ch:
		if !decision.Allowed {
			t.Fatalf("expected allow, got %+v", decision)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for permission decision")
	}
}

func TestPermissionBrokerTimeoutDenies(t *testing.T) {
	m := New(rpc.NewServer(os.Stdin, os.Stdout), t.TempDir())
	m.perms.autoDeny = 20 * time.Millisecond
	ctx := context.Background()
	done := make(chan struct{})
	go func() {
		decision, _ := m.awaitPermission(ctx, "run-1", agent.PermissionRequest{
			RequestID: "req-timeout",
			Tool:      "Write",
		})
		if decision.Allowed {
			t.Error("expected deny on timeout")
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("timed out")
	}
}

func TestParseToolPolicy(t *testing.T) {
	got := parseToolPolicy(map[string]string{"Bash": "deny", "*": "allow"})
	if got["Bash"] != agent.ToolPolicyDeny || got["*"] != agent.ToolPolicyAllow {
		t.Fatalf("unexpected policy: %+v", got)
	}
}

func TestPersistEventStdoutCap(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "stdout.ndjson")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Truncate(maxStdoutNdjsonBytes); err != nil {
		t.Fatal(err)
	}
	m := New(rpc.NewServer(os.Stdin, os.Stdout), dir)
	ar := &activeRun{id: "run-cap", meta: &RunMeta{RunID: "run-cap", Status: "running"}}
	before, _ := f.Stat()
	m.persistEvent(f, ar, RunEvent{Kind: EventMessage, Text: "blocked"})
	after, _ := f.Stat()
	if after.Size() != before.Size() {
		t.Fatalf("expected cap to block write: before=%d after=%d", before.Size(), after.Size())
	}
}

func TestStartParamsContainerImageJSON(t *testing.T) {
	raw := []byte(`{"runtime":"claude","prompt":"hi","containerImage":"liquitask-agent:latest"}`)
	var p StartParams
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	if p.ContainerImage != "liquitask-agent:latest" {
		t.Fatalf("ContainerImage = %q, want liquitask-agent:latest", p.ContainerImage)
	}
}

func TestHandleStartRejectsUnavailableContainer(t *testing.T) {
	if agent.ValidateContainerAvailable() == nil {
		t.Skip("container system is available; skipping unavailable rejection test")
	}
	m := New(rpc.NewServer(os.Stdin, os.Stdout), t.TempDir())
	raw, _ := json.Marshal(StartParams{
		Runtime:        "claude",
		Prompt:         "hello",
		ContainerImage: "liquitask-agent:latest",
	})
	_, rpcErr := m.HandleStart(raw)
	if rpcErr == nil {
		t.Fatal("expected run.start to fail when container system unavailable")
	}
	if !strings.Contains(rpcErr.Message, "container") {
		t.Fatalf("expected container error, got %q", rpcErr.Message)
	}
}
