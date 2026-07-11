package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ToolPolicyAction is the per-tool permission policy: allow, ask, or deny.
type ToolPolicyAction string

const (
	ToolPolicyAllow ToolPolicyAction = "allow"
	ToolPolicyAsk   ToolPolicyAction = "ask"
	ToolPolicyDeny  ToolPolicyAction = "deny"
)

// PermissionRequest describes a tool permission prompt surfaced to the runner.
type PermissionRequest struct {
	RequestID   string
	Tool        string
	Input       map[string]any
	InputDigest string
	Title       string
}

// PermissionDecision is the outcome of a permission prompt.
type PermissionDecision struct {
	Allowed      bool
	Always       bool // approve for session / always
	DeniedReason string
}

// PermissionPromptFunc blocks until a permission decision is available or ctx
// expires. When nil, ResolveToolPermission falls back to policy + AutoApprove.
type PermissionPromptFunc func(ctx context.Context, req PermissionRequest) (PermissionDecision, error)

const defaultPermissionPromptTimeout = 5 * time.Minute

// ResolveToolPermission decides whether a tool call may proceed.
func ResolveToolPermission(
	ctx context.Context,
	tool string,
	input map[string]any,
	opts ExecOptions,
) (PermissionDecision, error) {
	tool = strings.TrimSpace(tool)
	action := lookupToolPolicy(tool, opts.ToolPolicy)

	switch action {
	case ToolPolicyDeny:
		return PermissionDecision{Allowed: false, DeniedReason: fmt.Sprintf("tool %q denied by policy", tool)}, nil
	case ToolPolicyAllow:
		return PermissionDecision{Allowed: true, Always: true}, nil
	}

	if opts.AutoApprove || strings.EqualFold(opts.PermissionMode, "bypassPermissions") {
		return PermissionDecision{Allowed: true, Always: true}, nil
	}

	if opts.PermissionPrompt == nil {
		return PermissionDecision{
			Allowed:      false,
			DeniedReason: fmt.Sprintf("tool %q requires approval but no permission broker is configured", tool),
		}, nil
	}

	promptCtx := ctx
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		promptCtx, cancel = context.WithTimeout(ctx, defaultPermissionPromptTimeout)
		defer cancel()
	}

	req := PermissionRequest{
		RequestID:   fmt.Sprintf("perm-%d", time.Now().UnixNano()),
		Tool:        tool,
		Input:       input,
		InputDigest: PermissionInputDigest(input),
		Title:       tool,
	}
	decision, err := opts.PermissionPrompt(promptCtx, req)
	if err != nil {
		return PermissionDecision{Allowed: false, DeniedReason: err.Error()}, nil
	}
	return decision, nil
}

func lookupToolPolicy(tool string, policy map[string]ToolPolicyAction) ToolPolicyAction {
	if len(policy) == 0 {
		return ToolPolicyAsk
	}
	if v, ok := policy[tool]; ok {
		return v
	}
	if v, ok := policy["*"]; ok {
		return v
	}
	return ToolPolicyAsk
}

// ShouldBypassPermissions reports whether the backend should launch in
// auto-approve / yolo / bypass-permissions mode.
func ShouldBypassPermissions(opts ExecOptions) bool {
	return opts.AutoApprove || strings.EqualFold(opts.PermissionMode, "bypassPermissions")
}

func resolveClaudePermissionMode(opts ExecOptions) string {
	if ShouldBypassPermissions(opts) {
		return "bypassPermissions"
	}
	if pm := strings.TrimSpace(opts.PermissionMode); pm != "" {
		return pm
	}
	return "default"
}

// acpPermissionTool extracts tool metadata from an ACP session/request_permission frame.
func acpPermissionTool(raw map[string]json.RawMessage) (tool string, input map[string]any) {
	var params struct {
		ToolCall struct {
			Title string `json:"title"`
		} `json:"toolCall"`
	}
	if data, ok := raw["params"]; ok {
		_ = json.Unmarshal(data, &params)
	}
	tool = strings.TrimSpace(params.ToolCall.Title)
	if tool == "" {
		tool = "tool"
	}
	return tool, nil
}
