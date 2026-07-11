package agent

import "os"

func osFindProcess(pid int) (*os.Process, error) {
	return os.FindProcess(pid)
}
