package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/liquitask/liquitask-agentd/internal/client"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
	"github.com/liquitask/liquitask-agentd/internal/runner"
)

// Config holds CLI runtime options.
type Config struct {
	DataDir string
	JSON    bool
}

// DefaultDataDir resolves the agentd data directory.
func DefaultDataDir() string {
	return rpc.DefaultDataDir()
}

// List returns active, completed, and queued runs grouped by status.
func List(cfg Config) error {
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()

	rawRuns, err := c.Call("run.reattach", nil)
	if err != nil {
		return err
	}
	var runs []runnerReattach
	if err := json.Unmarshal(rawRuns, &runs); err != nil {
		return fmt.Errorf("decode runs: %w", err)
	}

	rawQueue, err := c.Call("queue.list", nil)
	if err != nil {
		return err
	}
	var queue runner.QueueState
	if err := json.Unmarshal(rawQueue, &queue); err != nil {
		return fmt.Errorf("decode queue: %w", err)
	}

	grouped := groupRunsByStatus(runs, queue)
	if cfg.JSON {
		return emitJSON(os.Stdout, grouped)
	}
	return printList(grouped)
}

// Status summarizes run counts and token usage from the journal.
func Status(cfg Config) error {
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()

	rawRuns, err := c.Call("run.reattach", nil)
	if err != nil {
		return err
	}
	var runs []runnerReattach
	if err := json.Unmarshal(rawRuns, &runs); err != nil {
		return err
	}

	rawQueue, err := c.Call("queue.list", nil)
	if err != nil {
		return err
	}
	var queue runner.QueueState
	if err := json.Unmarshal(rawQueue, &queue); err != nil {
		return err
	}

	summary := buildStatusSummary(cfg.DataDir, runs, queue)
	if cfg.JSON {
		return emitJSON(os.Stdout, summary)
	}
	return printStatus(summary)
}

// Show prints metadata for one run.
func Show(cfg Config, runID string) error {
	if runID == "" {
		return fmt.Errorf("run id required")
	}
	detail, err := loadRunDetail(cfg.DataDir, runID)
	if err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, detail)
	}
	return printShow(detail)
}

// Transcript tails stdout.ndjson for a run.
func Transcript(cfg Config, runID string, tail int) error {
	if runID == "" {
		return fmt.Errorf("run id required")
	}
	lines, err := readStdoutLines(cfg.DataDir, runID)
	if err != nil {
		return err
	}
	if tail > 0 && len(lines) > tail {
		lines = lines[len(lines)-tail:]
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, map[string]any{"runId": runID, "lines": lines})
	}
	for _, line := range lines {
		fmt.Println(line)
	}
	return nil
}

// Logs returns log-level events from stdout.ndjson.
func Logs(cfg Config, runID string, tail int) error {
	if runID == "" {
		return fmt.Errorf("run id required")
	}
	lines, err := readStdoutLines(cfg.DataDir, runID)
	if err != nil {
		return err
	}
	var logs []string
	for _, line := range lines {
		var ev runner.RunEvent
		if err := json.Unmarshal([]byte(line), &ev); err != nil {
			continue
		}
		if ev.Kind == runner.EventLog || ev.Level != "" {
			logs = append(logs, line)
		}
	}
	if tail > 0 && len(logs) > tail {
		logs = logs[len(logs)-tail:]
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, map[string]any{"runId": runID, "logs": logs})
	}
	for _, line := range logs {
		fmt.Println(line)
	}
	return nil
}

// Send injects guidance into a live run.
func Send(cfg Config, runID, message string) error {
	if runID == "" || message == "" {
		return fmt.Errorf("run id and message required")
	}
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()
	result, err := c.Call("run.inject", map[string]string{
		"runId":    runID,
		"guidance": message,
	})
	if err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, json.RawMessage(result))
	}
	fmt.Println("guidance sent")
	return nil
}

// Interrupt cancels a live run.
func Interrupt(cfg Config, runID string) error {
	if runID == "" {
		return fmt.Errorf("run id required")
	}
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()
	result, err := c.Call("run.cancel", map[string]string{"runId": runID})
	if err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, json.RawMessage(result))
	}
	fmt.Println("interrupt sent")
	return nil
}

// PermissionRespond approves or denies a pending permission request.
func PermissionRespond(cfg Config, runID, requestID, decision string) error {
	if runID == "" || requestID == "" {
		return fmt.Errorf("run id and request id required")
	}
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()
	result, err := c.Call("permission.respond", map[string]string{
		"runId":     runID,
		"requestId": requestID,
		"decision":  decision,
	})
	if err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, json.RawMessage(result))
	}
	fmt.Printf("%s recorded\n", decision)
	return nil
}

type runnerReattach struct {
	RunID     string `json:"runId"`
	TaskID    string `json:"taskId"`
	Runtime   string `json:"runtime"`
	Alive     bool   `json:"alive"`
	Status    string `json:"status"`
	SessionID string `json:"sessionId,omitempty"`
	Paused    bool   `json:"paused,omitempty"`
}

type listGroup struct {
	Status string           `json:"status"`
	Runs   []runnerReattach `json:"runs"`
}

type tokenTotals struct {
	InputTokens      int64 `json:"inputTokens"`
	OutputTokens     int64 `json:"outputTokens"`
	CacheReadTokens  int64 `json:"cacheReadTokens"`
	CacheWriteTokens int64 `json:"cacheWriteTokens"`
}

type statusSummary struct {
	Counts      map[string]int          `json:"counts"`
	Active      int                     `json:"active"`
	Queued      int                     `json:"queued"`
	UsageByModel map[string]tokenTotals `json:"usageByModel"`
}

type runDetail struct {
	RunID        string            `json:"runId"`
	TaskID       string            `json:"taskId,omitempty"`
	Runtime      string            `json:"runtime,omitempty"`
	Status       string            `json:"status,omitempty"`
	SessionID    string            `json:"sessionId,omitempty"`
	Paused       bool              `json:"paused,omitempty"`
	Alive        bool              `json:"alive,omitempty"`
	StartedAtMs  int64             `json:"startedAtMs,omitempty"`
	FinishedAtMs int64             `json:"finishedAtMs,omitempty"`
	PID          int               `json:"pid,omitempty"`
	WorktreePath string            `json:"worktreePath,omitempty"`
	Branch       string            `json:"branch,omitempty"`
	PrURL        string            `json:"prUrl,omitempty"`
	Meta         *runner.RunMeta   `json:"meta,omitempty"`
}

func groupRunsByStatus(runs []runnerReattach, queue runner.QueueState) []listGroup {
	byStatus := make(map[string][]runnerReattach)
	for _, r := range runs {
		status := r.Status
		if status == "" {
			status = "unknown"
		}
		byStatus[status] = append(byStatus[status], r)
	}
	for _, entry := range queue.Queue {
		byStatus["queued"] = append(byStatus["queued"], runnerReattach{
			RunID:  entry.RunID,
			TaskID: entry.TaskID,
			Status: "queued",
			Alive:  false,
		})
	}
	order := []string{"running", "paused", "queued", "completed", "failed", "cancelled"}
	var groups []listGroup
	seen := make(map[string]bool)
	for _, status := range order {
		if items, ok := byStatus[status]; ok && len(items) > 0 {
			sort.Slice(items, func(i, j int) bool { return items[i].RunID < items[j].RunID })
			groups = append(groups, listGroup{Status: status, Runs: items})
			seen[status] = true
		}
	}
	var rest []string
	for status := range byStatus {
		if !seen[status] {
			rest = append(rest, status)
		}
	}
	sort.Strings(rest)
	for _, status := range rest {
		items := byStatus[status]
		sort.Slice(items, func(i, j int) bool { return items[i].RunID < items[j].RunID })
		groups = append(groups, listGroup{Status: status, Runs: items})
	}
	return groups
}

func buildStatusSummary(dataDir string, runs []runnerReattach, queue runner.QueueState) statusSummary {
	counts := make(map[string]int)
	active := 0
	for _, r := range runs {
		status := r.Status
		if status == "" {
			status = "unknown"
		}
		counts[status]++
		if r.Alive || status == "running" {
			active++
		}
	}
	queued := len(queue.Queue)
	counts["queued"] = queued

	usage := aggregateUsage(dataDir)
	return statusSummary{
		Counts:       counts,
		Active:       active,
		Queued:       queued,
		UsageByModel: usage,
	}
}

func aggregateUsage(dataDir string) map[string]tokenTotals {
	runsDir := filepath.Join(dataDir, "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		return nil
	}
	out := make(map[string]tokenTotals)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		path := filepath.Join(runsDir, entry.Name(), "stdout.ndjson")
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line == "" {
				continue
			}
			var ev runner.RunEvent
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				continue
			}
			if ev.Kind != runner.EventResult || len(ev.Usage) == 0 {
				continue
			}
			for model, u := range ev.Usage {
				cur := out[model]
				cur.InputTokens += u.InputTokens
				cur.OutputTokens += u.OutputTokens
				cur.CacheReadTokens += u.CacheReadTokens
				cur.CacheWriteTokens += u.CacheWriteTokens
				out[model] = cur
			}
		}
	}
	return out
}

func loadRunDetail(dataDir, runID string) (*runDetail, error) {
	metaPath := filepath.Join(dataDir, "runs", runID, "meta.json")
	var meta runner.RunMeta
	metaBytes, metaErr := os.ReadFile(metaPath)
	if metaErr == nil {
		_ = json.Unmarshal(metaBytes, &meta)
	}

	detail := &runDetail{
		RunID:        runID,
		TaskID:       meta.TaskID,
		Runtime:      meta.Runtime,
		Status:       meta.Status,
		SessionID:    meta.SessionID,
		Paused:       meta.Paused,
		StartedAtMs:  meta.StartedAtMs,
		FinishedAtMs: meta.FinishedAtMs,
		PID:          meta.PID,
		Meta:         &meta,
	}

	c, err := client.Dial(dataDir)
	if err == nil {
		defer c.Close()
		raw, callErr := c.Call("run.reattach", nil)
		if callErr == nil {
			var runs []runnerReattach
			if json.Unmarshal(raw, &runs) == nil {
				for _, r := range runs {
					if r.RunID == runID {
						detail.Alive = r.Alive
						if r.Status != "" {
							detail.Status = r.Status
						}
						if r.TaskID != "" {
							detail.TaskID = r.TaskID
						}
						if r.Runtime != "" {
							detail.Runtime = r.Runtime
						}
						if r.SessionID != "" {
							detail.SessionID = r.SessionID
						}
						detail.Paused = r.Paused
						break
					}
				}
			}
		}
	}

	if wtPath, branch := discoverWorktree(runID); wtPath != "" {
		detail.WorktreePath = wtPath
		detail.Branch = branch
	}
	if detail.Meta != nil && metaErr != nil {
		detail.Meta = nil
	}
	if metaErr != nil && detail.Status == "" {
		return nil, fmt.Errorf("run %q not found", runID)
	}
	return detail, nil
}

func readStdoutLines(dataDir, runID string) ([]string, error) {
	path := filepath.Join(dataDir, "runs", runID, "stdout.ndjson")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read transcript: %w", err)
	}
	raw := strings.Split(string(data), "\n")
	var lines []string
	for _, line := range raw {
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines, nil
}

func emitJSON(w *os.File, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// EmitError writes a JSON error object for --json mode.
func EmitError(w *os.File, err error) error {
	return emitJSON(w, map[string]string{"error": err.Error()})
}

func printList(groups []listGroup) error {
	if len(groups) == 0 {
		fmt.Println("No runs.")
		return nil
	}
	for _, g := range groups {
		fmt.Printf("[%s]\n", strings.ToUpper(g.Status))
		for _, r := range g.Runs {
			line := fmt.Sprintf("  %s  task=%s", r.RunID, r.TaskID)
			if r.Runtime != "" {
				line += fmt.Sprintf("  runtime=%s", r.Runtime)
			}
			if r.Alive {
				line += "  (alive)"
			}
			if r.Paused {
				line += "  (paused)"
			}
			fmt.Println(line)
		}
	}
	return nil
}

func printStatus(s statusSummary) error {
	fmt.Printf("Active: %d  Queued: %d\n", s.Active, s.Queued)
	if len(s.Counts) > 0 {
		fmt.Println("Counts:")
		keys := make([]string, 0, len(s.Counts))
		for k := range s.Counts {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Printf("  %s: %d\n", k, s.Counts[k])
		}
	}
	if len(s.UsageByModel) > 0 {
		fmt.Println("Token usage:")
		models := make([]string, 0, len(s.UsageByModel))
		for m := range s.UsageByModel {
			models = append(models, m)
		}
		sort.Strings(models)
		for _, model := range models {
			u := s.UsageByModel[model]
			fmt.Printf("  %s: in=%d out=%d cache_read=%d cache_write=%d\n",
				model, u.InputTokens, u.OutputTokens, u.CacheReadTokens, u.CacheWriteTokens)
		}
	}
	return nil
}

func printShow(d *runDetail) error {
	fmt.Printf("Run: %s\n", d.RunID)
	if d.TaskID != "" {
		fmt.Printf("Task: %s\n", d.TaskID)
	}
	if d.Runtime != "" {
		fmt.Printf("Runtime: %s\n", d.Runtime)
	}
	if d.Status != "" {
		fmt.Printf("Status: %s\n", d.Status)
	}
	if d.Alive {
		fmt.Println("Alive: yes")
	}
	if d.Paused {
		fmt.Println("Paused: yes")
	}
	if d.SessionID != "" {
		fmt.Printf("Session: %s\n", d.SessionID)
	}
	if d.WorktreePath != "" {
		fmt.Printf("Worktree: %s\n", d.WorktreePath)
	}
	if d.Branch != "" {
		fmt.Printf("Branch: %s\n", d.Branch)
	}
	if d.PrURL != "" {
		fmt.Printf("PR: %s\n", d.PrURL)
	}
	if d.PID > 0 {
		fmt.Printf("PID: %d\n", d.PID)
	}
	return nil
}

// TraceList prints reversible trace steps for a run.
func TraceList(cfg Config, runID string) error {
	if runID == "" {
		return fmt.Errorf("run id required")
	}
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()
	raw, err := c.Call("trace.list", map[string]string{"runId": runID})
	if err != nil {
		return err
	}
	if cfg.JSON {
		var payload json.RawMessage = raw
		return emitJSON(os.Stdout, payload)
	}
	var result struct {
		RunID string `json:"runId"`
		Steps []struct {
			Index int    `json:"index"`
			Kind  string `json:"kind"`
			Label string `json:"label"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return err
	}
	if len(result.Steps) == 0 {
		fmt.Println("No trace steps.")
		return nil
	}
	for _, s := range result.Steps {
		fmt.Printf("%3d  %-14s  %s\n", s.Index, s.Kind, s.Label)
	}
	return nil
}
