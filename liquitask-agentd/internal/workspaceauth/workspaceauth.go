package workspaceauth

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// IsPathAuthorized reports whether normalizedPath is exactly authorizedPath or
// contained within it (directory-boundary safe, so notes-evil does not match
// notes).
func IsPathAuthorized(normalizedPath string, authorizedPaths []string) bool {
	if normalizedPath == "" || len(authorizedPaths) == 0 {
		return false
	}
	target := normalizeForCompare(normalizedPath)
	sep := string(os.PathSeparator)
	for _, auth := range authorizedPaths {
		if strings.TrimSpace(auth) == "" {
			continue
		}
		base := normalizeForCompare(LexicalClean(auth))
		if target == base || strings.HasPrefix(target, base+sep) {
			return true
		}
	}
	return false
}

// AuthorizeDir canonicalizes dir and requires it to sit inside one of the
// authorized workspace paths.
func AuthorizeDir(dir string, authorizedPaths []string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", fmt.Errorf("working directory is required")
	}
	if !IsPathAuthorized(LexicalClean(dir), authorizedPaths) {
		return "", fmt.Errorf("directory is not an authorised workspace path: %s", dir)
	}
	resolved, err := filepath.EvalSymlinks(dir)
	if err != nil {
		abs, absErr := filepath.Abs(dir)
		if absErr != nil {
			return "", fmt.Errorf("directory not accessible: %w", err)
		}
		resolved = abs
	} else {
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return "", fmt.Errorf("directory not accessible: %w", err)
		}
	}
	if !IsPathAuthorized(resolved, authorizedPaths) {
		return "", fmt.Errorf("resolved directory escapes the authorised workspace: %s", resolved)
	}
	return resolved, nil
}

// LexicalClean resolves "." and ".." without touching the filesystem.
func LexicalClean(input string) string {
	clean := filepath.Clean(filepath.FromSlash(input))
	if clean == "." {
		return ""
	}
	return clean
}

func normalizeForCompare(path string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(filepath.Clean(path))
	}
	return filepath.Clean(path)
}
