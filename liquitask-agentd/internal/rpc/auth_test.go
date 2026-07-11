package rpc

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureTokenCreatesAndReuses(t *testing.T) {
	dir := t.TempDir()
	token1, err := EnsureToken(dir)
	if err != nil {
		t.Fatal(err)
	}
	token2, err := EnsureToken(dir)
	if err != nil {
		t.Fatal(err)
	}
	if token1 == "" || token1 != token2 {
		t.Fatalf("token mismatch: %q vs %q", token1, token2)
	}
	info, err := os.Stat(filepath.Join(dir, tokenFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestValidateTokenRejectsWrongSecret(t *testing.T) {
	dir := t.TempDir()
	token, err := EnsureToken(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidateToken(dir, token) {
		t.Fatal("expected valid token")
	}
	if ValidateToken(dir, "wrong") {
		t.Fatal("expected invalid token")
	}
}

func TestParseAuthLine(t *testing.T) {
	token, err := ParseAuthLine([]byte(`{"auth":"abc123"}`))
	if err != nil || token != "abc123" {
		t.Fatalf("parse auth = %q, err = %v", token, err)
	}
}
