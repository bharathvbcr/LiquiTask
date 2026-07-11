package feedback

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"
)

const (
	ciPollInterval     = 90 * time.Second
	reviewPollInterval = 120 * time.Second
)

// WatchedRun is one PR the daemon should poll while the app is open or closed.
type WatchedRun struct {
	RunID     string `json:"runId"`
	TaskID    string `json:"taskId"`
	PrURL     string `json:"prUrl"`
	RepoDir   string `json:"repoDir,omitempty"`
	GitBranch string `json:"gitBranch,omitempty"`
	Status    string `json:"status,omitempty"`
}

// Event is emitted on feedback.event when CI fails or review comments arrive.
type Event struct {
	Kind    string         `json:"kind"`
	RunID   string         `json:"runId"`
	TaskID  string         `json:"taskId"`
	PrURL   string         `json:"prUrl,omitempty"`
	Payload map[string]any `json:"payload,omitempty"`
}

// Notifier delivers feedback events to connected RPC clients.
type Notifier interface {
	Notify(method string, params any) error
}

// Poller polls GitHub CI/review state for watched runs and emits events.
type Poller struct {
	logger     *slog.Logger
	notify     Notifier
	// OnEvent is an optional in-process hook (scheduler auto-repair).
	OnEvent func(Event)
	mu         sync.RWMutex
	watched    map[string]WatchedRun
	ciSeen     map[string]struct{}
	reviewSeen map[string]struct{}
	prStateSeen map[string]string
	ciRollupSeen map[string]string
	reviewDecisionSeen map[string]string
}

// NewPoller creates a background CI/review poller.
func NewPoller(logger *slog.Logger, notify Notifier) *Poller {
	if logger == nil {
		logger = slog.Default()
	}
	return &Poller{
		logger:             logger,
		notify:             notify,
		watched:            make(map[string]WatchedRun),
		ciSeen:             make(map[string]struct{}),
		reviewSeen:         make(map[string]struct{}),
		prStateSeen:          make(map[string]string),
		ciRollupSeen:         make(map[string]string),
		reviewDecisionSeen:   make(map[string]string),
	}
}

// UpdateWatchList replaces the set of runs to poll.
func (p *Poller) UpdateWatchList(runs []WatchedRun) {
	p.mu.Lock()
	defer p.mu.Unlock()
	next := make(map[string]WatchedRun, len(runs))
	for _, r := range runs {
		if r.RunID == "" || r.PrURL == "" {
			continue
		}
		if r.Status != "" && r.Status != "completed" {
			continue
		}
		next[r.RunID] = r
	}
	p.watched = next
}

// Start runs the poll loop until ctx is cancelled.
func (p *Poller) Start(ctx context.Context) {
	ticker := time.NewTicker(minDuration(ciPollInterval, reviewPollInterval))
	defer ticker.Stop()
	p.tick()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.tick()
		}
	}
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func (p *Poller) tick() {
	p.mu.RLock()
	runs := make([]WatchedRun, 0, len(p.watched))
	for _, r := range p.watched {
		runs = append(runs, r)
	}
	p.mu.RUnlock()

	for _, run := range runs {
		p.pollPRState(run)
		p.pollCI(run)
		p.pollReviews(run)
	}
}

func (p *Poller) pollPRState(run WatchedRun) {
	key := "pr:" + run.RunID
	var repoDir *string
	if run.RepoDir != "" {
		repoDir = &run.RepoDir
	}
	meta, err := PollPRMeta(run.PrURL, repoDir)
	if err != nil {
		return
	}
	state := NormalizePRState(meta)
	if state == "" {
		return
	}
	p.mu.Lock()
	prev, seen := p.prStateSeen[key]
	if seen && prev == state {
		p.mu.Unlock()
		return
	}
	p.prStateSeen[key] = state
	p.mu.Unlock()

	kind := "pr_state"
	switch state {
	case "open":
		kind = "pr_opened"
	case "merged":
		kind = "pr_merged"
	case "closed":
		kind = "pr_closed"
	case "draft":
		kind = "pr_draft"
	}

	p.emit(Event{
		Kind:   kind,
		RunID:  run.RunID,
		TaskID: run.TaskID,
		PrURL:  run.PrURL,
		Payload: map[string]any{
			"runId":          run.RunID,
			"taskId":         run.TaskID,
			"prUrl":          run.PrURL,
			"prNumber":       meta.PrNumber,
			"state":          state,
			"isDraft":        meta.IsDraft,
			"reviewDecision": NormalizeReviewDecision(meta.ReviewDecision),
			"ciRollup":       NormalizeCIRollup(meta.StatusCheckRollup.State),
		},
	})

	// Emit dedicated review/ci rollup transitions when they change.
	reviewDecision := NormalizeReviewDecision(meta.ReviewDecision)
	ciRollup := NormalizeCIRollup(meta.StatusCheckRollup.State)
	p.mu.Lock()
	prevReview := p.reviewDecisionSeen[key]
	prevCI := p.ciRollupSeen[key]
	if reviewDecision != "" && reviewDecision != prevReview {
		p.reviewDecisionSeen[key] = reviewDecision
		p.mu.Unlock()
		p.emit(Event{
			Kind:   "review_state",
			RunID:  run.RunID,
			TaskID: run.TaskID,
			PrURL:  run.PrURL,
			Payload: map[string]any{
				"runId":    run.RunID,
				"taskId":   run.TaskID,
				"prUrl":    run.PrURL,
				"prNumber": meta.PrNumber,
				"decision": reviewDecision,
			},
		})
	} else {
		p.mu.Unlock()
	}
	p.mu.Lock()
	if ciRollup != "" && ciRollup != prevCI {
		p.ciRollupSeen[key] = ciRollup
		p.mu.Unlock()
		p.emit(Event{
			Kind:   "ci_state",
			RunID:  run.RunID,
			TaskID: run.TaskID,
			PrURL:  run.PrURL,
			Payload: map[string]any{
				"runId":    run.RunID,
				"taskId":   run.TaskID,
				"prUrl":    run.PrURL,
				"prNumber": meta.PrNumber,
				"rollup":   ciRollup,
			},
		})
	} else {
		p.mu.Unlock()
	}
}

func (p *Poller) pollCI(run WatchedRun) {
	key := "ci:" + run.RunID
	var repoDir *string
	if run.RepoDir != "" {
		repoDir = &run.RepoDir
	}
	result, err := PollPRChecks(run.PrURL, repoDir)
	if err != nil {
		return
	}
	if result.PendingCount > 0 {
		return
	}
	if result.AllPassed || len(result.Checks) == 0 {
		p.mu.Lock()
		delete(p.ciSeen, key)
		p.mu.Unlock()
		return
	}
	if result.FailedCount == 0 {
		return
	}
	p.mu.Lock()
	if _, seen := p.ciSeen[key]; seen {
		p.mu.Unlock()
		return
	}
	p.ciSeen[key] = struct{}{}
	p.mu.Unlock()

	var failed []PrCheck
	for _, c := range result.Checks {
		if isFailedCheck(c.State) {
			failed = append(failed, c)
		}
	}
	p.emit(Event{
		Kind:   "ci_failed",
		RunID:  run.RunID,
		TaskID: run.TaskID,
		PrURL:  run.PrURL,
		Payload: map[string]any{
			"runId":        run.RunID,
			"taskId":       run.TaskID,
			"prUrl":        run.PrURL,
			"repoDir":      run.RepoDir,
			"gitBranch":    run.GitBranch,
			"failedChecks": failed,
			"prNumber":     result.PrNumber,
		},
	})
}

func (p *Poller) pollReviews(run WatchedRun) {
	key := "review:" + run.RunID
	var repoDir *string
	if run.RepoDir != "" {
		repoDir = &run.RepoDir
	}
	result, err := PollPRReviewComments(run.PrURL, repoDir)
	if err != nil {
		return
	}
	var fresh []ReviewComment
	for _, c := range result.Comments {
		if strings.TrimSpace(c.Body) == "" {
			continue
		}
		fresh = append(fresh, c)
	}
	if len(fresh) == 0 {
		return
	}
	fingerprint := reviewFingerprint(fresh)
	p.mu.Lock()
	if _, seen := p.reviewSeen[key+":"+fingerprint]; seen {
		p.mu.Unlock()
		return
	}
	p.reviewSeen[key+":"+fingerprint] = struct{}{}
	p.mu.Unlock()

	p.emit(Event{
		Kind:   "review_comments",
		RunID:  run.RunID,
		TaskID: run.TaskID,
		PrURL:  run.PrURL,
		Payload: map[string]any{
			"runId":    run.RunID,
			"taskId":   run.TaskID,
			"prUrl":    run.PrURL,
			"comments": fresh,
			"prNumber": result.PrNumber,
		},
	})
}

func (p *Poller) emit(ev Event) {
	if p.OnEvent != nil {
		p.OnEvent(ev)
	}
	if p.notify == nil {
		return
	}
	if err := p.notify.Notify("feedback.event", ev); err != nil {
		p.logger.Warn("feedback notify failed", "kind", ev.Kind, "runId", ev.RunID, "err", err)
	}
}

func reviewFingerprint(comments []ReviewComment) string {
	parts := make([]string, 0, len(comments))
	for _, c := range comments {
		body := c.Body
		if len(body) > 80 {
			body = body[:80]
		}
		parts = append(parts, c.Author+":"+body)
	}
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:8])
}
