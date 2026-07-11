//go:build darwin

package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// runContainerWrappedShell runs a shell snippet through PrepareManagedCommand
// with the same container wrapping used for agent runs (ContainerImage set).
func runContainerWrappedShell(t *testing.T, opts ExecOptions, script string) (stdout string, exitCode int) {
	t.Helper()
	if err := ValidateContainerAvailable(); err != nil {
		t.Skipf("container system unavailable: %v", err)
	}

	cmd := exec.Command("/bin/sh", "-c", script)
	if err := PrepareManagedCommand(cmd, opts, 10*time.Second); err != nil {
		t.Fatalf("PrepareManagedCommand: %v", err)
	}

	out, err := cmd.CombinedOutput()
	stdout = string(out)
	if err == nil {
		return stdout, 0
	}
	var exitErr *exec.ExitError
	if ok := asExitError(err, &exitErr); ok {
		return stdout, exitErr.ExitCode()
	}
	t.Fatalf("container-wrapped shell: %v\n%s", err, stdout)
	return "", -1
}

// TestPrepareManagedCommandContainerWrap verifies container argv assembly through
// PrepareManagedCommand (the same path agent backends use at spawn time).
func TestPrepareManagedCommandContainerWrap(t *testing.T) {
	workDir := t.TempDir()
	cmd := exec.Command("echo", "ok")
	cmd.Dir = workDir
	opts := ExecOptions{
		Cwd:            workDir,
		ContainerImage: "liquitask-agent:latest",
	}
	if err := PrepareManagedCommand(cmd, opts, 10*time.Second); err != nil {
		t.Skipf("container CLI unavailable: %v", err)
	}
	joined := strings.Join(cmd.Args, " ")
	for _, want := range []string{"run", "--rm", "-v", ":/work", "-w", "/work", "liquitask-agent:latest", "echo", "ok"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("argv %q missing %q", joined, want)
		}
	}
}

// TestContainerWriteContainment is a live smoke test for apple/container wrapping
// on macOS. It verifies a simple command runs inside the VM when the system is up.
func TestContainerWriteContainment(t *testing.T) {
	if err := ValidateContainerAvailable(); err != nil {
		t.Skipf("container system unavailable: %v", err)
	}

	cwd := t.TempDir()
	marker := filepath.Join(cwd, "container-smoke.txt")
	opts := ExecOptions{
		Cwd:            cwd,
		ContainerImage: "liquitask-agent:latest",
	}

	out, code := runContainerWrappedShell(t, opts, `touch container-smoke.txt && echo ok`)
	if code != 0 {
		t.Fatalf("expected container command to succeed, exit=%d out=%q", code, strings.TrimSpace(out))
	}
	if !strings.Contains(out, "ok") {
		t.Fatalf("expected ok in output, got %q", strings.TrimSpace(out))
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("host marker file missing after container touch: %v", err)
	}
}
