package runner

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// VerifyVerdict is the fail-closed result of a DevCouncil post-run gate.
type VerifyVerdict struct {
	Passed        bool     `json:"passed"`
	BlockingGaps  []string `json:"blockingGaps,omitempty"`
	Raw           string   `json:"raw,omitempty"`
	CLIAvailable  bool     `json:"cliAvailable"`
	ExitCode      int      `json:"exitCode,omitempty"`
	Error         string   `json:"error,omitempty"`
}

type verifyTaskResult struct {
	TaskID           string `json:"task_id"`
	Status           string `json:"status"`
	BlockingGapCount int    `json:"blocking_gap_count"`
	Gaps             []struct {
		Description string `json:"description"`
		Blocking    bool   `json:"blocking"`
	} `json:"gaps"`
}

type verifyOutput struct {
	OK    bool               `json:"ok"`
	Tasks []verifyTaskResult `json:"tasks"`
	Error string             `json:"error"`
}

func resolveDevCLI() string {
	for _, name := range []string{"dev", "devcouncil"} {
		if path, err := exec.LookPath(name); err == nil && strings.TrimSpace(path) != "" {
			return path
		}
	}
	return ""
}

func extractJSONObject(raw string) string {
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start < 0 || end <= start {
		return ""
	}
	return raw[start : end+1]
}

// RunDevVerifyGate shells to `dev verify --json` and fails closed on parse or
// non-zero exit when blocking gaps are present.
func RunDevVerifyGate(cwd, taskID string) VerifyVerdict {
	cli := resolveDevCLI()
	if cli == "" {
		// Fail closed when verify was requested but the CLI is missing —
		// skipping would mark gated runs as passed without evidence.
		return VerifyVerdict{
			Passed:       false,
			CLIAvailable: false,
			Error:        "DevCouncil CLI not found — verify gate failed closed",
		}
	}
	args := []string{"verify", "--json", "--project-root", cwd}
	if strings.TrimSpace(taskID) != "" {
		args = append(args, taskID)
	}
	cmd := exec.Command(cli, args...)
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	raw := strings.TrimSpace(string(out))
	exitCode := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exitCode = ee.ExitCode()
		}
	}
	jsonBody := extractJSONObject(raw)
	if jsonBody == "" {
		return VerifyVerdict{
			Passed:       false,
			CLIAvailable: true,
			ExitCode:     exitCode,
			Raw:          raw,
			Error:        "verify output contained no JSON",
		}
	}
	var parsed verifyOutput
	if err := json.Unmarshal([]byte(jsonBody), &parsed); err != nil {
		return VerifyVerdict{
			Passed:       false,
			CLIAvailable: true,
			ExitCode:     exitCode,
			Raw:          raw,
			Error:        fmt.Sprintf("verify JSON parse failed: %v", err),
		}
	}
	blocking := make([]string, 0)
	for _, task := range parsed.Tasks {
		for _, gap := range task.Gaps {
			if gap.Blocking {
				desc := strings.TrimSpace(gap.Description)
				if desc == "" {
					desc = "blocking gap"
				}
				blocking = append(blocking, desc)
			}
		}
		if task.BlockingGapCount > 0 && len(blocking) == 0 {
			blocking = append(blocking, fmt.Sprintf("task %s has %d blocking gap(s)", task.TaskID, task.BlockingGapCount))
		}
	}
	passed := exitCode == 0 && parsed.OK && len(blocking) == 0
	return VerifyVerdict{
		Passed:       passed,
		BlockingGaps: blocking,
		Raw:          raw,
		CLIAvailable: true,
		ExitCode:     exitCode,
		Error:        parsed.Error,
	}
}
