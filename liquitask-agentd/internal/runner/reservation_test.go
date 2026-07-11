package runner

import "testing"

func TestScopeReservationClaimRelease(t *testing.T) {
	r := newScopeReservation(t.TempDir())

	ok, conflict, pos, err := r.claim("run-1", "task-1", []string{"src/services"}, true)
	if err != nil || !ok || conflict != nil || pos != 0 {
		t.Fatalf("claim run-1 = ok:%v conflict:%v pos:%d err:%v", ok, conflict, pos, err)
	}

	ok, conflict, pos, err = r.claim("run-2", "task-2", []string{"src/services/foo.ts"}, true)
	if err != nil || ok || conflict == nil || pos != 1 {
		t.Fatalf("claim run-2 queued = ok:%v conflict:%+v pos:%d err:%v", ok, conflict, pos, err)
	}

	next, err := r.release("run-1")
	if err != nil || next == nil || next.RunID != "run-2" {
		t.Fatalf("release run-1 next = %+v err:%v", next, err)
	}

	state, err := r.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Active) != 1 || state.Active[0].RunID != "run-2" {
		t.Fatalf("active after promote: %+v", state.Active)
	}
	if len(state.Waiting) != 0 {
		t.Fatalf("waiting should be empty: %+v", state.Waiting)
	}
}

func TestScopeReservationNoQueueConflict(t *testing.T) {
	r := newScopeReservation(t.TempDir())
	_, _, _, _ = r.claim("run-1", "task-1", []string{"crates/"}, true)

	ok, conflict, _, err := r.claim("run-2", "task-2", []string{"crates/liquitask-core"}, false)
	if err != nil || ok || conflict == nil {
		t.Fatalf("expected immediate conflict: ok=%v conflict=%+v err=%v", ok, conflict, err)
	}
}

func TestPathsOverlap(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"src/foo.ts", "src/foo.ts", true},
		{"src", "src/services", true},
		{"src/services", "src/foo.ts", true},
		{"crates", "src", false},
		{"**", "src/foo.ts", true},
	}
	for _, tc := range cases {
		if got := pathsOverlap(tc.a, tc.b); got != tc.want {
			t.Errorf("pathsOverlap(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestScopeReservationScrubStale(t *testing.T) {
	r := newScopeReservation(t.TempDir())
	_, _, _, _ = r.claim("run-dead", "task-1", []string{"src/"}, true)
	if err := r.scrubStale(func(runID string) bool { return runID != "run-dead" }); err != nil {
		t.Fatal(err)
	}
	state, _ := r.list()
	if len(state.Active) != 0 {
		t.Fatalf("expected stale scrubbed: %+v", state.Active)
	}
}
