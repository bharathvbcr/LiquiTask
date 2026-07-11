package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/liquitask/liquitask-agentd/internal/board"
	"github.com/liquitask/liquitask-agentd/internal/client"
)

// BoardList prints tasks, optionally filtered by column.
func BoardList(cfg Config, column string) error {
	snap, err := board.Load("")
	if err != nil {
		return err
	}
	tasks := board.ListTasks(snap, column)
	reservations, _ := loadReservations(cfg)

	out := map[string]any{
		"exportedAt":   snap.ExportedAt,
		"tasks":        tasks,
		"reservations": reservations,
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, out)
	}
	if len(tasks) == 0 {
		fmt.Println("No tasks found.")
		return nil
	}
	for _, t := range tasks {
		fmt.Printf("%s  %-12s  %s  [%s]\n", t.JobID, t.Status, t.Title, t.Assignee)
	}
	if reservations != nil {
		fmt.Printf("\nActive scope reservations: %d\n", len(reservations))
	}
	return nil
}

// BoardShow prints one task card.
func BoardShow(cfg Config, taskRef string) error {
	snap, err := board.Load("")
	if err != nil {
		return err
	}
	task, err := board.FindTask(snap, taskRef)
	if err != nil {
		return err
	}
	reservations, _ := loadReservations(cfg)
	out := map[string]any{"task": task, "reservations": reservations}
	if cfg.JSON {
		return emitJSON(os.Stdout, out)
	}
	fmt.Printf("ID:       %s\n", task.ID)
	fmt.Printf("Job:      %s\n", task.JobID)
	fmt.Printf("Title:    %s\n", task.Title)
	fmt.Printf("Status:   %s\n", task.Status)
	fmt.Printf("Assignee: %s\n", task.Assignee)
	if task.Summary != "" {
		fmt.Printf("Summary:  %s\n", task.Summary)
	}
	return nil
}

// BoardCreate appends a task to the snapshot (meta-agent orchestration).
func BoardCreate(cfg Config, title, assignee, status string) error {
	snap, err := board.Load("")
	if err != nil {
		return err
	}
	id := fmt.Sprintf("task-cli-%d", len(snap.Tasks)+1)
	jobID := fmt.Sprintf("TSK-%04d", 9000+len(snap.Tasks))
	if status == "" {
		status = "Task"
	}
	task := board.Task{
		ID:       id,
		JobID:    jobID,
		Title:    title,
		Status:   status,
		Assignee: assignee,
		Summary:  title,
	}
	snap.Tasks = append(snap.Tasks, task)
	if err := writeSnapshot(snap); err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, task)
	}
	fmt.Printf("Created %s: %s\n", jobID, title)
	return nil
}

// BoardAssign sets task assignee in the snapshot.
func BoardAssign(cfg Config, taskRef, agentRef string) error {
	snap, err := board.Load("")
	if err != nil {
		return err
	}
	task, err := board.FindTask(snap, taskRef)
	if err != nil {
		return err
	}
	agent, err := board.FindAgent(snap, agentRef)
	if err != nil {
		// Allow raw assignee name when agent not in roster.
		task.Assignee = agentRef
	} else {
		task.Assignee = agent.Name
	}
	for i := range snap.Tasks {
		if snap.Tasks[i].ID == task.ID {
			snap.Tasks[i] = *task
			break
		}
	}
	if err := writeSnapshot(snap); err != nil {
		return err
	}
	if cfg.JSON {
		return emitJSON(os.Stdout, task)
	}
	fmt.Printf("Assigned %s to %s\n", task.JobID, task.Assignee)
	return nil
}

// BoardDispatch queues run.start for a task via agentd.
func BoardDispatch(cfg Config, taskRef string) error {
	snap, err := board.Load("")
	if err != nil {
		return err
	}
	task, err := board.FindTask(snap, taskRef)
	if err != nil {
		return err
	}
	agent, err := board.FindAgent(snap, task.Assignee)
	if err != nil {
		return fmt.Errorf("no agent for assignee %q: %w", task.Assignee, err)
	}
	if agent.Role == "reviewer" {
		return fmt.Errorf("reviewer agents cannot be dispatched for implementation work")
	}

	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return err
	}
	defer c.Close()

	reservations, _ := loadReservations(cfg)
	if reservations != nil {
		for _, r := range reservations {
			if r["taskId"] == task.ID {
				return fmt.Errorf("scope reservation held by run %v", r["runId"])
			}
		}
	}

	prompt := task.Summary
	if prompt == "" {
		prompt = task.Title
	}
	params := map[string]any{
		"taskId":  task.ID,
		"runtime": providerToRuntime(agent.Provider),
		"prompt":  prompt,
		"cwd":     agent.WorkingDir,
	}
	raw, err := c.Call("run.start", params)
	if err != nil {
		return err
	}
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	if cfg.JSON {
		return emitJSON(os.Stdout, map[string]any{"task": task, "agent": agent, "run": result})
	}
	fmt.Printf("Dispatched %s to %s\n", task.JobID, agent.Name)
	return nil
}

func providerToRuntime(provider string) string {
	switch strings.ToLower(provider) {
	case "claude-code":
		return "claude"
	default:
		return strings.ToLower(provider)
	}
}

func writeSnapshot(snap *board.Snapshot) error {
	path := board.DefaultSnapshotPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func loadReservations(cfg Config) ([]map[string]any, error) {
	c, err := client.Dial(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	raw, err := c.Call("reservation.list", nil)
	if err != nil {
		return nil, err
	}
	var state struct {
		Active []map[string]any `json:"active"`
	}
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	return state.Active, nil
}

// RunBoardCommand dispatches board subcommands.
func RunBoardCommand(cfg Config, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: liquitask board <list|show|create|assign|dispatch>")
	}
	switch args[0] {
	case "list":
		column := ""
		if len(args) > 1 {
			column = args[1]
		}
		return BoardList(cfg, column)
	case "show":
		if len(args) < 2 {
			return fmt.Errorf("usage: liquitask board show <task>")
		}
		return BoardShow(cfg, args[1])
	case "create":
		if len(args) < 2 {
			return fmt.Errorf("usage: liquitask board create <title> [assignee] [status]")
		}
		assignee := ""
		status := ""
		if len(args) > 2 {
			assignee = args[2]
		}
		if len(args) > 3 {
			status = args[3]
		}
		return BoardCreate(cfg, args[1], assignee, status)
	case "assign":
		if len(args) < 3 {
			return fmt.Errorf("usage: liquitask board assign <task> <agent>")
		}
		return BoardAssign(cfg, args[1], args[2])
	case "dispatch":
		if len(args) < 2 {
			return fmt.Errorf("usage: liquitask board dispatch <task>")
		}
		return BoardDispatch(cfg, args[1])
	default:
		return fmt.Errorf("unknown board command %q", args[0])
	}
}
