//go:build windows

package rpc

import (
	"net"

	"github.com/Microsoft/go-winio"
)

func listenSocket(path string) (net.Listener, error) {
	// Restrict the named pipe to the current user (owner full access).
	return winio.ListenPipe(path, &winio.PipeConfig{
		SecurityDescriptor: "D:P(A;;GA;;;OW)",
	})
}
