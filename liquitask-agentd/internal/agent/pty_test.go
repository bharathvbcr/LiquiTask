//go:build unix

package agent

import (
	"bytes"
	"io"
	"os/exec"
	"runtime"
	"testing"
)

func TestPtyTeeReader(t *testing.T) {
	var captured bytes.Buffer
	r := &ptyTeeReader{
		src:      bytes.NewReader([]byte("hello")),
		onOutput: func(p []byte) { captured.Write(p) },
	}
	buf := make([]byte, 8)
	n, err := io.ReadFull(r, buf[:5])
	if err != nil {
		t.Fatal(err)
	}
	if n != 5 || string(buf[:5]) != "hello" {
		t.Fatalf("read = %q", buf[:5])
	}
	if captured.String() != "hello" {
		t.Fatalf("tee = %q", captured.String())
	}
}

func TestAttachProcessIO_PipeFallback(t *testing.T) {
	cmd := exec.Command("echo", "ok")
	pio, err := AttachProcessIO(cmd, "hermes", ExecOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if pio.ProcessStarted {
		t.Fatal("pipe mode should not pre-start")
	}
	if pio.PtyMaster != nil {
		t.Fatal("pipe mode should not expose PTY master")
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(pio.Stdout)
	if err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	if !bytes.Contains(out, []byte("ok")) {
		t.Fatalf("stdout = %q", out)
	}
}

func TestAttachProcessIO_PtyEcho(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("PTY attach is unix-only in this phase")
	}
	shell := "/bin/sh"
	if _, err := exec.LookPath(shell); err != nil {
		t.Skip("no /bin/sh")
	}
	cmd := exec.Command(shell, "-c", "echo pty-ok")
	pio, err := AttachProcessIO(cmd, "claude", ExecOptions{
		PtyEnabled: true,
		OnPtyOutput: func(p []byte) {},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !pio.ProcessStarted {
		t.Fatal("PTY mode should start the process")
	}
	if pio.PtyMaster == nil {
		t.Fatal("expected PTY master")
	}
	out, err := io.ReadAll(pio.Stdout)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(out, []byte("pty-ok")) {
		t.Fatalf("stdout = %q", out)
	}
}
