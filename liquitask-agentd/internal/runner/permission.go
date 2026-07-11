package runner

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/agent"
)

const permissionRespondTimeout = 5 * time.Minute

type pendingPermission struct {
	ch          chan agent.PermissionDecision
	inputDigest string
}

type permissionBroker struct {
	mu       sync.Mutex
	pending  map[string]map[string]*pendingPermission // runID -> requestID -> ch
	autoDeny time.Duration
}

func newPermissionBroker() *permissionBroker {
	return &permissionBroker{
		pending:  make(map[string]map[string]*pendingPermission),
		autoDeny: permissionRespondTimeout,
	}
}

func (b *permissionBroker) registerPrompt(runID string, req agent.PermissionRequest) (<-chan agent.PermissionDecision, error) {
	if runID == "" || req.RequestID == "" {
		return nil, fmt.Errorf("invalid permission request")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.pending[runID] == nil {
		b.pending[runID] = make(map[string]*pendingPermission)
	}
	if _, exists := b.pending[runID][req.RequestID]; exists {
		return nil, fmt.Errorf("duplicate permission request %s", req.RequestID)
	}
	pp := &pendingPermission{ch: make(chan agent.PermissionDecision, 1), inputDigest: req.InputDigest}
	b.pending[runID][req.RequestID] = pp
	return pp.ch, nil
}

func (b *permissionBroker) respond(runID, requestID, decision, inputDigest string) error {
	b.mu.Lock()
	runPending := b.pending[runID]
	pp := runPending[requestID]
	if pp != nil {
		if pp.inputDigest != "" && inputDigest != "" && pp.inputDigest != inputDigest {
			b.mu.Unlock()
			return fmt.Errorf("permission input digest mismatch")
		}
		delete(runPending, requestID)
		if len(runPending) == 0 {
			delete(b.pending, runID)
		}
	}
	b.mu.Unlock()
	if pp == nil {
		return fmt.Errorf("permission request not found")
	}

	var out agent.PermissionDecision
	switch decision {
	case "allow", "approve":
		out = agent.PermissionDecision{Allowed: true}
	case "always", "approve_for_session":
		out = agent.PermissionDecision{Allowed: true, Always: true}
	case "deny", "reject":
		out = agent.PermissionDecision{Allowed: false, DeniedReason: "denied by user"}
	default:
		return fmt.Errorf("unknown decision %q", decision)
	}
	select {
	case pp.ch <- out:
	default:
	}
	return nil
}

func (b *permissionBroker) clearRun(runID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, pp := range b.pending[runID] {
		select {
		case pp.ch <- agent.PermissionDecision{Allowed: false, DeniedReason: "run ended"}:
		default:
		}
	}
	delete(b.pending, runID)
}

func (b *permissionBroker) unregisterPrompt(runID, requestID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	runPending := b.pending[runID]
	if runPending == nil {
		return
	}
	pp, ok := runPending[requestID]
	if !ok {
		return
	}
	select {
	case pp.ch <- agent.PermissionDecision{Allowed: false, DeniedReason: "permission request timed out"}:
	default:
	}
	delete(runPending, requestID)
	if len(runPending) == 0 {
		delete(b.pending, runID)
	}
}

func (m *Manager) awaitPermission(ctx context.Context, runID string, req agent.PermissionRequest) (agent.PermissionDecision, error) {
	ch, err := m.perms.registerPrompt(runID, req)
	if err != nil {
		return agent.PermissionDecision{}, err
	}

	m.emit(runID, RunEvent{
		RunID:       runID,
		Kind:        EventPermissionRequest,
		Tool:        req.Tool,
		CallID:      req.RequestID,
		Input:       req.Input,
		InputDigest: req.InputDigest,
		Text:        req.Title,
	})

	waitCtx := ctx
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		waitCtx, cancel = context.WithTimeout(ctx, m.perms.autoDeny)
		defer cancel()
	}

	select {
	case decision := <-ch:
		return decision, nil
	case <-waitCtx.Done():
		m.perms.unregisterPrompt(runID, req.RequestID)
		return agent.PermissionDecision{Allowed: false, DeniedReason: "permission request timed out"}, waitCtx.Err()
	}
}

func (m *Manager) permissionPromptFor(runID string) agent.PermissionPromptFunc {
	return func(ctx context.Context, req agent.PermissionRequest) (agent.PermissionDecision, error) {
		return m.awaitPermission(ctx, runID, req)
	}
}
