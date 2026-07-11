package runner

import (
	"encoding/json"

	"github.com/liquitask/liquitask-agentd/internal/agent"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

// PtyEvent is streamed on run.pty notifications.
type PtyEvent struct {
	RunID string `json:"runId"`
	Data  string `json:"data"`
}

// HandlePtyHistory returns the ring-buffer snapshot for a run's PTY stream.
func (m *Manager) HandlePtyHistory(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	supports := agent.RuntimeSupportsPty(ar.runtime)
	var data string
	if ar.ptyBuf != nil {
		data = string(ar.ptyBuf.Snapshot())
	}
	return map[string]any{
		"data":         data,
		"supportsPty":  supports,
		"ptyActive":    ar.ptyActive,
		"takenOver":    ar.ptyTakenOver,
	}, nil
}

// HandlePtyWrite sends keystrokes to a run's PTY (takeover mode only).
func (m *Manager) HandlePtyWrite(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
		Data  string `json:"data"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId and data required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	if !ar.ptyTakenOver {
		return nil, rpc.Err("run not in takeover mode")
	}
	if ar.ptyMaster == nil {
		return nil, rpc.Err("run has no PTY session")
	}
	if _, err := ar.ptyMaster.Write([]byte(p.Data)); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

// HandlePtyTakeover pauses the agent and enables interactive PTY input.
func (m *Manager) HandlePtyTakeover(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	if ar.ptyMaster == nil {
		return nil, rpc.Err("run has no PTY session")
	}
	if ar.ptyTakenOver {
		return map[string]bool{"ok": true}, nil
	}
	pid := sessionPID(ar)
	if pid > 0 {
		_ = agentSignalStop(pid)
		ar.pauseMu.Lock()
		ar.paused = true
		ar.pauseMu.Unlock()
		if ar.meta != nil {
			ar.meta.Paused = true
			_ = m.journal.writeMeta(ar.meta)
		}
	}
	ar.ptyTakenOver = true
	m.emit(p.RunID, RunEvent{RunID: p.RunID, Kind: EventStatus, Status: "pty_takeover", Text: "Terminal takeover — agent paused"})
	return map[string]bool{"ok": true}, nil
}

func (m *Manager) emitPty(runID string, data []byte) {
	if len(data) == 0 {
		return
	}
	ev := PtyEvent{RunID: runID, Data: string(data)}
	_ = m.server.Notify("run.pty", ev)
}
