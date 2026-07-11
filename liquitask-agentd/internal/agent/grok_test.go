package agent

import (
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestNewReturnsGrokBackend(t *testing.T) {
	t.Parallel()
	b, err := New("grok", Config{ExecutablePath: "/nonexistent/grok"})
	if err != nil {
		t.Fatalf("New(grok) error: %v", err)
	}
	if _, ok := b.(*grokBackend); !ok {
		t.Fatalf("expected *grokBackend, got %T", b)
	}
}

func TestBuildGrokArgs(t *testing.T) {
	t.Parallel()

	args := buildGrokArgs("do something", ExecOptions{
		Cwd:   "/tmp/work",
		Model: "grok-4.5",
	}, slog.Default())

	joined := strings.Join(args, " ")
	for _, want := range []string{"--no-auto-update", "-p", "do something", "streaming-json", "--cwd", "/tmp/work", "-m", "grok-4.5"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("expected %q in args, got %v", want, args)
		}
	}
	if strings.Contains(joined, "--always-approve") {
		t.Fatalf("expected no --always-approve without bypass permissions, got %v", args)
	}
}

func TestBuildGrokArgsBypassPermissions(t *testing.T) {
	t.Parallel()

	args := buildGrokArgs("do something", ExecOptions{AutoApprove: true}, slog.Default())
	hasApprove := false
	for _, a := range args {
		if a == "--always-approve" {
			hasApprove = true
		}
	}
	if !hasApprove {
		t.Fatalf("expected --always-approve when bypassing permissions, got %v", args)
	}
}

func TestBuildGrokArgsWithResume(t *testing.T) {
	t.Parallel()

	args := buildGrokArgs("continue", ExecOptions{
		ResumeSessionID: "sess-grok-1",
	}, slog.Default())

	hasResume := false
	for i, a := range args {
		if a == "-r" && i+1 < len(args) && args[i+1] == "sess-grok-1" {
			hasResume = true
		}
	}
	if !hasResume {
		t.Fatalf("expected -r sess-grok-1, got %v", args)
	}
}

func TestBuildGrokArgsCustomArgsFiltered(t *testing.T) {
	t.Parallel()

	args := buildGrokArgs("task", ExecOptions{
		CustomArgs: []string{"--extra", "val", "--always-approve", "--output-format", "text"},
	}, slog.Default())

	hasExtra := false
	approveCount := 0
	for i, a := range args {
		if a == "--extra" && i+1 < len(args) && args[i+1] == "val" {
			hasExtra = true
		}
		if a == "--always-approve" {
			approveCount++
		}
		if a == "text" {
			t.Fatalf("--output-format from custom args should be filtered, got %v", args)
		}
	}
	if !hasExtra {
		t.Fatalf("expected --extra val in args, got %v", args)
	}
	if approveCount != 0 {
		t.Fatalf("expected no --always-approve without bypass permissions, got %v", args)
	}
}

func TestGrokStreamParserToleratesUnknownEvents(t *testing.T) {
	t.Parallel()

	b := &grokBackend{cfg: Config{Logger: slog.Default()}}
	ch := make(chan Message, 10)
	var output strings.Builder

	lines := []string{
		`{"type":"unknown_event","foo":"bar"}`,
		`{"type":"assistant","message":{"model":"grok-4.5","content":[{"type":"text","text":"pong"}]}}`,
		`{"type":"result","result":"pong","session_id":"sess-1","inputTokens":10,"outputTokens":2}`,
	}

	for _, line := range lines {
		var evt cursorStreamEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		switch evt.Type {
		case "assistant":
			b.handleGrokAssistant(&evt, ch, &output)
		case "result":
			usage := make(map[string]TokenUsage)
			b.accumulateGrokResultUsage(usage, &evt, "")
		}
	}

	if output.String() != "pong" {
		t.Fatalf("expected pong output, got %q", output.String())
	}
}

func TestParseGrokModels(t *testing.T) {
	t.Parallel()

	out := `Available models

grok-4.5 - Grok 4.5 (default)
grok-4 - Grok 4
`
	models := parseGrokModels(out)
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d: %+v", len(models), models)
	}
	if !models[0].Default {
		t.Fatalf("expected first model default=true, got %+v", models[0])
	}
	if models[0].Provider != "xai" {
		t.Fatalf("expected xai provider, got %q", models[0].Provider)
	}
}

func TestGrokStaticModels(t *testing.T) {
	t.Parallel()
	models := grokStaticModels()
	if len(models) != 1 || models[0].ID != "grok-4.5" || !models[0].Default {
		t.Fatalf("unexpected static catalog: %+v", models)
	}
}
