package runner

import (
	"encoding/json"
	"testing"
)

func TestPtyRingBufferCap(t *testing.T) {
	b := newPtyRingBuffer(10)
	b.Write([]byte("1234567890"))
	snap := string(b.Snapshot())
	if snap != "1234567890" {
		t.Fatalf("first write = %q", snap)
	}
	b.Write([]byte("ABCDE"))
	snap = string(b.Snapshot())
	if len(snap) != 10 {
		t.Fatalf("expected cap 10, got len=%d snap=%q", len(snap), snap)
	}
	if snap != "67890ABCDE" {
		t.Fatalf("rolling cap = %q", snap)
	}
}

func TestHandlePtyHistory(t *testing.T) {
	m := New(nil, t.TempDir())
	ar := &activeRun{
		id:      "run-pty",
		runtime: "claude",
		ptyBuf:  newPtyRingBuffer(1024),
		ptyActive: true,
	}
	ar.ptyBuf.Write([]byte("ansi\x1b[0m"))
	m.mu.Lock()
	m.runs["run-pty"] = ar
	m.mu.Unlock()

	raw, _ := json.Marshal(map[string]string{"runId": "run-pty"})
	got, err := m.HandlePtyHistory(raw)
	if err != nil {
		t.Fatal(err)
	}
	mapped := got.(map[string]any)
	if mapped["data"] != "ansi\x1b[0m" {
		t.Fatalf("data = %#v", mapped["data"])
	}
	if mapped["supportsPty"] != true {
		t.Fatalf("supportsPty = %#v", mapped["supportsPty"])
	}
}

func TestHandlePtyWriteRequiresTakeover(t *testing.T) {
	m := New(nil, t.TempDir())
	raw, _ := json.Marshal(map[string]string{"runId": "missing", "data": "x"})
	if _, err := m.HandlePtyWrite(raw); err == nil {
		t.Fatal("expected error for missing run")
	}
}
