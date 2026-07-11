package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"sync"
	"sync/atomic"
)

// Request is a JSON-RPC 2.0 request.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response is a JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string `json:"jsonrpc"`
	ID      any    `json:"id,omitempty"`
	Result  any    `json:"result,omitempty"`
	Error   *Error `json:"error,omitempty"`
}

// Notification is a JSON-RPC 2.0 notification (no id).
type Notification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

// Error is a JSON-RPC 2.0 error object.
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// Handler processes a request and returns a result or error.
type Handler func(params json.RawMessage) (any, *Error)

type clientConn struct {
	out   io.Writer
	outMu sync.Mutex
}

// Server is a newline-delimited JSON-RPC 2.0 server over stdio and/or sockets.
type Server struct {
	in       io.Reader
	out      io.Writer
	outMu    sync.Mutex
	handlers map[string]Handler
	nextNot  atomic.Uint64

	clientsMu sync.RWMutex
	clients   []*clientConn
}

// NewServer starts a JSON-RPC server with a primary in/out pair (stdio or a single socket).
func NewServer(in io.Reader, out io.Writer) *Server {
	return &Server{
		in:       in,
		out:      out,
		handlers: make(map[string]Handler),
	}
}

// Register adds a method handler.
func (s *Server) Register(method string, h Handler) {
	s.handlers[method] = h
}

func (s *Server) addClient(out io.Writer) *clientConn {
	c := &clientConn{out: out}
	s.clientsMu.Lock()
	s.clients = append(s.clients, c)
	s.clientsMu.Unlock()
	return c
}

func (s *Server) removeClient(c *clientConn) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for i, existing := range s.clients {
		if existing == c {
			s.clients = append(s.clients[:i], s.clients[i+1:]...)
			return
		}
	}
}

// Notify sends a notification to all connected clients and the primary out.
func (s *Server) Notify(method string, params any) error {
	n := Notification{JSONRPC: "2.0", Method: method, Params: params}
	b, err := json.Marshal(n)
	if err != nil {
		return err
	}
	line := append(b, '\n')

	s.outMu.Lock()
	_, _ = s.out.Write(line)
	s.outMu.Unlock()

	s.clientsMu.RLock()
	clients := append([]*clientConn(nil), s.clients...)
	s.clientsMu.RUnlock()
	for _, c := range clients {
		c.outMu.Lock()
		_, _ = c.out.Write(line)
		c.outMu.Unlock()
	}
	return nil
}

// Run processes requests on the primary in reader until EOF.
func (s *Server) Run() error {
	return s.serveReader(s.in, nil)
}

// ServeConn handles one authenticated socket connection until it closes.
func (s *Server) ServeConn(conn net.Conn, dataDir string) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return
	}
	token, err := ParseAuthLine(line)
	if err != nil || !ValidateToken(dataDir, token) {
		_, _ = conn.Write([]byte(`{"error":"unauthorized"}` + "\n"))
		return
	}
	client := s.addClient(conn)
	defer s.removeClient(client)
	_ = s.serveReader(reader, client)
}

// ListenSocket binds the platform RPC listener and accepts connections.
func (s *Server) ListenSocket(dataDir string) (net.Listener, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if _, err := EnsureToken(dataDir); err != nil {
		return nil, err
	}
	return listenSocket(SocketPath(dataDir))
}

// AcceptLoop serves authenticated socket connections until the listener closes.
func (s *Server) AcceptLoop(ln net.Listener, dataDir string) {
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go s.ServeConn(conn, dataDir)
	}
}

func (s *Server) serveReader(in io.Reader, client *clientConn) error {
	sc := bufio.NewScanner(in)
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 16*1024*1024)

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			_ = s.writeTo(client, Response{
				JSONRPC: "2.0",
				Error:   &Error{Code: -32700, Message: "parse error", Data: err.Error()},
			})
			continue
		}
		if req.JSONRPC != "" && req.JSONRPC != "2.0" {
			_ = s.replyClient(client, req.ID, nil, &Error{Code: -32600, Message: "invalid request"})
			continue
		}
		h, ok := s.handlers[req.Method]
		if !ok {
			if req.ID != nil {
				_ = s.replyClient(client, req.ID, nil, &Error{Code: -32601, Message: "method not found: " + req.Method})
			}
			continue
		}
		result, rpcErr := h(req.Params)
		if req.ID == nil {
			continue
		}
		_ = s.replyClient(client, req.ID, result, rpcErr)
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("scan: %w", err)
	}
	return nil
}

func (s *Server) replyClient(client *clientConn, id any, result any, rpcErr *Error) error {
	resp := Response{JSONRPC: "2.0", ID: id}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return s.writeTo(client, resp)
}

func (s *Server) reply(id any, result any, rpcErr *Error) error {
	return s.replyClient(nil, id, result, rpcErr)
}

func (s *Server) write(v any) error {
	return s.writeTo(nil, v)
}

func (s *Server) writeTo(client *clientConn, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	line := append(b, '\n')
	if client != nil {
		client.outMu.Lock()
		defer client.outMu.Unlock()
		_, err = client.out.Write(line)
		return err
	}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	_, err = s.out.Write(line)
	return err
}

// Stdio constructs a server over os.Stdin/os.Stdout.
func Stdio() *Server {
	return NewServer(os.Stdin, os.Stdout)
}

// WritePIDFile records the daemon pid for connect-or-spawn probes.
func WritePIDFile(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(PIDPath(dataDir), []byte(fmt.Sprintf("%d\n", os.Getpid())), 0o600)
}

// RemovePIDFile clears the pidfile on shutdown.
func RemovePIDFile(dataDir string) {
	_ = os.Remove(PIDPath(dataDir))
}

// Must helpers
func ErrInvalidParams(msg string) *Error {
	return &Error{Code: -32602, Message: msg}
}

func ErrInternal(msg string) *Error {
	return &Error{Code: -32000, Message: msg}
}

func Err(msg string) *Error {
	return &Error{Code: -32000, Message: msg}
}

// ErrUnauthorized is returned for failed auth handshakes.
func ErrUnauthorized(msg string) *Error {
	return &Error{Code: -32001, Message: msg}
}

var _ = slog.Default
