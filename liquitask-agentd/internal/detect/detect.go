package detect

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Runtime describes a locally installed coding-agent CLI.
type Runtime struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Binary  string `json:"binary"`
	Path    string `json:"path,omitempty"`
	Version string `json:"version,omitempty"`
	Ready   bool   `json:"ready"`
}

// known lists every runtime the detect RPC will scan for on PATH. It is a
// superset of agent.SupportedTypes: the 14 supported types are startable via
// run.start (agent.New/Backend.Execute), plus two detect-only extras —
// "gemini" and "aider" — for CLIs the daemon can report as installed but
// cannot yet start through the agent.Backend abstraction (no ported backend
// exists for either). They are kept here deliberately, not dropped, so the
// desktop UI can still show them as "detected, not yet startable" rather than
// disappearing entirely; HandleStart rejects them with a clear "unsupported
// runtime" error via agent.IsSupportedType.
//
// The 14 supported entries' IDs and default binary names are kept in lockstep
// with agent.SupportedTypes and each backend's own execPath default (see the
// `if execPath == ""` fallback in each backend file).
var known = []struct {
	ID, Name string
	Bins     []string
	VerArgs  []string
}{
	{"claude", "Claude Code", []string{"claude"}, []string{"--version"}},
	{"codebuddy", "CodeBuddy", []string{"codebuddy"}, []string{"--version"}},
	{"codex", "Codex", []string{"codex"}, []string{"--version"}},
	{"copilot", "GitHub Copilot CLI", []string{"copilot"}, []string{"--version"}},
	{"opencode", "OpenCode", []string{"opencode"}, []string{"--version"}},
	{"openclaw", "OpenClaw", []string{"openclaw"}, []string{"--version"}},
	{"hermes", "Hermes", []string{"hermes"}, []string{"--version"}},
	{"pi", "Pi", []string{"pi"}, []string{"--version"}},
	{"cursor", "Cursor Agent", []string{"cursor-agent", "cursor"}, []string{"--version"}},
	{"kimi", "Kimi", []string{"kimi"}, []string{"--version"}},
	{"kiro", "Kiro", []string{"kiro-cli", "kiro"}, []string{"--version"}},
	{"antigravity", "Antigravity", []string{"agy"}, []string{"--version"}},
	{"qoder", "Qoder", []string{"qodercli", "qoder"}, []string{"--version"}},
	{"traecli", "Trae", []string{"traecli"}, []string{"--version"}},
	// Detect-only: no ported agent.Backend yet, so not in agent.SupportedTypes.
	{"gemini", "Gemini CLI", []string{"gemini"}, []string{"--version"}},
	{"aider", "Aider", []string{"aider"}, []string{"--version"}},
}

// Detect scans PATH for known coding-agent CLIs.
func Detect() []Runtime {
	out := make([]Runtime, 0, len(known))
	for _, k := range known {
		rt := Runtime{ID: k.ID, Name: k.Name, Ready: false}
		for _, bin := range k.Bins {
			path, err := exec.LookPath(bin)
			if err != nil {
				continue
			}
			rt.Binary = bin
			rt.Path = path
			rt.Ready = true
			if ver := versionOf(path, k.VerArgs); ver != "" {
				rt.Version = ver
			}
			break
		}
		out = append(out, rt)
	}
	return out
}

func versionOf(path string, args []string) string {
	if len(args) == 0 {
		return ""
	}
	cmd := exec.Command(path, args...)
	b, err := cmd.CombinedOutput()
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(string(b))
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	if len(line) > 80 {
		line = line[:80]
	}
	return line
}

// ResolveBinary returns an absolute path for a runtime id or binary name.
func ResolveBinary(idOrBin string) (string, error) {
	for _, r := range Detect() {
		if r.Ready && (r.ID == idOrBin || r.Binary == idOrBin) {
			return r.Path, nil
		}
	}
	if path, err := exec.LookPath(idOrBin); err == nil {
		return path, nil
	}
	// Windows: try .cmd/.exe
	if runtime.GOOS == "windows" {
		for _, ext := range []string{".cmd", ".exe", ".bat"} {
			if path, err := exec.LookPath(idOrBin + ext); err == nil {
				return path, nil
			}
		}
	}
	return "", &NotFoundError{Name: idOrBin}
}

// NotFoundError is returned when a binary is missing.
type NotFoundError struct{ Name string }

func (e *NotFoundError) Error() string {
	return "agent runtime not found: " + e.Name
}

// DisplayName is the basename of a path.
func DisplayName(path string) string {
	return filepath.Base(path)
}
