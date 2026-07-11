package agent

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestScrubMcpConfigSecretsRemovesLiquitaskSecret(t *testing.T) {
	raw := json.RawMessage(`{"mcpServers":{"liquitask":{"command":"node","env":{"LIQUITASK_MCP_DIR":"/tmp/mcp","LIQUITASK_MCP_SECRET":"deadbeef0123456789abcdef0123456789abcdef","LIQUITASK_RESPONSE_SECRET":"cafebabe0123456789abcdef0123456789abcdef","LIQUITASK_TASK_ID":"t1"}}}}`)
	scrubbed, err := ScrubMcpConfigSecrets(raw)
	if err != nil {
		t.Fatalf("ScrubMcpConfigSecrets: %v", err)
	}
	if strings.Contains(string(scrubbed), "LIQUITASK_MCP_SECRET") {
		t.Fatalf("MCP secret still present: %s", scrubbed)
	}
	if strings.Contains(string(scrubbed), "LIQUITASK_RESPONSE_SECRET") {
		t.Fatalf("response secret still present: %s", scrubbed)
	}
	if !strings.Contains(string(scrubbed), "LIQUITASK_MCP_DIR") {
		t.Fatalf("mcp dir removed: %s", scrubbed)
	}
}

func TestExtractLiquitaskMcpDir(t *testing.T) {
	raw := json.RawMessage(`{"mcpServers":{"liquitask":{"env":{"LIQUITASK_MCP_DIR":"/data/mcp/run-1"}}}}`)
	if got := ExtractLiquitaskMcpDir(raw); got != "/data/mcp/run-1" {
		t.Fatalf("ExtractLiquitaskMcpDir = %q", got)
	}
}

func TestScrubMcpConfigSecretsNoopWithoutServers(t *testing.T) {
	raw := json.RawMessage(`{"mcpServers":{}}`)
	scrubbed, err := ScrubMcpConfigSecrets(raw)
	if err != nil {
		t.Fatalf("ScrubMcpConfigSecrets: %v", err)
	}
	if string(scrubbed) != string(raw) {
		t.Fatalf("expected noop, got %s", scrubbed)
	}
}
