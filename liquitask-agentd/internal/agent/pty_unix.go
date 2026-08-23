//go:build unix

package agent

import (
	"errors"
	"io"
	"os/exec"
	"syscall"

	"github.com/creack/pty"
)

func attachPtyIO(cmd *exec.Cmd, onOutput OnPtyOutput) (*ProcessIO, error) {
	master, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}
	reader := &ptyTeeReader{
		src:      master,
		onOutput: onOutput,
	}
	return &ProcessIO{
		Stdout:         reader,
		Stdin:          master,
		PtyMaster:      master,
		ProcessStarted: true,
	}, nil
}

// ptyTeeReader wraps the PTY master: every Read tees bytes to onOutput.
type ptyTeeReader struct {
	src      io.Reader
	onOutput OnPtyOutput
}

func (r *ptyTeeReader) Read(p []byte) (int, error) {
	n, err := r.src.Read(p)
	if n > 0 && r.onOutput != nil {
		// Copy because callers may reuse p across reads.
		chunk := make([]byte, n)
		copy(chunk, p[:n])
		r.onOutput(chunk)
	}
	// On Linux, closing the slave PTY causes master Read to return EIO (treated as EOF).
	if errors.Is(err, syscall.EIO) {
		err = io.EOF
	}
	return n, err
}

func (r *ptyTeeReader) Close() error {
	if c, ok := r.src.(io.Closer); ok {
		return c.Close()
	}
	return nil
}
