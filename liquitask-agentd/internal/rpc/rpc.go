package rpc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
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

// Server is a newline-delimited JSON-RPC 2.0 server over stdio.
type Server struct {
	in       io.Reader
	out      io.Writer
	outMu    sync.Mutex
	handlers map[string]Handler
	nextNot  atomic.Uint64
}

// NewServer starts a stdio JSON-RPC server.
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

// Notify sends a notification to the client.
func (s *Server) Notify(method string, params any) error {
	n := Notification{JSONRPC: "2.0", Method: method, Params: params}
	return s.write(n)
}

// Run processes requests until EOF.
func (s *Server) Run() error {
	sc := bufio.NewScanner(s.in)
	// 16 MiB max line — agent events can be large.
	buf := make([]byte, 0, 64*1024)
	sc.Buffer(buf, 16*1024*1024)

	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			_ = s.write(Response{
				JSONRPC: "2.0",
				Error:   &Error{Code: -32700, Message: "parse error", Data: err.Error()},
			})
			continue
		}
		if req.JSONRPC != "" && req.JSONRPC != "2.0" {
			_ = s.reply(req.ID, nil, &Error{Code: -32600, Message: "invalid request"})
			continue
		}
		h, ok := s.handlers[req.Method]
		if !ok {
			if req.ID != nil {
				_ = s.reply(req.ID, nil, &Error{Code: -32601, Message: "method not found: " + req.Method})
			}
			continue
		}
		// Notifications (no id) and requests both invoke the handler.
		result, rpcErr := h(req.Params)
		if req.ID == nil {
			continue
		}
		_ = s.reply(req.ID, result, rpcErr)
	}
	if err := sc.Err(); err != nil {
		return fmt.Errorf("scan: %w", err)
	}
	return nil
}

func (s *Server) reply(id any, result any, rpcErr *Error) error {
	resp := Response{JSONRPC: "2.0", ID: id}
	if rpcErr != nil {
		resp.Error = rpcErr
	} else {
		resp.Result = result
	}
	return s.write(resp)
}

func (s *Server) write(v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	_, err = s.out.Write(append(b, '\n'))
	return err
}

// Stdio constructs a server over os.Stdin/os.Stdout.
func Stdio() *Server {
	return NewServer(os.Stdin, os.Stdout)
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
