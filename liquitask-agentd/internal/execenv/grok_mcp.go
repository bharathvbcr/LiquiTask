package execenv

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// PrepareGrokMcpConfig writes Grok-native MCP sidecars for agents that have an
// explicit managed mcp_config saved. Exported for the slim runner path in
// internal/agent (which does not call execenv.Prepare).
func PrepareGrokMcpConfig(workDir string, mcpConfig json.RawMessage) error {
	return prepareGrokMcpConfig(workDir, mcpConfig, nil)
}

// prepareGrokMcpConfig writes Grok-native MCP sidecars for agents that have an
// explicit managed mcp_config saved. A nil/null mcp_config means "let Grok
// behave normally", so no .grok/config.toml is created. Grok merges project
// .grok/config.toml with user config natively — no separate data-dir env var.
func prepareGrokMcpConfig(workDir string, mcpConfig json.RawMessage, manifest *sidecarManifest) error {
	if !hasManagedGrokMcpConfig(mcpConfig) {
		return nil
	}

	projectRoot := grokProjectRoot(workDir)
	servers, err := parseGrokManagedMcpServers(mcpConfig)
	if err != nil {
		return err
	}

	grokDir := filepath.Join(projectRoot, ".grok")
	if err := recordMkdirAll(grokDir, 0o755, manifest); err != nil {
		return fmt.Errorf("create .grok dir: %w", err)
	}

	configData, err := marshalGrokMcpConfig(servers)
	if err != nil {
		return err
	}
	configPath := filepath.Join(grokDir, "config.toml")
	if err := recordWriteFile(configPath, configData, 0o600, manifest); err != nil {
		if errors.Is(err, errPathPreExists) {
			return fmt.Errorf("managed grok mcp_config would overwrite existing .grok/config.toml")
		}
		return fmt.Errorf("write .grok/config.toml: %w", err)
	}
	return nil
}

func hasManagedGrokMcpConfig(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && !bytes.Equal(trimmed, []byte("null"))
}

func parseGrokManagedMcpServers(raw json.RawMessage) (map[string]json.RawMessage, error) {
	var cfg struct {
		McpServers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("parse mcp_config json: %w", err)
	}
	if cfg.McpServers == nil {
		return map[string]json.RawMessage{}, nil
	}
	for name, server := range cfg.McpServers {
		if strings.TrimSpace(name) == "" {
			return nil, fmt.Errorf("mcp server name must not be empty")
		}
		var obj map[string]any
		if err := json.Unmarshal(server, &obj); err != nil {
			return nil, fmt.Errorf("mcp_servers.%s: %w", name, err)
		}
		if obj == nil {
			return nil, fmt.Errorf("mcp_servers.%s must be a JSON object", name)
		}
	}
	return cfg.McpServers, nil
}

func marshalGrokMcpConfig(servers map[string]json.RawMessage) ([]byte, error) {
	if servers == nil {
		servers = map[string]json.RawMessage{}
	}
	names := make([]string, 0, len(servers))
	for name := range servers {
		names = append(names, name)
	}
	sort.Strings(names)

	var sb strings.Builder
	sb.WriteString("# LiquiTask managed MCP servers (do not edit; regenerated per run)\n")
	for i, name := range names {
		if i > 0 {
			sb.WriteString("\n")
		}
		var serverVal map[string]any
		if err := json.Unmarshal(servers[name], &serverVal); err != nil {
			return nil, fmt.Errorf("mcp_servers.%s: %w", name, err)
		}
		sb.WriteString("[mcp_servers.")
		sb.WriteString(name)
		sb.WriteString("]\n")
		keys := make([]string, 0, len(serverVal))
		for k := range serverVal {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			tomlValue, err := grokJSONValueToTOML(serverVal[k])
			if err != nil {
				return nil, fmt.Errorf("mcp_servers.%s.%s: %w", name, k, err)
			}
			sb.WriteString(k)
			sb.WriteString(" = ")
			sb.WriteString(tomlValue)
			sb.WriteString("\n")
		}
	}
	return append([]byte(sb.String()), '\n'), nil
}

func grokJSONValueToTOML(v any) (string, error) {
	switch val := v.(type) {
	case nil:
		return `""`, nil
	case bool:
		if val {
			return "true", nil
		}
		return "false", nil
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val)), nil
		}
		return fmt.Sprintf("%g", val), nil
	case string:
		return grokQuoteTOMLString(val), nil
	case []any:
		parts := make([]string, 0, len(val))
		for _, item := range val {
			s, err := grokJSONValueToTOML(item)
			if err != nil {
				return "", err
			}
			parts = append(parts, s)
		}
		return "[" + strings.Join(parts, ", ") + "]", nil
	case map[string]any:
		parts := make([]string, 0, len(val))
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			s, err := grokJSONValueToTOML(val[k])
			if err != nil {
				return "", err
			}
			parts = append(parts, k+" = "+s)
		}
		return "{" + strings.Join(parts, ", ") + "}", nil
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return "", err
		}
		return grokQuoteTOMLString(string(b)), nil
	}
}

func grokQuoteTOMLString(s string) string {
	escaped := strings.ReplaceAll(s, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func grokProjectRoot(workDir string) string {
	if workDir == "" {
		return workDir
	}
	dir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		dir = workDir
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		dir = workDir
	}
	fallback := dir
	for {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return fallback
		}
		dir = parent
	}
}
