package runner

import "testing"

func TestCheckSpawnBudgetBlocksMaxRuns(t *testing.T) {
	p := StartParams{MaxRunsPerDay: 2, TodayRunCount: 1}
	if err := checkSpawnBudget(p, 2); err == nil {
		t.Fatal("expected max runs error")
	}
}

func TestCheckSpawnBudgetAllowsUnderCap(t *testing.T) {
	p := StartParams{MaxRunsPerDay: 5, TodayRunCount: 2}
	if err := checkSpawnBudget(p, 3); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
