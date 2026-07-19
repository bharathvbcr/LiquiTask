package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/liquitask/liquitask-agentd/internal/feedback"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

func TestIntentStoreSetGet(t *testing.T) {
	store := newIntentStore(t.TempDir())
	intent := DispatchIntent{
		RunID:      "run-local",
		LocalRunID: "run-local",
		TaskID:     "task-1",
		AgentID:    "agent-1",
		Runtime:    "claude",
		Prompt:     "do work",
		Cwd:        "/repo",
	}
	if err := store.set(intent); err != nil {
		t.Fatal(err)
	}
	got, ok, err := store.get("run-local")
	if err != nil || !ok || got == nil {
		t.Fatalf("get = %+v, ok=%v, err=%v", got, ok, err)
	}
	if got.AgentID != "agent-1" || got.Prompt != "do work" {
		t.Fatalf("unexpected intent: %+v", got)
	}
	intent.AgentdRunID = "agentd-uuid"
	if err := store.set(intent); err != nil {
		t.Fatal(err)
	}
	got2, ok, err := store.get("agentd-uuid")
	if err != nil || !ok || got2 == nil || got2.RunID != "run-local" {
		t.Fatalf("lookup by agentd id failed: %+v ok=%v err=%v", got2, ok, err)
	}
}

func TestIntentStorePersistsAcrossReload(t *testing.T) {
	dir := t.TempDir()
	s1 := newIntentStore(dir)
	_ = s1.set(DispatchIntent{RunID: "run-1", TaskID: "t1", AgentID: "a1"})
	s2 := newIntentStore(dir)
	got, ok, err := s2.get("run-1")
	if err != nil || !ok || got == nil {
		t.Fatalf("reload failed: %+v ok=%v err=%v", got, ok, err)
	}
}

func TestSchedulerOnRunFinishedEmitsAndReleases(t *testing.T) {
	dir := t.TempDir()
	mgr := New(rpc.NewServer(os.Stdin, os.Stdout), dir)
	events := make(chan SchedulerEvent, 4)
	mgr.scheduler.emitHook = func(ev SchedulerEvent) {
		events <- ev
	}

	_, _ = mgr.queue.enqueue(QueueEntry{TaskID: "task-2", AgentID: "agent-1", RunID: "run-queued"})
	_ = mgr.queue.acquire("agent-1", "run-active", 0)
	_ = mgr.scheduler.intents.set(DispatchIntent{
		RunID: "run-active", LocalRunID: "run-active", TaskID: "task-1", AgentID: "agent-1",
	})

	mgr.scheduler.onAgentRunFinished("run-active", "task-1", "completed", "sess-1", "")

	select {
	case ev := <-events:
		if ev.Kind != SchedRunFinished || ev.Status != "completed" {
			t.Fatalf("finished event = %+v", ev)
		}
	default:
		t.Fatal("expected scheduler.run.finished event")
	}
	select {
	case ev := <-events:
		if ev.Kind != SchedDequeued || ev.TaskID != "task-2" {
			t.Fatalf("dequeued event = %+v", ev)
		}
	default:
		t.Fatal("expected scheduler.dequeued event")
	}
	state, err := mgr.queue.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.ActiveByAgent) != 0 {
		t.Fatalf("expected active slot released: %+v", state.ActiveByAgent)
	}
}

func TestSchedulerVerifyGateFailClosed(t *testing.T) {
	dir := t.TempDir()
	mgr := New(rpc.NewServer(os.Stdin, os.Stdout), dir)
	gateEvents := make(chan SchedulerEvent, 2)
	mgr.scheduler.emitHook = func(ev SchedulerEvent) {
		if ev.Kind == SchedGateFailed || ev.Kind == SchedRunFinished {
			gateEvents <- ev
		}
	}
	_ = mgr.queue.acquire("agent-1", "run-verify", 0)
	_ = mgr.scheduler.intents.set(DispatchIntent{
		RunID: "run-verify", LocalRunID: "run-verify", TaskID: "task-1", AgentID: "agent-1",
		DevCouncilVerify: true, Cwd: t.TempDir(),
	})

	mgr.scheduler.onAgentRunFinished("run-verify", "task-1", "completed", "", "")

	var sawGate, sawFinished bool
	for i := 0; i < 2; i++ {
		select {
		case ev := <-gateEvents:
			if ev.Kind == SchedGateFailed {
				sawGate = true
			}
			if ev.Kind == SchedRunFinished && ev.Status == "failed" {
				sawFinished = true
			}
		default:
		}
	}
	if !sawGate || !sawFinished {
		t.Fatalf("expected gate.failed + failed finish, sawGate=%v sawFinished=%v", sawGate, sawFinished)
	}
}

func TestSchedulerAutoRepairFollowUpAcquiresSlot(t *testing.T) {
	dir := t.TempDir()
	mgr := New(rpc.NewServer(os.Stdin, os.Stdout), dir)
	_ = mgr.scheduler.intents.set(DispatchIntent{
		RunID: "run-1", LocalRunID: "run-1", TaskID: "task-1", AgentID: "agent-1",
		Runtime: "claude", Cwd: dir, SessionID: "sess-abc", AutoRepairCI: true, AutoRepairMax: 3,
		StartParams: &StartParams{Runtime: "claude", Prompt: "seed", Cwd: dir, TaskID: "task-1"},
	})

	mgr.scheduler.onFeedbackEvent(feedback.Event{
		Kind: "ci_failed", RunID: "run-1", TaskID: "task-1",
		Payload: map[string]any{"failedChecks": []any{map[string]any{"name": "build", "state": "FAIL"}}},
	})
	intent, ok, _ := mgr.scheduler.intents.get("run-1")
	if !ok || intent == nil {
		t.Fatal("intent missing after feedback")
	}
	if intent.AutoRepairCIAttempts != 1 {
		t.Fatalf("attempts = %d, want 1", intent.AutoRepairCIAttempts)
	}
}

func TestBuildFollowUpStartParamsPreservesAdvisorAndThinking(t *testing.T) {
	t.Parallel()

	intent := &DispatchIntent{
		TaskID:    "task-1",
		Runtime:   "claude",
		Cwd:       "/repo",
		Model:     "claude-sonnet-4-6",
		SessionID: "sess-abc",
		StartParams: &StartParams{
			TaskID:         "task-1",
			Runtime:        "claude",
			Cwd:            "/repo",
			Prompt:         "original prompt",
			Model:          "claude-sonnet-4-6",
			AdvisorModel:   "opus",
			ThinkingLevel:  "high",
			PermissionMode: "acceptEdits",
			McpConfig:      `{"mcpServers":{}}`,
			TimeoutMs:      120000,
		},
	}

	params, ok := buildFollowUpStartParams(intent, "fix CI failures")
	if !ok {
		t.Fatal("expected follow-up params")
	}
	if params.Prompt != "fix CI failures" {
		t.Fatalf("prompt = %q, want follow-up prompt", params.Prompt)
	}
	if params.ResumeSessionID != "sess-abc" {
		t.Fatalf("ResumeSessionID = %q, want sess-abc", params.ResumeSessionID)
	}
	if params.AdvisorModel != "opus" {
		t.Fatalf("AdvisorModel = %q, want opus (must survive auto-repair follow-up)", params.AdvisorModel)
	}
	if params.ThinkingLevel != "high" {
		t.Fatalf("ThinkingLevel = %q, want high", params.ThinkingLevel)
	}
	if params.PermissionMode != "acceptEdits" || params.McpConfig == "" || params.TimeoutMs != 120000 {
		t.Fatalf("expected other StartParams fields preserved, got %+v", params)
	}
}

func TestBuildFollowUpStartParamsRequiresSession(t *testing.T) {
	t.Parallel()

	_, ok := buildFollowUpStartParams(&DispatchIntent{
		TaskID: "task-1",
		StartParams: &StartParams{
			Runtime:      "claude",
			Prompt:       "seed",
			AdvisorModel: "opus",
		},
	}, "follow-up")
	if ok {
		t.Fatal("expected false when SessionID missing")
	}
}

func TestRunDevVerifyGateNoCLI(t *testing.T) {
	if resolveDevCLI() != "" {
		t.Skip("dev CLI present in environment")
	}
	verdict := RunDevVerifyGate(t.TempDir(), "task-1")
	if verdict.Passed || verdict.CLIAvailable {
		t.Fatalf("expected fail-closed when CLI missing: %+v", verdict)
	}
}

func TestHandleIntentSetRPC(t *testing.T) {
	mgr := New(rpc.NewServer(os.Stdin, os.Stdout), t.TempDir())
	raw, _ := json.Marshal(DispatchIntent{
		RunID: "run-1", TaskID: "task-1", AgentID: "agent-1", Prompt: "hi", Runtime: "claude",
	})
	_, err := mgr.HandleIntentSet(raw)
	if err != nil {
		t.Fatalf("HandleIntentSet: %v", err)
	}
	got, ok, _ := mgr.scheduler.intents.get("run-1")
	if !ok || got == nil || got.Prompt != "hi" {
		t.Fatalf("intent not stored: %+v ok=%v", got, ok)
	}
}

func TestIntentFileWritten(t *testing.T) {
	dir := t.TempDir()
	store := newIntentStore(dir)
	_ = store.set(DispatchIntent{RunID: "run-1", TaskID: "t", AgentID: "a"})
	path := filepath.Join(dir, intentFile)
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("intents file not written: %v", err)
	}
}
