package agent

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestMapLocalToRemote(t *testing.T) {
	t.Parallel()
	got, err := mapLocalToRemote(
		"/Users/dev/project/.worktrees/run-1",
		"/Users/dev/project",
		"/home/dev/project",
	)
	if err != nil {
		t.Fatalf("mapLocalToRemote: %v", err)
	}
	want := "/home/dev/project/.worktrees/run-1"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestMapLocalToRemoteRejectsOutsideBase(t *testing.T) {
	t.Parallel()
	_, err := mapLocalToRemote("/Users/dev/other", "/Users/dev/project", "/home/dev/project")
	if err == nil {
		t.Fatal("expected error for path outside base")
	}
}

func TestShellQuote(t *testing.T) {
	t.Parallel()
	input := "it's fine"
	got := shellQuote(input)
	if got == "" || !strings.HasPrefix(got, "'") || !strings.HasSuffix(got, "'") {
		t.Fatalf("shellQuote: %q", got)
	}
	if !strings.Contains(got, "it") || !strings.Contains(got, "s fine") {
		t.Fatalf("shellQuote lost content: %q", got)
	}
}

func TestValidateSSHConfigRequiresTarget(t *testing.T) {
	t.Parallel()
	if err := ValidateSSHConfig(SSHConfig{}); err == nil {
		t.Fatal("expected error for empty target")
	}
}

func TestRemoteSSHSupportedMatchesPlatform(t *testing.T) {
	t.Parallel()
	got := RemoteSSHSupported()
	want := runtime.GOOS == "darwin" || runtime.GOOS == "linux"
	if got != want {
		t.Fatalf("RemoteSSHSupported()=%v want %v", got, want)
	}
}

func TestMutagenURLPath(t *testing.T) {
	t.Parallel()
	if got := mutagenURLPath("user@host:/var/www/app"); got != "/var/www/app" {
		t.Fatalf("mutagenURLPath ssh url: %q", got)
	}
	if got := mutagenURLPath("/local/path"); got != "/local/path" {
		t.Fatalf("mutagenURLPath plain path: %q", got)
	}
}

func TestApplySSHWrapRejectsContainer(t *testing.T) {
	t.Parallel()
	cmd := exec.Command("claude", "--version")
	opts := ExecOptions{
		SSH:            &SSHConfig{Target: "dev@host"},
		RemoteCwd:      "/home/dev/project",
		ContainerImage: "liquitask-agent:latest",
	}
	if err := ApplySSHWrap(cmd, opts); err == nil {
		t.Fatal("expected error combining ssh with container")
	}
}

func TestApplySSHWrapRejectsOSSandbox(t *testing.T) {
	t.Parallel()
	cmd := exec.Command("claude", "--version")
	opts := ExecOptions{
		SSH:         &SSHConfig{Target: "dev@host"},
		RemoteCwd:   "/home/dev/project",
		SandboxMode: "os",
	}
	if err := ApplySSHWrap(cmd, opts); err == nil {
		t.Fatal("expected error combining ssh with os sandbox")
	}
}

func TestResolveRemoteExecutionRequiresRemotePathWithoutMutagen(t *testing.T) {
	t.Parallel()
	_, err := ResolveRemoteExecution(SSHConfig{
		Target:        "dev@host",
		LocalBasePath: t.TempDir(),
	}, t.TempDir())
	if err == nil {
		t.Fatal("expected error when remote path is missing and mutagen is unavailable")
	}
}

func TestResolveRemoteExecutionWithExplicitRemoteBase(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("ssh"); err != nil {
		t.Skip("ssh not available")
	}
	localBase := t.TempDir()
	localCwd := filepath.Join(localBase, ".worktrees", "run-1")
	if err := os.MkdirAll(localCwd, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := ResolveRemoteExecution(SSHConfig{
		Target:         "dev@host",
		LocalBasePath:  localBase,
		RemoteBasePath: "/home/dev/project",
	}, localCwd)
	if err == nil {
		t.Fatal("expected verifyRemoteDirectory to fail without a live host")
	}
	if !sshContains(err.Error(), "remote directory") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func sshContains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || sshIndexOf(s, sub) >= 0)
}

func sshIndexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
