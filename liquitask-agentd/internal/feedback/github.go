package feedback

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// PrCheck mirrors the GitHub PR check shape used by the app-side DLQ.
type PrCheck struct {
	Name     string `json:"name"`
	State    string `json:"state"`
	Bucket   string `json:"bucket,omitempty"`
	Link     string `json:"link,omitempty"`
	Workflow string `json:"workflow,omitempty"`
}

// PrChecksResult is returned by gh pr checks polling.
type PrChecksResult struct {
	PrNumber     int64     `json:"prNumber"`
	Checks       []PrCheck `json:"checks"`
	FailedCount  int       `json:"failedCount"`
	PendingCount int       `json:"pendingCount"`
	AllPassed    bool      `json:"allPassed"`
}

// ReviewComment mirrors GitHub PR review/inline comment payloads.
type ReviewComment struct {
	Author    string `json:"author"`
	Body      string `json:"body"`
	Path      string `json:"path,omitempty"`
	Line      *int64 `json:"line,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	URL       string `json:"url,omitempty"`
}

// ReviewCommentsResult is returned by gh pr view / comments polling.
type ReviewCommentsResult struct {
	PrNumber int64           `json:"prNumber"`
	Comments []ReviewComment `json:"comments"`
}

func ghCmd(repoDir *string, args ...string) (string, error) {
	cmd := exec.Command("gh", args...)
	if repoDir != nil && strings.TrimSpace(*repoDir) != "" {
		cmd.Dir = *repoDir
	}
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			msg := strings.TrimSpace(string(ee.Stderr))
			if msg == "" {
				msg = strings.TrimSpace(string(out))
			}
			return "", fmt.Errorf("%s", msg)
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func parsePRNumber(prURL string) (int64, error) {
	trimmed := strings.TrimSuffix(strings.TrimSpace(prURL), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) == 0 {
		return 0, fmt.Errorf("invalid PR URL: %s", prURL)
	}
	num, err := strconv.ParseInt(parts[len(parts)-1], 10, 64)
	if err != nil || num <= 0 {
		return 0, fmt.Errorf("invalid PR number in URL: %s", prURL)
	}
	return num, nil
}

func summarizeChecks(checks []PrCheck) (failed, pending int, allPassed bool) {
	for _, c := range checks {
		state := strings.ToUpper(c.State)
		switch {
		case strings.Contains(state, "FAIL") || state == "ERROR":
			failed++
		case strings.Contains(state, "PEND") || state == "IN_PROGRESS" || state == "QUEUED":
			pending++
		}
	}
	allPassed = len(checks) > 0 && failed == 0 && pending == 0
	return failed, pending, allPassed
}

// PollPRChecks shells to `gh pr checks` for a pull request.
func PollPRChecks(prURL string, repoDir *string) (*PrChecksResult, error) {
	prNumber, err := parsePRNumber(prURL)
	if err != nil {
		return nil, err
	}
	num := strconv.FormatInt(prNumber, 10)
	raw, err := ghCmd(repoDir, "pr", "checks", num, "--json", "name,state,bucket,link,workflow")
	if err != nil {
		return nil, err
	}
	var checks []PrCheck
	if err := json.Unmarshal([]byte(raw), &checks); err != nil {
		return nil, fmt.Errorf("parse gh pr checks: %w", err)
	}
	failed, pending, allPassed := summarizeChecks(checks)
	return &PrChecksResult{
		PrNumber:     prNumber,
		Checks:       checks,
		FailedCount:  failed,
		PendingCount: pending,
		AllPassed:    allPassed,
	}, nil
}

// PollPRReviewComments shells to `gh pr view` and inline comments API.
func PollPRReviewComments(prURL string, repoDir *string) (*ReviewCommentsResult, error) {
	prNumber, err := parsePRNumber(prURL)
	if err != nil {
		return nil, err
	}
	num := strconv.FormatInt(prNumber, 10)
	viewJSON, err := ghCmd(repoDir, "pr", "view", num, "--json", "reviews,comments")
	if err != nil {
		return nil, err
	}
	var view struct {
		Reviews  []struct {
			Body        string `json:"body"`
			SubmittedAt string `json:"submittedAt"`
			URL         string `json:"url"`
			Author      struct {
				Login string `json:"login"`
			} `json:"author"`
		} `json:"reviews"`
		Comments []struct {
			Body      string `json:"body"`
			CreatedAt string `json:"createdAt"`
			URL       string `json:"url"`
			Author    struct {
				Login string `json:"login"`
			} `json:"author"`
		} `json:"comments"`
	}
	if err := json.Unmarshal([]byte(viewJSON), &view); err != nil {
		return nil, fmt.Errorf("parse gh pr view: %w", err)
	}

	var comments []ReviewComment
	for _, review := range view.Reviews {
		body := strings.TrimSpace(review.Body)
		if body == "" {
			continue
		}
		author := review.Author.Login
		if author == "" {
			author = "reviewer"
		}
		comments = append(comments, ReviewComment{
			Author:    author,
			Body:      body,
			CreatedAt: review.SubmittedAt,
			URL:       review.URL,
		})
	}
	for _, c := range view.Comments {
		body := strings.TrimSpace(c.Body)
		if body == "" {
			continue
		}
		author := c.Author.Login
		if author == "" {
			author = "reviewer"
		}
		comments = append(comments, ReviewComment{
			Author:    author,
			Body:      body,
			CreatedAt: c.CreatedAt,
			URL:       c.URL,
		})
	}

	inlineJSON, err := ghCmd(repoDir, "api", fmt.Sprintf("repos/{owner}/{repo}/pulls/%s/comments", num), "--paginate")
	if err == nil && strings.TrimSpace(inlineJSON) != "" {
		var inline []struct {
			Body      string `json:"body"`
			Path      string `json:"path"`
			Line      *int64 `json:"line"`
			CreatedAt string `json:"created_at"`
			HTMLURL   string `json:"html_url"`
			User      struct {
				Login string `json:"login"`
			} `json:"user"`
		}
		if json.Unmarshal([]byte(inlineJSON), &inline) == nil {
			for _, c := range inline {
				body := strings.TrimSpace(c.Body)
				if body == "" {
					continue
				}
				author := c.User.Login
				if author == "" {
					author = "reviewer"
				}
				comments = append(comments, ReviewComment{
					Author:    author,
					Body:      body,
					Path:      c.Path,
					Line:      c.Line,
					CreatedAt: c.CreatedAt,
					URL:       c.HTMLURL,
				})
			}
		}
	}

	return &ReviewCommentsResult{PrNumber: prNumber, Comments: comments}, nil
}

func isFailedCheck(state string) bool {
	up := strings.ToUpper(state)
	return strings.Contains(up, "FAIL") || up == "ERROR"
}
