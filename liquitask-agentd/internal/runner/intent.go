package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

const (
	intentFile    = "intents.json"
	intentTmpFile = "intents.json.tmp"
)

// DispatchIntent is the durable dispatch record the daemon scheduler owns.
// The renderer registers intents; the daemon dequeues, verifies, retries, and
// follow-ups without TS-side orchestration.
type DispatchIntent struct {
	RunID       string `json:"runId"`
	LocalRunID  string `json:"localRunId,omitempty"`
	TaskID      string `json:"taskId"`
	AgentID     string `json:"agentId"`
	Runtime     string `json:"runtime,omitempty"`
	Cwd         string `json:"cwd,omitempty"`
	Prompt      string `json:"prompt,omitempty"`
	Model       string `json:"model,omitempty"`
	ResumeSessionID string `json:"resumeSessionId,omitempty"`

	DevCouncilVerify bool `json:"devCouncilVerify,omitempty"`
	MaxRetries       int  `json:"maxRetries,omitempty"`
	RetryCount       int  `json:"retryCount,omitempty"`

	AutoRepairCI             bool `json:"autoRepairCi,omitempty"`
	AutoRepairReview         bool `json:"autoRepairReview,omitempty"`
	AutoRepairMax            int  `json:"autoRepairMax,omitempty"`
	AutoRepairCIAttempts     int  `json:"autoRepairCiAttempts,omitempty"`
	AutoRepairReviewAttempts int  `json:"autoRepairReviewAttempts,omitempty"`

	PrURL     string `json:"prUrl,omitempty"`
	RepoDir   string `json:"repoDir,omitempty"`
	GitBranch string `json:"gitBranch,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	AgentdRunID string `json:"agentdRunId,omitempty"`
	Status    string `json:"status,omitempty"`

	StartParams *StartParams `json:"startParams,omitempty"`
}

type intentStore struct {
	path string
	mu   sync.Mutex
}

func newIntentStore(dataDir string) *intentStore {
	return &intentStore{path: filepath.Join(dataDir, intentFile)}
}

func (s *intentStore) load() (map[string]DispatchIntent, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]DispatchIntent), nil
		}
		return nil, err
	}
	var raw map[string]DispatchIntent
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if raw == nil {
		raw = make(map[string]DispatchIntent)
	}
	return raw, nil
}

func (s *intentStore) save(all map[string]DispatchIntent) error {
	data, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(s.path), intentTmpFile)
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func intentKey(intent DispatchIntent) string {
	if intent.RunID != "" {
		return intent.RunID
	}
	if intent.LocalRunID != "" {
		return intent.LocalRunID
	}
	return intent.TaskID + ":" + intent.AgentID
}

func (s *intentStore) set(intent DispatchIntent) error {
	key := intentKey(intent)
	if key == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.load()
	if err != nil {
		return err
	}
	all[key] = intent
	return s.save(all)
}

func (s *intentStore) get(runID string) (*DispatchIntent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.load()
	if err != nil {
		return nil, false, err
	}
	if intent, ok := all[runID]; ok {
		copy := intent
		return &copy, true, nil
	}
	for _, intent := range all {
		if intent.AgentdRunID == runID || intent.LocalRunID == runID {
			copy := intent
			return &copy, true, nil
		}
	}
	return nil, false, nil
}

func (s *intentStore) remove(runID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.load()
	if err != nil {
		return err
	}
	changed := false
	if _, ok := all[runID]; ok {
		delete(all, runID)
		changed = true
	}
	for key, intent := range all {
		if intent.AgentdRunID == runID || intent.LocalRunID == runID {
			delete(all, key)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return s.save(all)
}

func (s *intentStore) list() ([]DispatchIntent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.load()
	if err != nil {
		return nil, err
	}
	out := make([]DispatchIntent, 0, len(all))
	for _, intent := range all {
		out = append(out, intent)
	}
	return out, nil
}
