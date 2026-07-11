package daemon

import (
	"fmt"
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
	dir, err := resolveAllowedSkillSourceDir(sourcePath)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
	if err != nil {
		return "", err
	}
	if len(data) > maxSkillBodyBytes {
		data = data[:maxSkillBodyBytes]
	}
	return string(data), nil
}

func resolveAllowedSkillSourceDir(sourcePath string) (string, error) {
	dir := expandHomePath(sourcePath)
	dir = filepath.Clean(dir)
	if dir == "" || dir == "." {
		return "", fmt.Errorf("invalid skill source path")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("skill source path not accessible: %w", err)
	}
	roots, err := allLocalSkillRoots()
	if err != nil {
		return "", err
	}
	if !isPathUnderAnyRoot(abs, roots) {
		return "", fmt.Errorf("skill source path is outside allowed skill directories")
	}
	return abs, nil
}

func allLocalSkillRoots() ([]string, error) {
	seen := make(map[string]struct{})
	roots := make([]string, 0)
	for _, provider := range SupportedSkillProviders {
		skillRoots, supported, err := localSkillRootsForProvider(provider)
		if err != nil {
			return nil, err
		}
		if !supported {
			continue
		}
		for _, root := range skillRoots {
			abs, err := filepath.Abs(root.path)
			if err != nil {
				continue
			}
			if _, ok := seen[abs]; ok {
				continue
			}
			seen[abs] = struct{}{}
			roots = append(roots, abs)
		}
	}
	return roots, nil
}

func isPathUnderAnyRoot(path string, roots []string) bool {
	clean := filepath.Clean(path)
	for _, root := range roots {
		rootClean := filepath.Clean(root)
		if clean == rootClean {
			return true
		}
		rel, err := filepath.Rel(rootClean, clean)
		if err != nil {
			continue
		}
		if rel == "." {
			return true
		}
		if !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
			return true
		}
	}
	return false
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
