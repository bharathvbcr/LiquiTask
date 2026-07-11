package client

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

func TestClientCall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket integration test")
	}

	dir := t.TempDir()
	srv := rpc.NewServer(os.Stdin, os.Stdout)
	srv.Register("echo", func(raw json.RawMessage) (any, *rpc.Error) {
		var p map[string]string
		_ = json.Unmarshal(raw, &p)
		return map[string]string{"msg": p["msg"]}, nil
	})

	ln, err := srv.ListenSocket(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go srv.AcceptLoop(ln, dir)

	waitForSocket(t, filepath.Join(dir, "agentd.sock"))

	c, err := Dial(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	raw, err := c.Call("echo", map[string]string{"msg": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]string
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out["msg"] != "hello" {
		t.Fatalf("unexpected result: %+v", out)
	}
}

func TestClientRejectsMissingToken(t *testing.T) {
	dir := t.TempDir()
	_, err := Dial(dir)
	if err == nil {
		t.Fatal("expected dial error without token file")
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
