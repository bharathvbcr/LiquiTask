package rpc

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// AuthLine is the first NDJSON line a socket client must send.
type AuthLine struct {
	Auth string `json:"auth"`
}

// EnsureToken creates or reads the daemon RPC token (0600).
func EnsureToken(dataDir string) (string, error) {
	path := TokenPath(dataDir)
	if data, err := os.ReadFile(path); err == nil {
		token := strings.TrimSpace(string(data))
		if token != "" {
			return token, nil
		}
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return "", err
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(token+"\n"), 0o600); err != nil {
		return "", err
	}
	return token, nil
}

// ReadToken reads the RPC auth token from disk.
func ReadToken(dataDir string) (string, error) {
	data, err := os.ReadFile(TokenPath(dataDir))
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(string(data))
	if token == "" {
		return "", fmt.Errorf("empty token file")
	}
	return token, nil
}

// ValidateToken compares a client token to the on-disk secret.
func ValidateToken(dataDir, clientToken string) bool {
	expected, err := ReadToken(dataDir)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.TrimSpace(clientToken))) == 1
}

// ParseAuthLine unmarshals the first client line as an auth handshake.
func ParseAuthLine(line []byte) (string, error) {
	var msg AuthLine
	if err := json.Unmarshal(line, &msg); err != nil {
		return "", err
	}
	if strings.TrimSpace(msg.Auth) == "" {
		return "", fmt.Errorf("missing auth token")
	}
	return msg.Auth, nil
}
