package daemon

// LocalSkillSummary is the public alias for the ported local-skill discovery
// result — the underlying struct's fields are already exported, this alias
// just gives external packages (internal/runner, cmd/liquitask-agentd) a
// name to reference without exporting the whole file's internals.
type LocalSkillSummary = runtimeLocalSkillSummary

// SupportedSkillProviders mirrors agent.SupportedTypes (kept independent to
// avoid an import cycle: internal/agent has no reason to depend on
// internal/daemon). Used by ListLocalSkills("") to sweep every provider's
// skill root plus the universal ~/.agents/skills fallback.
var SupportedSkillProviders = []string{
	"claude", "codebuddy", "codex", "copilot", "opencode", "openclaw",
	"hermes", "pi", "cursor", "grok", "kimi", "kiro", "antigravity", "qoder", "traecli",
}

// ListLocalSkills discovers locally-installed skills for one provider, or —
// when provider is empty — sweeps every supported provider's root plus the
// shared ~/.agents/skills fallback, deduping by Key across providers so a
// skill visible to multiple runtimes (e.g. via the universal root) is only
// reported once.
func ListLocalSkills(provider string) ([]LocalSkillSummary, error) {
	if provider != "" {
		skills, supported, err := listRuntimeLocalSkills(provider)
		if err != nil {
			return nil, err
		}
		if !supported {
			return []LocalSkillSummary{}, nil
		}
		return skills, nil
	}

	seen := make(map[string]bool)
	all := make([]LocalSkillSummary, 0)
	for _, p := range SupportedSkillProviders {
		skills, supported, err := listRuntimeLocalSkills(p)
		if err != nil || !supported {
			continue
		}
		for _, s := range skills {
			if seen[s.Key] {
				continue
			}
			seen[s.Key] = true
			all = append(all, s)
		}
	}
	return all, nil
}
