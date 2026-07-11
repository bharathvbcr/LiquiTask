//go:build darwin

package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runSandboxedShell runs a shell snippet under the same sandbox-exec profile
// used for agent runs (sandboxMode=os).
func runSandboxedShell(t *testing.T, opts ExecOptions, script string) (stdout string, exitCode int) {
	t.Helper()
	profile, err := buildSandboxProfileInput(opts)
	if err != nil {
		t.Fatalf("buildSandboxProfileInput: %v", err)
	}
	profilePath, cleanup, err := writeSandboxProfileFile(profile)
	if err != nil {
		t.Fatalf("writeSandboxProfileFile: %v", err)
	}
	defer cleanup()

	sandboxExec, err := sandboxExecPath()
	if err != nil {
		t.Skipf("sandbox-exec unavailable: %v", err)
		return "", -1
	}

	cmd := exec.Command(sandboxExec, "-f", profilePath, "--", "/bin/sh", "-c", script)
	out, err := cmd.CombinedOutput()
	stdout = string(out)
	if err == nil {
		return stdout, 0
	}
	var exitErr *exec.ExitError
	if ok := asExitError(err, &exitErr); ok {
		return stdout, exitErr.ExitCode()
	}
	t.Fatalf("sandboxed shell: %v\n%s", err, stdout)
	return "", -1
}

func asExitError(err error, target **exec.ExitError) bool {
	if err == nil {
		return false
	}
	if ee, ok := err.(*exec.ExitError); ok {
		*target = ee
		return true
	}
	return false
}

// TestOSSandboxWriteContainment is a live smoke test for sandboxMode=os on macOS.
// It verifies writes succeed inside the worktree cwd and fail outside the allowlist.
func TestOSSandboxWriteContainment(t *testing.T) {
	if _, err := sandboxExecPath(); err != nil {
		t.Skipf("sandbox-exec not available: %v", err)
	}

	cwd := t.TempDir()
	allowed := filepath.Join(cwd, "allowed-write.txt")

	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("UserHomeDir: %v", err)
	}
	denied := filepath.Join(home, "Documents", fmt.Sprintf("liquitask-sandbox-deny-%d.txt", os.Getpid()))
	t.Cleanup(func() { _ = os.Remove(denied) })

	opts := ExecOptions{
		Cwd:         cwd,
		SandboxMode: "os",
	}

	// Allowed path: inside cwd (writable root).
	out, code := runSandboxedShell(t, opts, fmt.Sprintf(`touch %q && echo ok`, allowed))
	if code != 0 {
		t.Fatalf("expected write inside cwd to succeed, exit=%d out=%q", code, strings.TrimSpace(out))
	}
	if _, err := os.Stat(allowed); err != nil {
		t.Fatalf("allowed file missing after sandboxed touch: %v", err)
	}

	// Denied path: outside writable roots.
	out, code = runSandboxedShell(t, opts, fmt.Sprintf(`touch %q`, denied))
	if code == 0 {
		t.Fatalf("expected write outside allowlist to fail, but touch succeeded")
	}
	if _, err := os.Stat(denied); err == nil {
		t.Fatalf("denied file should not exist after blocked touch")
	}
	if !strings.Contains(out, "Operation not permitted") && !strings.Contains(out, "denied") {
		t.Logf("sandbox stderr/stdout (non-fatal): %s", strings.TrimSpace(out))
	}
}

// TestOSSandboxMcpSecretReadable verifies the OS sandbox denies reads of
// LIQUITASK_MCP_DIR/.secret even though the MCP dir is a writable root.
func TestOSSandboxMcpSecretReadable(t *testing.T) {
	if _, err := sandboxExecPath(); err != nil {
		t.Skipf("sandbox-exec not available: %v", err)
	}

	cwd := t.TempDir()
	mcpDir := filepath.Join(cwd, "mcp-run")
	if err := os.MkdirAll(mcpDir, 0o700); err != nil {
		t.Fatal(err)
	}
	secret := "deadbeef0123456789abcdef0123456789abcdef"
	if err := os.WriteFile(filepath.Join(mcpDir, ".secret"), []byte(secret), 0o600); err != nil {
		t.Fatal(err)
	}

	mcpConfig := fmt.Sprintf(
		`{"mcpServers":{"liquitask":{"command":"node","env":{"LIQUITASK_MCP_DIR":%q}}}}`,
		mcpDir,
	)
	opts := ExecOptions{
		Cwd:         cwd,
		SandboxMode: "os",
		McpConfig:   []byte(mcpConfig),
	}

	secretPath := filepath.Join(mcpDir, ".secret")
	out, code := runSandboxedShell(t, opts, fmt.Sprintf(`cat %q`, secretPath))
	if code == 0 && strings.Contains(out, secret) {
		t.Fatalf("sandboxed process must not read .secret; exit=%d out=%q", code, out)
	}
	if strings.Contains(out, secret) {
		t.Fatalf("sandboxed process must not read .secret; got %q", strings.TrimSpace(out))
	}
}
