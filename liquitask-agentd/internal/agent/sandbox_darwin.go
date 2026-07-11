//go:build darwin

package agent

import (
	"os/exec"
)

func applyPlatformSandbox(cmd *exec.Cmd, profile sandboxProfileInput) error {
	sandboxExec, err := sandboxExecPath()
	if err != nil {
		return err
	}
	profilePath, cleanup, err := writeSandboxProfileFile(profile)
	if err != nil {
		return err
	}
	// Profile file lives until process start; cleaned up by the OS on temp dir removal.
	_ = cleanup

	origPath := cmd.Path
	origArgs := append([]string(nil), cmd.Args...)
	if len(origArgs) == 0 {
		origArgs = []string{origPath}
	}
	innerArgs := origArgs[1:]

	cmd.Path = sandboxExec
	cmd.Args = append([]string{sandboxExec, "-f", profilePath, "--", origPath}, innerArgs...)
	return nil
}
