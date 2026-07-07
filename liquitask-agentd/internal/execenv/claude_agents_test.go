package execenv

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// expectedDefaultClaudeAgents is the set of agents the daemon ships, in the
// filename sort order embed.FS.ReadDir returns. Update this list and the
// embedded files together — TestEmbeddedClaudeAgentsAreWellFormed asserts they
// stay in lockstep so a stray or missing file is caught.
var expectedDefaultClaudeAgents = []string{
	"code-reviewer.md",
	"codebase-explorer.md",
	"debugger.md",
	"docs-writer.md",
	"pr-author.md",
	"refactorer.md",
	"security-reviewer.md",
	"test-author.md",
	"test-runner.md",
}

const liquiTaskPreambleMarker = "## Running inside a LiquiTask agent run"

func TestProviderUsesClaudeAgents(t *testing.T) {
	t.Parallel()
	for _, p := range []string{"claude", "codebuddy"} {
		if !providerUsesClaudeAgents(p) {
			t.Errorf("providerUsesClaudeAgents(%q) = false, want true", p)
		}
	}
	for _, p := range []string{"codex", "cursor", "copilot", "opencode", "openclaw", "antigravity", ""} {
		if providerUsesClaudeAgents(p) {
			t.Errorf("providerUsesClaudeAgents(%q) = true, want false", p)
		}
	}
}

// TestEmbeddedClaudeAgentsAreWellFormed guards the shipped files: each embedded
// agent must lead with YAML frontmatter whose `name` matches its filename and
// must carry a description, since Claude Code keys subagent discovery and
// delegation on exactly those fields. The embedded content is checked as
// authored (before the provision-time preamble is appended).
func TestEmbeddedClaudeAgentsAreWellFormed(t *testing.T) {
	t.Parallel()
	entries, err := defaultClaudeAgentsFS.ReadDir(defaultClaudeAgentsSrcDir)
	if err != nil {
		t.Fatalf("read embedded agents dir: %v", err)
	}

	var got []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || filepath.Ext(name) != ".md" {
			continue
		}
		got = append(got, name)

		data, err := defaultClaudeAgentsFS.ReadFile(defaultClaudeAgentsSrcDir + "/" + name)
		if err != nil {
			t.Fatalf("read embedded agent %s: %v", name, err)
		}
		content := string(data)
		if !strings.HasPrefix(content, "---\n") {
			t.Errorf("agent %s: missing opening YAML frontmatter", name)
			continue
		}
		stem := strings.TrimSuffix(name, ".md")
		if !strings.Contains(content, "name: "+stem+"\n") {
			t.Errorf("agent %s: frontmatter name must match filename stem %q", name, stem)
		}
		if !strings.Contains(content, "description:") {
			t.Errorf("agent %s: frontmatter missing description", name)
		}
		// The preamble is injected at provision time, not baked into the file.
		if strings.Contains(content, liquiTaskPreambleMarker) {
			t.Errorf("agent %s: embedded file must not contain the injected preamble", name)
		}
	}

	if strings.Join(got, ",") != strings.Join(expectedDefaultClaudeAgents, ",") {
		t.Errorf("embedded agents = %v, want %v", got, expectedDefaultClaudeAgents)
	}
}

func TestWriteClaudeAgentsDefaults(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()
	manifest := &sidecarManifest{}

	if err := writeClaudeAgents(workDir, TaskContextForEnv{}, manifest); err != nil {
		t.Fatalf("writeClaudeAgents: %v", err)
	}

	agentsDir := filepath.Join(workDir, ".claude", "agents")
	for _, name := range expectedDefaultClaudeAgents {
		data, err := os.ReadFile(filepath.Join(agentsDir, name))
		if err != nil {
			t.Errorf("expected agent %s on disk: %v", name, err)
			continue
		}
		content := string(data)
		if !strings.HasPrefix(content, "---\n") {
			t.Errorf("agent %s: frontmatter must remain first after preamble injection", name)
		}
		if !strings.Contains(content, liquiTaskPreambleMarker) {
			t.Errorf("agent %s: provisioned default missing the LiquiTask preamble", name)
		}
	}

	if len(manifest.Files) != len(expectedDefaultClaudeAgents) {
		t.Errorf("manifest recorded %d files, want %d", len(manifest.Files), len(expectedDefaultClaudeAgents))
	}
	if len(manifest.Dirs) == 0 {
		t.Errorf("manifest recorded no created directories, want .claude and .claude/agents")
	}
}

// TestWriteClaudeAgentsPreservesUserAgent verifies the "user content wins" rule:
// a user-authored agent at the same filename is never overwritten, and is not
// recorded in the manifest (so cleanup never deletes it), while the remaining
// defaults are still provisioned.
func TestWriteClaudeAgentsPreservesUserAgent(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()
	agentsDir := filepath.Join(workDir, ".claude", "agents")
	if err := os.MkdirAll(agentsDir, 0o755); err != nil {
		t.Fatalf("mkdir agents dir: %v", err)
	}
	userAgent := filepath.Join(agentsDir, "code-reviewer.md")
	userContent := "---\nname: code-reviewer\ndescription: my own reviewer\n---\nCustom instructions.\n"
	if err := os.WriteFile(userAgent, []byte(userContent), 0o644); err != nil {
		t.Fatalf("write user agent: %v", err)
	}

	manifest := &sidecarManifest{}
	if err := writeClaudeAgents(workDir, TaskContextForEnv{}, manifest); err != nil {
		t.Fatalf("writeClaudeAgents: %v", err)
	}

	got, err := os.ReadFile(userAgent)
	if err != nil {
		t.Fatalf("read user agent: %v", err)
	}
	if string(got) != userContent {
		t.Errorf("user-authored agent was overwritten:\n got %q\nwant %q", got, userContent)
	}
	for _, f := range manifest.Files {
		if filepath.Base(f) == "code-reviewer.md" {
			t.Errorf("manifest recorded a user-owned agent %q; cleanup would wrongly delete it", f)
		}
	}
	if _, err := os.Stat(filepath.Join(agentsDir, "debugger.md")); err != nil {
		t.Errorf("expected non-colliding default debugger.md to still be written: %v", err)
	}
}

// TestResolveClaudeAgentsConfig exercises the disable + custom-override logic
// without touching disk.
func TestResolveClaudeAgentsConfig(t *testing.T) {
	t.Parallel()
	ctx := TaskContextForEnv{
		DisabledDefaultClaudeAgents: []string{"Debugger"}, // case-insensitive slug
		CustomClaudeAgents: []ClaudeAgentSpec{
			{Name: "code-reviewer", Content: "---\nname: code-reviewer\n---\nOVERRIDE\n"},
			{Name: "My Helper!", Content: "---\nname: my-helper\n---\nBespoke.\n"},
			{Name: "  ", Content: "ignored: blank name"},          // skipped
			{Name: "empty", Content: "   "},                       // skipped: blank content
		},
	}

	agents, err := resolveClaudeAgents(ctx)
	if err != nil {
		t.Fatalf("resolveClaudeAgents: %v", err)
	}

	byFile := make(map[string]string, len(agents))
	for _, a := range agents {
		byFile[a.fileName] = a.content
	}

	if _, ok := byFile["debugger.md"]; ok {
		t.Errorf("disabled default debugger.md should be absent")
	}
	if _, ok := byFile["my-helper.md"]; !ok {
		t.Errorf("custom agent my-helper.md should be present (got %v)", keys(byFile))
	}
	if got := byFile["code-reviewer.md"]; !strings.Contains(got, "OVERRIDE") {
		t.Errorf("custom code-reviewer should override the default, got %q", got)
	}
	if strings.Contains(byFile["code-reviewer.md"], liquiTaskPreambleMarker) {
		t.Errorf("custom agents are written verbatim and must not get the preamble")
	}
	if !strings.Contains(byFile["test-runner.md"], liquiTaskPreambleMarker) {
		t.Errorf("surviving default test-runner should carry the preamble")
	}
	// Blank-name and blank-content specs are skipped entirely.
	for f := range byFile {
		if f == ".md" || f == "empty.md" {
			t.Errorf("invalid custom spec produced a file %q", f)
		}
	}
	// Output is sorted by filename.
	for i := 1; i < len(agents); i++ {
		if agents[i-1].fileName > agents[i].fileName {
			t.Errorf("agents not sorted by filename: %q before %q", agents[i-1].fileName, agents[i].fileName)
		}
	}
}

// TestClaudeDefaultAgentsEnvOptOut confirms MULTICA_CLAUDE_DEFAULT_AGENTS=0
// drops the embedded defaults while still writing explicit custom agents. This
// test cannot run in parallel because it mutates process env via t.Setenv.
func TestClaudeDefaultAgentsEnvOptOut(t *testing.T) {
	t.Setenv(MulticaClaudeDefaultAgentsEnv, "0")

	if claudeDefaultAgentsEnabled() {
		t.Fatalf("claudeDefaultAgentsEnabled() = true with env set to 0")
	}

	// No custom agents + defaults off → nothing written, no directory created.
	emptyDir := t.TempDir()
	if err := writeClaudeAgents(emptyDir, TaskContextForEnv{}, &sidecarManifest{}); err != nil {
		t.Fatalf("writeClaudeAgents (opt-out, empty): %v", err)
	}
	if _, err := os.Stat(filepath.Join(emptyDir, ".claude")); !os.IsNotExist(err) {
		t.Errorf("opt-out with no custom agents should not create .claude (err=%v)", err)
	}

	// Custom agent + defaults off → only the custom agent is written.
	customDir := t.TempDir()
	ctx := TaskContextForEnv{CustomClaudeAgents: []ClaudeAgentSpec{
		{Name: "only-this", Content: "---\nname: only-this\n---\nSolo.\n"},
	}}
	if err := writeClaudeAgents(customDir, ctx, &sidecarManifest{}); err != nil {
		t.Fatalf("writeClaudeAgents (opt-out, custom): %v", err)
	}
	agentsDir := filepath.Join(customDir, ".claude", "agents")
	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		t.Fatalf("read agents dir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "only-this.md" {
		t.Errorf("opt-out with one custom agent: got %d entries, want only only-this.md", len(entries))
	}
}

func TestPrepareProvisionsClaudeAgents(t *testing.T) {
	t.Parallel()
	workspacesRoot := t.TempDir()
	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		WorkspaceID:    "ws-claude-agents",
		TaskID:         "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		Provider:       "claude",
		Task: TaskContextForEnv{
			IssueID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		},
	}, discardLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	agentsDir := filepath.Join(env.WorkDir, ".claude", "agents")
	for _, name := range expectedDefaultClaudeAgents {
		if _, err := os.Stat(filepath.Join(agentsDir, name)); err != nil {
			t.Errorf("Prepare(claude) did not provision %s: %v", name, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(agentsDir, "debugger.md"))
	if err != nil {
		t.Fatalf("read provisioned debugger.md: %v", err)
	}
	if !strings.Contains(string(data), liquiTaskPreambleMarker) {
		t.Errorf("provisioned agent missing LiquiTask preamble")
	}
}

func TestPrepareSkipsClaudeAgentsForOtherProvider(t *testing.T) {
	t.Parallel()
	workspacesRoot := t.TempDir()
	// copilot has no special Prepare branch and writes skills under
	// .github/skills, so a .claude directory must never appear.
	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		WorkspaceID:    "ws-copilot",
		TaskID:         "b2c3d4e5-f6a7-8901-bcde-f23456789012",
		Provider:       "copilot",
		Task: TaskContextForEnv{
			IssueID: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
		},
	}, discardLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	claudeDir := filepath.Join(env.WorkDir, ".claude")
	if _, err := os.Stat(claudeDir); !os.IsNotExist(err) {
		t.Errorf("Prepare(copilot) created %s, want it absent (err=%v)", claudeDir, err)
	}
}

// TestReuseRefreshesClaudeAgents proves the reuse path refreshes provisioned
// agents: a custom agent present on the first dispatch but removed from the
// config is gone after Reuse, and a newly added one appears. This falls out of
// the existing CleanupSidecars-then-rewrite flow (no agent-specific reclaim
// needed) because our agent files are recorded in the sidecar manifest.
func TestReuseRefreshesClaudeAgents(t *testing.T) {
	t.Parallel()
	workspacesRoot := t.TempDir()
	taskID := "c3d4e5f6-a7b8-9012-cdef-345678901234"

	env, err := Prepare(PrepareParams{
		WorkspacesRoot: workspacesRoot,
		WorkspaceID:    "ws-reuse",
		TaskID:         taskID,
		Provider:       "claude",
		Task: TaskContextForEnv{
			IssueID:            taskID,
			CustomClaudeAgents: []ClaudeAgentSpec{{Name: "first-only", Content: "---\nname: first-only\n---\nA.\n"}},
		},
	}, discardLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	agentsDir := filepath.Join(env.WorkDir, ".claude", "agents")
	if _, err := os.Stat(filepath.Join(agentsDir, "first-only.md")); err != nil {
		t.Fatalf("first dispatch should provision first-only.md: %v", err)
	}

	reused := Reuse(ReuseParams{
		WorkDir:  env.WorkDir,
		Provider: "claude",
		Task: TaskContextForEnv{
			IssueID:            taskID,
			CustomClaudeAgents: []ClaudeAgentSpec{{Name: "second-only", Content: "---\nname: second-only\n---\nB.\n"}},
		},
	}, discardLogger())
	if reused == nil {
		t.Fatalf("Reuse returned nil for existing workdir")
	}

	if _, err := os.Stat(filepath.Join(agentsDir, "second-only.md")); err != nil {
		t.Errorf("reuse should provision the new custom agent second-only.md: %v", err)
	}
	if _, err := os.Stat(filepath.Join(agentsDir, "first-only.md")); !os.IsNotExist(err) {
		t.Errorf("reuse should drop the removed custom agent first-only.md (err=%v)", err)
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
