package execenv

import (
	"sync"
	"testing"
)

// NOTE (local-only adaptation): upstream's server_snapshot_provider_test.go
// exercised the ServerSnapshotProvider as a live featureflag.Provider wired
// into a featureflag.Service chain (env -> server snapshot -> static YAML),
// plus end-to-end heartbeat delivery via featureflagdispatch.Evaluator and
// protocol.DaemonFeatureFlagSnapshot. None of that exists in this sidecar —
// see the stub comment in server_snapshot_provider.go for why. What remains
// below covers the plain data-holder behavior the stub actually implements:
// Apply/Snapshot/Clear copy semantics and concurrency safety. Tests that
// depended on featureflag.Provider.Lookup, useSlimBrief precedence, or
// heartbeat-driven flag propagation are intentionally not ported — there is
// no local equivalent to assert against.

func TestServerSnapshotProviderApplyAndSnapshotCopy(t *testing.T) {
	t.Parallel()

	provider := NewServerSnapshotProvider()
	flags := map[string]string{"some_flag": "on"}
	provider.Apply(ServerSnapshot{Version: 7, Flags: flags})

	// Mutating the caller's map after Apply must not affect the stored
	// snapshot — Apply clones its input.
	flags["some_flag"] = "off"

	snapshot, ok := provider.Snapshot()
	if !ok {
		t.Fatal("Snapshot not found after Apply")
	}
	if snapshot.Version != 7 || snapshot.Flags["some_flag"] != "on" {
		t.Fatalf("snapshot = %+v, want version 7 and some_flag=on", snapshot)
	}

	// Mutating the returned Snapshot's map must not affect the provider's
	// internal state — Snapshot returns a copy.
	snapshot.Flags["some_flag"] = "mutated"
	snapshot2, _ := provider.Snapshot()
	if snapshot2.Flags["some_flag"] != "on" {
		t.Fatalf("mutating Snapshot copy changed provider state: %+v", snapshot2)
	}
}

func TestServerSnapshotProviderClear(t *testing.T) {
	t.Parallel()

	provider := NewServerSnapshotProvider()
	provider.Apply(ServerSnapshot{Version: 1, Flags: map[string]string{"a": "on"}})
	if _, ok := provider.Snapshot(); !ok {
		t.Fatal("expected snapshot to be present after Apply")
	}

	provider.Clear()
	if _, ok := provider.Snapshot(); ok {
		t.Fatal("expected snapshot to be cleared")
	}
}

func TestServerSnapshotProviderNilReceiverIsSafe(t *testing.T) {
	t.Parallel()

	var p *ServerSnapshotProvider
	// None of these should panic on a nil receiver.
	p.Apply(ServerSnapshot{Version: 1, Flags: map[string]string{"a": "on"}})
	p.Clear()
	if _, ok := p.Snapshot(); ok {
		t.Fatal("nil provider should never report a snapshot present")
	}
}

func TestServerSnapshotProviderConcurrentSwapAndSnapshot(t *testing.T) {
	t.Parallel()

	provider := NewServerSnapshotProvider()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			provider.Apply(ServerSnapshot{
				Version: uint64(i + 1),
				Flags:   map[string]string{"flag": boolVariant(i%2 == 0)},
			})
		}()
	}
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = provider.Snapshot()
		}()
	}
	wg.Wait()

	if _, ok := provider.Snapshot(); !ok {
		t.Fatal("provider lost snapshot after concurrent swaps")
	}
}

func TestApplyFeatureFlagSnapshotNoProviderIsSafe(t *testing.T) {
	savedProvider := activeServerSnapshotProvider.Load()
	activeServerSnapshotProvider.Store(nil)
	t.Cleanup(func() { activeServerSnapshotProvider.Store(savedProvider) })

	// Must not panic when no provider is installed.
	ApplyFeatureFlagSnapshot(1, map[string]string{"some_flag": "on"})
}

func TestApplyFeatureFlagSnapshotNilFlagsClearsProvider(t *testing.T) {
	savedProvider := activeServerSnapshotProvider.Load()
	provider := NewServerSnapshotProvider()
	provider.Apply(ServerSnapshot{
		Version: 1,
		Flags:   map[string]string{"some_flag": "on"},
	})
	SetServerSnapshotProvider(provider)
	t.Cleanup(func() { activeServerSnapshotProvider.Store(savedProvider) })

	ApplyFeatureFlagSnapshot(2, nil)
	if _, ok := provider.Snapshot(); ok {
		t.Fatal("nil flags should clear the server snapshot provider")
	}
}

func boolVariant(enabled bool) string {
	if enabled {
		return "on"
	}
	return "off"
}
