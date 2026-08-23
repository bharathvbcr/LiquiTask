//go:build windows

package agent

import "syscall"

const (
	SigKill syscall.Signal = 9
	SigTerm syscall.Signal = 15
	SigStop syscall.Signal = 19
	SigCont syscall.Signal = 18
)

func KillProcess(pid int) {
	SignalProcess(pid, SigKill)
}

func StopProcess(pid int) {
}

func ResumeProcess(pid int) {
}
