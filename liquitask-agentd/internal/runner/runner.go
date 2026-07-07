package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"github.com/google/uuid"
	"github.com/liquitask/liquitask-agentd/internal/agent"
	"github.com/liquitask/liquitask-agentd/internal/daemon"
	"github.com/liquitask/liquitask-agentd/internal/detect"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

// Event kinds emitted on run.events.
const (
	EventMessage           = "message"
	EventToolUse           = "tool_use"
	EventToolResult        = "tool_result"
	EventThinking          = "thinking"
	EventStatus            = "status"
	EventLog               = "log"
	EventPermissionRequest = "permission_request"
	EventResult            = "result"
	EventError             = "error"
)

// RunEvent is a single streamed run event.
type RunEvent struct {
	RunID string `json:"runId"`
	Kind  string `json:"kind"`
	// Payload fields vary by kind.
	Text       string                `json:"text,omitempty"`
	Tool       string                `json:"tool,omitempty"`
	CallID     string                `json:"callId,omitempty"`
	Input      map[string]any        `json:"input,omitempty"`
	Output     string                `json:"output,omitempty"`
	Status     string                `json:"status,omitempty"`
	Level      string                `json:"level,omitempty"`
	SessionID  string                `json:"sessionId,omitempty"`
	Error      string                `json:"error,omitempty"`
	Code       int                   `json:"code,omitempty"`
	DurationMs int64                 `json:"durationMs,omitempty"`
	Usage      map[string]TokenUsage `json:"usage,omitempty"`
}

// TokenUsage mirrors agent.TokenUsage for RPC serialization so runner.go does
// not force RPC clients to import the internal agent package's types.
type TokenUsage struct {
	InputTokens      int64 `json:"inputTokens"`
	OutputTokens     int64 `json:"outputTokens"`
	CacheReadTokens  int64 `json:"cacheReadTokens"`
	CacheWriteTokens int64 `json:"cacheWriteTokens"`
}

// StartParams configures run.start.
type StartParams struct {
	TaskID          string   `json:"taskId"`
	Runtime         string   `json:"runtime"`
	Model           string   `json:"model,omitempty"`
	Cwd             string   `json:"cwd,omitempty"`
	Prompt          string   `json:"prompt"`
	Scope           []string `json:"scope,omitempty"`
	McpConfig       string   `json:"mcpConfig,omitempty"`
	ThinkingLevel   string   `json:"thinkingLevel,omitempty"`
	ResumeSessionID string   `json:"resumeSessionId,omitempty"`
}

// Manager supervises agent runs and streams events via JSON-RPC notifications.
type Manager struct {
	server  *rpc.Server
	mu      sync.Mutex
	runs    map[string]*activeRun
	dataDir string
	logger  *slog.Logger
}

// activeRun tracks an in-flight (or just-finished) agent.Backend execution.
// It replaces the old *exec.Cmd-based bookkeeping: process control now goes
// through the agent.Session returned by Backend.Execute (cancel via context,
// pause/resume via Session.PID()) instead of a raw command handle.
type activeRun struct {
	id      string
	taskID  string
	runtime string
	cancel  context.CancelFunc
	session *agent.Session
	done    chan struct{}
	paused  bool
	pauseMu sync.Mutex
}

// New creates a run manager.
func New(server *rpc.Server, dataDir string) *Manager {
	return &Manager{
		server:  server,
		runs:    make(map[string]*activeRun),
		dataDir: dataDir,
		logger:  slog.Default(),
	}
}

// HandleDetect implements detect RPC.
func (m *Manager) HandleDetect(_ json.RawMessage) (any, *rpc.Error) {
	return detect.Detect(), nil
}

// HandleSkillsList implements skills.list — local skill discovery ported from
// Multica's daemon (internal/daemon/local_skills.go). params.provider empty
// sweeps every supported runtime's skill root plus ~/.agents/skills.
func (m *Manager) HandleSkillsList(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		Provider string `json:"provider"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, rpc.ErrInvalidParams("invalid skills.list params")
		}
	}
	skills, err := daemon.ListLocalSkills(p.Provider)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return skills, nil
}

// HandleSkillsRead implements skills.read — return a locally-installed skill's
// SKILL.md body by its source directory (from skills.list), for inlining the
// real guidance into a run prompt instead of just the one-line description.
func (m *Manager) HandleSkillsRead(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		SourcePath string `json:"sourcePath"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid skills.read params")
	}
	if p.SourcePath == "" {
		return nil, rpc.ErrInvalidParams("sourcePath required")
	}
	body, err := daemon.ReadLocalSkillBody(p.SourcePath)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]string{"body": body}, nil
}

// HandleStart implements run.start. It resolves the runtime's executable via
// internal/detect (PATH scan), then hands execution off to the ported
// internal/agent Backend abstraction — agent.New()+Backend.Execute() — instead
// of hand-rolling per-CLI argv construction. This gets us the richer
// per-backend behaviour (thinking levels, per-OS quirks, deadlock handling,
// MCP config plumbing, resume sessions, etc.) that the Multica-ported
// backends implement internally.
func (m *Manager) HandleStart(raw json.RawMessage) (any, *rpc.Error) {
	var p StartParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid run.start params")
	}
	if p.Runtime == "" || p.Prompt == "" {
		return nil, rpc.ErrInvalidParams("runtime and prompt required")
	}
	if p.TaskID == "" {
		p.TaskID = "task"
	}
	if !agent.IsSupportedType(p.Runtime) {
		return nil, rpc.ErrInvalidParams(fmt.Sprintf("unsupported runtime %q (supported: %v)", p.Runtime, agent.SupportedTypes))
	}
	cwd := p.Cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}

	execPath, err := detect.ResolveBinary(p.Runtime)
	if err != nil {
		return nil, rpc.Err(err.Error())
	}

	runID := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())
	ar := &activeRun{
		id:      runID,
		taskID:  p.TaskID,
		runtime: p.Runtime,
		cancel:  cancel,
		done:    make(chan struct{}),
	}
	m.mu.Lock()
	m.runs[runID] = ar
	m.mu.Unlock()

	go m.execute(ctx, ar, p, cwd, execPath)
	return map[string]string{"runId": runID}, nil
}

// HandleCancel implements run.cancel. Cancelling the context passed to
// Execute is sufficient — every ported backend's Execute wires its subprocess
// via exec.CommandContext (or an explicit ctx.Done() watcher for
// protocol-driven backends like codex), so cancellation cleanly stops the
// subprocess without runner.go needing direct process access.
func (m *Manager) HandleCancel(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	ar.cancel()
	return map[string]bool{"ok": true}, nil
}

// HandlePause implements run.pause (unix SIGSTOP), sourcing the PID from the
// agent.Session instead of a raw *exec.Cmd.
func (m *Manager) HandlePause(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	pid := sessionPID(ar)
	if pid == 0 {
		return nil, rpc.Err("run not pausable: backend did not report a process id")
	}
	ar.pauseMu.Lock()
	defer ar.pauseMu.Unlock()
	if ar.paused {
		return map[string]bool{"ok": true}, nil
	}
	if err := syscall.Kill(pid, syscall.SIGSTOP); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	ar.paused = true
	return map[string]bool{"ok": true}, nil
}

// HandleResume implements run.resume (unix SIGCONT), sourcing the PID from
// the agent.Session instead of a raw *exec.Cmd.
func (m *Manager) HandleResume(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	m.mu.Lock()
	ar, ok := m.runs[p.RunID]
	m.mu.Unlock()
	if !ok {
		return nil, rpc.Err("run not found")
	}
	pid := sessionPID(ar)
	if pid == 0 {
		return nil, rpc.Err("run not pausable: backend did not report a process id")
	}
	ar.pauseMu.Lock()
	defer ar.pauseMu.Unlock()
	if !ar.paused {
		return map[string]bool{"ok": true}, nil
	}
	if err := syscall.Kill(pid, syscall.SIGCONT); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	ar.paused = false
	return map[string]bool{"ok": true}, nil
}

// sessionPID returns the OS PID reported by the run's agent.Session, or 0 if
// the run has no session yet (race with HandleStart's goroutine) or the
// backend never populated one.
func sessionPID(ar *activeRun) int {
	if ar.session == nil {
		return 0
	}
	return ar.session.PID()
}

// HandleInject implements run.inject — writes guidance to a run-scoped file.
//
// NOTE: this remains a best-effort stub. None of the ported Multica backends
// currently read an injected-guidance file mid-run (they consume the prompt
// once at Execute() time and, for protocol-driven backends like codex, drive
// a single turn to completion); there is no clean integration point yet to
// feed live guidance into a running turn. Keeping the file-write behavior
// preserves the existing RPC contract and gives a future mid-run-injection
// feature a file it can read, but today it has no effect on the running
// agent process.
func (m *Manager) HandleInject(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID    string `json:"runId"`
		Guidance string `json:"guidance"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId and guidance required")
	}
	path := filepath.Join(m.dataDir, "runs", p.RunID, "guidance.txt")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	if err := os.WriteFile(path, []byte(p.Guidance), 0o644); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	m.emit(p.RunID, RunEvent{RunID: p.RunID, Kind: EventMessage, Text: "[guidance injected]"})
	return map[string]bool{"ok": true}, nil
}

// HandleReattach implements run.reattach — lists runs still tracked in
// memory.
//
// NOTE: this only sees runs the current daemon process started; true
// cross-restart reattach (recovering runs after the daemon itself restarts)
// needs run state persisted to disk (e.g. a runs/<id>/state.json checkpoint
// plus a way to re-observe a still-running subprocess or resume via the
// backend's session id) beyond what this pass covers. Flagged as future work,
// not in scope here.
func (m *Manager) HandleReattach(_ json.RawMessage) (any, *rpc.Error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	type info struct {
		RunID   string `json:"runId"`
		TaskID  string `json:"taskId"`
		Runtime string `json:"runtime"`
		Alive   bool   `json:"alive"`
		Status  string `json:"status"`
	}
	out := make([]info, 0, len(m.runs))
	for id, ar := range m.runs {
		alive := true
		select {
		case <-ar.done:
			alive = false
		default:
		}
		status := "running"
		if !alive {
			status = "completed"
		}
		out = append(out, info{RunID: id, TaskID: ar.taskID, Runtime: ar.runtime, Alive: alive, Status: status})
	}
	return out, nil
}

// HandlePermissionRespond is a stub for permission.respond (Phase 1 logs
// only).
//
// NOTE: no obvious integration point yet. The MCP config plumbing that
// exists today in internal/execenv materialises static MCP server config for
// a run (e.g. codex's config.toml mcp_servers block) rather than brokering
// live tool-permission prompts from a running agent back to this daemon, so
// there is nothing yet to wire this into. Left as a stub with the same
// signature until a permission-request channel exists on agent.Session.
func (m *Manager) HandlePermissionRespond(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID     string `json:"runId"`
		RequestID string `json:"requestId"`
		Decision  string `json:"decision"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid permission.respond params")
	}
	// Full MCP permission bridge lands with Multica backend port; acknowledge for now.
	return map[string]bool{"ok": true}, nil
}

// execute resolves and runs the backend for p.Runtime, streaming its
// Messages/Result into run.events notifications.
func (m *Manager) execute(ctx context.Context, ar *activeRun, p StartParams, cwd string, execPath string) {
	defer close(ar.done)
	defer func() {
		m.mu.Lock()
		delete(m.runs, ar.id)
		m.mu.Unlock()
	}()

	runDir := filepath.Join(m.dataDir, "runs", ar.id)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		m.emitResult(ar.id, "failed", err.Error(), -1, "", nil)
		return
	}
	stdoutPath := filepath.Join(runDir, "stdout.ndjson")
	stdoutFile, err := os.Create(stdoutPath)
	if err != nil {
		m.emitResult(ar.id, "failed", err.Error(), -1, "", nil)
		return
	}
	defer stdoutFile.Close()

	backend, err := agent.New(p.Runtime, agent.Config{
		ExecutablePath: execPath,
		Logger:         m.logger.With("runtime", p.Runtime, "runId", ar.id),
	})
	if err != nil {
		m.emitResult(ar.id, "failed", err.Error(), -1, "", nil)
		return
	}

	opts := agent.ExecOptions{
		Cwd:             cwd,
		Model:           p.Model,
		ThinkingLevel:   p.ThinkingLevel,
		ResumeSessionID: p.ResumeSessionID,
	}
	if p.McpConfig != "" {
		opts.McpConfig = json.RawMessage(p.McpConfig)
	}

	session, err := backend.Execute(ctx, p.Prompt, opts)
	if err != nil {
		m.emitResult(ar.id, "failed", err.Error(), -1, "", nil)
		return
	}

	m.mu.Lock()
	ar.session = session
	m.mu.Unlock()

	m.emit(ar.id, RunEvent{RunID: ar.id, Kind: EventMessage, Text: fmt.Sprintf("started %s (pid %d)", p.Runtime, session.PID())})

	// Stream agent.Message events, translating each into a RunEvent and
	// persisting it to runs/<runId>/stdout.ndjson (kept for reattach /
	// post-hoc inspection, mirroring the previous stream-json tail convention).
	for msg := range session.Messages {
		ev := translateMessage(ar.id, msg)
		m.persistEvent(stdoutFile, ev)
		m.emit(ar.id, ev)
	}

	// Result is sent exactly once after Messages closes.
	res, ok := <-session.Result
	if !ok {
		// Backend closed Result without sending — treat as an unexplained
		// failure rather than silently dropping the run.
		m.emitResult(ar.id, "failed", "backend closed result channel without a result", -1, "", nil)
		return
	}
	m.emitResultFrom(ar.id, res, stdoutFile)
}

// translateMessage maps an agent.Message onto the RunEvent wire shape used by
// run.events notifications.
func translateMessage(runID string, msg agent.Message) RunEvent {
	ev := RunEvent{
		RunID:     runID,
		Text:      msg.Content,
		Tool:      msg.Tool,
		CallID:    msg.CallID,
		Input:     msg.Input,
		Output:    msg.Output,
		Status:    msg.Status,
		Level:     msg.Level,
		SessionID: msg.SessionID,
	}
	switch msg.Type {
	case agent.MessageText:
		ev.Kind = EventMessage
	case agent.MessageThinking:
		ev.Kind = EventThinking
	case agent.MessageToolUse:
		ev.Kind = EventToolUse
	case agent.MessageToolResult:
		ev.Kind = EventToolResult
	case agent.MessageStatus:
		ev.Kind = EventStatus
	case agent.MessageError:
		ev.Kind = EventError
		ev.Error = msg.Content
	case agent.MessageLog:
		ev.Kind = EventLog
	default:
		ev.Kind = EventMessage
	}
	return ev
}

// emitResultFrom translates an agent.Result into a final RunEvent.
func (m *Manager) emitResultFrom(runID string, res agent.Result, stdoutFile *os.File) {
	usage := convertUsage(res.Usage)
	ev := RunEvent{
		RunID:      runID,
		Kind:       EventResult,
		Status:     res.Status,
		Error:      res.Error,
		SessionID:  res.SessionID,
		DurationMs: res.DurationMs,
		Usage:      usage,
	}
	if res.Output != "" {
		ev.Text = res.Output
	}
	m.persistEvent(stdoutFile, ev)
	m.emit(runID, ev)
}

func convertUsage(usage map[string]agent.TokenUsage) map[string]TokenUsage {
	if len(usage) == 0 {
		return nil
	}
	out := make(map[string]TokenUsage, len(usage))
	for model, u := range usage {
		out[model] = TokenUsage{
			InputTokens:      u.InputTokens,
			OutputTokens:     u.OutputTokens,
			CacheReadTokens:  u.CacheReadTokens,
			CacheWriteTokens: u.CacheWriteTokens,
		}
	}
	return out
}

// persistEvent appends a RunEvent to the run's stdout.ndjson file, preserving
// the previous stream-json-tail-for-reattach convention. Best-effort: a write
// failure is logged but never interrupts the live event stream.
func (m *Manager) persistEvent(f *os.File, ev RunEvent) {
	if f == nil {
		return
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	data = append(data, '\n')
	if _, err := f.Write(data); err != nil {
		m.logger.Warn("runner: failed to persist run event", "err", err)
	}
}

func (m *Manager) emit(runID string, ev RunEvent) {
	ev.RunID = runID
	_ = m.server.Notify("run.events", ev)
}

func (m *Manager) emitResult(runID, status, errMsg string, code int, sessionID string, usage map[string]TokenUsage) {
	_ = m.server.Notify("run.events", RunEvent{
		RunID:     runID,
		Kind:      EventResult,
		Status:    status,
		Error:     errMsg,
		Code:      code,
		SessionID: sessionID,
		Usage:     usage,
	})
}
