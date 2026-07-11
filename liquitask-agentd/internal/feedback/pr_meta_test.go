package feedback

import "testing"

func TestNormalizePRState(t *testing.T) {
	if got := NormalizePRState(&PrMeta{State: "MERGED"}); got != "merged" {
		t.Fatalf("expected merged, got %q", got)
	}
	if got := NormalizePRState(&PrMeta{State: "OPEN", IsDraft: true}); got != "draft" {
		t.Fatalf("expected draft, got %q", got)
	}
	if got := NormalizePRState(&PrMeta{State: "OPEN"}); got != "open" {
		t.Fatalf("expected open, got %q", got)
	}
}

func TestNormalizeReviewDecision(t *testing.T) {
	if got := NormalizeReviewDecision("CHANGES_REQUESTED"); got != "changes_requested" {
		t.Fatalf("unexpected: %q", got)
	}
}

func TestNormalizeCIRollup(t *testing.T) {
	if got := NormalizeCIRollup("SUCCESS"); got != "success" {
		t.Fatalf("unexpected: %q", got)
	}
	if got := NormalizeCIRollup("FAILURE"); got != "failure" {
		t.Fatalf("unexpected: %q", got)
	}
}
