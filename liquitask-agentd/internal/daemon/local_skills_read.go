package daemon

import (
	"os"
	"path/filepath"
	"strings"
)

// maxSkillBodyBytes caps how much of a SKILL.md we return for prompt inlining,
// so a large skill file can't blow up a run prompt.
const maxSkillBodyBytes = 8192

// ReadLocalSkillBody returns the SKILL.md contents for a locally-installed skill
// given its source directory (as reported by ListLocalSkills, possibly in
// ~-relative form). The body is capped to keep run prompts bounded. The filename
// mirrors internal/skill.ContentFilename ("SKILL.md"); it is inlined here to
// avoid importing that package from daemon.
func ReadLocalSkillBody(sourcePath string) (string, error) {
	dir := expandHomePath(sourcePath)
	data, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
	if err != nil {
		return "", err
	}
	if len(data) > maxSkillBodyBytes {
		data = data[:maxSkillBodyBytes]
	}
	return string(data), nil
}

// expandHomePath is the inverse of relativizeHomePath: it turns a leading "~"
// back into the user's home directory so the path can be read from disk. A path
// without a "~" prefix is returned unchanged.
func expandHomePath(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			if p == "~" {
				return home
			}
			return filepath.Join(home, p[2:])
		}
	}
	return p
}
