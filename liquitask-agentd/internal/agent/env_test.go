package agent

import (
	"os"
	"strings"
	"testing"
)

func TestBuildEnvBlocksRuntimeSecretSuffixes(t *testing.T) {
	t.Setenv("CURSOR_API_KEY", "leaked")
	t.Setenv("CODEX_API_KEY", "leaked")
	t.Setenv("CLAUDE_CODE_FOO", "allowed-config")

	env := buildEnv(nil)
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "CURSOR_API_KEY", "CODEX_API_KEY":
			t.Fatalf("runtime secret %s leaked into child env: %v", key, env)
		}
	}
}

func TestBuildEnvBlocksHostSecrets(t *testing.T) {
	t.Setenv("AWS_SECRET_ACCESS_KEY", "leaked")
	t.Setenv("GH_TOKEN", "leaked")
	t.Setenv("OPENAI_API_KEY", "leaked")
	t.Setenv("PATH", "/usr/bin")

	env := buildEnv(nil)
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "AWS_SECRET_ACCESS_KEY", "GH_TOKEN", "OPENAI_API_KEY":
			t.Fatalf("host secret %s leaked into child env: %v", key, env)
		}
	}
	if !containsEnvEntry(env, "PATH", "/usr/bin") {
		t.Fatalf("expected PATH to be preserved, got %v", env)
	}
}

func TestBuildEnvAppendsPerAgentExtras(t *testing.T) {
	t.Parallel()
	env := buildEnv(map[string]string{"CUSTOM_AGENT_FLAG": "1", "AWS_SECRET_ACCESS_KEY": "from-config"})
	if !containsEnvEntry(env, "CUSTOM_AGENT_FLAG", "1") {
		t.Fatalf("expected per-agent extra env, got %v", env)
	}
	if !containsEnvEntry(env, "AWS_SECRET_ACCESS_KEY", "from-config") {
		t.Fatalf("per-agent custom_env should override allowlist absence, got %v", env)
	}
}

func containsEnvEntry(env []string, key, wantVal string) bool {
	prefix := key + "="
	for _, entry := range env {
		if entry == prefix+wantVal {
			return true
		}
	}
	return false
}

func TestAllowedHostEnvironIncludesRuntimePrefixes(t *testing.T) {
	t.Setenv("CLAUDE_CODE_TMPDIR", "/custom/tmp")
	env := allowedHostEnviron()
	if !containsEnvEntry(env, "CLAUDE_CODE_TMPDIR", "/custom/tmp") {
		t.Fatalf("expected runtime config prefix to be allowed, got %v", env)
	}
	_ = os.Unsetenv("CLAUDE_CODE_TMPDIR")
}
