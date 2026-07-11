package agent

import (
	"encoding/json"
	"strings"
)

const (
	liquitaskMcpSecretEnvKey     = "LIQUITASK_MCP_SECRET"
	liquitaskResponseSecretEnvKey = "LIQUITASK_RESPONSE_SECRET"
)

var scrubbedMcpEnvKeys = []string{
	liquitaskMcpSecretEnvKey,
	liquitaskResponseSecretEnvKey,
}

// ScrubMcpConfigSecrets removes LiquiTask signing keys from every
// mcpServers.*.env block before configs are written to disk or passed to agent
// CLIs. The bridge reads secrets from LIQUITASK_MCP_DIR files (0600), not env.
func ScrubMcpConfigSecrets(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return raw, nil
	}
	var parsed struct {
		McpServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	if len(parsed.McpServers) == 0 {
		return raw, nil
	}

	changed := false
	for name, serverRaw := range parsed.McpServers {
		var server map[string]any
		if err := json.Unmarshal(serverRaw, &server); err != nil {
			continue
		}
		envVal, ok := server["env"]
		if !ok {
			continue
		}
		envMap, ok := envVal.(map[string]any)
		if !ok {
			continue
		}
		scrubbedKey := false
		for _, key := range scrubbedMcpEnvKeys {
			if _, has := envMap[key]; has {
				delete(envMap, key)
				scrubbedKey = true
			}
		}
		if !scrubbedKey {
			continue
		}
		if len(envMap) == 0 {
			delete(server, "env")
		} else {
			server["env"] = envMap
		}
		scrubbed, err := json.Marshal(server)
		if err != nil {
			return nil, err
		}
		parsed.McpServers[name] = scrubbed
		changed = true
	}
	if !changed {
		return raw, nil
	}
	return json.Marshal(parsed)
}

// ExtractLiquitaskMcpDir reads LIQUITASK_MCP_DIR from the liquitask MCP server
// env block inside an mcp_config JSON blob.
func ExtractLiquitaskMcpDir(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var parsed struct {
		McpServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return ""
	}
	serverRaw, ok := parsed.McpServers["liquitask"]
	if !ok {
		return ""
	}
	var server struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(serverRaw, &server); err != nil {
		return ""
	}
	return strings.TrimSpace(server.Env["LIQUITASK_MCP_DIR"])
}
