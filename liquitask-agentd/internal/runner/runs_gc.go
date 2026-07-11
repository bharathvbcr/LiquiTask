package runner

import (
	"context"
	"log/slog"
	"os"
	"sort"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/agent"
)

const (
	runsGCTTL               = 7 * 24 * time.Hour
	runsGCInterval          = 6 * time.Hour
	runsGCStartupDelay      = 30 * time.Second
	maxRetainedTerminalRuns = 50
)

// startRunsGC periodically prunes stale terminal run directories under
// ~/.liquitask/agentd/runs/.
func (m *Manager) startRunsGC(ctx context.Context) {
	go func() {
		timer := time.NewTimer(runsGCStartupDelay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		m.runRunsGC()
		ticker := time.NewTicker(runsGCInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.runRunsGC()
			}
		}
	}()
}

func (m *Manager) runRunsGC() {
	runIDs, err := m.journal.listRunIDs()
	if err != nil {
		m.logger.Warn("runs gc: list failed", "err", err)
		return
	}

	type candidate struct {
		runID    string
		finished time.Time
	}
	var terminal []candidate

	for _, runID := range runIDs {
		meta, err := m.journal.readMeta(runID)
		if err != nil {
			continue
		}
		if meta.isActive() {
			continue
		}
		finished := time.UnixMilli(meta.FinishedAtMs)
		if meta.FinishedAtMs == 0 {
			finished = time.UnixMilli(meta.StartedAtMs)
		}
		if finished.IsZero() {
			if info, err := os.Stat(m.journal.runDir(runID)); err == nil {
				finished = info.ModTime()
			}
		}
		terminal = append(terminal, candidate{runID: runID, finished: finished})
	}

	sort.Slice(terminal, func(i, j int) bool {
		return terminal[i].finished.After(terminal[j].finished)
	})

	keep := make(map[string]bool, maxRetainedTerminalRuns)
	for i, c := range terminal {
		if i < maxRetainedTerminalRuns {
			keep[c.runID] = true
		}
	}

	removed := 0
	for _, c := range terminal {
		if keep[c.runID] {
			continue
		}
		if time.Since(c.finished) < runsGCTTL {
			continue
		}
		dir := m.journal.runDir(c.runID)
		if err := os.RemoveAll(dir); err != nil {
			m.logger.Warn("runs gc: remove failed", "runId", c.runID, "err", err)
			continue
		}
		removed++
	}
	if removed > 0 {
		m.logger.Info("runs gc: pruned terminal runs", "removed", removed)
	}
}

// ReconcileJournal scans persisted runs on daemon boot, reconciling dead PIDs
// and returning reattach info for still-live processes.
func (m *Manager) ReconcileJournal() []reattachInfo {
	runIDs, err := m.journal.listRunIDs()
	if err != nil {
		m.logger.Warn("journal reconcile: list failed", "err", err)
		return nil
	}
	var out []reattachInfo
	for _, runID := range runIDs {
		meta, err := m.journal.readMeta(runID)
		if err != nil || !meta.isActive() {
			continue
		}
		info := reattachInfo{
			RunID:   runID,
			TaskID:  meta.TaskID,
			Runtime: meta.Runtime,
		}
		if agent.ProcessIdentityMatches(meta.PID, meta.ProcessStartTimeMs) {
			info.Alive = true
			info.Status = "running"
			info.SessionID = meta.SessionID
			info.Paused = meta.Paused
		} else {
			runDir := m.journal.runDir(runID)
			status, sessionID, _ := reconcileFromStdout(runDir)
			meta.Status = status
			if sessionID != "" {
				meta.SessionID = sessionID
			}
			meta.FinishedAtMs = nowMs()
			_ = m.journal.writeMeta(meta)
			info.Alive = false
			info.Status = status
			info.SessionID = sessionID
		}
		out = append(out, info)
	}
	return out
}

type reattachInfo struct {
	RunID     string `json:"runId"`
	TaskID    string `json:"taskId"`
	Runtime   string `json:"runtime"`
	Alive     bool   `json:"alive"`
	Status    string `json:"status"`
	SessionID string `json:"sessionId,omitempty"`
	Paused    bool   `json:"paused,omitempty"`
}

// suppress unused when tests stub logger
var _ = slog.Default
