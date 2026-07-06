package daemon

import "testing"

func TestListLocalSkills_UnknownProviderReturnsEmpty(t *testing.T) {
	skills, err := ListLocalSkills("not-a-real-provider")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(skills) != 0 {
		t.Fatalf("expected empty slice for unsupported provider, got %d", len(skills))
	}
}

func TestListLocalSkills_EmptyProviderSweepsAll(t *testing.T) {
	// No assertion on count (depends on the machine's installed skills), just
	// that sweeping all providers doesn't error and returns a valid (possibly
	// empty) slice.
	skills, err := ListLocalSkills("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if skills == nil {
		t.Fatal("expected a non-nil slice even when no skills are found")
	}
}

func TestListLocalSkills_KnownProviderDoesNotError(t *testing.T) {
	skills, err := ListLocalSkills("claude")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if skills == nil {
		t.Fatal("expected a non-nil slice")
	}
}
