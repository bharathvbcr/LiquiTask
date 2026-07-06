package execenv

import (
	"sync/atomic"
)

// runtimeBriefSlimFlag names the toggle that switches the runtime brief from
// the legacy verbose form (the canonical pre-MUL-3560 prompt that shipped to
// Multica production for ~2 years) to the post-MUL-3560 slim form
// (kind-driven dispatcher + per-section compression). Kept as a named
// constant (rather than inlining a bare bool) so the toggle point below and
// any future diagnostics stay self-documenting about which behavior it
// gates.
//
// NOTE (local-only fallback): upstream Multica gated this behind
// github.com/multica-ai/multica/server/pkg/featureflag — a Toggle Router
// with staging-YAML config, per-workspace/user targeting (Allow/Deny lists,
// percent rollouts keyed on workspace_id), and an ops override via
// FF_RUNTIME_BRIEF_SLIM env var read by a fleet-wide EnvProvider. None of
// that has an equivalent in liquitask-agentd: this is a local, single-user
// sidecar with no staging fleet, no per-workspace rollout targeting, and no
// ops-controlled remote config to phase a change in gradually. There is
// nothing to "roll out" to — there's one user and one process.
//
// The flag is therefore stubbed out as a simple in-process atomic bool,
// defaulting to false (legacy brief), preserving:
//   - the SetFeatureFlags-style override point tests use to flip behavior
//     under t.Cleanup without racing parallel goroutines, and
//   - the "default false → legacy" safety property the original flag had
//     in every environment that never wired a provider.
//
// If LiquiTask ever wants to ship the slim brief, flip runtimeBriefSlimDefault
// to true (or expose a local settings toggle that calls SetSlimBriefEnabled)
// rather than re-introducing a remote flag service.
const runtimeBriefSlimFlag = "runtime_brief_slim"

// runtimeBriefSlimDefault is the local, single-user replacement for
// "no provider wired → use the caller's default" in the original
// featureflag.Service.IsEnabled call. Multica's default was false
// (legacy) in every environment that didn't explicitly opt in via staging
// YAML; the sidecar keeps that same safe default.
const runtimeBriefSlimDefault = false

// runtimeSlimBriefEnabled is the package-scope toggle used by
// buildMetaSkillContent / BuildCommentReplyInstructions to pick between the
// legacy and slim brief paths. Stored behind an atomic.Bool (rather than the
// original atomic.Pointer[featureflag.Service]) so tests can flip it under a
// t.Cleanup without races against parallel test goroutines, mirroring the
// original wiring contract without depending on the removed cloud package.
var runtimeSlimBriefEnabled atomic.Bool

func init() {
	runtimeSlimBriefEnabled.Store(runtimeBriefSlimDefault)
}

// SetSlimBriefEnabled wires the slim-brief toggle for this process. Kept as
// an explicit setter (rather than a raw exported var) so call sites and
// tests read the same way the original SetFeatureFlags did. Local-only
// fallback for the removed featureflag.Service — see the package-level note
// above for why there is no provider/targeting layer here.
func SetSlimBriefEnabled(enabled bool) {
	runtimeSlimBriefEnabled.Store(enabled)
}

// useSlimBrief is the canonical toggle point for "should this run render the
// slim brief or the legacy brief".
//
// No server uplink in this sidecar: the original implementation evaluated
// against a per-request EvalContext (for future per-workspace targeting via
// Rule.Allow/Deny on workspace_id) sourced from a remote Toggle Router.
// There is no such per-request/per-workspace context here — a single-user
// sidecar has exactly one effective "tenant" — so the decision collapses to
// a single process-wide bool with no context argument. Default is false
// (legacy) unless SetSlimBriefEnabled(true) has been called.
func useSlimBrief() bool {
	return runtimeSlimBriefEnabled.Load()
}
