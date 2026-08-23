//go:build !windows

package agent

import "syscall"

const (
	SigKill = syscall.SIGKILL
	SigTerm = syscall.SIGTERM
	SigStop = syscall.SIGSTOP
	SigCont = syscall.SIGCONT
)

func KillProcess(pid int) {
	SignalProcess(pid, syscall.SIGKILL)
}

func StopProcess(pid int) {
	SignalProcess(pid, syscall.SIGSTOP)
}

func ResumeProcess(pid int) {
	SignalProcess(pid, syscall.SIGCONT)
}
