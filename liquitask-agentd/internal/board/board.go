package board

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Snapshot is the board export written by the Tauri app.
type Snapshot struct {
	ExportedAt string   `json:"exportedAt"`
	Tasks      []Task   `json:"tasks"`
	Columns    []Column `json:"columns"`
	Agents     []Agent  `json:"agents"`
}

// Task is a minimal task card for CLI/MCP operations.
type Task struct {
	ID        string `json:"id"`
	JobID     string `json:"jobId"`
	Title     string `json:"title"`
	Status    string `json:"status"`
	Assignee  string `json:"assignee"`
	ProjectID string `json:"projectId"`
	Summary   string `json:"summary"`
}

// Column is a board column definition.
type Column struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Agent is a minimal agent profile for dispatch.
type Agent struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Provider   string `json:"provider"`
	WorkingDir string `json:"workingDir"`
	AutoPickup bool   `json:"autoPickup"`
	RunMode    string `json:"runMode"`
	Role       string `json:"role"`
}

// DefaultSnapshotPath returns ~/.liquitask/board-snapshot.json.
func DefaultSnapshotPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "liquitask-board-snapshot.json")
	}
	return filepath.Join(home, ".liquitask", "board-snapshot.json")
}

// Load reads the board snapshot from disk.
func Load(path string) (*Snapshot, error) {
	if path == "" {
		path = DefaultSnapshotPath()
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read board snapshot: %w", err)
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return nil, fmt.Errorf("decode board snapshot: %w", err)
	}
	return &snap, nil
}

// FindTask resolves a task by id, jobId, or title prefix.
func FindTask(snap *Snapshot, ref string) (*Task, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("task reference required")
	}
	lower := strings.ToLower(ref)
	for i := range snap.Tasks {
		t := &snap.Tasks[i]
		if t.ID == ref || t.JobID == ref || strings.EqualFold(t.JobID, ref) {
			return t, nil
		}
		if strings.HasPrefix(strings.ToLower(t.Title), lower) {
			return t, nil
		}
	}
	return nil, fmt.Errorf("task not found: %s", ref)
}

// FindAgent resolves an agent by id or assignee name.
func FindAgent(snap *Snapshot, ref string) (*Agent, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("agent reference required")
	}
	lower := strings.ToLower(ref)
	for i := range snap.Agents {
		a := &snap.Agents[i]
		if a.ID == ref || strings.EqualFold(a.Name, ref) {
			return a, nil
		}
		if strings.Contains(strings.ToLower(a.Name), lower) {
			return a, nil
		}
	}
	return nil, fmt.Errorf("agent not found: %s", ref)
}

// ListTasks returns tasks optionally filtered by column id/title.
func ListTasks(snap *Snapshot, column string) []Task {
	if column == "" {
		return snap.Tasks
	}
	var out []Task
	for _, t := range snap.Tasks {
		if t.Status == column || strings.EqualFold(t.Status, column) {
			out = append(out, t)
			continue
		}
		for _, c := range snap.Columns {
			if c.ID == t.Status && (c.ID == column || strings.EqualFold(c.Title, column)) {
				out = append(out, t)
				break
			}
			if strings.EqualFold(c.Title, column) && c.ID == t.Status {
				out = append(out, t)
				break
			}
		}
	}
	return out
}
