package runner

import (
	"testing"

	"github.com/liquitask/liquitask-agentd/internal/agent"
)

func TestPermissionRespondRejectsDigestMismatch(t *testing.T) {
	b := newPermissionBroker()
	req := agent.PermissionRequest{
		RequestID:   "req-1",
		Tool:        "write",
		Input:       map[string]any{"path": "src/a.ts"},
		InputDigest: agent.PermissionInputDigest(map[string]any{"path": "src/a.ts"}),
	}
	ch, err := b.registerPrompt("run-1", req)
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		<-ch
	}()
	if err := b.respond("run-1", "req-1", "allow", "deadbeef"); err == nil {
		t.Fatal("expected digest mismatch error")
	}
}
