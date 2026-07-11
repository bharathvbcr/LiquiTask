package agent

import (
	"context"
	"testing"
)

func TestResolveToolPermissionDenyPolicy(t *testing.T) {
	decision, err := ResolveToolPermission(context.Background(), "Bash", nil, ExecOptions{
		ToolPolicy: map[string]ToolPolicyAction{"Bash": ToolPolicyDeny},
	})
	if err != nil || decision.Allowed {
		t.Fatalf("expected deny, got %+v err=%v", decision, err)
	}
}

func TestResolveToolPermissionAutoApprove(t *testing.T) {
	decision, err := ResolveToolPermission(context.Background(), "Bash", nil, ExecOptions{
		AutoApprove: true,
	})
	if err != nil || !decision.Allowed {
		t.Fatalf("expected allow with autoApprove, got %+v err=%v", decision, err)
	}
}

func TestShouldBypassPermissions(t *testing.T) {
	if ShouldBypassPermissions(ExecOptions{}) {
		t.Fatal("default should not bypass")
	}
	if !ShouldBypassPermissions(ExecOptions{AutoApprove: true}) {
		t.Fatal("autoApprove should bypass")
	}
	if !ShouldBypassPermissions(ExecOptions{PermissionMode: "bypassPermissions"}) {
		t.Fatal("bypassPermissions mode should bypass")
	}
}

func TestResolveClaudePermissionMode(t *testing.T) {
	if got := resolveClaudePermissionMode(ExecOptions{}); got != "default" {
		t.Fatalf("got %q want default", got)
	}
	if got := resolveClaudePermissionMode(ExecOptions{AutoApprove: true}); got != "bypassPermissions" {
		t.Fatalf("got %q want bypassPermissions", got)
	}
}
