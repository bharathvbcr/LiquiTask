package board

import "testing"

func TestFindTask(t *testing.T) {
	snap := &Snapshot{
		Tasks: []Task{
			{ID: "t1", JobID: "TSK-1001", Title: "Fix login bug", Status: "Task"},
		},
	}
	task, err := FindTask(snap, "TSK-1001")
	if err != nil || task.ID != "t1" {
		t.Fatalf("FindTask by job: %+v err=%v", task, err)
	}
	task2, err := FindTask(snap, "Fix login")
	if err != nil || task2.ID != "t1" {
		t.Fatalf("FindTask by title: %+v err=%v", task2, err)
	}
}

func TestListTasksByColumn(t *testing.T) {
	snap := &Snapshot{
		Columns: []Column{{ID: "InProgress", Title: "In Progress"}},
		Tasks: []Task{
			{ID: "t1", Status: "InProgress", Title: "A"},
			{ID: "t2", Status: "Task", Title: "B"},
		},
	}
	got := ListTasks(snap, "In Progress")
	if len(got) != 1 || got[0].ID != "t1" {
		t.Fatalf("ListTasks: %+v", got)
	}
}
