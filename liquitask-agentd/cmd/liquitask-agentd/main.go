// liquitask-agentd — local agent execution sidecar for LiquiTask v3.
//
// Speaks newline-delimited JSON-RPC 2.0 over stdio. Ported patterns from
// Multica server/pkg/agent (see vendor/multica-ref/ and docs/THIRD_PARTY.md).
package main

import (
	"log/slog"
	"os"
	"path/filepath"

	"github.com/liquitask/liquitask-agentd/internal/rpc"
	"github.com/liquitask/liquitask-agentd/internal/runner"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	dataDir := os.Getenv("LIQUITASK_AGENTD_DATA")
	if dataDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			dataDir = os.TempDir()
		} else {
			dataDir = filepath.Join(home, ".liquitask", "agentd")
		}
	}
	_ = os.MkdirAll(dataDir, 0o755)

	srv := rpc.Stdio()
	mgr := runner.New(srv, dataDir)

	srv.Register("detect", mgr.HandleDetect)
	srv.Register("run.start", mgr.HandleStart)
	srv.Register("run.cancel", mgr.HandleCancel)
	srv.Register("run.pause", mgr.HandlePause)
	srv.Register("run.resume", mgr.HandleResume)
	srv.Register("run.inject", mgr.HandleInject)
	srv.Register("run.reattach", mgr.HandleReattach)
	srv.Register("permission.respond", mgr.HandlePermissionRespond)

	if err := srv.Run(); err != nil {
		slog.Error("agentd exit", "err", err)
		os.Exit(1)
	}
}
