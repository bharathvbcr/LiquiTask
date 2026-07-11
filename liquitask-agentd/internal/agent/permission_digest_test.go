package agent

import "testing"

func TestPermissionInputDigestStableAcrossKeyOrder(t *testing.T) {
	a := map[string]any{"path": "src/a.ts", "content": "x"}
	b := map[string]any{"content": "x", "path": "src/a.ts"}
	da := PermissionInputDigest(a)
	db := PermissionInputDigest(b)
	if da == "" || da != db {
		t.Fatalf("expected stable digest, got %q vs %q", da, db)
	}
}

func TestPermissionInputDigestChangesWithPayload(t *testing.T) {
	d1 := PermissionInputDigest(map[string]any{"path": "src/a.ts"})
	d2 := PermissionInputDigest(map[string]any{"path": "src/b.ts"})
	if d1 == d2 {
		t.Fatal("digest must change when input changes")
	}
}
