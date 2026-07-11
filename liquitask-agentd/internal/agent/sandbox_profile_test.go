package agent

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestCollectSandboxWritableRootsIncludesCwdAndMcpDir(t *testing.T) {
	opts := ExecOptions{
		Cwd: "/tmp/worktree",
		McpConfig: json.RawMessage(
			`{"mcpServers":{"liquitask":{"env":{"LIQUITASK_MCP_DIR":"/var/mcp/run-1"}}}}`,
		),
	}
	roots, err := collectSandboxWritableRoots(opts)
	if err != nil {
		t.Fatalf("collectSandboxWritableRoots: %v", err)
	}
	joined := strings.Join(roots, "\n")
	if !strings.Contains(joined, "/tmp/worktree") {
		t.Errorf("expected cwd in writable roots, got:\n%s", joined)
	}
	if !strings.Contains(joined, "/var/mcp/run-1") {
		t.Errorf("expected MCP dir in writable roots, got:\n%s", joined)
	}
}

func TestCollectSandboxScopeRestrictsWritableRoots(t *testing.T) {
	opts := ExecOptions{
		Cwd:         "/tmp/worktree",
		SandboxMode: "os",
		ScopePaths:  []string{"src/api", "crates/core"},
		McpConfig: json.RawMessage(
			`{"mcpServers":{"liquitask":{"env":{"LIQUITASK_MCP_DIR":"/var/mcp/run-1"}}}}`,
		),
	}
	roots, err := collectSandboxWritableRoots(opts)
	if err != nil {
		t.Fatalf("collectSandboxWritableRoots: %v", err)
	}
	joined := strings.Join(roots, "\n")
	if strings.Contains(joined, "/tmp/worktree\n") && !strings.Contains(joined, "/tmp/worktree/src/api") {
		// whole worktree must not be writable when scope is active
		if strings.Count(joined, "/tmp/worktree") == 1 && !strings.Contains(joined, "src/api") {
			t.Errorf("expected scoped paths only, got:\n%s", joined)
		}
	}
	if !strings.Contains(joined, "src/api") {
		t.Errorf("expected scoped src/api path, got:\n%s", joined)
	}
	if strings.Contains(joined, "crates/core") == false {
		t.Errorf("expected scoped crates/core path, got:\n%s", joined)
	}
}

func TestCanonicalSandboxRootResolvesVarSymlink(t *testing.T) {
	dir := t.TempDir()
	raw := dir
	if !strings.HasPrefix(raw, "/var/") && !strings.HasPrefix(raw, "/private/var/") {
		t.Skip("temp dir not under /var on this host")
	}
	got := canonicalSandboxRoot(raw)
	if !strings.HasPrefix(got, "/private/var/") {
		t.Fatalf("expected /private/var canonical root, got %q", got)
	}
}

func TestWriteSandboxProfileFileShape(t *testing.T) {
	profile := sandboxProfileInput{
		WritableRoots: []string{"/tmp/work", "/var/mcp/run-1"},
		McpDir:        "/var/mcp/run-1",
	}
	path, cleanup, err := writeSandboxProfileFile(profile)
	if err != nil {
		t.Fatalf("writeSandboxProfileFile: %v", err)
	}
	defer cleanup()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(raw)
	for _, want := range []string{
		"(deny default)",
		"(allow file-read*)",
		`(deny file-read* (literal "/var/mcp/run-1/.secret"))`,
		`(deny file-read* (literal "/var/mcp/run-1/response-secret"))`,
		`(allow file-write* (subpath "/tmp/work"))`,
		`(allow file-write* (subpath "/var/mcp/run-1"))`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("profile missing %q:\n%s", want, s)
		}
	}
}
