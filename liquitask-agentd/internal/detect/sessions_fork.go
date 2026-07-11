package detect

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// ForkSupported reports whether fork/checkpoint/rewind is implemented for a runtime.
func ForkSupported(runtime string) bool {
	switch strings.ToLower(strings.TrimSpace(runtime)) {
	case "claude", "codex":
		return true
	default:
		return false
	}
}

// ForkParams configures sessions.fork.
type ForkParams struct {
	Runtime      string `json:"runtime"`
	SessionID    string `json:"sessionId"`
	ProjectPath  string `json:"projectPath,omitempty"`
	MessageIndex int    `json:"messageIndex,omitempty"` // 0 = keep all lines
	NewSessionID string `json:"newSessionId,omitempty"`
}

// ForkResult is returned by sessions.fork.
type ForkResult struct {
	NewSessionID string `json:"newSessionId"`
	SessionPath  string `json:"sessionPath"`
	MessageIndex int    `json:"messageIndex"`
}

// TruncateParams configures sessions.truncate (rewind).
type TruncateParams struct {
	Runtime      string `json:"runtime"`
	SessionID    string `json:"sessionId"`
	ProjectPath  string `json:"projectPath,omitempty"`
	MessageIndex int    `json:"messageIndex"`
}

// TruncateResult is returned by sessions.truncate.
type TruncateResult struct {
	SessionPath  string `json:"sessionPath"`
	MessageIndex int    `json:"messageIndex"`
}

// MessageCountParams configures sessions.messageCount.
type MessageCountParams struct {
	Runtime     string `json:"runtime"`
	SessionID   string `json:"sessionId"`
	ProjectPath string `json:"projectPath,omitempty"`
}

// MessageCountResult is returned by sessions.messageCount.
type MessageCountResult struct {
	SessionPath  string `json:"sessionPath"`
	MessageIndex int    `json:"messageIndex"`
}

// LocateSessionFile finds the on-disk JSONL session file for a runtime/session id.
func LocateSessionFile(runtime, sessionID, projectPath string) (string, error) {
	runtime = strings.ToLower(strings.TrimSpace(runtime))
	sessionID = strings.TrimSpace(sessionID)
	if runtime == "" || sessionID == "" {
		return "", fmt.Errorf("runtime and sessionId required")
	}
	switch runtime {
	case "claude":
		return locateClaudeSessionFile(sessionID, projectPath)
	case "codex":
		return locateCodexSessionFile(sessionID, projectPath)
	default:
		return "", fmt.Errorf("session fork not supported for runtime %q", runtime)
	}
}

// CountSessionMessages returns the number of non-empty JSONL lines in a session file.
func CountSessionMessages(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return countJSONLLines(f)
}

// ForkSession copies a session file to a new id, optionally truncating to messageIndex lines.
func ForkSession(p ForkParams) (ForkResult, error) {
	runtime := strings.ToLower(strings.TrimSpace(p.Runtime))
	if !ForkSupported(runtime) {
		return ForkResult{}, fmt.Errorf("session fork not supported for runtime %q", p.Runtime)
	}
	srcPath, err := LocateSessionFile(runtime, p.SessionID, p.ProjectPath)
	if err != nil {
		return ForkResult{}, err
	}
	lineCount, err := CountSessionMessages(srcPath)
	if err != nil {
		return ForkResult{}, err
	}
	truncateAt := p.MessageIndex
	if truncateAt <= 0 || truncateAt > lineCount {
		truncateAt = lineCount
	}

	newID := strings.TrimSpace(p.NewSessionID)
	if newID == "" {
		newID = uuid.NewString()
	}

	destPath, err := forkDestPath(runtime, srcPath, newID)
	if err != nil {
		return ForkResult{}, err
	}
	if err := copySessionFile(srcPath, destPath, truncateAt); err != nil {
		return ForkResult{}, err
	}
	if runtime == "codex" {
		if err := patchCodexSessionMeta(destPath, newID); err != nil {
			_ = os.Remove(destPath)
			return ForkResult{}, err
		}
	}
	return ForkResult{
		NewSessionID: newID,
		SessionPath:  destPath,
		MessageIndex: truncateAt,
	}, nil
}

// TruncateSessionFile keeps the first messageIndex non-empty JSONL lines.
func TruncateSession(p TruncateParams) (TruncateResult, error) {
	runtime := strings.ToLower(strings.TrimSpace(p.Runtime))
	if !ForkSupported(runtime) {
		return TruncateResult{}, fmt.Errorf("session truncate not supported for runtime %q", p.Runtime)
	}
	if p.MessageIndex < 0 {
		return TruncateResult{}, fmt.Errorf("messageIndex must be >= 0")
	}
	path, err := LocateSessionFile(runtime, p.SessionID, p.ProjectPath)
	if err != nil {
		return TruncateResult{}, err
	}
	if err := truncateJSONLFile(path, p.MessageIndex); err != nil {
		return TruncateResult{}, err
	}
	return TruncateResult{SessionPath: path, MessageIndex: p.MessageIndex}, nil
}

// SessionMessageCount locates a session file and returns its line count.
func SessionMessageCount(p MessageCountParams) (MessageCountResult, error) {
	runtime := strings.ToLower(strings.TrimSpace(p.Runtime))
	if !ForkSupported(runtime) {
		return MessageCountResult{}, fmt.Errorf("session message count not supported for runtime %q", p.Runtime)
	}
	path, err := LocateSessionFile(runtime, p.SessionID, p.ProjectPath)
	if err != nil {
		return MessageCountResult{}, err
	}
	count, err := CountSessionMessages(path)
	if err != nil {
		return MessageCountResult{}, err
	}
	return MessageCountResult{SessionPath: path, MessageIndex: count}, nil
}

func locateClaudeSessionFile(sessionID, projectPath string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(home, ".claude", "projects")
	if projectPath = strings.TrimSpace(projectPath); projectPath != "" {
		if path, ok := claudeSessionInProject(root, projectPath, sessionID); ok {
			return path, nil
		}
	}
	projects, err := os.ReadDir(root)
	if err != nil {
		return "", fmt.Errorf("claude session %q not found", sessionID)
	}
	for _, proj := range projects {
		if !proj.IsDir() {
			continue
		}
		candidate := filepath.Join(root, proj.Name(), sessionID+".jsonl")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("claude session %q not found", sessionID)
}

func claudeSessionInProject(root, projectPath, sessionID string) (string, bool) {
	projects, err := os.ReadDir(root)
	if err != nil {
		return "", false
	}
	want := filepath.Clean(projectPath)
	for _, proj := range projects {
		if !proj.IsDir() {
			continue
		}
		decoded := decodeClaudeProjectDir(proj.Name())
		if decoded != "" && !pathsCompatible(decoded, want) {
			continue
		}
		candidate := filepath.Join(root, proj.Name(), sessionID+".jsonl")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	return "", false
}

func locateCodexSessionFile(sessionID, projectPath string) (string, error) {
	root := codexSessionRoot()
	if root == "" {
		return "", fmt.Errorf("codex sessions directory not found")
	}
	var found string
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		if strings.HasSuffix(d.Name(), sessionID+".jsonl") || strings.Contains(d.Name(), sessionID) {
			if projectPath != "" {
				meta := readCodexSessionMeta(path)
				if meta.Cwd != "" && !pathsCompatible(meta.Cwd, projectPath) {
					return nil
				}
			}
			found = path
			return io.EOF
		}
		meta := readCodexSessionMeta(path)
		if meta.SessionID == sessionID {
			if projectPath != "" && meta.Cwd != "" && !pathsCompatible(meta.Cwd, projectPath) {
				return nil
			}
			found = path
			return io.EOF
		}
		return nil
	})
	if found != "" {
		return found, nil
	}
	return "", fmt.Errorf("codex session %q not found", sessionID)
}

func forkDestPath(runtime, srcPath, newID string) (string, error) {
	dir := filepath.Dir(srcPath)
	switch runtime {
	case "claude":
		return filepath.Join(dir, newID+".jsonl"), nil
	case "codex":
		base := filepath.Base(srcPath)
		if strings.HasPrefix(base, "rollout-") {
			return filepath.Join(dir, "rollout-"+newID+".jsonl"), nil
		}
		return filepath.Join(dir, newID+".jsonl"), nil
	default:
		return "", fmt.Errorf("unsupported runtime %q", runtime)
	}
}

func copySessionFile(src, dest string, truncateAt int) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer func() {
		_ = out.Close()
	}()

	if truncateAt <= 0 {
		_, err = io.Copy(out, in)
		return err
	}
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lines := 0
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		if lines >= truncateAt {
			break
		}
		if _, err := out.WriteString(line + "\n"); err != nil {
			return err
		}
		lines++
	}
	return sc.Err()
}

func truncateJSONLFile(path string, messageIndex int) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	var lines []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		lines = append(lines, line)
		if len(lines) >= messageIndex {
			break
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	if messageIndex > len(lines) {
		messageIndex = len(lines)
	}
	lines = lines[:messageIndex]

	out, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	for _, line := range lines {
		if _, err := out.WriteString(line + "\n"); err != nil {
			return err
		}
	}
	return nil
}

func countJSONLLines(r io.Reader) (int, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	count := 0
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) != "" {
			count++
		}
	}
	return count, sc.Err()
}

func patchCodexSessionMeta(path, newSessionID string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
	if len(lines) == 0 {
		return fmt.Errorf("empty codex session file")
	}
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var obj map[string]any
		if json.Unmarshal([]byte(line), &obj) != nil {
			continue
		}
		if t, _ := obj["type"].(string); t != "session_meta" {
			continue
		}
		payload, _ := obj["payload"].(map[string]any)
		if payload == nil {
			continue
		}
		payload["session_id"] = newSessionID
		payload["id"] = newSessionID
		updated, err := json.Marshal(obj)
		if err != nil {
			return err
		}
		lines[i] = string(updated)
		break
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

func pathsCompatible(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	if a == "" || b == "" {
		return false
	}
	if a == b {
		return true
	}
	return strings.HasPrefix(a, b+string(filepath.Separator)) ||
		strings.HasPrefix(b, a+string(filepath.Separator))
}
