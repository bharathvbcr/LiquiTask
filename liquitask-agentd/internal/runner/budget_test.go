package runner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBudgetReserveAndRelease(t *testing.T) {
	dir := t.TempDir()
	store := newBudgetStore(dir)
	n1, err := store.reserveRun("agent-a")
	if err != nil {
		t.Fatal(err)
	}
	if n1 != 1 {
		t.Fatalf("expected 1 reservation, got %d", n1)
	}
	n2, err := store.reserveRun("agent-a")
	if err != nil {
		t.Fatal(err)
	}
	if n2 != 2 {
		t.Fatalf("expected 2 reservations, got %d", n2)
	}
	if err := store.releaseRun("agent-a"); err != nil {
		t.Fatal(err)
	}
	count, err := store.reservedCount("agent-a")
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("expected 1 after release, got %d", count)
	}
	if _, err := os.ReadFile(filepath.Join(dir, budgetFile)); err != nil {
		t.Fatalf("ledger not persisted: %v", err)
	}
}
