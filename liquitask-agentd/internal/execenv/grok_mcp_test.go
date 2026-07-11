package execenv

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareGrokMcpConfigWritesConfigToml(t *testing.T) {
	workDir := t.TempDir()
	mcpConfig := json.RawMessage(`{"mcpServers":{"liquitask":{"command":"node","args":["bridge.mjs"]}}}`)

	if err := PrepareGrokMcpConfig(workDir, mcpConfig); err != nil {
		t.Fatalf("PrepareGrokMcpConfig: %v", err)
	}

	configPath := filepath.Join(workDir, ".grok", "config.toml")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config.toml: %v", err)
	}
	content := string(data)
	if !strings.Contains(content, "[mcp_servers.liquitask]") {
		t.Fatalf("missing mcp_servers table, got:\n%s", content)
	}
	if !strings.Contains(content, `command = "node"`) {
		t.Fatalf("missing command, got:\n%s", content)
	}
}

func TestPrepareGrokMcpConfigNilIsNoop(t *testing.T) {
	workDir := t.TempDir()
	if err := PrepareGrokMcpConfig(workDir, nil); err != nil {
		t.Fatalf("PrepareGrokMcpConfig: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, ".grok", "config.toml")); !os.IsNotExist(err) {
		t.Fatalf("expected no config.toml for nil mcp_config, err=%v", err)
	}
}

func TestPrepareGrokMcpConfigRejectsBadShape(t *testing.T) {
	workDir := t.TempDir()
	err := PrepareGrokMcpConfig(workDir, json.RawMessage(`{"mcpServers":{"bad":42}}`))
	if err == nil {
		t.Fatal("expected error for non-object server config")
	}
}
