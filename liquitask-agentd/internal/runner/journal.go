package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	metaFile    = "meta.json"
	metaTmpFile = "meta.json.tmp"
)

// RunMeta is the durable journal entry for a single agentd run.
type RunMeta struct {
	RunID              string `json:"runId"`
	TaskID             string `json:"taskId"`
	Runtime            string `json:"runtime"`
	Status             string `json:"status"` // running|completed|failed|cancelled
	PID                int    `json:"pid,omitempty"`
	PGID               int    `json:"pgid,omitempty"`
	ProcessStartTimeMs int64  `json:"processStartTimeMs,omitempty"`
	StartedAtMs        int64  `json:"startedAtMs"`
	FinishedAtMs       int64  `json:"finishedAtMs,omitempty"`
	StdoutOffset       int64  `json:"stdoutOffset,omitempty"`
	SessionID          string `json:"sessionId,omitempty"`
	Paused             bool   `json:"paused,omitempty"`
}

func (m *RunMeta) isActive() bool {
	return m != nil && m.Status == "running"
}

type journal struct {
	dir string
	mu  sync.Mutex
}

func newJournal(dataDir string) *journal {
	return &journal{dir: filepath.Join(dataDir, "runs")}
}

func (j *journal) runDir(runID string) string {
	return filepath.Join(j.dir, runID)
}

func (j *journal) writeMeta(meta *RunMeta) error {
	if meta == nil || meta.RunID == "" {
		return fmt.Errorf("invalid run meta")
	}
	j.mu.Lock()
	defer j.mu.Unlock()

	dir := j.runDir(meta.RunID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, metaTmpFile)
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(dir, metaFile))
}

func (j *journal) readMeta(runID string) (*RunMeta, error) {
	path := filepath.Join(j.runDir(runID), metaFile)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var meta RunMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

func (j *journal) listRunIDs() ([]string, error) {
	entries, err := os.ReadDir(j.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out, nil
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

// reconcileFromStdout derives a terminal status from the run's stdout.ndjson.
func reconcileFromStdout(runDir string) (status, sessionID, summary string) {
	status = "failed"
	path := filepath.Join(runDir, "stdout.ndjson")
	data, err := os.ReadFile(path)
	if err != nil {
		return status, "", ""
	}
	lines := splitNDJSONLines(string(data))
	for _, line := range lines {
		var ev RunEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		if ev.SessionID != "" {
			sessionID = ev.SessionID
		}
		if ev.Kind == EventResult {
			if ev.Status != "" {
				status = ev.Status
			} else {
				status = "completed"
			}
			if ev.Text != "" {
				summary = ev.Text
			}
			if ev.Error != "" && status == "failed" {
				summary = ev.Error
			}
		}
	}
	return status, sessionID, summary
}

func splitNDJSONLines(raw string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(raw); i++ {
		if raw[i] == '\n' {
			line := raw[start:i]
			start = i + 1
			if line != "" {
				lines = append(lines, line)
			}
		}
	}
	if start < len(raw) {
		if tail := raw[start:]; tail != "" {
			lines = append(lines, tail)
		}
	}
	return lines
}
