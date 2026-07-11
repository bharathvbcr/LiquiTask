package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	reservationFile    = "reservations.json"
	reservationTmpFile = "reservations.json.tmp"
)

// ReservationEntry is an active scope hold for one run.
type ReservationEntry struct {
	RunID       string   `json:"runId"`
	TaskID      string   `json:"taskId"`
	Paths       []string `json:"paths"`
	ClaimedAtMs int64    `json:"claimedAtMs"`
}

// ReservationWaitEntry is a run waiting for overlapping scope to be released.
type ReservationWaitEntry struct {
	RunID        string   `json:"runId"`
	TaskID       string   `json:"taskId"`
	Paths        []string `json:"paths"`
	EnqueuedAtMs int64    `json:"enqueuedAtMs"`
}

// ReservationState is the durable scope reservation snapshot.
type ReservationState struct {
	Active  []ReservationEntry     `json:"active"`
	Waiting []ReservationWaitEntry `json:"waiting"`
}

// ReservationConflict describes an overlapping active holder.
type ReservationConflict struct {
	RunID  string   `json:"runId"`
	TaskID string   `json:"taskId"`
	Paths  []string `json:"paths"`
	Overlap []string `json:"overlap"`
}

type scopeReservation struct {
	path string
	mu   sync.Mutex
}

func newScopeReservation(dataDir string) *scopeReservation {
	return &scopeReservation{path: filepath.Join(dataDir, reservationFile)}
}

func (r *scopeReservation) load() (*ReservationState, error) {
	data, err := os.ReadFile(r.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &ReservationState{}, nil
		}
		return nil, err
	}
	var state ReservationState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	return &state, nil
}

func (r *scopeReservation) save(state *ReservationState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(filepath.Dir(r.path), reservationTmpFile)
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}

func (r *scopeReservation) list() (*ReservationState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.load()
}

func normalizeScopePath(path string) string {
	p := strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	p = strings.Trim(p, "/")
	if p == "" || p == "**" || p == "*" {
		return "**"
	}
	if strings.HasSuffix(p, "/") {
		return strings.TrimSuffix(p, "/")
	}
	return p
}

func pathsOverlap(a, b string) bool {
	na := normalizeScopePath(a)
	nb := normalizeScopePath(b)
	if na == "**" || nb == "**" {
		return true
	}
	if na == nb {
		return true
	}
	if strings.HasPrefix(na, nb+"/") || strings.HasPrefix(nb, na+"/") {
		return true
	}
	// Conservative: same top-level directory counts as overlap (directory-level heuristic).
	partsA := strings.Split(na, "/")
	partsB := strings.Split(nb, "/")
	if len(partsA) > 0 && len(partsB) > 0 && partsA[0] != "" && partsA[0] == partsB[0] {
		return true
	}
	return globOverlap(na, nb)
}

func globOverlap(a, b string) bool {
	if !strings.ContainsAny(a, "*?") && !strings.ContainsAny(b, "*?") {
		return false
	}
	// Conservative: any glob touching a directory prefix counts as overlap.
	if strings.Contains(a, "*") || strings.Contains(b, "*") {
		segA := strings.Split(a, "/")[0]
		segB := strings.Split(b, "/")[0]
		if segA != "" && segB != "" && (segA == segB || segA == "**" || segB == "**") {
			return true
		}
	}
	return a == b || b == a
}

func reservationOverlap(requested, held []string) []string {
	out := make([]string, 0)
	seen := make(map[string]struct{})
	for _, req := range requested {
		for _, h := range held {
			if pathsOverlap(req, h) {
				key := normalizeScopePath(req) + "|" + normalizeScopePath(h)
				if _, ok := seen[key]; ok {
					continue
				}
				seen[key] = struct{}{}
				out = append(out, req)
			}
		}
	}
	return out
}

func findConflict(state *ReservationState, runID string, paths []string) *ReservationConflict {
	for _, active := range state.Active {
		if active.RunID == runID {
			continue
		}
		overlap := reservationOverlap(paths, active.Paths)
		if len(overlap) > 0 {
			return &ReservationConflict{
				RunID:   active.RunID,
				TaskID:  active.TaskID,
				Paths:   append([]string(nil), active.Paths...),
				Overlap: overlap,
			}
		}
	}
	return nil
}

func (r *scopeReservation) claim(runID, taskID string, paths []string, queueOnConflict bool) (bool, *ReservationConflict, int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state, err := r.load()
	if err != nil {
		return false, nil, 0, err
	}
	norm := normalizePaths(paths)
	if len(norm) == 0 {
		norm = []string{"**"}
	}

	// Idempotent re-claim for the same run.
	for i, active := range state.Active {
		if active.RunID == runID {
			state.Active[i].TaskID = taskID
			state.Active[i].Paths = norm
			if err := r.save(state); err != nil {
				return false, nil, 0, err
			}
			return true, nil, 0, nil
		}
	}

	if conflict := findConflict(state, runID, norm); conflict != nil {
		if !queueOnConflict {
			return false, conflict, 0, nil
		}
		for _, w := range state.Waiting {
			if w.RunID == runID {
				pos := waitPosition(state, runID)
				return false, conflict, pos, nil
			}
		}
		state.Waiting = append(state.Waiting, ReservationWaitEntry{
			RunID:        runID,
			TaskID:       taskID,
			Paths:        norm,
			EnqueuedAtMs: nowMs(),
		})
		if err := r.save(state); err != nil {
			return false, nil, 0, err
		}
		return false, conflict, waitPosition(state, runID), nil
	}

	state.Active = append(state.Active, ReservationEntry{
		RunID:       runID,
		TaskID:      taskID,
		Paths:       norm,
		ClaimedAtMs: nowMs(),
	})
	if err := r.save(state); err != nil {
		return false, nil, 0, err
	}
	return true, nil, 0, nil
}

func normalizePaths(paths []string) []string {
	out := make([]string, 0, len(paths))
	seen := make(map[string]struct{})
	for _, p := range paths {
		n := normalizeScopePath(p)
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		out = append(out, n)
	}
	return out
}

func waitPosition(state *ReservationState, runID string) int {
	pos := 0
	for _, w := range state.Waiting {
		pos++
		if w.RunID == runID {
			return pos
		}
	}
	return 0
}

func (r *scopeReservation) release(runID string) (*ReservationWaitEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state, err := r.load()
	if err != nil {
		return nil, err
	}
	changed := false
	filtered := state.Active[:0]
	for _, active := range state.Active {
		if active.RunID == runID {
			changed = true
			continue
		}
		filtered = append(filtered, active)
	}
	state.Active = filtered

	// Drop any wait-list row for this run — caller cancelled or finished without claiming.
	waitFiltered := state.Waiting[:0]
	for _, w := range state.Waiting {
		if w.RunID == runID {
			changed = true
			continue
		}
		waitFiltered = append(waitFiltered, w)
	}
	state.Waiting = waitFiltered

	var next *ReservationWaitEntry
	for i, w := range state.Waiting {
		if findConflict(state, w.RunID, w.Paths) != nil {
			continue
		}
		entry := w
		state.Active = append(state.Active, ReservationEntry{
			RunID:       entry.RunID,
			TaskID:      entry.TaskID,
			Paths:       append([]string(nil), entry.Paths...),
			ClaimedAtMs: nowMs(),
		})
		state.Waiting = append(state.Waiting[:i], state.Waiting[i+1:]...)
		next = &entry
		changed = true
		break
	}

	if !changed {
		return nil, nil
	}
	if err := r.save(state); err != nil {
		return nil, err
	}
	return next, nil
}

func (r *scopeReservation) scrubStale(isActive func(runID string) bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	state, err := r.load()
	if err != nil {
		return err
	}
	changed := false
	filtered := state.Active[:0]
	for _, active := range state.Active {
		if isActive(active.RunID) {
			filtered = append(filtered, active)
		} else {
			changed = true
		}
	}
	state.Active = filtered
	waitFiltered := state.Waiting[:0]
	for _, w := range state.Waiting {
		if isActive(w.RunID) {
			waitFiltered = append(waitFiltered, w)
		} else {
			changed = true
		}
	}
	state.Waiting = waitFiltered
	if !changed {
		return nil
	}
	return r.save(state)
}

func (r *scopeReservation) checkOverlap(paths []string, excludeRunID string) *ReservationConflict {
	state, err := r.load()
	if err != nil {
		return nil
	}
	norm := normalizePaths(paths)
	if len(norm) == 0 {
		norm = []string{"**"}
	}
	return findConflict(state, excludeRunID, norm)
}

func reservationPathsLabel(paths []string) string {
	if len(paths) == 0 {
		return "(whole repo)"
	}
	if len(paths) <= 2 {
		return strings.Join(paths, ", ")
	}
	return fmt.Sprintf("%s +%d more", paths[0], len(paths)-1)
}
