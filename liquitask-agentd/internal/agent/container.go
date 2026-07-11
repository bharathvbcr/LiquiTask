package agent

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// containerPassthroughEnvKeys are forwarded into the VM via `container run -e`.
// The apple/container image is the isolation boundary; API keys must reach the
// agent CLI inside the VM (see docs/AGENT_TEAMMATES.md).
var containerPassthroughEnvKeys = []string{
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"CURSOR_API_KEY",
	"GITHUB_TOKEN",
	"GH_TOKEN",
	"CODEX_API_KEY",
	"GROK_API_KEY",
}

const containerWorkMount = "/work"

// ValidateContainerAvailable reports whether apple/container is installed and
// the VM system is running (`container system status` succeeds).
func ValidateContainerAvailable() error {
	containerPath, err := exec.LookPath("container")
	if err != nil {
		return fmt.Errorf("container CLI not found (apple/container required): %w", err)
	}
	cmd := exec.Command(containerPath, "system", "status")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("container system not running (run `container system start`): %s", msg)
	}
	return nil
}

// wrapContainerRun rewrites cmd to execute via `container run`, mounting the
// host worktree at /work. No-op when ContainerImage is empty.
func wrapContainerRun(cmd *exec.Cmd, opts ExecOptions) error {
	image := strings.TrimSpace(opts.ContainerImage)
	if image == "" {
		return nil
	}
	if image == "" || strings.HasPrefix(image, "-") || len(image) > 200 {
		return fmt.Errorf("invalid container image %q", image)
	}

	containerPath, err := exec.LookPath("container")
	if err != nil {
		return fmt.Errorf("container CLI not found (apple/container required): %w", err)
	}

	workDir := strings.TrimSpace(opts.Cwd)
	if workDir == "" {
		workDir = cmd.Dir
	}
	workDir, err = filepath.Abs(workDir)
	if err != nil || workDir == "" {
		return fmt.Errorf("container sandbox requires an absolute working directory")
	}

	innerPath := cmd.Path
	innerArgs := append([]string(nil), cmd.Args...)
	if len(innerArgs) > 0 && innerArgs[0] == innerPath {
		innerArgs = innerArgs[1:]
	}

	rewritten, extraMounts := rewriteArgsForContainer(innerArgs, workDir)
	runArgs := []string{"run", "--rm", "-v", workDir + ":" + containerWorkMount, "-w", containerWorkMount}
	runArgs = append(runArgs, extraMounts...)
	if envGuest, cleanup, err := writeContainerSecretsEnvFile(workDir); err != nil {
		return fmt.Errorf("container secrets env file: %w", err)
	} else if envGuest != "" {
		runArgs = append(runArgs, "--env-file", envGuest)
		defer cleanup()
	}
	runArgs = append(runArgs, image, innerPath)
	runArgs = append(runArgs, rewritten...)

	cmd.Path = containerPath
	cmd.Args = append([]string{containerPath}, runArgs...)
	cmd.Dir = ""
	return nil
}

func rewriteArgsForContainer(args []string, workDir string) ([]string, []string) {
	out := make([]string, 0, len(args))
	var mounts []string
	seenMount := make(map[string]bool)

	for _, arg := range args {
		rewritten, mount := rewriteContainerPathArg(arg, workDir)
		out = append(out, rewritten)
		if mount.host != "" && !seenMount[mount.host] {
			seenMount[mount.host] = true
			mounts = append(mounts, "-v", mount.host+":"+mount.guest)
		}
	}
	return out, mounts
}

type containerMount struct {
	host  string
	guest string
}

func rewriteContainerPathArg(arg, workDir string) (string, containerMount) {
	if !filepath.IsAbs(arg) {
		return arg, containerMount{}
	}
	if rel, err := filepath.Rel(workDir, arg); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return filepath.ToSlash(filepath.Join(containerWorkMount, rel)), containerMount{}
	}
	hostDir := filepath.Dir(arg)
	guestDir := "/mnt" + strings.ReplaceAll(hostDir, string(filepath.Separator), "_")
	return guestDir + "/" + filepath.Base(arg), containerMount{host: hostDir, guest: guestDir}
}

// writeContainerSecretsEnvFile writes API keys to a 0600 env file mounted into
// the VM instead of passing `-e KEY=value` on argv (visible in `ps`).
func writeContainerSecretsEnvFile(workDir string) (guestPath string, cleanup func(), err error) {
	noop := func() {}
	dir := filepath.Join(workDir, ".liquitask")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", noop, err
	}
	name := fmt.Sprintf("container-secrets-%d.env", time.Now().UnixNano())
	hostPath := filepath.Join(dir, name)
	var lines []string
	for _, key := range containerPassthroughEnvKeys {
		if val, ok := os.LookupEnv(key); ok && strings.TrimSpace(val) != "" {
			lines = append(lines, key+"="+val)
		}
	}
	if len(lines) == 0 {
		return "", noop, nil
	}
	payload := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(hostPath, []byte(payload), 0o600); err != nil {
		return "", noop, err
	}
	guest := containerWorkMount + "/.liquitask/" + name
	return guest, func() { _ = os.Remove(hostPath) }, nil
}
