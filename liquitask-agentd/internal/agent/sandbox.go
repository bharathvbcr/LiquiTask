package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// PrepareManagedCommand applies optional OS sandbox wrapping then configures
// daemon-managed process lifecycle on cmd.
func PrepareManagedCommand(cmd *exec.Cmd, opts ExecOptions, waitDelay time.Duration) error {
	if cmd.Dir == "" && opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	if opts.SSH != nil && strings.TrimSpace(opts.SSH.Target) != "" {
		if err := ApplySSHWrap(cmd, opts); err != nil {
			return err
		}
	} else if strings.TrimSpace(opts.ContainerImage) != "" {
		if err := wrapContainerRun(cmd, opts); err != nil {
			return err
		}
	} else if opts.SandboxMode == "os" {
		if err := wrapOSSandbox(cmd, opts); err != nil {
			return err
		}
	}
	InstallManagedProcess(cmd, waitDelay)
	return nil
}

// ApplyOSSandbox wraps cmd with the platform OS sandbox when sandboxMode is "os".
// No-op for other modes. Used by backends with custom lifecycle (codex, opencode).
func ApplyOSSandbox(cmd *exec.Cmd, opts ExecOptions) error {
	if opts.SandboxMode != "os" {
		return nil
	}
	return wrapOSSandbox(cmd, opts)
}

func wrapOSSandbox(cmd *exec.Cmd, opts ExecOptions) error {
	if opts.EphemeralHome == "" {
		dir, err := os.MkdirTemp("", "liquitask-agent-home-*")
		if err != nil {
			return fmt.Errorf("create ephemeral agent home: %w", err)
		}
		opts.EphemeralHome = dir
	}
	if cmd.Env == nil {
		cmd.Env = os.Environ()
	}
	cmd.Env = append(cmd.Env, "HOME="+opts.EphemeralHome, "XDG_CONFIG_HOME="+filepath.Join(opts.EphemeralHome, ".config"))
	profile, err := buildSandboxProfileInput(opts)
	if err != nil {
		return fmt.Errorf("build sandbox profile: %w", err)
	}
	return applyPlatformSandbox(cmd, profile)
}

func quoteSandboxSubpath(p string) string {
	escaped := strings.ReplaceAll(p, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func writeSandboxProfileFile(profile sandboxProfileInput) (string, func(), error) {
	var sb strings.Builder
	sb.WriteString("(version 1)\n")
	sb.WriteString("(deny default)\n")
	sb.WriteString("(allow network*)\n")
	sb.WriteString("(allow process*)\n")
	sb.WriteString("(allow mach-lookup)\n")
	sb.WriteString("(allow sysctl-read)\n")
	appendSandboxFileReadRules(&sb, profile)
	for _, root := range profile.WritableRoots {
		sb.WriteString("(allow file-write* (subpath ")
		sb.WriteString(quoteSandboxSubpath(root))
		sb.WriteString("))\n")
	}
	dir, err := os.MkdirTemp("", "liquitask-sb-*")
	if err != nil {
		return "", nil, fmt.Errorf("create sandbox profile dir: %w", err)
	}
	path := filepath.Join(dir, "profile.sb")
	if err := os.WriteFile(path, []byte(sb.String()), 0o600); err != nil {
		_ = os.RemoveAll(dir)
		return "", nil, fmt.Errorf("write sandbox profile: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(dir) }
	return path, cleanup, nil
}

func sandboxExecPath() (string, error) {
	for _, candidate := range []string{"/usr/bin/sandbox-exec", "/usr/sbin/sandbox-exec"} {
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate, nil
		}
	}
	if p, err := exec.LookPath("sandbox-exec"); err == nil {
		return p, nil
	}
	return "", fmt.Errorf("sandbox-exec not found (OS sandbox requires macOS sandbox-exec)")
}
