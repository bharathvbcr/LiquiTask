//go:build !darwin && !linux

package agent

import (
	"fmt"
	"os/exec"
	"runtime"
)

func applyPlatformSandbox(cmd *exec.Cmd, profile sandboxProfileInput) error {
	_ = cmd
	_ = profile
	return fmt.Errorf("OS sandbox (sandboxMode=os) is not supported on %s", runtime.GOOS)
}
