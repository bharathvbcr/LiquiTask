package execenv

import (
	"embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// defaultClaudeAgentsFS holds the built-in default Claude Code subagent
// definitions the daemon provisions into a Claude Code task workdir. Claude
// Code natively discovers project-scoped subagents from
// {workDir}/.claude/agents/*.md, so dropping these files there lets a
// daemon-managed `claude` run delegate to a reviewer, tester, debugger, and so
// on without the user configuring anything. This is the Claude-side analogue of
// the provider-native skill injection in context.go: same .claude/ layout, same
// "user content wins" rule (see writeClaudeAgents).
//
// Codex is deliberately the opposite case — codex_multi_agent.go DISABLES its
// native subagents because the daemon cannot yet model Codex child threads.
// Claude Code subagents run synchronously via the Task tool and return their
// result inline, so they carry no such lifecycle risk.
//
//go:embed default_claude_agents/*.md
var defaultClaudeAgentsFS embed.FS

// defaultClaudeAgentsSrcDir is the embedded directory holding the agent files.
// embed.FS paths are always slash-separated, independent of the host OS.
const defaultClaudeAgentsSrcDir = "default_claude_agents"

// MulticaClaudeDefaultAgentsEnv gates whether the daemon ships its built-in
// default subagents. Default ON; set to a falsy value (0/false/no/off,
// case-insensitive) to provision none of the embedded defaults. Workspace-
// defined custom agents (CustomClaudeAgents) are unaffected by this switch —
// they are explicit user choices, not daemon defaults. Mirrors the opt-out
// shape of MULTICA_CODEX_MULTI_AGENT.
const MulticaClaudeDefaultAgentsEnv = "MULTICA_CLAUDE_DEFAULT_AGENTS"

// ClaudeAgentSpec is a workspace-defined subagent to write into a Claude run's
// .claude/agents/ directory. Name is a human label (sanitised into a filename);
// Content is the full agent markdown (YAML frontmatter + body) exactly as
// authored. A custom agent whose sanitised name matches a default's replaces
// that default. Empty-name or empty-content specs are ignored.
type ClaudeAgentSpec struct {
	Name    string
	Content string
}

// providerUsesClaudeAgents reports whether the provider discovers subagents
// from a workdir-local .claude/agents/ directory. Claude Code ("claude") and
// the Claude-Code-compatible CodeBuddy ("codebuddy") both read the .claude/
// layout — the same pairing skillsDirPath and runtime_config use for
// .claude/skills and the CLAUDE.md brief.
func providerUsesClaudeAgents(provider string) bool {
	switch provider {
	case "claude", "codebuddy":
		return true
	default:
		return false
	}
}

// claudeAgentsDirPath returns the .claude/agents directory under workDir where
// Claude Code discovers project-scoped subagents.
func claudeAgentsDirPath(workDir string) string {
	return filepath.Join(workDir, ".claude", "agents")
}

// claudeDefaultAgentsEnabled reports whether the daemon should ship its built-in
// default subagents. Default true; only an explicit falsy
// MULTICA_CLAUDE_DEFAULT_AGENTS turns them off.
func claudeDefaultAgentsEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(MulticaClaudeDefaultAgentsEnv))) {
	case "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

// sanitizeAgentSlug lowercases name and reduces it to a filesystem-safe slug
// (alphanumerics separated by single dashes). It returns "" when nothing usable
// remains, which callers treat as "skip" — this is also the reserved-name guard:
// path separators, "..", and other traversal attempts collapse to a bare slug
// that can only ever name a file directly inside .claude/agents/.
func sanitizeAgentSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonAlphaNum.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// resolvedClaudeAgent is one subagent to write: its filename and full content.
type resolvedClaudeAgent struct {
	fileName string // "<slug>.md"
	content  string
}

// resolveClaudeAgents computes the effective set of subagents to provision for a
// Claude run. Precedence, applied in order:
//
//  1. env opt-out (MULTICA_CLAUDE_DEFAULT_AGENTS=0) drops all embedded defaults;
//  2. per-workspace DisabledDefaultClaudeAgents drops named defaults;
//  3. every surviving default gets the LiquiTask operating-context preamble;
//  4. CustomClaudeAgents are added, and a custom whose slug matches a default
//     replaces it (written verbatim, without the preamble — user content is
//     authoritative).
//
// The result is sorted by filename so the on-disk set is deterministic.
func resolveClaudeAgents(ctx TaskContextForEnv) ([]resolvedClaudeAgent, error) {
	disabled := make(map[string]struct{}, len(ctx.DisabledDefaultClaudeAgents))
	for _, name := range ctx.DisabledDefaultClaudeAgents {
		if slug := sanitizeAgentSlug(name); slug != "" {
			disabled[slug] = struct{}{}
		}
	}

	// Custom agents claim their slug first so a matching default is dropped.
	custom := make(map[string]resolvedClaudeAgent, len(ctx.CustomClaudeAgents))
	for _, spec := range ctx.CustomClaudeAgents {
		slug := sanitizeAgentSlug(spec.Name)
		if slug == "" || strings.TrimSpace(spec.Content) == "" {
			continue
		}
		custom[slug] = resolvedClaudeAgent{fileName: slug + ".md", content: spec.Content}
	}

	byFile := make(map[string]resolvedClaudeAgent)

	if claudeDefaultAgentsEnabled() {
		entries, err := defaultClaudeAgentsFS.ReadDir(defaultClaudeAgentsSrcDir)
		if err != nil {
			return nil, fmt.Errorf("read embedded claude agents: %w", err)
		}
		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".md" {
				continue
			}
			slug := strings.TrimSuffix(entry.Name(), ".md")
			if _, off := disabled[slug]; off {
				continue
			}
			if _, overridden := custom[slug]; overridden {
				continue
			}
			data, err := defaultClaudeAgentsFS.ReadFile(defaultClaudeAgentsSrcDir + "/" + entry.Name())
			if err != nil {
				return nil, fmt.Errorf("read embedded claude agent %s: %w", entry.Name(), err)
			}
			byFile[entry.Name()] = resolvedClaudeAgent{
				fileName: entry.Name(),
				content:  applyLiquiTaskAgentPreamble(string(data)),
			}
		}
	}

	for _, agent := range custom {
		byFile[agent.fileName] = agent
	}

	out := make([]resolvedClaudeAgent, 0, len(byFile))
	for _, agent := range byFile {
		out = append(out, agent)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].fileName < out[j].fileName })
	return out, nil
}

// writeClaudeAgents materialises the effective subagent set (see
// resolveClaudeAgents) into {workDir}/.claude/agents/. Callers must gate on
// providerUsesClaudeAgents.
//
// It follows the sidecar-manifest contract exactly like writeSkillFiles: every
// directory and file it creates is recorded (when manifest is non-nil) so
// CleanupSidecars can roll a local_directory workdir back to its pre-Prepare
// state, and a filename already occupied by the user is left untouched — a
// user-authored .claude/agents/<name>.md always wins. Because recordWriteFile
// refuses to overwrite a pre-existing path, that precedence falls out of the
// errPathPreExists branch below rather than needing a separate check. When the
// effective set is empty (defaults opted out and no custom agents), nothing is
// written and no .claude/agents directory is created.
func writeClaudeAgents(workDir string, ctx TaskContextForEnv, manifest *sidecarManifest) error {
	agents, err := resolveClaudeAgents(ctx)
	if err != nil {
		return err
	}
	if len(agents) == 0 {
		return nil
	}

	agentsDir := claudeAgentsDirPath(workDir)
	if err := recordMkdirAll(agentsDir, 0o755, manifest); err != nil {
		return fmt.Errorf("create claude agents dir: %w", err)
	}

	for _, agent := range agents {
		dst := filepath.Join(agentsDir, agent.fileName)
		if err := recordWriteFile(dst, []byte(agent.content), 0o644, manifest); err != nil {
			if errors.Is(err, errPathPreExists) {
				// The user already defines an agent at this filename. Their
				// definition takes precedence; leave it untouched and do not
				// record it in the manifest (we did not create it).
				continue
			}
			return fmt.Errorf("write claude agent %s: %w", agent.fileName, err)
		}
	}

	return nil
}

// liquiTaskAgentPreamble is appended to every built-in default subagent at
// provision time so the subagent knows it is running inside an autonomous
// LiquiTask (Multica) task run rather than an interactive session. Kept as
// concatenated double-quoted lines (not a raw literal) so the markdown can use
// backtick code spans and gofmt leaves it alone.
const liquiTaskAgentPreamble = "\n" +
	"## Running inside a LiquiTask agent run\n" +
	"\n" +
	"You are a subagent inside an autonomous LiquiTask (Multica) run. There is no interactive user watching during the run — behave accordingly:\n" +
	"\n" +
	"- Task and repo context come from the `multica` CLI and the working directory: run `multica issue get <id> --output json` for the assignment, `multica repo checkout <url>` to obtain code, and read `.agent_context/issue_context.md` when it is present.\n" +
	"- You cannot prompt the user; the interactive question tool is disabled in managed runs. If you must clarify something, post it with `multica issue comment <id> \"...\"` and continue with the safest reasonable assumption instead of blocking.\n" +
	"- Work is gated by DevCouncil (plan → scope → verify). Stay within the task's stated scope and surface out-of-scope findings as a comment rather than acting on them silently.\n" +
	"- Do not launch background or async processes; managed runs require foreground execution.\n"

// applyLiquiTaskAgentPreamble appends the LiquiTask operating-context section to
// a default agent's markdown. The preamble goes after the agent's own content —
// the YAML frontmatter stays first and intact, so Claude Code parses the header
// normally while the model still sees the runtime guidance in the body.
func applyLiquiTaskAgentPreamble(content string) string {
	return strings.TrimRight(content, "\n") + "\n" + liquiTaskAgentPreamble
}
