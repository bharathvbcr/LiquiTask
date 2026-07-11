package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

const (
	traceFileName = "trace.json"
)

// TraceStep is one reversible step in a run trace.
type TraceStep struct {
	ID                  string `json:"id"`
	Index               int    `json:"index"`
	Kind                string `json:"kind"`
	Label               string `json:"label"`
	Ts                  string `json:"ts"`
	GitCommitSha        string `json:"gitCommitSha,omitempty"`
	SessionMessageIndex int    `json:"sessionMessageIndex,omitempty"`
	SessionCheckpointID string `json:"sessionCheckpointId,omitempty"`
	ToolName            string `json:"toolName,omitempty"`
	PermissionDecision  string `json:"permissionDecision,omitempty"`
}

// TraceListResult is returned by trace.list.
type TraceListResult struct {
	RunID string      `json:"runId"`
	Steps []TraceStep `json:"steps"`
}

func tracePath(dataDir, runID string) string {
	return filepath.Join(dataDir, "runs", runID, traceFileName)
}

func loadTraceSidecar(dataDir, runID string) ([]TraceStep, error) {
	path := tracePath(dataDir, runID)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var steps []TraceStep
	if err := json.Unmarshal(data, &steps); err != nil {
		return nil, err
	}
	return steps, nil
}

func stepsFromStdout(dataDir, runID string) ([]TraceStep, error) {
	path := filepath.Join(dataDir, "runs", runID, "stdout.ndjson")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var steps []TraceStep
	idx := 0
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var ev RunEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		var kind, label string
		switch ev.Kind {
		case EventToolUse:
			kind = "tool"
			if isWriteTool(ev.Tool) {
				kind = "file_write"
			}
			label = ev.Tool
		case EventPermissionRequest:
			kind = "permission"
			label = "Permission: " + ev.Tool
		case EventToolResult:
			continue
		default:
			continue
		}
		steps = append(steps, TraceStep{
			ID:       fmt.Sprintf("journal-%d", idx),
			Index:    idx,
			Kind:     kind,
			Label:    label,
			Ts:       time.Now().UTC().Format(time.RFC3339),
			ToolName: ev.Tool,
		})
		idx++
	}
	return steps, nil
}

func isWriteTool(tool string) bool {
	switch strings.ToLower(tool) {
	case "write", "edit", "apply_patch", "multiedit", "notebookedit":
		return true
	default:
		return false
	}
}

func mergeTraceSteps(sidecar, journal []TraceStep) []TraceStep {
	if len(sidecar) == 0 {
		return journal
	}
	if len(journal) == 0 {
		return sidecar
	}
	out := append([]TraceStep(nil), sidecar...)
	seen := map[string]bool{}
	for _, s := range sidecar {
		seen[s.ID] = true
	}
	next := len(out)
	for _, s := range journal {
		if seen[s.ID] {
			continue
		}
		s.Index = next
		out = append(out, s)
		next++
	}
	return out
}

// HandleTraceList implements trace.list — stdout.ndjson journal + trace.json sidecar.
func (m *Manager) HandleTraceList(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	sidecar, err := loadTraceSidecar(m.dataDir, p.RunID)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	journal, err := stepsFromStdout(m.dataDir, p.RunID)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return TraceListResult{RunID: p.RunID, Steps: mergeTraceSteps(sidecar, journal)}, nil
}

// HandleTraceWrite persists trace steps from the app bridge (trace.sync).
func (m *Manager) HandleTraceWrite(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string      `json:"runId"`
		Steps []TraceStep `json:"steps"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId and steps required")
	}
	dir := filepath.Join(m.dataDir, "runs", p.RunID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	data, err := json.MarshalIndent(p.Steps, "", "  ")
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	tmp := filepath.Join(dir, traceFileName+".tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	if err := os.Rename(tmp, tracePath(m.dataDir, p.RunID)); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

// HandleTraceRevertToStep returns revert anchor metadata for the app bridge.
func (m *Manager) HandleTraceRevertToStep(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID  string `json:"runId"`
		StepID string `json:"stepId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" || p.StepID == "" {
		return nil, rpc.ErrInvalidParams("runId and stepId required")
	}
	steps, _ := loadTraceSidecar(m.dataDir, p.RunID)
	var target *TraceStep
	for i := range steps {
		if steps[i].ID == p.StepID {
			target = &steps[i]
			break
		}
	}
	if target == nil {
		journal, _ := stepsFromStdout(m.dataDir, p.RunID)
		for i := range journal {
			if journal[i].ID == p.StepID {
				target = &journal[i]
				break
			}
		}
	}
	if target == nil {
		return nil, rpc.Err("trace step not found")
	}
	return map[string]any{
		"runId":               p.RunID,
		"stepId":              p.StepID,
		"gitCommitSha":        target.GitCommitSha,
		"sessionMessageIndex": target.SessionMessageIndex,
		"sessionCheckpointId": target.SessionCheckpointID,
	}, nil
}

// HandleTraceForkFromStep returns fork anchor metadata for the app bridge.
func (m *Manager) HandleTraceForkFromStep(raw json.RawMessage) (any, *rpc.Error) {
	return m.HandleTraceRevertToStep(raw)
}
