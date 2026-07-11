// Package client is a JSON-RPC 2.0 client for the liquitask-agentd supervisor socket.
package client

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"runtime"
	"sync"
	"sync/atomic"

	"github.com/liquitask/liquitask-agentd/internal/rpc"
)

// Client talks to agentd over the authenticated NDJSON socket.
type Client struct {
	conn   net.Conn
	reader *bufio.Reader
	mu     sync.Mutex
	nextID atomic.Uint64
}

// Dial connects to the supervisor at dataDir using the on-disk auth token.
func Dial(dataDir string) (*Client, error) {
	token, err := rpc.ReadToken(dataDir)
	if err != nil {
		return nil, fmt.Errorf("read token: %w", err)
	}
	sock := rpc.SocketPath(dataDir)
	network := "unix"
	if runtime.GOOS == "windows" {
		network = "pipe"
	}
	conn, err := net.Dial(network, sock)
	if err != nil {
		return nil, fmt.Errorf("connect %s: %w", sock, err)
	}
	authLine, err := json.Marshal(map[string]string{"auth": token})
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if _, err := conn.Write(append(authLine, '\n')); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("auth write: %w", err)
	}
	return &Client{
		conn:   conn,
		reader: bufio.NewReader(conn),
	}, nil
}

// Close ends the socket session.
func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// Call invokes a JSON-RPC method and returns the result payload.
func (c *Client) Call(method string, params any) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	id := c.nextID.Add(1)
	var rawParams json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		rawParams = b
	}
	req := rpc.Request{JSONRPC: "2.0", ID: id, Method: method, Params: rawParams}
	line, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	if _, err := c.conn.Write(append(line, '\n')); err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}

	for {
		respLine, err := c.reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				return nil, fmt.Errorf("connection closed waiting for response")
			}
			return nil, fmt.Errorf("read response: %w", err)
		}
		if len(respLine) == 0 {
			continue
		}
		var resp rpc.Response
		if err := json.Unmarshal(respLine, &resp); err != nil {
			continue
		}
		if resp.ID == nil {
			continue
		}
		switch v := resp.ID.(type) {
		case float64:
			if uint64(v) != id {
				continue
			}
		case json.Number:
			n, _ := v.Int64()
			if uint64(n) != id {
				continue
			}
		default:
			continue
		}
		if resp.Error != nil {
			return nil, fmt.Errorf("%s (code %d)", resp.Error.Message, resp.Error.Code)
		}
		return json.Marshal(resp.Result)
	}
}
