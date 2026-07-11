package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

const (
	queueFile    = "queue.json"
	queueTmpFile = "queue.json.tmp"
)

// QueueEntry is one waiting task for an agent slot.
type QueueEntry struct {
	TaskID       string `json:"taskId"`
	AgentID      string `json:"agentId"`
	RunID        string `json:"runId,omitempty"`
	EnqueuedAtMs int64  `json:"enqueuedAtMs"`
}

// QueueState is the durable supervisor queue snapshot.
type QueueState struct {
	ActiveByAgent map[string]string `json:"activeByAgent"`
	Queue         []QueueEntry      `json:"queue"`
}

type runQueue struct {
	path string
	mu   sync.Mutex
}

func newRunQueue(dataDir string) *runQueue {
	return &runQueue{path: filepath.Join(dataDir, queueFile)}
}

func (q *runQueue) load() (*QueueState, error) {
	data, err := os.ReadFile(q.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &QueueState{ActiveByAgent: make(map[string]string)}, nil
		}
		return nil, err
	}
	var state QueueState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state.ActiveByAgent == nil {
		state.ActiveByAgent = make(map[string]string)
	}
	return &state, nil
}

func (q *runQueue) save(state *QueueState) error {
	if state.ActiveByAgent == nil {
		state.ActiveByAgent = make(map[string]string)
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(q.path), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(q.path), queueTmpFile)
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, q.path)
}

func (q *runQueue) list() (*QueueState, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.load()
}

func (q *runQueue) enqueue(entry QueueEntry) (int, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	state, err := q.load()
	if err != nil {
		return 0, err
	}
	for _, existing := range state.Queue {
		if existing.TaskID == entry.TaskID && existing.AgentID == entry.AgentID {
			return queuePosition(state, entry.TaskID, entry.AgentID), nil
		}
	}
	if entry.EnqueuedAtMs == 0 {
		entry.EnqueuedAtMs = nowMs()
	}
	state.Queue = append(state.Queue, entry)
	if err := q.save(state); err != nil {
		return 0, err
	}
	return queuePosition(state, entry.TaskID, entry.AgentID), nil
}

func (q *runQueue) remove(taskID, agentID, runID string) (bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	state, err := q.load()
	if err != nil {
		return false, err
	}
	changed := false
	filtered := state.Queue[:0]
	for _, entry := range state.Queue {
		if (taskID != "" && entry.TaskID == taskID) ||
			(agentID != "" && entry.AgentID == agentID && taskID == "") ||
			(runID != "" && entry.RunID == runID) {
			changed = true
			continue
		}
		filtered = append(filtered, entry)
	}
	state.Queue = filtered
	if runID != "" {
		for agent, activeRun := range state.ActiveByAgent {
			if activeRun == runID {
				delete(state.ActiveByAgent, agent)
				changed = true
			}
		}
	}
	if !changed {
		return false, nil
	}
	return true, q.save(state)
}

func (q *runQueue) acquire(agentID, runID string, maxConcurrent int) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	state, err := q.load()
	if err != nil {
		return err
	}
	if existing, ok := state.ActiveByAgent[agentID]; ok {
		if existing == runID {
			return nil
		}
		return fmt.Errorf("agent %s is already active with run %s", agentID, existing)
	}
	if maxConcurrent > 0 && len(state.ActiveByAgent) >= maxConcurrent {
		return fmt.Errorf("max concurrent agent runs (%d) reached", maxConcurrent)
	}
	state.ActiveByAgent[agentID] = runID
	return q.save(state)
}

func (q *runQueue) release(agentID string) (*QueueEntry, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	state, err := q.load()
	if err != nil {
		return nil, err
	}
	delete(state.ActiveByAgent, agentID)
	next := dequeueForAgent(state, agentID)
	if err := q.save(state); err != nil {
		return nil, err
	}
	if next == nil {
		return nil, nil
	}
	entry := *next
	return &entry, nil
}

func (q *runQueue) isAgentBusy(agentID string) (bool, string, error) {
	state, err := q.list()
	if err != nil {
		return false, "", err
	}
	runID, ok := state.ActiveByAgent[agentID]
	return ok, runID, nil
}

func activeRunCount(state *QueueState) int {
	return len(state.ActiveByAgent)
}

func (q *runQueue) scrubStaleActives(isActive func(runID string) bool) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	state, err := q.load()
	if err != nil {
		return err
	}
	changed := false
	for agent, runID := range state.ActiveByAgent {
		if !isActive(runID) {
			delete(state.ActiveByAgent, agent)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return q.save(state)
}

func (q *runQueue) canAcquire(maxConcurrent int) (bool, error) {
	if maxConcurrent <= 0 {
		return true, nil
	}
	state, err := q.load()
	if err != nil {
		return false, err
	}
	return activeRunCount(state) < maxConcurrent, nil
}

func queuePosition(state *QueueState, taskID, agentID string) int {
	line := 0
	for _, entry := range state.Queue {
		if entry.AgentID != agentID {
			continue
		}
		line++
		if entry.TaskID == taskID {
			return line
		}
	}
	return 0
}

func dequeueForAgent(state *QueueState, agentID string) *QueueEntry {
	idx := -1
	for i, entry := range state.Queue {
		if entry.AgentID == agentID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil
	}
	entry := state.Queue[idx]
	state.Queue = append(state.Queue[:idx], state.Queue[idx+1:]...)
	return &entry
}

func queueLengthForAgent(state *QueueState, agentID string) int {
	n := 0
	for _, entry := range state.Queue {
		if entry.AgentID == agentID {
			n++
		}
	}
	return n
}
