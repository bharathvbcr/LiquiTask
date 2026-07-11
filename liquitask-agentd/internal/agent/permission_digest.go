package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// PermissionInputDigest returns a stable SHA-256 hex digest of a tool input map.
// Used to bind user approvals to the exact payload shown in the prompt (SEC-11).
func PermissionInputDigest(input map[string]any) string {
	if len(input) == 0 {
		return ""
	}
	normalized := canonicalPermissionInput(input)
	raw, err := json.Marshal(normalized)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func canonicalPermissionInput(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	keys := make([]string, 0, len(input))
	for k := range input {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(map[string]any, len(keys))
	for _, k := range keys {
		out[k] = input[k]
	}
	return out
}
