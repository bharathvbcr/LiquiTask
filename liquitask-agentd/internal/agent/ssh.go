package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// SSHConfig describes remote execution over OpenSSH (unix hosts only).
type SSHConfig struct {
	Target         string `json:"target"`
	Port           int    `json:"port,omitempty"`
	IdentityFile   string `json:"identityFile,omitempty"`
	LocalBasePath  string `json:"localBasePath,omitempty"`
	RemoteBasePath string `json:"remoteBasePath,omitempty"`
	FallbackLocal  bool   `json:"fallbackToLocal,omitempty"`
}

// SSHResolution is the outcome of preparing a remote working directory.
type SSHResolution struct {
	RemoteCwd      string
	UsedMutagen    bool
	FallbackLocal  bool
	FallbackReason string
}

const sshStatusFallback = "ssh_fallback"

// SSHStatusFallback is emitted on run.events when execution falls back to local.
const SSHStatusFallback = sshStatusFallback

// RemoteSSHSupported reports whether this platform can spawn remote SSH runs.
func RemoteSSHSupported() bool {
	return runtime.GOOS == "darwin" || runtime.GOOS == "linux"
}

// ValidateSSHConfig checks SSH target configuration.
func ValidateSSHConfig(cfg SSHConfig) error {
	if strings.TrimSpace(cfg.Target) == "" {
		return fmt.Errorf("ssh target required")
	}
	if !RemoteSSHSupported() {
		return fmt.Errorf("remote SSH execution is not supported on %s", runtime.GOOS)
	}
	if _, err := exec.LookPath("ssh"); err != nil {
		return fmt.Errorf("ssh executable not found: %w", err)
	}
	return nil
}

// CheckSSHHealth verifies passwordless/batch SSH connectivity.
func CheckSSHHealth(cfg SSHConfig) error {
	if err := ValidateSSHConfig(cfg); err != nil {
		return err
	}
	args := sshBaseArgs(cfg)
	args = append(args, cfg.Target, "echo", "liquitask-ok")
	cmd := exec.Command("ssh", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("ssh health check failed: %s", msg)
	}
	if !strings.Contains(string(out), "liquitask-ok") {
		return fmt.Errorf("ssh health check failed: unexpected response %q", strings.TrimSpace(string(out)))
	}
	return nil
}

// ResolveRemoteExecution maps a local cwd to a remote cwd, optionally via Mutagen.
// When Mutagen is unavailable, remoteBasePath must be set and the mapped path must exist.
func ResolveRemoteExecution(cfg SSHConfig, localCwd string) (SSHResolution, error) {
	if err := ValidateSSHConfig(cfg); err != nil {
		return SSHResolution{}, err
	}
	localCwd = strings.TrimSpace(localCwd)
	if localCwd == "" {
		return SSHResolution{}, fmt.Errorf("local working directory required for ssh execution")
	}
	localAbs, err := filepath.Abs(localCwd)
	if err != nil {
		return SSHResolution{}, fmt.Errorf("resolve local cwd: %w", err)
	}

	localBase := strings.TrimSpace(cfg.LocalBasePath)
	if localBase == "" {
		localBase = localAbs
	} else {
		localBase, err = filepath.Abs(localBase)
		if err != nil {
			return SSHResolution{}, fmt.Errorf("resolve local base path: %w", err)
		}
	}

	remoteBase := strings.TrimSpace(cfg.RemoteBasePath)
	usedMutagen := false
	if mutagenRemote, ok := mutagenRemotePathFor(localBase); ok {
		remoteBase = mutagenRemote
		usedMutagen = true
	}
	if remoteBase == "" {
		return SSHResolution{}, fmt.Errorf("remote repo path required when Mutagen sync is not detected (set remotePath on the agent profile)")
	}

	remoteCwd, err := mapLocalToRemote(localAbs, localBase, remoteBase)
	if err != nil {
		return SSHResolution{}, err
	}
	if err := verifyRemoteDirectory(cfg, remoteCwd); err != nil {
		return SSHResolution{}, err
	}
	return SSHResolution{RemoteCwd: remoteCwd, UsedMutagen: usedMutagen}, nil
}

// PrepareSSHExecution resolves remote cwd and optionally falls back to local execution.
func PrepareSSHExecution(cfg SSHConfig, localCwd string) (SSHResolution, error) {
	if err := CheckSSHHealth(cfg); err != nil {
		if cfg.FallbackLocal {
			return SSHResolution{FallbackLocal: true, FallbackReason: err.Error()}, nil
		}
		return SSHResolution{}, err
	}
	res, err := ResolveRemoteExecution(cfg, localCwd)
	if err != nil {
		if cfg.FallbackLocal {
			return SSHResolution{FallbackLocal: true, FallbackReason: err.Error()}, nil
		}
		return SSHResolution{}, err
	}
	return res, nil
}

// ApplySSHWrap rewrites cmd to run via `ssh -tt` on the remote host.
// Remote container/OS sandbox profiles are rejected — out of scope for v1.
func ApplySSHWrap(cmd *exec.Cmd, opts ExecOptions) error {
	cfg := opts.SSH
	if cfg == nil || strings.TrimSpace(cfg.Target) == "" {
		return nil
	}
	if strings.TrimSpace(opts.ContainerImage) != "" {
		return fmt.Errorf("remote SSH execution cannot be combined with container sandbox")
	}
	if opts.SandboxMode == "os" {
		return fmt.Errorf("remote SSH execution cannot be combined with OS sandbox")
	}
	if err := ValidateSSHConfig(*cfg); err != nil {
		return err
	}
	remoteCwd := strings.TrimSpace(opts.RemoteCwd)
	if remoteCwd == "" {
		return fmt.Errorf("remote working directory not resolved for ssh execution")
	}

	innerPath := cmd.Path
	innerArgs := append([]string(nil), cmd.Args...)
	if len(innerArgs) > 0 && innerArgs[0] == innerPath {
		innerArgs = innerArgs[1:]
	}
	innerArgs, err := stageLocalArgPaths(*cfg, innerArgs)
	if err != nil {
		return err
	}

	remoteExec := filepath.Base(innerPath)
	if remoteExec == "" || remoteExec == "." {
		remoteExec = innerPath
	}
	remoteCmd := shellJoin(remoteExec, innerArgs)
	fullRemote := fmt.Sprintf("cd %s && exec %s", shellQuote(remoteCwd), remoteCmd)

	sshArgs := sshBaseArgs(*cfg)
	sshArgs = append(sshArgs, cfg.Target, fullRemote)
	cmd.Path, _ = exec.LookPath("ssh")
	cmd.Args = append([]string{"ssh"}, sshArgs...)
	cmd.Dir = ""
	return nil
}

func sshBaseArgs(cfg SSHConfig) []string {
	args := []string{
		"-tt",
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
		"-o", "StrictHostKeyChecking=accept-new",
	}
	if cfg.Port > 0 {
		args = append(args, "-p", fmt.Sprintf("%d", cfg.Port))
	}
	if id := strings.TrimSpace(cfg.IdentityFile); id != "" {
		args = append(args, "-i", id)
	}
	return args
}

func mapLocalToRemote(localPath, localBase, remoteBase string) (string, error) {
	localPath = filepath.Clean(localPath)
	localBase = filepath.Clean(localBase)
	rel, err := filepath.Rel(localBase, localPath)
	if err != nil {
		return "", fmt.Errorf("map local path under base: %w", err)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("local cwd %q is outside agent base %q", localPath, localBase)
	}
	remoteBase = strings.TrimRight(remoteBase, "/")
	if rel == "." {
		return remoteBase, nil
	}
	remoteRel := filepath.ToSlash(rel)
	return remoteBase + "/" + remoteRel, nil
}

func verifyRemoteDirectory(cfg SSHConfig, remotePath string) error {
	args := sshBaseArgs(cfg)
	args = append(args, cfg.Target, "test", "-d", remotePath)
	cmd := exec.Command("ssh", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("remote directory %q not found (clone the repo on the host or configure Mutagen sync): %s", remotePath, msg)
	}
	return nil
}

type mutagenSession struct {
	Name       string `json:"name"`
	AlphaPath  string `json:"alphaPath"`
	BetaPath   string `json:"betaPath"`
	AlphaURL   string `json:"alphaURL"`
	BetaURL    string `json:"betaURL"`
}

func mutagenRemotePathFor(localBase string) (string, bool) {
	if _, err := exec.LookPath("mutagen"); err != nil {
		return "", false
	}
	localBase, err := filepath.Abs(localBase)
	if err != nil {
		return "", false
	}
	cmd := exec.Command("mutagen", "sync", "list", "--template", "{{json .}}")
	out, err := cmd.Output()
	if err != nil || len(bytes.TrimSpace(out)) == 0 {
		return "", false
	}
	var sessions []mutagenSession
	if err := json.Unmarshal(out, &sessions); err != nil {
		return "", false
	}
	localBase = filepath.Clean(localBase)
	for _, s := range sessions {
		alpha := strings.TrimSpace(s.AlphaPath)
		if alpha == "" {
			alpha = mutagenURLPath(s.AlphaURL)
		}
		if alpha == "" {
			continue
		}
		alpha = filepath.Clean(alpha)
		if alpha != localBase && !strings.HasPrefix(localBase, alpha+string(filepath.Separator)) {
			continue
		}
		beta := strings.TrimSpace(s.BetaPath)
		if beta == "" {
			beta = mutagenURLPath(s.BetaURL)
		}
		if beta == "" {
			continue
		}
		rel, err := filepath.Rel(alpha, localBase)
		if err != nil {
			continue
		}
		beta = strings.TrimRight(beta, "/")
		if rel == "." {
			return beta, true
		}
		return beta + "/" + filepath.ToSlash(rel), true
	}
	return "", false
}

func mutagenURLPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if strings.Contains(raw, ":/") {
		parts := strings.SplitN(raw, ":", 2)
		if len(parts) == 2 {
			return parts[1]
		}
	}
	return raw
}

func stageLocalArgPaths(cfg SSHConfig, args []string) ([]string, error) {
	out := append([]string(nil), args...)
	for i := 0; i < len(out); i++ {
		candidate := strings.TrimSpace(out[i])
		if candidate == "" || strings.HasPrefix(candidate, "-") {
			continue
		}
		if !filepath.IsAbs(candidate) {
			continue
		}
		st, err := os.Stat(candidate)
		if err != nil || st.IsDir() {
			continue
		}
		remotePath, err := uploadLocalFile(cfg, candidate)
		if err != nil {
			return nil, err
		}
		out[i] = remotePath
	}
	return out, nil
}

func uploadLocalFile(cfg SSHConfig, localPath string) (string, error) {
	data, err := os.ReadFile(localPath)
	if err != nil {
		return "", fmt.Errorf("read %s for remote staging: %w", localPath, err)
	}
	remotePath := fmt.Sprintf("/tmp/liquitask-stage-%s", filepath.Base(localPath))
	args := sshBaseArgs(cfg)
	args = append(args, cfg.Target, fmt.Sprintf("cat > %s", shellQuote(remotePath)))
	cmd := exec.Command("ssh", args...)
	cmd.Stdin = bytes.NewReader(data)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("upload %s to remote: %s", localPath, msg)
	}
	return remotePath, nil
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", `'\'\''`) + "'"
}

func shellJoin(bin string, args []string) string {
	parts := []string{shellQuote(bin)}
	for _, a := range args {
		parts = append(parts, shellQuote(a))
	}
	return strings.Join(parts, " ")
}
