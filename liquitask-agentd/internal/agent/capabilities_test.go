package agent

import "testing"

func TestRuntimeSupportsPty(t *testing.T) {
	supported := []string{"claude", "codex", "cursor", "codebuddy"}
	for _, rt := range supported {
		if !RuntimeSupportsPty(rt) {
			t.Errorf("expected %q to support PTY", rt)
		}
	}
	unsupported := []string{"hermes", "kimi", "kiro", "copilot", "qoder", "openclaw", "pi"}
	for _, rt := range unsupported {
		if RuntimeSupportsPty(rt) {
			t.Errorf("expected %q to fall back to pipe mode", rt)
		}
	}
}
