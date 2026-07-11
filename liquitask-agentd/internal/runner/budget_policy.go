package runner

import "fmt"

func checkSpawnBudget(p StartParams, reservedCount int) error {
	effective := p.TodayRunCount
	if reservedCount > effective {
		effective = reservedCount
	}
	if p.MaxRunsPerDay > 0 && effective >= p.MaxRunsPerDay {
		return fmt.Errorf("max runs per day (%d) reached (%d started today)", p.MaxRunsPerDay, effective)
	}
	if p.DailyCostCapUsd > 0 && p.TodaySpendUsd >= p.DailyCostCapUsd {
		return fmt.Errorf("daily cost cap $%.2f exceeded ($%.2f spent today)", p.DailyCostCapUsd, p.TodaySpendUsd)
	}
	if p.PerRunCostCapUsd > 0 && p.TodaySpendUsd+p.PerRunCostCapUsd > p.DailyCostCapUsd && p.DailyCostCapUsd > 0 {
		// Conservative: reject when this run's cap would exceed the remaining daily headroom.
		remaining := p.DailyCostCapUsd - p.TodaySpendUsd
		if remaining < p.PerRunCostCapUsd {
			return fmt.Errorf("insufficient daily budget headroom for per-run cap $%.2f", p.PerRunCostCapUsd)
		}
	}
	return nil
}
