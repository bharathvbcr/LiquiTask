package runner

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/liquitask/liquitask-agentd/internal/feedback"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

// Scheduler RPC event kinds forwarded to the renderer.
const (
	SchedRunFinished    = "scheduler.run.finished"
	SchedDequeued         = "scheduler.dequeued"
	SchedGateFailed       = "scheduler.gate.failed"
	SchedGatePassed       = "scheduler.gate.passed"
	SchedFollowUpStarted  = "scheduler.follow_up.started"
	SchedRetryScheduled   = "scheduler.retry.scheduled"
)

// SchedulerEvent is emitted on scheduler.* notifications.
type SchedulerEvent struct {
	Kind    string         `json:"kind"`
	RunID   string         `json:"runId"`
	LocalRunID string      `json:"localRunId,omitempty"`
	TaskID  string         `json:"taskId"`
	AgentID string         `json:"agentId"`
	Status  string         `json:"status,omitempty"`
	SessionID string       `json:"sessionId,omitempty"`
	Error   string         `json:"error,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

type schedulerConfig struct {
	MaxConcurrentRuns int `json:"maxConcurrentRuns"`
	DefaultMaxRetries int `json:"defaultMaxRetries"`
}

type scheduler struct {
	mgr    *Manager
	intents *intentStore
	config schedulerConfig
	// emitHook is test-only; production uses RPC notifications.
	emitHook func(SchedulerEvent)
}

func newScheduler(mgr *Manager) *scheduler {
	return &scheduler{
		mgr:     mgr,
		intents: newIntentStore(mgr.dataDir),
		config: schedulerConfig{
			MaxConcurrentRuns: 0,
			DefaultMaxRetries: 2,
		},
	}
}

func (s *scheduler) emit(ev SchedulerEvent) {
	if s.emitHook != nil {
		s.emitHook(ev)
	}
	if s.mgr == nil || s.mgr.server == nil {
		return
	}
	method := ev.Kind
	if !strings.HasPrefix(method, "scheduler.") {
		method = "scheduler." + method
	}
	_ = s.mgr.server.Notify(method, ev)
}

// HandleIntentSet implements scheduler.intent.set.
func (m *Manager) HandleIntentSet(raw json.RawMessage) (any, *rpc.Error) {
	var intent DispatchIntent
	if err := json.Unmarshal(raw, &intent); err != nil {
		return nil, rpc.ErrInvalidParams("invalid scheduler.intent.set params")
	}
	if intent.RunID == "" && intent.LocalRunID == "" {
		return nil, rpc.ErrInvalidParams("runId or localRunId required")
	}
	if intent.TaskID == "" || intent.AgentID == "" {
		return nil, rpc.ErrInvalidParams("taskId and agentId required")
	}
	if intent.RunID == "" {
		intent.RunID = intent.LocalRunID
	}
	if intent.LocalRunID == "" {
		intent.LocalRunID = intent.RunID
	}
	if intent.MaxRetries <= 0 && m.scheduler.config.DefaultMaxRetries > 0 {
		intent.MaxRetries = m.scheduler.config.DefaultMaxRetries
	}
	if err := m.scheduler.intents.set(intent); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

// HandleSchedulerConfigSet implements scheduler.config.set.
func (m *Manager) HandleSchedulerConfigSet(raw json.RawMessage) (any, *rpc.Error) {
	var cfg schedulerConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, rpc.ErrInvalidParams("invalid scheduler.config.set params")
	}
	if cfg.MaxConcurrentRuns >= 0 {
		m.scheduler.config.MaxConcurrentRuns = cfg.MaxConcurrentRuns
	}
	if cfg.DefaultMaxRetries >= 0 {
		m.scheduler.config.DefaultMaxRetries = cfg.DefaultMaxRetries
	}
	return map[string]bool{"ok": true}, nil
}

// HandleSchedulerList implements scheduler.intent.list (debug/read mirror).
func (m *Manager) HandleSchedulerList(_ json.RawMessage) (any, *rpc.Error) {
	intents, err := m.scheduler.intents.list()
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]any{"intents": intents}, nil
}

func (s *scheduler) onFeedbackEvent(ev feedback.Event) {
	switch ev.Kind {
	case "ci_failed":
		s.handleAutoRepair(ev, "ci")
	case "review_comments":
		s.handleAutoRepair(ev, "review")
	}
}

func (s *scheduler) handleAutoRepair(ev feedback.Event, kind string) {
	intent, ok, err := s.intents.get(ev.RunID)
	if err != nil || !ok || intent == nil {
		return
	}
	if kind == "ci" && !intent.AutoRepairCI {
		return
	}
	if kind == "review" && !intent.AutoRepairReview {
		return
	}
	max := intent.AutoRepairMax
	if max <= 0 {
		max = 3
	}
	if kind == "ci" {
		if intent.AutoRepairCIAttempts >= max {
			return
		}
		intent.AutoRepairCIAttempts++
	} else {
		if intent.AutoRepairReviewAttempts >= max {
			return
		}
		intent.AutoRepairReviewAttempts++
	}
	prompt := buildFollowUpPrompt(ev, kind)
	if prompt == "" {
		return
	}
	_ = s.intents.set(*intent)
	s.startFollowUp(intent, prompt, kind)
}

func buildFollowUpPrompt(ev feedback.Event, kind string) string {
	payload := ev.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	if kind == "ci" {
		checks, _ := payload["failedChecks"].([]any)
		lines := make([]string, 0, len(checks))
		for _, c := range checks {
			if m, ok := c.(map[string]any); ok {
				name, _ := m["name"].(string)
				state, _ := m["state"].(string)
				if name != "" {
					lines = append(lines, fmt.Sprintf("- %s: %s", name, state))
				}
			}
		}
		return strings.Join([]string{
			"CI checks failed on the pull request. Fix the failures and push an updated commit.",
			"",
			"Failed checks:",
			strings.Join(lines, "\n"),
		}, "\n")
	}
	comments, _ := payload["comments"].([]any)
	lines := make([]string, 0, len(comments))
	for i, c := range comments {
		if m, ok := c.(map[string]any); ok {
			author, _ := m["author"].(string)
			body, _ := m["body"].(string)
			path, _ := m["path"].(string)
			loc := ""
			if path != "" {
				loc = " @ " + path
			}
			lines = append(lines, fmt.Sprintf("%d. %s%s: %s", i+1, author, loc, strings.TrimSpace(body)))
		}
		if i >= 11 {
			break
		}
	}
	return strings.Join(append([]string{"Address every pull-request review comment:", ""}, lines...), "\n")
}

func (s *scheduler) onAgentRunFinished(agentdRunID, taskID, status, sessionID, errMsg string) {
	intent, ok, _ := s.intents.get(agentdRunID)
	agentID := ""
	localRunID := agentdRunID
	runID := agentdRunID
	if ok && intent != nil {
		agentID = intent.AgentID
		if intent.LocalRunID != "" {
			localRunID = intent.LocalRunID
		}
		if intent.RunID != "" {
			runID = intent.RunID
		}
		intent.Status = status
		intent.SessionID = sessionID
		intent.AgentdRunID = agentdRunID
		_ = s.intents.set(*intent)
	} else {
		// No intent — still emit finished for renderer reconcile.
		s.emit(SchedulerEvent{
			Kind:       SchedRunFinished,
			RunID:      agentdRunID,
			LocalRunID: localRunID,
			TaskID:     taskID,
			Status:     status,
			SessionID:  sessionID,
			Error:      errMsg,
		})
		return
	}

	finalStatus := status
	verifyPayload := map[string]any{}

	if status == "completed" && intent.DevCouncilVerify {
		cwd := intent.Cwd
		if cwd == "" && intent.StartParams != nil {
			cwd = intent.StartParams.Cwd
		}
		if cwd != "" {
			verdict := RunDevVerifyGate(cwd, intent.TaskID)
			verifyPayload["verification"] = verdict
			if !verdict.Passed {
				finalStatus = "failed"
				if errMsg == "" {
					errMsg = "DevCouncil verify gate failed"
				}
				s.emit(SchedulerEvent{
					Kind:       SchedGateFailed,
					RunID:      runID,
					LocalRunID: localRunID,
					TaskID:     intent.TaskID,
					AgentID:    agentID,
					Status:     finalStatus,
					SessionID:  sessionID,
					Error:      errMsg,
					Payload:    verifyPayload,
				})
			} else {
				s.emit(SchedulerEvent{
					Kind:       SchedGatePassed,
					RunID:      runID,
					LocalRunID: localRunID,
					TaskID:     intent.TaskID,
					AgentID:    agentID,
					Status:     finalStatus,
					SessionID:  sessionID,
					Payload:    verifyPayload,
				})
			}
		}
	}

	if finalStatus == "failed" && intent.RetryCount < intent.MaxRetries && isRetryableFailure(errMsg) {
		intent.RetryCount++
		_ = s.intents.set(*intent)
		s.emit(SchedulerEvent{
			Kind:       SchedRetryScheduled,
			RunID:      runID,
			LocalRunID: localRunID,
			TaskID:     intent.TaskID,
			AgentID:    agentID,
			Status:     "queued",
			Payload: map[string]any{
				"attempt": intent.RetryCount,
				"max":     intent.MaxRetries,
			},
		})
		_, _ = s.mgr.queue.enqueue(QueueEntry{
			TaskID:  intent.TaskID,
			AgentID: agentID,
			RunID:   localRunID,
		})
	}

	intent.Status = finalStatus
	_ = s.intents.set(*intent)

	s.emit(SchedulerEvent{
		Kind:       SchedRunFinished,
		RunID:      runID,
		LocalRunID: localRunID,
		TaskID:     intent.TaskID,
		AgentID:    agentID,
		Status:     finalStatus,
		SessionID:  sessionID,
		Error:      errMsg,
		Payload:    verifyPayload,
	})

	if agentID != "" {
		s.releaseAndAdvance(agentID)
	}
}

func isRetryableFailure(errMsg string) bool {
	msg := strings.ToLower(strings.TrimSpace(errMsg))
	if msg == "" {
		return true
	}
	for _, needle := range []string{"cancelled", "canceled", "user", "budget", "verify gate"} {
		if strings.Contains(msg, needle) {
			return false
		}
	}
	return true
}

func (s *scheduler) releaseAndAdvance(agentID string) {
	next, err := s.mgr.queue.release(agentID)
	if err != nil || next == nil {
		s.tryWakeGlobalQueue()
		return
	}
	s.emitDequeued(*next)
	s.tryDispatchQueued(*next)
}

func (s *scheduler) tryWakeGlobalQueue() {
	max := s.config.MaxConcurrentRuns
	if max <= 0 {
		return
	}
	for {
		ok, err := s.mgr.queue.canAcquire(max)
		if err != nil || !ok {
			return
		}
		state, err := s.mgr.queue.list()
		if err != nil {
			return
		}
		var candidate *QueueEntry
		for i := range state.Queue {
			entry := state.Queue[i]
			if _, busy := state.ActiveByAgent[entry.AgentID]; busy {
				continue
			}
			candidate = &entry
			break
		}
		if candidate == nil {
			return
		}
		if err := s.mgr.queue.acquire(candidate.AgentID, candidate.RunID, max); err != nil {
			return
		}
		_, _ = s.mgr.queue.remove(candidate.TaskID, candidate.AgentID, candidate.RunID)
		s.emitDequeued(*candidate)
		if !s.tryDispatchQueued(*candidate) {
			return
		}
	}
}

func (s *scheduler) emitDequeued(entry QueueEntry) {
	localRunID := entry.RunID
	intent, ok, _ := s.intents.get(entry.RunID)
	if ok && intent != nil && intent.LocalRunID != "" {
		localRunID = intent.LocalRunID
	}
	s.emit(SchedulerEvent{
		Kind:       SchedDequeued,
		RunID:      entry.RunID,
		LocalRunID: localRunID,
		TaskID:     entry.TaskID,
		AgentID:    entry.AgentID,
		Status:     "queued",
		Payload: map[string]any{
			"taskId":  entry.TaskID,
			"agentId": entry.AgentID,
			"runId":   entry.RunID,
		},
	})
}

// tryDispatchQueued starts a queued run headless when the intent carries enough
// context (prompt + cwd). Returns true when a dispatch was attempted.
func (s *scheduler) tryDispatchQueued(entry QueueEntry) bool {
	intent, ok, _ := s.intents.get(entry.RunID)
	if !ok || intent == nil {
		return false
	}
	params := intent.StartParams
	if params == nil {
		params = &StartParams{
			TaskID:          intent.TaskID,
			Runtime:         intent.Runtime,
			Cwd:             intent.Cwd,
			Prompt:          intent.Prompt,
			Model:           intent.Model,
			ResumeSessionID: intent.ResumeSessionID,
		}
	}
	if strings.TrimSpace(params.Prompt) == "" || strings.TrimSpace(params.Runtime) == "" {
		return false
	}
	if strings.TrimSpace(params.Cwd) == "" {
		params.Cwd = intent.Cwd
	}
	if params.TaskID == "" {
		params.TaskID = intent.TaskID
	}
	if params.ResumeSessionID == "" && intent.SessionID != "" {
		params.ResumeSessionID = intent.SessionID
	}
	raw, _ := json.Marshal(params)
	result, rpcErr := s.mgr.HandleStart(raw)
	if rpcErr != nil {
		s.mgr.logger.Warn("scheduler dispatch failed", "runId", entry.RunID, "err", rpcErr.Message)
		return false
	}
	if m, ok := result.(map[string]string); ok {
		if agentdID := m["runId"]; agentdID != "" {
			intent.AgentdRunID = agentdID
			intent.Status = "running"
			_ = s.intents.set(*intent)
		}
	}
	return true
}

func (s *scheduler) startFollowUp(intent *DispatchIntent, prompt, kind string) {
	if intent == nil || strings.TrimSpace(prompt) == "" {
		return
	}
	params := StartParams{
		TaskID:          intent.TaskID,
		Runtime:         intent.Runtime,
		Cwd:             intent.Cwd,
		Prompt:          prompt,
		Model:           intent.Model,
		ResumeSessionID: intent.SessionID,
	}
	if intent.StartParams != nil {
		params.PermissionMode = intent.StartParams.PermissionMode
		params.McpConfig = intent.StartParams.McpConfig
		params.SandboxMode = intent.StartParams.SandboxMode
		params.ContainerImage = intent.StartParams.ContainerImage
		params.AutoApprove = intent.StartParams.AutoApprove
		params.ToolPolicy = intent.StartParams.ToolPolicy
		params.TimeoutMs = intent.StartParams.TimeoutMs
		params.WorkspacePaths = intent.StartParams.WorkspacePaths
	}
	if strings.TrimSpace(params.Cwd) == "" {
		params.Cwd = intent.RepoDir
	}
	if strings.TrimSpace(params.Runtime) == "" && intent.StartParams != nil {
		params.Runtime = intent.StartParams.Runtime
	}
	if strings.TrimSpace(params.ResumeSessionID) == "" {
		return
	}
	if err := s.mgr.queue.acquire(intent.AgentID, intent.LocalRunID, s.config.MaxConcurrentRuns); err != nil {
		s.mgr.logger.Warn("scheduler follow-up acquire failed", "runId", intent.LocalRunID, "err", err)
		return
	}
	raw, _ := json.Marshal(params)
	result, rpcErr := s.mgr.HandleStart(raw)
	if rpcErr != nil {
		_, _ = s.mgr.queue.release(intent.AgentID)
		s.mgr.logger.Warn("scheduler follow-up start failed", "runId", intent.LocalRunID, "err", rpcErr.Message)
		return
	}
	agentdID := ""
	if m, ok := result.(map[string]string); ok {
		agentdID = m["runId"]
	}
	intent.Status = "running"
	intent.AgentdRunID = agentdID
	intent.Prompt = prompt
	_ = s.intents.set(*intent)
	s.emit(SchedulerEvent{
		Kind:       SchedFollowUpStarted,
		RunID:      intent.RunID,
		LocalRunID: intent.LocalRunID,
		TaskID:     intent.TaskID,
		AgentID:    intent.AgentID,
		Status:     "running",
		SessionID:  intent.SessionID,
		Payload: map[string]any{
			"kind":        kind,
			"agentdRunId": agentdID,
			"prompt":      prompt,
		},
	})
}

// Council-mode subprocess runs (devcouncil-e2e / devcouncil-verify) remain on the
// Rust agent_council_runner path. The scheduler owns agentd queue/dequeue, verify
// for direct runs, retries, and feedback follow-ups only.
