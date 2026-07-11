package runner

import "testing"

func TestRunQueueEnqueueRelease(t *testing.T) {
	q := newRunQueue(t.TempDir())

	pos, err := q.enqueue(QueueEntry{TaskID: "task-1", AgentID: "agent-1", RunID: "run-q"})
	if err != nil || pos != 1 {
		t.Fatalf("enqueue = %d, err = %v", pos, err)
	}
	if err := q.acquire("agent-1", "run-active", 0); err != nil {
		t.Fatal(err)
	}
	busy, runID, err := q.isAgentBusy("agent-1")
	if err != nil || !busy || runID != "run-active" {
		t.Fatalf("busy = %v, runID = %q, err = %v", busy, runID, err)
	}

	next, err := q.release("agent-1")
	if err != nil {
		t.Fatal(err)
	}
	if next == nil || next.TaskID != "task-1" {
		t.Fatalf("next = %+v", next)
	}
	state, err := q.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Queue) != 0 || len(state.ActiveByAgent) != 0 {
		t.Fatalf("expected empty queue state: %+v", state)
	}
}

func TestRunQueueRemove(t *testing.T) {
	q := newRunQueue(t.TempDir())
	_, _ = q.enqueue(QueueEntry{TaskID: "task-1", AgentID: "agent-1"})
	ok, err := q.remove("task-1", "", "")
	if err != nil || !ok {
		t.Fatalf("remove = %v, err = %v", ok, err)
	}
	state, _ := q.list()
	if len(state.Queue) != 0 {
		t.Fatalf("queue not empty: %+v", state.Queue)
	}
}

func TestRunQueueConcurrentCap(t *testing.T) {
	q := newRunQueue(t.TempDir())

	if err := q.acquire("agent-1", "run-1", 2); err != nil {
		t.Fatal(err)
	}
	if err := q.acquire("agent-2", "run-2", 2); err != nil {
		t.Fatal(err)
	}
	err := q.acquire("agent-3", "run-3", 2)
	if err == nil {
		t.Fatal("expected acquire to fail at concurrent cap")
	}
	ok, checkErr := q.canAcquire(2)
	if checkErr != nil || ok {
		t.Fatalf("canAcquire = %v, err = %v", ok, checkErr)
	}
}

func TestRunQueueScrubStaleActives(t *testing.T) {
	q := newRunQueue(t.TempDir())
	if err := q.acquire("agent-1", "run-dead", 0); err != nil {
		t.Fatal(err)
	}
	if err := q.scrubStaleActives(func(runID string) bool { return false }); err != nil {
		t.Fatal(err)
	}
	state, err := q.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.ActiveByAgent) != 0 {
		t.Fatalf("expected stale active cleared: %+v", state.ActiveByAgent)
	}
}

func TestRunQueuePersistsAcrossReload(t *testing.T) {
	dir := t.TempDir()
	q1 := newRunQueue(dir)
	_, err := q1.enqueue(QueueEntry{TaskID: "task-1", AgentID: "agent-1", RunID: "run-1"})
	if err != nil {
		t.Fatal(err)
	}
	q2 := newRunQueue(dir)
	state, err := q2.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Queue) != 1 || state.Queue[0].RunID != "run-1" {
		t.Fatalf("unexpected reloaded queue: %+v", state.Queue)
	}
}
