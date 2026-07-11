package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	budgetFile    = "budget-ledger.json"
	budgetTmpFile = "budget-ledger.json.tmp"
)

// BudgetLedger tracks per-agent daily run reservations to close the TOCTOU
// window between renderer pre-check and sidecar spawn.
type BudgetLedger struct {
	AgentID     string  `json:"agentId"`
	DayKey      string  `json:"dayKey"`
	Reserved    int     `json:"reserved"`
	SpendUsd    float64 `json:"spendUsd"`
	UpdatedAtMs int64   `json:"updatedAtMs"`
}

type budgetStore struct {
	path string
	mu   sync.Mutex
}

func newBudgetStore(dataDir string) *budgetStore {
	return &budgetStore{path: filepath.Join(dataDir, budgetFile)}
}

func localDayKey() string {
	now := time.Now()
	return fmt.Sprintf("%04d-%02d-%02d", now.Year(), int(now.Month()), now.Day())
}

func (s *budgetStore) load() (map[string]BudgetLedger, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]BudgetLedger), nil
		}
		return nil, err
	}
	var state map[string]BudgetLedger
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state == nil {
		state = make(map[string]BudgetLedger)
	}
	return state, nil
}

func (s *budgetStore) save(state map[string]BudgetLedger) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(s.path), budgetTmpFile)
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// reserveRun atomically increments today's reserved run count for agentID.
// Returns the post-reservation count.
func (s *budgetStore) reserveRun(agentID string) (int, error) {
	if agentID == "" {
		return 0, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return 0, err
	}
	day := localDayKey()
	entry := state[agentID]
	if entry.DayKey != day {
		entry = BudgetLedger{AgentID: agentID, DayKey: day}
	}
	entry.Reserved++
	entry.UpdatedAtMs = nowMs()
	state[agentID] = entry
	if err := s.save(state); err != nil {
		return 0, err
	}
	return entry.Reserved, nil
}

// releaseRun decrements a reservation when spawn is rejected after reserve.
func (s *budgetStore) releaseRun(agentID string) error {
	if agentID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load()
	if err != nil {
		return err
	}
	entry, ok := state[agentID]
	if !ok || entry.DayKey != localDayKey() || entry.Reserved <= 0 {
		return nil
	}
	entry.Reserved--
	entry.UpdatedAtMs = nowMs()
	state[agentID] = entry
	return s.save(state)
}

func (s *budgetStore) reservedCount(agentID string) (int, error) {
	state, err := s.load()
	if err != nil {
		return 0, err
	}
	entry, ok := state[agentID]
	if !ok || entry.DayKey != localDayKey() {
		return 0, nil
	}
	return entry.Reserved, nil
}
