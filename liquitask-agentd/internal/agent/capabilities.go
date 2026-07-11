package agent

// runtimeSupportsPty lists runtimes wired through AttachProcessIO for PTY mode.
// Other runtimes fall back to pipe mode until their backends are updated.
var runtimeSupportsPty = map[string]bool{
	"claude":    true,
	"codex":     true,
	"cursor":    true,
	"codebuddy": true,
}

// RuntimeSupportsPty reports whether the runtime can be executed under a PTY.
func RuntimeSupportsPty(runtime string) bool {
	return runtimeSupportsPty[runtime]
}
