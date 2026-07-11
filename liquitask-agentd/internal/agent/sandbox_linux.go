//go:build linux

package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func applyPlatformSandbox(cmd *exec.Cmd, profile sandboxProfileInput) error {
	bwrap, err := exec.LookPath("bwrap")
	if err != nil {
		return fmt.Errorf("bwrap not found (OS sandbox requires bubblewrap on Linux)")
	}

	origPath := cmd.Path
	origArgs := append([]string(nil), cmd.Args...)
	if len(origArgs) == 0 {
		origArgs = []string{origPath}
	}
	innerArgs := origArgs[1:]

	args := []string{
		"--die-with-parent",
		"--proc", "/proc",
		"--dev", "/dev",
		"--tmpfs", "/tmp",
	}
	for _, bind := range []string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc/resolv.conf", "/etc/ssl", "/etc/nsswitch.conf", "/etc/hosts"} {
		if st, err := os.Stat(bind); err == nil && !st.IsDir() {
			args = append(args, "--ro-bind", bind, bind)
		} else if err == nil {
			args = append(args, "--ro-bind", bind, bind)
		}
	}
	for _, root := range profile.WritableRoots {
		args = appendWritableRootBind(args, root, profile.McpDir)
	}
	if cmd.Dir != "" {
		args = append(args, "--chdir", cmd.Dir)
	}
	args = append(args, "--", origPath)
	args = append(args, innerArgs...)

	cmd.Path = bwrap
	cmd.Args = append([]string{bwrap}, args...)
	return nil
}

func appendWritableRootBind(args []string, root, mcpDir string) []string {
	root = filepath.Clean(root)
	if mcpDir != "" && root == filepath.Clean(mcpDir) {
		return appendMcpDirBindsExcludingSecret(args, root)
	}
	return append(args, "--bind", root, root)
}

// appendMcpDirBindsExcludingSecret mounts the MCP bridge dir for writes but
// masks .secret so the sandboxed agent cannot read the per-run HMAC key.
func appendMcpDirBindsExcludingSecret(args []string, mcpDir string) []string {
	args = append(args, "--bind", mcpDir, mcpDir)
	secretPath := filepath.Join(mcpDir, ".secret")
	if _, err := os.Stat(secretPath); err == nil {
		args = append(args, "--ro-bind", "/dev/null", secretPath)
	}
	return args
}

func linuxSandboxBindRoots(profile sandboxProfileInput) []string {
	out := make([]string, 0, len(profile.WritableRoots))
	for _, root := range profile.WritableRoots {
		out = append(out, filepath.Clean(root))
	}
	return out
}

func init() {
	_ = strings.TrimSpace
}
