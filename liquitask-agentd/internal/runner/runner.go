package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/liquitask/liquitask-agentd/internal/agent"
	"github.com/liquitask/liquitask-agentd/internal/daemon"
	"github.com/liquitask/liquitask-agentd/internal/detect"
	"github.com/liquitask/liquitask-agentd/internal/feedback"
	"github.com/liquitask/liquitask-agentd/internal/notify"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
	"github.com/liquitask/liquitask-agentd/internal/workspaceauth"
)

const maxStdoutNdjsonBytes = 8 * 1024 * 1024 // 8 MiB cap per run log

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
	InputDigest string               `json:"inputDigest,omitempty"`
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
	TaskID          string            `json:"taskId"`
	LocalRunID      string            `json:"localRunId,omitempty"`
	AgentID         string            `json:"agentId,omitempty"`
	Runtime         string            `json:"runtime"`
	Model           string            `json:"model,omitempty"`
	Cwd             string            `json:"cwd,omitempty"`
	Prompt          string            `json:"prompt"`
	Scope           []string          `json:"scope,omitempty"`
	McpConfig       string            `json:"mcpConfig,omitempty"`
	ThinkingLevel   string            `json:"thinkingLevel,omitempty"`
	ResumeSessionID string            `json:"resumeSessionId,omitempty"`
	PermissionMode  string            `json:"permissionMode,omitempty"`
	TimeoutMs       int64             `json:"timeoutMs,omitempty"`
	StallTimeoutMs  int64             `json:"stallTimeoutMs,omitempty"`
	AutoApprove     bool              `json:"autoApprove,omitempty"`
	ToolPolicy      map[string]string `json:"toolPolicy,omitempty"`
	SandboxMode     string            `json:"sandboxMode,omitempty"`
	ContainerImage  string            `json:"containerImage,omitempty"`
	WorkspacePaths  []string          `json:"workspacePaths,omitempty"`
	Host            string            `json:"host,omitempty"`
	SSH             *agent.SSHConfig  `json:"ssh,omitempty"`
	LocalBasePath       string            `json:"localBasePath,omitempty"`
	DailyCostCapUsd     float64           `json:"dailyCostCapUsd,omitempty"`
	MaxRunsPerDay       int               `json:"maxRunsPerDay,omitempty"`
	PerRunCostCapUsd    float64           `json:"perRunCostCapUsd,omitempty"`
	PerRunTokenCap      int64             `json:"perRunTokenCap,omitempty"`
	TodaySpendUsd       float64           `json:"todaySpendUsd,omitempty"`
	TodayRunCount       int               `json:"todayRunCount,omitempty"`
	AdvisorModel        string            `json:"advisorModel,omitempty"`
}

// Manager supervises agent runs and streams events via JSON-RPC notifications.
type Manager struct {
	server  *rpc.Server
	mu      sync.Mutex
	runs    map[string]*activeRun
	dataDir string
	logger  *slog.Logger
	journal *journal
	queue        *runQueue
	reservations *scopeReservation
	scheduler    *scheduler
	budgets      *budgetStore
	perms        *permissionBroker
	notify   *notify.Dispatcher
	feedback *feedback.Poller
	gcStop   context.CancelFunc
	shutdown func()
	// Pinned at first run.start from the app bridge — client-supplied paths after
	// boot cannot expand the authorised workspace boundary.
	pinnedWorkspacePaths []string
}

// activeRun tracks an in-flight (or just-finished) agent.Backend execution.
type activeRun struct {
	id      string
	taskID  string
	runtime string
	cancel  context.CancelFunc
	session *agent.Session
	done    chan struct{}
	paused  bool
	pauseMu sync.Mutex
	pid     int
	meta    *RunMeta
	ptyBuf      *ptyRingBuffer
	ptyMaster   io.ReadWriteCloser
	ptyActive   bool
	ptyTakenOver bool
}

// New creates a run manager.
func New(server *rpc.Server, dataDir string) *Manager {
	m := &Manager{
		server:  server,
		runs:    make(map[string]*activeRun),
		dataDir: dataDir,
		logger:  slog.Default(),
		journal: newJournal(dataDir),
		queue:        newRunQueue(dataDir),
		reservations: newScopeReservation(dataDir),
		budgets:      newBudgetStore(dataDir),
		perms:        newPermissionBroker(),
		notify:  notify.NewDispatcher(),
	}
	m.scheduler = newScheduler(m)
	m.feedback = feedback.NewPoller(m.logger, server)
	m.feedback.OnEvent = m.scheduler.onFeedbackEvent
	return m
}

// HandleFeedbackWatch implements feedback.watch — app syncs PR runs to poll.
func (m *Manager) HandleFeedbackWatch(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		Runs []feedback.WatchedRun `json:"runs"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid feedback.watch params")
	}
	if m.feedback != nil {
		m.feedback.UpdateWatchList(p.Runs)
	}
	return map[string]int{"watched": len(p.Runs)}, nil
}

// HandleNotifyConfigSet implements notify.config.set.
func (m *Manager) HandleNotifyConfigSet(raw json.RawMessage) (any, *rpc.Error) {
	var cfg notify.Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, rpc.ErrInvalidParams("invalid notify.config.set params")
	}
	m.notify.SetConfig(cfg)
	return map[string]bool{"ok": true}, nil
}

// SetShutdownHook registers a callback invoked by daemon.stop.
func (m *Manager) SetShutdownHook(fn func()) {
	m.shutdown = fn
}

// StartBackground starts journal reconciliation and runs-dir GC.
func (m *Manager) StartBackground(ctx context.Context) {
	ctx, m.gcStop = context.WithCancel(ctx)
	reconciled := m.ReconcileJournal()
	m.scrubStaleQueueActives(reconciled)
	m.startRunsGC(ctx)
	go m.feedback.Start(ctx)
}

func (m *Manager) scrubStaleQueueActives(reconciled []reattachInfo) {
	active := make(map[string]struct{})
	for _, info := range reconciled {
		if info.Alive || info.Status == "running" || info.Status == "queued" {
			active[info.RunID] = struct{}{}
		}
	}
	m.mu.Lock()
	for id := range m.runs {
		active[id] = struct{}{}
	}
	m.mu.Unlock()
	if err := m.queue.scrubStaleActives(func(runID string) bool {
		_, ok := active[runID]
		return ok
	}); err != nil {
		m.logger.Warn("queue scrub stale actives failed", "err", err)
	}
	if err := m.reservations.scrubStale(func(runID string) bool {
		_, ok := active[runID]
		return ok
	}); err != nil {
		m.logger.Warn("reservation scrub stale failed", "err", err)
	}
}

// Shutdown cancels all tracked runs and kills their process groups.
func (m *Manager) Shutdown() {
	if m.gcStop != nil {
		m.gcStop()
	}
	m.mu.Lock()
	runs := make([]*activeRun, 0, len(m.runs))
	for _, ar := range m.runs {
		runs = append(runs, ar)
	}
	m.mu.Unlock()
	for _, ar := range runs {
		ar.cancel()
		pid := sessionPID(ar)
		if pid > 0 {
			agent.KillProcess(pid)
		}
		m.perms.clearRun(ar.id)
	}
}

// HandleDetect implements detect RPC.
func (m *Manager) HandleDetect(_ json.RawMessage) (any, *rpc.Error) {
	return detect.Detect(), nil
}

// HandleSkillsList implements skills.list.
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

// HandleSkillsRead implements skills.read.
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

// HandleStart implements run.start.
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
	if strings.TrimSpace(p.ContainerImage) != "" {
		if err := agent.ValidateContainerAvailable(); err != nil {
			return nil, rpc.Err(err.Error())
		}
	}
	if isSSHHost(p) {
		if strings.TrimSpace(p.ContainerImage) != "" || p.SandboxMode == "os" {
			return nil, rpc.Err("remote SSH execution cannot use container or OS sandbox")
		}
		if p.SSH == nil || strings.TrimSpace(p.SSH.Target) == "" {
			return nil, rpc.ErrInvalidParams("ssh target required when host is ssh")
		}
		if err := agent.ValidateSSHConfig(*p.SSH); err != nil {
			return nil, rpc.Err(err.Error())
		}
	}
	cwd := p.Cwd
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	m.mu.Lock()
	if len(m.pinnedWorkspacePaths) == 0 && len(p.WorkspacePaths) > 0 {
		m.pinnedWorkspacePaths = append([]string(nil), p.WorkspacePaths...)
	}
	workspacePaths := m.pinnedWorkspacePaths
	if len(workspacePaths) == 0 {
		workspacePaths = p.WorkspacePaths
	}
	m.mu.Unlock()
	authorizedCwd, err := workspaceauth.AuthorizeDir(cwd, workspacePaths)
	if err != nil {
		return nil, rpc.Err(err.Error())
	}
	cwd = authorizedCwd

	execPath, err := detect.ResolveBinary(p.Runtime)
	if err != nil {
		return nil, rpc.Err(err.Error())
	}

	var reservedCount int
	if p.AgentID != "" {
		reservedCount, err = m.budgets.reserveRun(p.AgentID)
		if err != nil {
			return nil, rpc.ErrInternal(err.Error())
		}
		if err := checkSpawnBudget(p, reservedCount); err != nil {
			_ = m.budgets.releaseRun(p.AgentID)
			return nil, rpc.Err(err.Error())
		}
	} else if err := checkSpawnBudget(p, p.TodayRunCount); err != nil {
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
		meta: &RunMeta{
			RunID:       runID,
			TaskID:      p.TaskID,
			Runtime:     p.Runtime,
			Status:      "running",
			StartedAtMs: nowMs(),
		},
	}
	_ = m.journal.writeMeta(ar.meta)

	m.mu.Lock()
	m.runs[runID] = ar
	m.mu.Unlock()

	m.linkIntentForStart(runID, p)

	go m.execute(ctx, ar, p, cwd, execPath, workspacePaths)
	return map[string]string{"runId": runID}, nil
}

func (m *Manager) linkIntentForStart(agentdRunID string, p StartParams) {
	localID := strings.TrimSpace(p.LocalRunID)
	if localID == "" {
		localID = strings.TrimSpace(p.TaskID)
	}
	intent, ok, err := m.scheduler.intents.get(localID)
	if err != nil || !ok || intent == nil {
		// Register a minimal intent so the scheduler can finish/dequeue.
		intent = &DispatchIntent{
			RunID:       localID,
			LocalRunID:  localID,
			TaskID:      p.TaskID,
			AgentID:     p.AgentID,
			Runtime:     p.Runtime,
			Cwd:         p.Cwd,
			Prompt:      p.Prompt,
			Model:       p.Model,
			AgentdRunID: agentdRunID,
			Status:      "running",
			StartParams: &p,
		}
	} else {
		intent.AgentdRunID = agentdRunID
		intent.Status = "running"
		if intent.Runtime == "" {
			intent.Runtime = p.Runtime
		}
		if intent.Cwd == "" {
			intent.Cwd = p.Cwd
		}
		if intent.Prompt == "" {
			intent.Prompt = p.Prompt
		}
		if intent.StartParams == nil {
			copy := p
			intent.StartParams = &copy
		}
	}
	_ = m.scheduler.intents.set(*intent)
}

// HandleCancel implements run.cancel.
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
	pid := sessionPID(ar)
	if pid > 0 {
		agent.KillProcess(pid)
	}
	return map[string]bool{"ok": true}, nil
}

// HandlePause implements run.pause using process-group SIGSTOP.
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
	if err := agentSignalStop(pid); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	ar.paused = true
	if ar.meta != nil {
		ar.meta.Paused = true
		_ = m.journal.writeMeta(ar.meta)
	}
	return map[string]bool{"ok": true}, nil
}

// HandleResume implements run.resume using process-group SIGCONT.
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
	if err := agentSignalCont(pid); err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	ar.paused = false
	if ar.meta != nil {
		ar.meta.Paused = false
		_ = m.journal.writeMeta(ar.meta)
	}
	return map[string]bool{"ok": true}, nil
}

func agentSignalStop(pid int) error {
	agent.StopProcess(pid)
	return nil
}

func agentSignalCont(pid int) error {
	agent.ResumeProcess(pid)
	return nil
}

func sessionPID(ar *activeRun) int {
	if ar.pid > 0 {
		return ar.pid
	}
	if ar.session == nil {
		return 0
	}
	return ar.session.PID()
}

// HandleInject implements run.inject.
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

// HandleSessionsDiscover scans on-disk agent sessions not started by LiquiTask.
func (m *Manager) HandleSessionsDiscover(raw json.RawMessage) (any, *rpc.Error) {
	var p detect.DiscoverParams
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, rpc.ErrInvalidParams(err.Error())
		}
	}
	return detect.DiscoverSessions(p.KnownSessionIDs), nil
}

// HandleSessionsFork copies (and optionally truncates) a Claude/Codex session file.
func (m *Manager) HandleSessionsFork(raw json.RawMessage) (any, *rpc.Error) {
	var p detect.ForkParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams(err.Error())
	}
	if p.Runtime == "" || p.SessionID == "" {
		return nil, rpc.ErrInvalidParams("runtime and sessionId required")
	}
	result, err := detect.ForkSession(p)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return result, nil
}

// HandleSessionsTruncate rewinds a session file to a message index.
func (m *Manager) HandleSessionsTruncate(raw json.RawMessage) (any, *rpc.Error) {
	var p detect.TruncateParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams(err.Error())
	}
	if p.Runtime == "" || p.SessionID == "" {
		return nil, rpc.ErrInvalidParams("runtime and sessionId required")
	}
	if p.MessageIndex < 0 {
		return nil, rpc.ErrInvalidParams("messageIndex must be >= 0")
	}
	result, err := detect.TruncateSession(p)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return result, nil
}

// HandleSessionsMessageCount returns the JSONL line count for a session file.
func (m *Manager) HandleSessionsMessageCount(raw json.RawMessage) (any, *rpc.Error) {
	var p detect.MessageCountParams
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams(err.Error())
	}
	if p.Runtime == "" || p.SessionID == "" {
		return nil, rpc.ErrInvalidParams("runtime and sessionId required")
	}
	result, err := detect.SessionMessageCount(p)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return result, nil
}

// HandleReattach lists persisted and in-memory runs after journal reconciliation.
func (m *Manager) HandleReattach(_ json.RawMessage) (any, *rpc.Error) {
	reconciled := m.ReconcileJournal()

	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]reattachInfo, 0, len(m.runs))
	seen := make(map[string]bool)
	for id, ar := range m.runs {
		alive := true
		select {
		case <-ar.done:
			alive = false
		default:
		}
		info := reattachInfo{RunID: id, TaskID: ar.taskID, Runtime: ar.runtime, Alive: alive}
		if !alive {
			runDir := filepath.Join(m.dataDir, "runs", id)
			status, sessionID, _ := reconcileFromStdout(runDir)
			if status == "" || status == "running" {
				status = "failed"
			}
			info.Status = status
			if ar.meta != nil {
				ar.meta.SessionID = sessionID
			}
		} else {
			status := "running"
			if ar.meta != nil && strings.EqualFold(strings.TrimSpace(ar.meta.Status), "verifying") {
				status = "verifying"
			}
			info.Status = status
			if ar.meta != nil && ar.meta.PID > 0 {
				if !agent.ProcessIdentityMatches(ar.meta.PID, ar.meta.ProcessStartTimeMs) {
					alive = false
					info.Alive = false
					info.Status = "failed"
				}
			}
		}
		if ar.meta != nil {
			info.SessionID = ar.meta.SessionID
			info.Paused = ar.meta.Paused
		}
		out = append(out, info)
		seen[id] = true
	}
	for _, info := range reconciled {
		if seen[info.RunID] {
			continue
		}
		out = append(out, info)
	}
	queueState, err := m.queue.list()
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	for _, entry := range queueState.Queue {
		out = append(out, reattachInfo{
			RunID:   entry.RunID,
			TaskID:  entry.TaskID,
			Runtime: "",
			Alive:   false,
			Status:  "queued",
		})
	}
	return out, nil
}

// HandleQueueList implements queue.list.
func (m *Manager) HandleQueueList(_ json.RawMessage) (any, *rpc.Error) {
	state, err := m.queue.list()
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return state, nil
}

// HandleQueueEnqueue implements queue.enqueue.
func (m *Manager) HandleQueueEnqueue(raw json.RawMessage) (any, *rpc.Error) {
	var p QueueEntry
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid queue.enqueue params")
	}
	if p.TaskID == "" || p.AgentID == "" {
		return nil, rpc.ErrInvalidParams("taskId and agentId required")
	}
	position, err := m.queue.enqueue(p)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]any{"position": position}, nil
}

// HandleQueueRemove implements queue.remove.
func (m *Manager) HandleQueueRemove(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		TaskID  string `json:"taskId"`
		AgentID string `json:"agentId"`
		RunID   string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid queue.remove params")
	}
	if p.TaskID == "" && p.RunID == "" {
		return nil, rpc.ErrInvalidParams("taskId or runId required")
	}
	ok, err := m.queue.remove(p.TaskID, p.AgentID, p.RunID)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return map[string]bool{"ok": ok}, nil
}

// HandleQueueAcquire marks an agent slot as active for a run.
func (m *Manager) HandleQueueAcquire(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		AgentID              string `json:"agentId"`
		RunID                string `json:"runId"`
		MaxConcurrentRuns    int    `json:"maxConcurrentRuns"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.AgentID == "" || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("agentId and runId required")
	}
	if err := m.queue.acquire(p.AgentID, p.RunID, p.MaxConcurrentRuns); err != nil {
		return nil, rpc.Err(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

// HandleReservationList implements reservation.list.
func (m *Manager) HandleReservationList(_ json.RawMessage) (any, *rpc.Error) {
	state, err := m.reservations.list()
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	return state, nil
}

// HandleReservationClaim implements reservation.claim.
func (m *Manager) HandleReservationClaim(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID           string   `json:"runId"`
		TaskID          string   `json:"taskId"`
		Paths           []string `json:"paths"`
		QueueOnConflict bool     `json:"queueOnConflict"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" || p.TaskID == "" {
		return nil, rpc.ErrInvalidParams("runId and taskId required")
	}
	ok, conflict, position, err := m.reservations.claim(p.RunID, p.TaskID, p.Paths, p.QueueOnConflict)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	out := map[string]any{"ok": ok}
	if conflict != nil {
		out["conflict"] = conflict
	}
	if position > 0 {
		out["waitPosition"] = position
	}
	return out, nil
}

// HandleReservationRelease implements reservation.release.
func (m *Manager) HandleReservationRelease(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.RunID == "" {
		return nil, rpc.ErrInvalidParams("runId required")
	}
	next, err := m.reservations.release(p.RunID)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	if next == nil {
		return map[string]any{"next": nil}, nil
	}
	return map[string]any{"next": next}, nil
}

// HandleQueueRelease frees an agent slot and returns the next queued entry.
func (m *Manager) HandleQueueRelease(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		AgentID string `json:"agentId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || p.AgentID == "" {
		return nil, rpc.ErrInvalidParams("agentId required")
	}
	next, err := m.queue.release(p.AgentID)
	if err != nil {
		return nil, rpc.ErrInternal(err.Error())
	}
	if next == nil {
		return map[string]any{"next": nil}, nil
	}
	return map[string]any{"next": next}, nil
}

// HandleDaemonStop implements daemon.stop for explicit lifecycle control.
func (m *Manager) HandleDaemonStop(_ json.RawMessage) (any, *rpc.Error) {
	if m.shutdown != nil {
		go m.shutdown()
	}
	return map[string]bool{"ok": true}, nil
}

// HandlePermissionRespond resolves a pending permission request.
func (m *Manager) HandlePermissionRespond(raw json.RawMessage) (any, *rpc.Error) {
	var p struct {
		RunID       string `json:"runId"`
		RequestID   string `json:"requestId"`
		Decision    string `json:"decision"`
		InputDigest string `json:"inputDigest,omitempty"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, rpc.ErrInvalidParams("invalid permission.respond params")
	}
	if p.RunID == "" || p.RequestID == "" || p.Decision == "" {
		return nil, rpc.ErrInvalidParams("runId, requestId, and decision required")
	}
	if err := m.perms.respond(p.RunID, p.RequestID, p.Decision, p.InputDigest); err != nil {
		return nil, rpc.Err(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

// HandleSSHHealth implements ssh.health for settings preflight checks.
func (m *Manager) HandleSSHHealth(raw json.RawMessage) (any, *rpc.Error) {
	var cfg agent.SSHConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, rpc.ErrInvalidParams("invalid ssh.health params")
	}
	if err := agent.CheckSSHHealth(cfg); err != nil {
		return nil, rpc.Err(err.Error())
	}
	return map[string]bool{"ok": true}, nil
}

func isSSHHost(p StartParams) bool {
	if strings.EqualFold(strings.TrimSpace(p.Host), "ssh") {
		return true
	}
	return p.SSH != nil && strings.TrimSpace(p.SSH.Target) != ""
}

func (m *Manager) execute(ctx context.Context, ar *activeRun, p StartParams, cwd string, execPath string, workspacePaths []string) {
	defer close(ar.done)
	defer m.perms.clearRun(ar.id)
	defer func() {
		m.mu.Lock()
		delete(m.runs, ar.id)
		m.mu.Unlock()
	}()

	runDir := filepath.Join(m.dataDir, "runs", ar.id)
	if err := os.MkdirAll(runDir, 0o755); err != nil {
		m.finalizeRun(ar, "failed", err.Error())
		return
	}
	stdoutPath := filepath.Join(runDir, "stdout.ndjson")
	stdoutFile, err := os.OpenFile(stdoutPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		m.finalizeRun(ar, "failed", err.Error())
		return
	}
	defer stdoutFile.Close()

	backend, err := agent.New(p.Runtime, agent.Config{
		ExecutablePath: execPath,
		Logger:         m.logger.With("runtime", p.Runtime, "runId", ar.id),
	})
	if err != nil {
		m.finalizeRun(ar, "failed", err.Error())
		return
	}

	opts := agent.ExecOptions{
		Cwd:              cwd,
		Model:            p.Model,
		AdvisorModel:     p.AdvisorModel,
		ThinkingLevel:    p.ThinkingLevel,
		ResumeSessionID:  p.ResumeSessionID,
		PermissionMode:   p.PermissionMode,
		AutoApprove:      p.AutoApprove || p.PermissionMode == "bypassPermissions",
		ToolPolicy:       parseToolPolicy(p.ToolPolicy),
		PermissionPrompt: m.permissionPromptFor(ar.id),
		SandboxMode:      p.SandboxMode,
		ContainerImage:   p.ContainerImage,
		WorkspacePaths:   workspacePaths,
		ScopePaths:       p.Scope,
		ExecutablePath:   execPath,
	}
	if agent.RuntimeSupportsPty(p.Runtime) {
		ar.ptyBuf = newPtyRingBuffer(defaultPtyRingCap)
		ar.ptyActive = true
		opts.PtyEnabled = true
		opts.OnPtyOutput = func(chunk []byte) {
			ar.ptyBuf.Write(chunk)
			m.emitPty(ar.id, chunk)
		}
	}
	if p.TimeoutMs > 0 {
		opts.Timeout = time.Duration(p.TimeoutMs) * time.Millisecond
	}
	if p.McpConfig != "" {
		scrubbed, err := agent.ScrubMcpConfigSecrets(json.RawMessage(p.McpConfig))
		if err != nil {
			m.finalizeRun(ar, "failed", fmt.Sprintf("scrub mcp config: %v", err))
			return
		}
		opts.McpConfig = scrubbed
	}

	if isSSHHost(p) && p.SSH != nil {
		sshCfg := *p.SSH
		if base := strings.TrimSpace(p.LocalBasePath); base != "" {
			sshCfg.LocalBasePath = base
		}
		res, err := agent.PrepareSSHExecution(sshCfg, cwd)
		if err != nil {
			m.finalizeRun(ar, "failed", err.Error())
			return
		}
		if res.FallbackLocal {
			m.emit(ar.id, RunEvent{
				RunID:  ar.id,
				Kind:   EventStatus,
				Status: agent.SSHStatusFallback,
				Text:   fmt.Sprintf("SSH unavailable — running locally: %s", res.FallbackReason),
			})
		} else {
			opts.SSH = p.SSH
			opts.RemoteCwd = res.RemoteCwd
			note := fmt.Sprintf("Remote execution via SSH (%s:%s)", p.SSH.Target, res.RemoteCwd)
			if res.UsedMutagen {
				note = "Mutagen sync detected — " + note
			}
			m.emit(ar.id, RunEvent{RunID: ar.id, Kind: EventStatus, Text: note})
		}
	}

	session, err := backend.Execute(ctx, p.Prompt, opts)
	if err != nil {
		m.finalizeRun(ar, "failed", err.Error())
		return
	}

	m.mu.Lock()
	ar.session = session
	pid := session.PID()
	ar.pid = pid
	if session.PtyMaster != nil {
		ar.ptyMaster = session.PtyMaster
	}
	if ar.meta != nil && pid > 0 {
		ar.meta.PID = pid
		ar.meta.PGID = pid
		ar.meta.ProcessStartTimeMs = agent.ProcessStartTimeMs(pid)
		_ = m.journal.writeMeta(ar.meta)
	}
	m.mu.Unlock()

	m.emit(ar.id, RunEvent{RunID: ar.id, Kind: EventMessage, Text: fmt.Sprintf("started %s (pid %d)", p.Runtime, pid)})

	for msg := range session.Messages {
		ev := translateMessage(ar.id, msg)
		if msg.SessionID != "" && ar.meta != nil && ar.meta.SessionID != msg.SessionID {
			ar.meta.SessionID = msg.SessionID
			_ = m.journal.writeMeta(ar.meta)
		}
		m.persistEvent(stdoutFile, ar, ev)
		m.emit(ar.id, ev)
	}

	res, ok := <-session.Result
	if !ok {
		m.finalizeRun(ar, "failed", "backend closed result channel without a result")
		return
	}
	m.emitResultFrom(ar.id, res, stdoutFile, ar)
	m.finalizeRun(ar, res.Status, res.Error)
	status := res.Status
	if status == "" {
		status = "failed"
	}
	m.scheduler.onAgentRunFinished(ar.id, ar.taskID, status, res.SessionID, res.Error)
}

func parseToolPolicy(raw map[string]string) map[string]agent.ToolPolicyAction {
	if len(raw) == 0 {
		return nil
	}
	out := make(map[string]agent.ToolPolicyAction, len(raw))
	for tool, action := range raw {
		switch action {
		case "allow":
			out[tool] = agent.ToolPolicyAllow
		case "deny":
			out[tool] = agent.ToolPolicyDeny
		default:
			out[tool] = agent.ToolPolicyAsk
		}
	}
	return out
}

func (m *Manager) finalizeRun(ar *activeRun, status, errMsg string) {
	if ar.meta == nil {
		return
	}
	if status == "" {
		status = "failed"
	}
	ar.meta.Status = status
	ar.meta.FinishedAtMs = nowMs()
	_ = m.journal.writeMeta(ar.meta)
	if errMsg != "" && status == "failed" {
		m.emit(ar.id, RunEvent{RunID: ar.id, Kind: EventError, Error: errMsg})
	}
}

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

func (m *Manager) emitResultFrom(runID string, res agent.Result, stdoutFile *os.File, ar *activeRun) {
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
	if ar.meta != nil && res.SessionID != "" {
		ar.meta.SessionID = res.SessionID
	}
	m.persistEvent(stdoutFile, ar, ev)
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

func redactRunLogLine(raw []byte) []byte {
	s := string(raw)
	patterns := []string{
		`(?i)(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[\w-]{8,}`,
		`(?i)sk-[a-zA-Z0-9]{20,}`,
		`(?i)ghp_[a-zA-Z0-9]{20,}`,
	}
	for _, p := range patterns {
		re := regexp.MustCompile(p)
		s = re.ReplaceAllString(s, `[REDACTED]`)
	}
	return []byte(s)
}

func (m *Manager) persistEvent(f *os.File, ar *activeRun, ev RunEvent) {
	if f == nil {
		return
	}
	if info, err := f.Stat(); err == nil && info.Size() >= maxStdoutNdjsonBytes {
		m.logger.Warn("runner: stdout.ndjson cap reached; skipping further persistence", "runId", ar.id)
		return
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return
	}
	data = redactRunLogLine(data)
	data = append(data, '\n')
	n, err := f.Write(data)
	if err != nil {
		m.logger.Warn("runner: failed to persist run event", "err", err)
		return
	}
	if ar.meta != nil {
		ar.meta.StdoutOffset += int64(n)
		_ = m.journal.writeMeta(ar.meta)
	}
}

func (m *Manager) emit(runID string, ev RunEvent) {
	ev.RunID = runID
	_ = m.server.Notify("run.events", ev)
	m.maybeNotifyRemote(ev)
}

func (m *Manager) maybeNotifyRemote(ev RunEvent) {
	if m.notify == nil {
		return
	}
	switch ev.Kind {
	case EventPermissionRequest:
		tool := ev.Tool
		if tool == "" {
			tool = "tool"
		}
		m.notify.MaybeSend(
			"permission_request",
			"Agent needs permission",
			fmt.Sprintf("Approve or deny %s to continue the run.", tool),
			"permission:"+ev.RunID+":"+ev.CallID,
		)
	case EventResult:
		switch ev.Status {
		case "completed":
			m.notify.MaybeSend(
				"run_completed",
				"Agent run complete",
				"An agent run finished — review and commit from LiquiTask.",
				"run_completed:"+ev.RunID,
			)
		case "failed", "cancelled":
			body := "An agent run failed."
			if ev.Error != "" {
				body = ev.Error
			}
			m.notify.MaybeSend(
				"run_failed",
				"Agent run failed",
				body,
				"run_failed:"+ev.RunID,
			)
		}
	}
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

// cappedWriter wraps a file and refuses writes once maxBytes is reached.
type cappedWriter struct {
	w        io.Writer
	maxBytes int64
	written  int64
}

func (c *cappedWriter) Write(p []byte) (int, error) {
	if c.written >= c.maxBytes {
		return 0, nil
	}
	remain := c.maxBytes - c.written
	if int64(len(p)) > remain {
		p = p[:remain]
	}
	n, err := c.w.Write(p)
	c.written += int64(n)
	return n, err
}
