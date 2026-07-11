package rpc

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestSocketRPCAuthAndRequest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket integration test")
	}

	dir := t.TempDir()
	srv := NewServer(os.Stdin, os.Stdout)
	srv.Register("ping", func(raw json.RawMessage) (any, *Error) {
		return map[string]string{"pong": "ok"}, nil
	})

	ln, err := srv.ListenSocket(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go srv.AcceptLoop(ln, dir)

	token, err := EnsureToken(dir)
	if err != nil {
		t.Fatal(err)
	}

	sockPath := filepath.Join(dir, socketFileName)
	var conn net.Conn
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conn, err = net.Dial("unix", sockPath)
		if err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if conn == nil {
		t.Fatalf("dial socket: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Write([]byte(`{"auth":"` + token + `"}` + "\n")); err != nil {
		t.Fatal(err)
	}
	req, _ := json.Marshal(Request{JSONRPC: "2.0", ID: 1, Method: "ping"})
	if _, err := conn.Write(append(req, '\n')); err != nil {
		t.Fatal(err)
	}

	sc := bufio.NewScanner(conn)
	if !sc.Scan() {
		t.Fatal("no response")
	}
	var resp Response
	if err := json.Unmarshal(sc.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Error != nil || resp.Result == nil {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestSocketRejectsBadAuth(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket integration test")
	}

	dir := t.TempDir()
	srv := NewServer(os.Stdin, os.Stdout)
	ln, err := srv.ListenSocket(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go srv.AcceptLoop(ln, dir)
	if _, err := EnsureToken(dir); err != nil {
		t.Fatal(err)
	}

	conn, err := net.Dial("unix", filepath.Join(dir, socketFileName))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := conn.Write([]byte(`{"auth":"bad"}` + "\n")); err != nil {
		t.Fatal(err)
	}
	sc := bufio.NewScanner(conn)
	if !sc.Scan() {
		t.Fatal("expected unauthorized response")
	}
	if sc.Text() == "" {
		t.Fatal("empty unauthorized response")
	}
}
