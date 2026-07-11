package cli_test

import (
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/cli"
	"github.com/liquitask/liquitask-agentd/internal/rpc"
	"github.com/liquitask/liquitask-agentd/internal/runner"
)

func TestCLIListJSON(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket integration test")
	}

	dir := t.TempDir()
	srv := rpc.NewServer(os.Stdin, os.Stdout)
	mgr := runner.New(srv, dir)
	srv.Register("run.reattach", mgr.HandleReattach)
	srv.Register("queue.list", mgr.HandleQueueList)

	ln, err := srv.ListenSocket(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go srv.AcceptLoop(ln, dir)

	waitForSocket(t, filepath.Join(dir, "agentd.sock"))

	cfg := cli.Config{DataDir: dir, JSON: true}
	if err := cli.List(cfg); err != nil {
		t.Fatal(err)
	}
}

func waitForSocket(t *testing.T, sockPath string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var err error
	for time.Now().Before(deadline) {
		var conn net.Conn
		conn, err = net.Dial("unix", sockPath)
		if err == nil {
			_ = conn.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("socket not ready: %v", err)
}
