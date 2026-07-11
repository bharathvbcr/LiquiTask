package rpc

import (
	"os"
	"path/filepath"
	"runtime"
)

const (
	socketFileName = "agentd.sock"
	pipeName       = `\\.\pipe\liquitask-agentd`
	tokenFileName  = "token"
	pidFileName    = "agentd.pid"
)

// DefaultDataDir returns ~/.liquitask/agentd (or LIQUITASK_AGENTD_DATA).
func DefaultDataDir() string {
	if dir := os.Getenv("LIQUITASK_AGENTD_DATA"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "liquitask-agentd")
	}
	return filepath.Join(home, ".liquitask", "agentd")
}

// SocketPath returns the platform-specific RPC listen address.
// Unix: filesystem socket path. Windows: named pipe path.
func SocketPath(dataDir string) string {
	if runtime.GOOS == "windows" {
		return pipeName
	}
	return filepath.Join(dataDir, socketFileName)
}

// TokenPath returns the RPC auth token file path.
func TokenPath(dataDir string) string {
	return filepath.Join(dataDir, tokenFileName)
}

// PIDPath returns the daemon pidfile path.
func PIDPath(dataDir string) string {
	return filepath.Join(dataDir, pidFileName)
}
