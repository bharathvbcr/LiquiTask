package execenv

import (
	"sync/atomic"
)

// STUB / LOCAL-ONLY ADAPTATION.
//
// Upstream Multica's server_snapshot_provider.go wires a
// featureflag.Provider that receives server-evaluated feature-flag decisions
// over the daemon's heartbeat ack (see protocol.DaemonFeatureFlagSnapshot)
// and exposes them to the rest of the daemon via a featureflag.Service
// provider chain (env override -> server snapshot -> static YAML fallback).
//
// liquitask-agentd is a local, single-user Tauri sidecar: there is no
// Multica server, no heartbeat RPC, and no server-evaluated flag decisions to
// receive. That entire delivery mechanism — ServerSnapshotProvider as a
// featureflag.Provider, ApplyFeatureFlagSnapshot consuming a heartbeat ack,
// and NewDaemonFeatureFlagServiceFromEnv building the env/server/static
// provider chain — is genuinely server-only state with no local equivalent.
//
// What follows is a minimal, clearly-scoped stand-in that keeps the same
// exported names other ported execenv files may reference
// (NewServerSnapshotProvider, SetServerSnapshotProvider,
// ApplyFeatureFlagSnapshot) so callers compile and behave sanely, but it is
// NOT a feature-flag system: Lookup always misses (ok=false), so any caller
// chaining this provider falls straight through to its own default / local
// override. There is no YAML/env-file flag loading here either — if
// liquitask-agentd ever needs local feature flags, that should be a fresh,
// intentionally-designed local mechanism (e.g. a config file or env vars
// read directly), not a port of the cloud heartbeat plumbing.
//
// ServerSnapshot is kept as a plain data holder (Version + Flags) in case a
// future local mechanism wants the same shape, but nothing in this sidecar
// populates it from a remote source.
type ServerSnapshot struct {
	Version uint64
	Flags   map[string]string
}

// ServerSnapshotProvider is a no-op stand-in for the upstream heartbeat-fed
// feature-flag provider. Apply/Clear/Snapshot are preserved as plain local
// state manipulation (useful for tests or a future local override path);
// Lookup always reports a miss since there is no server pushing decisions
// here — "no server uplink in this sidecar; treat as always-fresh / always
// fall through to the next provider in the chain".
type ServerSnapshotProvider struct {
	snap atomic.Pointer[ServerSnapshot]
}

var activeServerSnapshotProvider atomic.Pointer[ServerSnapshotProvider]

func NewServerSnapshotProvider() *ServerSnapshotProvider {
	return &ServerSnapshotProvider{}
}

// Name mirrors the upstream featureflag.Provider.Name() shape so a future
// local featureflag.Provider chain could still slot this in without a
// signature change.
func (*ServerSnapshotProvider) Name() string { return "server_snapshot" }

// Apply atomically replaces the provider's current snapshot. Kept for tests
// and for any future local caller that wants to stage flag overrides through
// the same shape upstream used; nothing in this sidecar calls it from a
// network path.
func (p *ServerSnapshotProvider) Apply(snapshot ServerSnapshot) {
	if p == nil {
		return
	}
	clone := make(map[string]string, len(snapshot.Flags))
	for key, variant := range snapshot.Flags {
		clone[key] = variant
	}
	p.snap.Store(&ServerSnapshot{
		Version: snapshot.Version,
		Flags:   clone,
	})
}

// Clear drops the current snapshot. No-op-equivalent here since nothing
// populates a snapshot from a server in the first place, but kept so the
// type remains a drop-in shape for tests.
func (p *ServerSnapshotProvider) Clear() {
	if p == nil {
		return
	}
	p.snap.Store(nil)
}

// Snapshot returns a copy of the current snapshot for tests and diagnostics.
func (p *ServerSnapshotProvider) Snapshot() (ServerSnapshot, bool) {
	if p == nil {
		return ServerSnapshot{}, false
	}
	snap := p.snap.Load()
	if snap == nil {
		return ServerSnapshot{}, false
	}
	clone := make(map[string]string, len(snap.Flags))
	for key, variant := range snap.Flags {
		clone[key] = variant
	}
	return ServerSnapshot{Version: snap.Version, Flags: clone}, true
}

// SetServerSnapshotProvider installs the provider. Retained for API
// compatibility with any ported call site; in this sidecar there is no
// heartbeat ack that ever calls Apply on the installed provider, so this is
// effectively inert wiring.
func SetServerSnapshotProvider(p *ServerSnapshotProvider) {
	activeServerSnapshotProvider.Store(p)
}

// ApplyFeatureFlagSnapshot upstream applies a protocol.DaemonFeatureFlagSnapshot
// delivered over a daemon heartbeat ack to the installed ServerSnapshotProvider.
//
// STUBBED: this sidecar has no daemon heartbeat RPC and no
// protocol.DaemonFeatureFlagSnapshot wire type (that type lives in Multica's
// server/pkg/protocol package, which is cloud-server wire protocol and is not
// ported here). The signature is kept local-only (map[string]string +
// version) rather than importing the unported protocol package, so this is a
// best-effort adaptation: treat any server flag payload this sidecar might
// ever synthesize locally as "always-fresh" — just clear or replace the
// snapshot directly via Clear()/Apply() instead of routing it through a
// heartbeat-shaped call. This function is kept only so a caller ported from
// upstream that still references the old call shape has an obvious local
// landing spot; wire it to Clear()/Apply() directly at the call site instead
// of relying on this indirection where possible.
func ApplyFeatureFlagSnapshot(version uint64, flags map[string]string) {
	p := activeServerSnapshotProvider.Load()
	if p == nil {
		return
	}
	if flags == nil {
		p.Clear()
		return
	}
	p.Apply(ServerSnapshot{Version: version, Flags: flags})
}

func snapshotVariantEnabled(v string) bool {
	switch v {
	case "", "off", "false", "0":
		return false
	default:
		return true
	}
}
