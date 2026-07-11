package agent

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// cliConfigHomes are agent-runtime config/cache dirs that need write access
// inside an OS sandbox profile.
var cliConfigHomes = []string{
	".claude",
	".codex",
	".cursor",
	".config/cursor",
	".config/codex",
	".npm",
	".cache/npm",
	".cache/node",
	".local/share/opencode",
	".config/opencode",
	".openclaw",
	".grok",
	".copilot",
	".config/github-copilot",
	".pi",
	".config/antigravity",
	".qoder",
	".codebuddy",
	".kiro",
	".kimi",
	".traecli",
	".hermes",
}

// collectSandboxWritableRoots returns canonical paths the OS sandbox must allow
// write access to for a single agent run.
func collectSandboxWritableRoots(opts ExecOptions) ([]string, error) {
	seen := make(map[string]struct{})
	var roots []string
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" {
			return
		}
		clean := canonicalSandboxRoot(p)
		if clean == "" {
			return
		}
		if _, ok := seen[clean]; ok {
			return
		}
		seen[clean] = struct{}{}
		roots = append(roots, clean)
	}

	scopeActive := len(opts.ScopePaths) > 0 && opts.SandboxMode == "os"
	if scopeActive {
		cwd := opts.Cwd
		for _, sp := range opts.ScopePaths {
			sp = strings.TrimSpace(strings.ReplaceAll(sp, "\\", "/"))
			sp = strings.Trim(sp, "/")
			if sp == "" || sp == "**" || sp == "*" {
				add(cwd)
				continue
			}
			if filepath.IsAbs(sp) {
				add(sp)
				continue
			}
			if cwd != "" {
				add(filepath.Join(cwd, sp))
			}
		}
	} else {
		if opts.Cwd != "" {
			add(opts.Cwd)
		}
		for _, wp := range opts.WorkspacePaths {
			add(wp)
		}
	}
	if mcpDir := ExtractLiquitaskMcpDir(opts.McpConfig); mcpDir != "" {
		add(mcpDir)
	}
	if tmp := os.Getenv("TMPDIR"); tmp != "" {
		add(tmp)
	} else if tmp := os.Getenv("TEMP"); tmp != "" {
		add(tmp)
	} else if tmp := os.Getenv("TMP"); tmp != "" {
		add(tmp)
	} else {
		add("/tmp")
	}
	// Per-run ephemeral HOME instead of real CLI config dirs (prevents hook/MCP poisoning).
	if opts.EphemeralHome != "" {
		add(opts.EphemeralHome)
	}
	if opts.ExecutablePath != "" {
		add(filepath.Dir(opts.ExecutablePath))
	}
	return roots, nil
}

func findGitDir(start string) string {
	dir := start
	for {
		gitPath := filepath.Join(dir, ".git")
		if st, err := os.Stat(gitPath); err == nil {
			if st.IsDir() {
				return gitPath
			}
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// sandboxProfileInput carries the resolved allow-roots for platform wrappers.
type sandboxProfileInput struct {
	WritableRoots []string
	Home          string
	McpDir        string
}

func buildSandboxProfileInput(opts ExecOptions) (sandboxProfileInput, error) {
	roots, err := collectSandboxWritableRoots(opts)
	if err != nil {
		return sandboxProfileInput{}, err
	}
	home, _ := os.UserHomeDir()
	mcpDir := ""
	if raw := ExtractLiquitaskMcpDir(opts.McpConfig); raw != "" {
		mcpDir = canonicalSandboxRoot(raw)
	}
	return sandboxProfileInput{WritableRoots: roots, Home: home, McpDir: mcpDir}, nil
}

// appendSandboxFileReadRules writes global read allow plus MCP/agentd secret denials.
func appendSandboxFileReadRules(sb *strings.Builder, profile sandboxProfileInput) {
	sb.WriteString("(allow file-read*)\n")
	if profile.McpDir != "" {
		for _, name := range []string{".secret", "response-secret"} {
			secretPath := filepath.Join(profile.McpDir, name)
			sb.WriteString("(deny file-read* (literal ")
			sb.WriteString(quoteSandboxSubpath(secretPath))
			sb.WriteString("))\n")
		}
		for _, sub := range []string{"inflight", "responses"} {
			dirPath := filepath.Join(profile.McpDir, sub)
			sb.WriteString("(deny file-write* (literal ")
			sb.WriteString(quoteSandboxSubpath(dirPath))
			sb.WriteString("))\n")
		}
	}
	dataDir := defaultAgentdDataDir()
	for _, name := range []string{"token", "agentd.sock"} {
		path := filepath.Join(dataDir, name)
		sb.WriteString("(deny file-read* (literal ")
		sb.WriteString(quoteSandboxSubpath(path))
		sb.WriteString("))\n")
	}
	if runtime.GOOS == "windows" {
		sb.WriteString("(deny file-read* (literal ")
		sb.WriteString(quoteSandboxSubpath(`\\.\pipe\liquitask-agentd`))
		sb.WriteString("))\n")
	}
}

func defaultAgentdDataDir() string {
	if dir := os.Getenv("LIQUITASK_AGENTD_DATA"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "liquitask-agentd")
	}
	return filepath.Join(home, ".liquitask", "agentd")
}

// canonicalSandboxRoot resolves symlinks so macOS sandbox-exec subpath rules
// match real vnode paths (/var → /private/var).
func canonicalSandboxRoot(p string) string {
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	return filepath.Clean(abs)
}
