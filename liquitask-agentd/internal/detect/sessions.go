package detect

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// DiscoveredSession is an agent CLI session found on disk that was not started
// through LiquiTask's run journal.
type DiscoveredSession struct {
	SessionID    string `json:"sessionId"`
	Runtime      string `json:"runtime"`
	ProjectPath  string `json:"projectPath"`
	SessionPath  string `json:"sessionPath"`
	GitBranch    string `json:"gitBranch,omitempty"`
	Preview      string `json:"preview,omitempty"`
	ModifiedAtMs int64  `json:"modifiedAtMs"`
}

// SessionRoot describes a runtime-specific directory tree to scan.
type SessionRoot struct {
	Runtime string `json:"runtime"`
	Path    string `json:"path"`
}

// DiscoverParams configures sessions.discover.
type DiscoverParams struct {
	KnownSessionIDs []string `json:"knownSessionIds,omitempty"`
}

// DiscoverResult is returned by sessions.discover.
type DiscoverResult struct {
	Sessions []DiscoveredSession `json:"sessions"`
}

// SessionRoots returns every on-disk session directory the scanner knows about.
func SessionRoots() []SessionRoot {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	roots := []SessionRoot{
		{Runtime: "claude", Path: filepath.Join(home, ".claude", "projects")},
	}
	if codex := codexSessionRoot(); codex != "" {
		roots = append(roots, SessionRoot{Runtime: "codex", Path: codex})
	}
	piDir := filepath.Join(home, ".multica", "pi-sessions")
	if info, err := os.Stat(piDir); err == nil && info.IsDir() {
		roots = append(roots, SessionRoot{Runtime: "pi", Path: piDir})
	}
	cursorDir := filepath.Join(home, ".cursor", "projects")
	if info, err := os.Stat(cursorDir); err == nil && info.IsDir() {
		roots = append(roots, SessionRoot{Runtime: "cursor", Path: cursorDir})
	}
	return roots
}

func codexSessionRoot() string {
	if codexHome := strings.TrimSpace(os.Getenv("CODEX_HOME")); codexHome != "" {
		dir := filepath.Join(codexHome, "sessions")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	dir := filepath.Join(home, ".codex", "sessions")
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		return dir
	}
	return ""
}

// DiscoverSessions scans runtime session directories and returns sessions not
// listed in knownSessionIDs (LiquiTask journal + renderer-known ids).
func DiscoverSessions(knownSessionIDs []string) DiscoverResult {
	known := make(map[string]struct{}, len(knownSessionIDs))
	for _, id := range knownSessionIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			known[id] = struct{}{}
		}
	}
	for _, id := range journalSessionIDs() {
		known[id] = struct{}{}
	}

	var out []DiscoveredSession
	for _, root := range SessionRoots() {
		switch root.Runtime {
		case "claude":
			out = append(out, scanClaudeProjects(root.Path, known)...)
		case "codex":
			out = append(out, scanCodexSessions(root.Path, known)...)
		case "pi":
			out = append(out, scanFlatJSONLSessions(root.Runtime, root.Path, known, false)...)
		case "cursor":
			out = append(out, scanCursorProjects(root.Path, known)...)
		}
	}
	return DiscoverResult{Sessions: out}
}

func journalSessionIDs() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	runsDir := filepath.Join(home, ".liquitask", "agentd", "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return nil
	}
	var ids []string
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(runsDir, ent.Name(), "meta.json"))
		if err != nil {
			continue
		}
		var meta struct {
			SessionID string `json:"sessionId"`
		}
		if json.Unmarshal(data, &meta) == nil && meta.SessionID != "" {
			ids = append(ids, meta.SessionID)
		}
	}
	return ids
}

func scanClaudeProjects(root string, known map[string]struct{}) []DiscoveredSession {
	projects, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []DiscoveredSession
	for _, proj := range projects {
		if !proj.IsDir() {
			continue
		}
		projectPath := decodeClaudeProjectDir(proj.Name())
		projDir := filepath.Join(root, proj.Name())
		files, err := os.ReadDir(projDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
			if _, skip := known[sessionID]; skip {
				continue
			}
			path := filepath.Join(projDir, f.Name())
			meta := readClaudeSessionMeta(path)
			out = append(out, DiscoveredSession{
				SessionID:    sessionID,
				Runtime:      "claude",
				ProjectPath:  firstNonEmpty(meta.Cwd, projectPath),
				SessionPath:  path,
				GitBranch:    normalizeBranch(meta.GitBranch),
				Preview:      meta.Preview,
				ModifiedAtMs: fileModMs(path),
			})
		}
	}
	return out
}

func scanCodexSessions(root string, known map[string]struct{}) []DiscoveredSession {
	var out []DiscoveredSession
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
			return nil
		}
		meta := readCodexSessionMeta(path)
		if meta.SessionID == "" {
			return nil
		}
		if _, skip := known[meta.SessionID]; skip {
			return nil
		}
		out = append(out, DiscoveredSession{
			SessionID:    meta.SessionID,
			Runtime:      "codex",
			ProjectPath:  meta.Cwd,
			SessionPath:  path,
			GitBranch:    normalizeBranch(meta.GitBranch),
			Preview:      meta.Preview,
			ModifiedAtMs: fileModMs(path),
		})
		return nil
	})
	return out
}

func scanFlatJSONLSessions(runtime, root string, known map[string]struct{}, useBasenameAsID bool) []DiscoveredSession {
	files, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []DiscoveredSession
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(root, f.Name())
		sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
		if !useBasenameAsID {
			meta := readGenericSessionMeta(path)
			if meta.SessionID != "" {
				sessionID = meta.SessionID
			}
		}
		if _, skip := known[sessionID]; skip {
			continue
		}
		meta := readGenericSessionMeta(path)
		out = append(out, DiscoveredSession{
			SessionID:    sessionID,
			Runtime:      runtime,
			ProjectPath:  meta.Cwd,
			SessionPath:  path,
			GitBranch:    normalizeBranch(meta.GitBranch),
			Preview:      meta.Preview,
			ModifiedAtMs: fileModMs(path),
		})
	}
	return out
}

func scanCursorProjects(root string, known map[string]struct{}) []DiscoveredSession {
	projects, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []DiscoveredSession
	for _, proj := range projects {
		if !proj.IsDir() {
			continue
		}
		projectPath := decodeCursorProjectDir(proj.Name())
		transcriptRoot := filepath.Join(root, proj.Name(), "agent-transcripts")
		_ = filepath.WalkDir(transcriptRoot, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(d.Name(), ".jsonl") {
				return nil
			}
			if strings.Contains(path, string(filepath.Separator)+"subagents"+string(filepath.Separator)) {
				return nil
			}
			sessionID := strings.TrimSuffix(d.Name(), ".jsonl")
			if _, skip := known[sessionID]; skip {
				return nil
			}
			meta := readGenericSessionMeta(path)
			out = append(out, DiscoveredSession{
				SessionID:    sessionID,
				Runtime:      "cursor",
				ProjectPath:  firstNonEmpty(meta.Cwd, projectPath),
				SessionPath:  path,
				GitBranch:    normalizeBranch(meta.GitBranch),
				Preview:      meta.Preview,
				ModifiedAtMs: fileModMs(path),
			})
			return nil
		})
	}
	return out
}

type sessionMeta struct {
	SessionID string
	Cwd       string
	GitBranch string
	Preview   string
}

func readClaudeSessionMeta(path string) sessionMeta {
	return readJSONLMeta(path, func(line map[string]any) (sessionMeta, bool) {
		var meta sessionMeta
		if v, ok := line["gitBranch"].(string); ok {
			meta.GitBranch = v
		}
		if v, ok := line["cwd"].(string); ok {
			meta.Cwd = v
		}
		if t, _ := line["type"].(string); t == "user" {
			meta.Preview = extractUserPreview(line)
			return meta, meta.Preview != ""
		}
		return meta, false
	})
}

func readCodexSessionMeta(path string) sessionMeta {
	return readJSONLMeta(path, func(line map[string]any) (sessionMeta, bool) {
		var meta sessionMeta
		t, _ := line["type"].(string)
		if t != "session_meta" {
			return meta, false
		}
		payload, _ := line["payload"].(map[string]any)
		if payload == nil {
			return meta, false
		}
		if v, ok := payload["session_id"].(string); ok {
			meta.SessionID = v
		}
		if v, ok := payload["id"].(string); ok && meta.SessionID == "" {
			meta.SessionID = v
		}
		if v, ok := payload["cwd"].(string); ok {
			meta.Cwd = v
		}
		if v, ok := payload["git_branch"].(string); ok {
			meta.GitBranch = v
		}
		return meta, meta.SessionID != ""
	})
}

func readGenericSessionMeta(path string) sessionMeta {
	return readJSONLMeta(path, func(line map[string]any) (sessionMeta, bool) {
		var meta sessionMeta
		for _, key := range []string{"sessionId", "session_id", "sessionID"} {
			if v, ok := line[key].(string); ok && v != "" {
				meta.SessionID = v
				break
			}
		}
		for _, key := range []string{"cwd", "projectPath", "project_path"} {
			if v, ok := line[key].(string); ok && v != "" {
				meta.Cwd = v
			}
		}
		if v, ok := line["gitBranch"].(string); ok {
			meta.GitBranch = v
		}
		if v, ok := line["git_branch"].(string); ok && meta.GitBranch == "" {
			meta.GitBranch = v
		}
		if t, _ := line["type"].(string); t == "user" && meta.Preview == "" {
			meta.Preview = extractUserPreview(line)
		}
		done := meta.SessionID != "" || meta.Preview != ""
		return meta, done
	})
}

func readJSONLMeta(path string, parse func(map[string]any) (sessionMeta, bool)) sessionMeta {
	f, err := os.Open(path)
	if err != nil {
		return sessionMeta{}
	}
	defer f.Close()

	var merged sessionMeta
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lines := 0
	for sc.Scan() && lines < 64 {
		lines++
		var line map[string]any
		if json.Unmarshal(sc.Bytes(), &line) != nil {
			continue
		}
		part, _ := parse(line)
		if part.SessionID != "" {
			merged.SessionID = part.SessionID
		}
		if part.Cwd != "" {
			merged.Cwd = part.Cwd
		}
		if part.GitBranch != "" {
			merged.GitBranch = part.GitBranch
		}
		if part.Preview != "" && merged.Preview == "" {
			merged.Preview = part.Preview
		}
	}
	return merged
}

func extractUserPreview(line map[string]any) string {
	msg, _ := line["message"].(map[string]any)
	if msg == nil {
		return ""
	}
	content := msg["content"]
	switch c := content.(type) {
	case string:
		return trimPreview(c)
	case []any:
		for _, part := range c {
			m, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if t, _ := m["type"].(string); t == "text" {
				if text, ok := m["text"].(string); ok {
					return trimPreview(text)
				}
			}
		}
	}
	return ""
}

func trimPreview(s string) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 160 {
		return s[:160] + "…"
	}
	return s
}

func decodeClaudeProjectDir(name string) string {
	if idx := strings.Index(name, "--worktrees-"); idx >= 0 {
		base := decodeSlugPath(name[:idx])
		suffix := name[idx+len("--worktrees-"):]
		return filepath.Join(base, ".claude", "worktrees", suffix)
	}
	return decodeSlugPath(name)
}

func decodeCursorProjectDir(name string) string {
	// Cursor uses Users-bharath-Code-Foo (no leading dash).
	if strings.HasPrefix(name, "Users-") || strings.HasPrefix(name, "users-") {
		return decodeSlugPath(name)
	}
	return decodeSlugPath(strings.TrimPrefix(name, "-"))
}

func decodeSlugPath(slug string) string {
	if slug == "" {
		return ""
	}
	parts := strings.Split(slug, "-")
	if len(parts) == 0 {
		return slug
	}
	return filepath.Join(parts...)
}

func normalizeBranch(branch string) string {
	branch = strings.TrimSpace(branch)
	branch = strings.TrimPrefix(branch, "refs/heads/")
	return branch
}

func fileModMs(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.ModTime().UnixMilli()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
