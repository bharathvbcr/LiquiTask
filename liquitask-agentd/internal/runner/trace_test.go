package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStepsFromStdout(t *testing.T) {
	dir := t.TempDir()
	runID := "run-trace-1"
	runDir := filepath.Join(dir, "runs", runID)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}
	ev := RunEvent{RunID: runID, Kind: EventToolUse, Tool: "Write"}
	line, _ := json.Marshal(ev)
	if err := os.WriteFile(filepath.Join(runDir, "stdout.ndjson"), append(line, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	steps, err := stepsFromStdout(dir, runID)
	if err != nil {
		t.Fatal(err)
	}
	if len(steps) != 1 || steps[0].Kind != "file_write" {
		t.Fatalf("steps: %+v", steps)
	}
}

func TestHandleTraceList(t *testing.T) {
	dir := t.TempDir()
	mgr := &Manager{dataDir: dir}
	runID := "run-1"
	runDir := filepath.Join(dir, "runs", runID)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sidecar := []TraceStep{{ID: "s0", Index: 0, Kind: "session", Label: "checkpoint"}}
	raw, _ := json.MarshalIndent(sidecar, "", "  ")
	if err := os.WriteFile(filepath.Join(runDir, traceFileName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	params, _ := json.Marshal(map[string]string{"runId": runID})
	result, rpcErr := mgr.HandleTraceList(params)
	if rpcErr != nil {
		t.Fatal(rpcErr)
	}
	out := result.(TraceListResult)
	if len(out.Steps) != 1 || out.Steps[0].Kind != "session" {
		t.Fatalf("trace list: %+v", out)
	}
}
