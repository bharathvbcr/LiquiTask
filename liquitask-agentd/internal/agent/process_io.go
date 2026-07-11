package agent

import (
	"io"
	"os/exec"
)

// OnPtyOutput receives raw PTY bytes for terminal streaming (tee side).
type OnPtyOutput func([]byte)

// ProcessIO holds stdout/stdin handles for an agent subprocess.
type ProcessIO struct {
	Stdout         io.ReadCloser
	Stdin          io.WriteCloser
	PtyMaster      io.ReadWriteCloser // non-nil in PTY mode — used for takeover input
	ProcessStarted bool               // true when pty.Start already launched cmd
}

// AttachProcessIO configures cmd stdout/stdin. When opts.PtyEnabled and the
// runtime supports PTY, the process is started under a pseudo-terminal and
// raw bytes are teed to opts.OnPtyOutput while remaining readable as stdout.
func AttachProcessIO(cmd *exec.Cmd, runtime string, opts ExecOptions) (*ProcessIO, error) {
	if opts.PtyEnabled && RuntimeSupportsPty(runtime) {
		return attachPtyIO(cmd, opts.OnPtyOutput)
	}
	return attachPipeIO(cmd)
}

func attachPipeIO(cmd *exec.Cmd) (*ProcessIO, error) {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		_ = stdout.Close()
		return nil, err
	}
	return &ProcessIO{Stdout: stdout, Stdin: stdin}, nil
}
