//go:build windows

package agent

import "os/exec"

// ConPTY attach is deferred; fall back to pipe mode on Windows.
func attachPtyIO(cmd *exec.Cmd, _ OnPtyOutput) (*ProcessIO, error) {
	return attachPipeIO(cmd)
}
