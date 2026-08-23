package agent

import (
	"os/exec"
	"syscall"
	"time"
)

const defaultManagedWaitDelay = 10 * time.Second

// InstallManagedProcess configures cmd for daemon-managed lifecycle: own process
// group, group-wide SIGKILL on context cancellation, and a WaitDelay backstop so
// cmd.Wait() cannot hang forever on stuck pipe readers. waitDelay <= 0 selects
// the package default (10s).
func InstallManagedProcess(cmd *exec.Cmd, waitDelay time.Duration) {
	if cmd == nil {
		return
	}
	configureProcessGroup(cmd)
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			signalProcessGroup(cmd.Process, SigKill)
		}
		return nil
	}
	if waitDelay <= 0 {
		waitDelay = defaultManagedWaitDelay
	}
	cmd.WaitDelay = waitDelay
}

// SignalProcess sends sig to the process group led by pid (negative kill on
// unix), falling back to the single process when group signalling fails.
func SignalProcess(pid int, sig syscall.Signal) {
	if pid <= 0 {
		return
	}
	proc, err := osFindProcess(pid)
	if err != nil || proc == nil {
		return
	}
	signalProcessGroup(proc, sig)
}
