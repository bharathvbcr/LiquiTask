package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRewriteArgsForContainer(t *testing.T) {
	workDir := filepath.Join(t.TempDir(), "repo")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mcpFile := filepath.Join(t.TempDir(), "mcp", "config.json")
	if err := os.MkdirAll(filepath.Dir(mcpFile), 0o755); err != nil {
		t.Fatal(err)
	}

	args := []string{
		"--mcp-config", mcpFile,
		"--add-dir", workDir,
	}
	rewritten, mounts := rewriteArgsForContainer(args, workDir)

	if !strings.Contains(rewritten[1], "/mnt") {
		t.Fatalf("expected mcp path rewritten for container mount, got %q", rewritten[1])
	}
	if rewritten[3] != containerWorkMount {
		t.Fatalf("worktree path = %q, want %q", rewritten[3], containerWorkMount)
	}
	if len(mounts) != 2 {
		t.Fatalf("expected one extra mount pair, got %v", mounts)
	}
}

func TestWrapContainerRunBuildsArgv(t *testing.T) {
	workDir := t.TempDir()
	cmd := exec.Command("claude", "--version")
	cmd.Dir = workDir
	opts := ExecOptions{
		Cwd:            workDir,
		ContainerImage: "liquitask-agent:latest",
	}
	if err := wrapContainerRun(cmd, opts); err != nil {
		t.Skipf("container CLI unavailable: %v", err)
	}
	joined := strings.Join(cmd.Args, " ")
	for _, want := range []string{"run", "--rm", "-v", ":/work", "-w", "/work", "liquitask-agent:latest", "claude", "--version"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("argv %q missing %q", joined, want)
		}
	}
}

func TestValidateContainerAvailable(t *testing.T) {
	err := ValidateContainerAvailable()
	if err == nil {
		return
	}
	if !strings.Contains(err.Error(), "container") {
		t.Fatalf("expected container-related error, got %v", err)
	}
}
