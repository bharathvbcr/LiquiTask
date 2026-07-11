package daemon

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadLocalSkillBody_rejects_path_traversal(t *testing.T) {
	t.Parallel()
	if _, err := ReadLocalSkillBody("/etc/passwd"); err == nil {
		t.Fatal("expected path outside skill roots to be rejected")
	}
}

func TestReadLocalSkillBody_rejects_parent_escape(t *testing.T) {
	t.Parallel()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("home dir unavailable")
	}
	traversal := filepath.Join(home, ".claude", "skills", "..", "..", ".ssh", "id_rsa")
	if _, err := ReadLocalSkillBody(traversal); err == nil {
		t.Fatal("expected traversal outside skill roots to be rejected")
	}
}

func TestIsPathUnderAnyRoot_blocks_prefix_trick(t *testing.T) {
	t.Parallel()
	roots := []string{"/home/user/.claude/skills"}
	if isPathUnderAnyRoot("/home/user/.claude/skills-evil/secret", roots) {
		t.Fatal("expected prefix trick to be denied")
	}
}
