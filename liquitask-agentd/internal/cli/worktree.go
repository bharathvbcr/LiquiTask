package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type worktreeSidecar struct {
	RunID     string `json:"runId"`
	TaskID    string `json:"taskId,omitempty"`
	Branch    string `json:"branch"`
	CreatedAt string `json:"createdAt"`
}

// discoverWorktree scans workspace roots for `<repo>/.worktrees/<runId>.liquitask.json`.
func discoverWorktree(runID string) (worktreePath, branch string) {
	filename := runID + ".liquitask.json"
	for _, root := range searchRoots() {
		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || worktreePath != "" {
				return nil
			}
			if d.IsDir() {
				name := d.Name()
				if name == ".git" || name == "node_modules" || name == "target" || name == "vendor" {
					return filepath.SkipDir
				}
				// Limit depth under each root to keep scans bounded.
				rel, relErr := filepath.Rel(root, path)
				if relErr == nil && strings.Count(rel, string(os.PathSeparator)) > 8 {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Name() != filename {
				return nil
			}
			if !strings.Contains(path, string(filepath.Separator)+".worktrees"+string(filepath.Separator)) {
				return nil
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return nil
			}
			var meta worktreeSidecar
			if json.Unmarshal(data, &meta) != nil {
				return nil
			}
			worktreePath = filepath.Join(filepath.Dir(path), runID)
			branch = meta.Branch
			return filepath.SkipAll
		})
		if worktreePath != "" {
			return worktreePath, branch
		}
	}
	return "", ""
}

func searchRoots() []string {
	seen := make(map[string]bool)
	var roots []string
	add := func(p string) {
		if p == "" {
			return
		}
		abs, err := filepath.Abs(p)
		if err != nil {
			return
		}
		if seen[abs] {
			return
		}
		if st, err := os.Stat(abs); err != nil || !st.IsDir() {
			return
		}
		seen[abs] = true
		roots = append(roots, abs)
	}
	if env := os.Getenv("LIQUITASK_WORKSPACE_ROOTS"); env != "" {
		for _, part := range strings.Split(env, ",") {
			add(strings.TrimSpace(part))
		}
		return roots
	}
	if home, err := os.UserHomeDir(); err == nil {
		add(home)
		add(filepath.Join(home, "Code"))
		add(filepath.Join(home, "Projects"))
		add(filepath.Join(home, "src"))
	}
	return roots
}
