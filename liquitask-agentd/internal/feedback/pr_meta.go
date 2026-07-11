package feedback

import (
	"encoding/json"
	"fmt"
	"strings"
)

// PrMeta is the PR lifecycle snapshot from `gh pr view`.
type PrMeta struct {
	PrNumber          int64  `json:"prNumber"`
	State             string `json:"state"` // OPEN | CLOSED | MERGED
	IsDraft           bool   `json:"isDraft"`
	ReviewDecision    string `json:"reviewDecision,omitempty"`
	StatusCheckRollup struct {
		State string `json:"state"` // SUCCESS | FAILURE | PENDING | ...
	} `json:"statusCheckRollup"`
}

// PollPRMeta shells to `gh pr view` for PR lifecycle state.
func PollPRMeta(prURL string, repoDir *string) (*PrMeta, error) {
	prNumber, err := parsePRNumber(prURL)
	if err != nil {
		return nil, err
	}
	num := fmt.Sprintf("%d", prNumber)
	raw, err := ghCmd(repoDir, "pr", "view", num, "--json", "state,isDraft,reviewDecision,statusCheckRollup")
	if err != nil {
		return nil, err
	}
	var meta PrMeta
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return nil, fmt.Errorf("parse gh pr view: %w", err)
	}
	meta.PrNumber = prNumber
	return &meta, nil
}

// NormalizePRState maps gh state + draft flag to app-facing state strings.
func NormalizePRState(meta *PrMeta) string {
	if meta == nil {
		return ""
	}
	up := strings.ToUpper(strings.TrimSpace(meta.State))
	if up == "MERGED" {
		return "merged"
	}
	if up == "CLOSED" {
		return "closed"
	}
	if meta.IsDraft {
		return "draft"
	}
	if up == "OPEN" {
		return "open"
	}
	return strings.ToLower(meta.State)
}

// NormalizeReviewDecision maps gh reviewDecision to app-facing strings.
func NormalizeReviewDecision(decision string) string {
	switch strings.ToUpper(strings.TrimSpace(decision)) {
	case "APPROVED":
		return "approved"
	case "CHANGES_REQUESTED":
		return "changes_requested"
	case "COMMENTED":
		return "commented"
	case "REVIEW_REQUIRED", "PENDING", "":
		return "pending"
	default:
		return strings.ToLower(decision)
	}
}

// NormalizeCIRollup maps statusCheckRollup.state to coarse CI buckets.
func NormalizeCIRollup(state string) string {
	up := strings.ToUpper(strings.TrimSpace(state))
	switch {
	case strings.Contains(up, "SUCCESS"):
		return "success"
	case strings.Contains(up, "FAIL"), up == "ERROR":
		return "failure"
	case strings.Contains(up, "PEND"), up == "IN_PROGRESS", up == "QUEUED":
		return "pending"
	default:
		return strings.ToLower(state)
	}
}
