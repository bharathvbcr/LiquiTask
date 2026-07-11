package agent

import (
	"os"
	"runtime"
	"strings"
)

// baseAllowedEnvKeys are host environment variables safe to inherit into agent
// child processes. Secrets (AWS_*, GH_TOKEN, OPENAI_API_KEY, etc.) are
// deliberately excluded — agents authenticate via their own runtime config or
// per-agent custom_env instead of the user's shell profile.
var baseAllowedEnvKeys = map[string]bool{
	"PATH": true, "PATHEXT": true,
	"HOME": true, "USER": true, "LOGNAME": true, "SHELL": true,
	"LANG": true, "LC_ALL": true, "LC_CTYPE": true, "LC_MESSAGES": true,
	"TERM": true, "COLORTERM": true, "NO_COLOR": true, "FORCE_COLOR": true,
	"TMPDIR": true, "TEMP": true, "TMP": true,
	"XDG_CONFIG_HOME": true, "XDG_DATA_HOME": true, "XDG_CACHE_HOME": true,
	"XDG_RUNTIME_DIR": true,
	"USERPROFILE": true, "HOMEDRIVE": true, "HOMEPATH": true,
	"APPDATA": true, "LOCALAPPDATA": true, "PROGRAMDATA": true,
	"PROGRAMFILES": true, "PROGRAMFILES(X86)": true, "PROGRAMW6432": true,
	"COMSPEC": true, "SYSTEMROOT": true, "SYSTEMDRIVE": true, "WINDIR": true,
	"OS": true, "USERNAME": true, "USERDOMAIN": true,
	"NUMBER_OF_PROCESSORS": true, "PROCESSOR_ARCHITECTURE": true,
	"PROCESSOR_IDENTIFIER": true,
}

// allowedEnvPrefixes covers documented per-runtime configuration namespaces.
// Host secrets outside these prefixes are not inherited.
var allowedEnvPrefixes = []string{
	"CLAUDE_CODE_",
	"CODEX_",
	"CURSOR_",
	"OPENCODE_",
	"OPENCLAW_",
	"COPILOT_",
	"HERMES_",
	"KIMI_",
	"KIRO_",
	"QODER_",
	"PI_",
	"GROK_",
	"ANTIGRAVITY_",
	"TRAECLI_",
	"LIQUITASK_",
}

// childEnvSecretSuffixes block credential-like vars even under runtime prefixes.
var childEnvSecretSuffixes = []string{
	"_API_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_PRIVATE_KEY",
}

func isChildEnvSecretKey(key string) bool {
	upper := strings.ToUpper(strings.TrimSpace(key))
	for _, suffix := range childEnvSecretSuffixes {
		if strings.HasSuffix(upper, suffix) {
			return true
		}
	}
	return false
}

func isAllowedHostEnvKey(key string) bool {
	if isFilteredChildEnvKey(key) || isChildEnvSecretKey(key) {
		return false
	}
	if baseAllowedEnvKeys[key] {
		return true
	}
	upper := strings.ToUpper(key)
	for _, prefix := range allowedEnvPrefixes {
		if strings.HasPrefix(upper, prefix) {
			return true
		}
	}
	return false
}

func allowedHostEnviron() []string {
	env := make([]string, 0, 32)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if isAllowedHostEnvKey(key) {
			env = append(env, entry)
		}
	}
	// Guarantee minimal shell usability when the host env is sparse (tests/CI).
	if len(env) == 0 {
		if runtime.GOOS == "windows" {
			return []string{"COMSPEC=cmd.exe", "SYSTEMROOT=C:\\Windows"}
		}
		return []string{"PATH=/usr/bin:/bin", "HOME=/tmp", "TERM=dumb"}
	}
	return env
}

func envSliceToMap(entries []string) map[string]string {
	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		key, val, ok := strings.Cut(entry, "=")
		if !ok || key == "" {
			continue
		}
		out[key] = val
	}
	return out
}
