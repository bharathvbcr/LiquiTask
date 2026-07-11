package feedback

import "testing"

func TestParsePRNumber(t *testing.T) {
	num, err := parsePRNumber("https://github.com/acme/widgets/pull/42")
	if err != nil {
		t.Fatal(err)
	}
	if num != 42 {
		t.Fatalf("expected 42, got %d", num)
	}
}

func TestSummarizeChecks(t *testing.T) {
	checks := []PrCheck{
		{Name: "test", State: "SUCCESS"},
		{Name: "lint", State: "FAILURE"},
	}
	failed, pending, allPassed := summarizeChecks(checks)
	if failed != 1 || pending != 0 || allPassed {
		t.Fatalf("unexpected summary: failed=%d pending=%d allPassed=%v", failed, pending, allPassed)
	}
}

func TestReviewFingerprintStable(t *testing.T) {
	comments := []ReviewComment{{Author: "alice", Body: "Please add tests"}}
	a := reviewFingerprint(comments)
	b := reviewFingerprint(comments)
	if a != b {
		t.Fatalf("fingerprint not stable: %q vs %q", a, b)
	}
}

func TestUpdateWatchListFiltersIncompleteRuns(t *testing.T) {
	p := NewPoller(nil, nil)
	p.UpdateWatchList([]WatchedRun{
		{RunID: "r1", TaskID: "t1", PrURL: "https://github.com/a/b/pull/1", Status: "completed"},
		{RunID: "r2", TaskID: "t2", PrURL: "https://github.com/a/b/pull/2", Status: "running"},
		{RunID: "", TaskID: "t3", PrURL: "https://github.com/a/b/pull/3"},
	})
	p.mu.RLock()
	defer p.mu.RUnlock()
	if len(p.watched) != 1 {
		t.Fatalf("expected 1 watched run, got %d", len(p.watched))
	}
	if _, ok := p.watched["r1"]; !ok {
		t.Fatalf("expected r1 to be watched")
	}
}
