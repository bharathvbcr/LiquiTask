// liquitask-agentd — local agent execution sidecar for LiquiTask v3.
//
// Speaks newline-delimited JSON-RPC 2.0 over a Unix socket / Windows named pipe
// (supervisor daemon mode) and optionally stdio (legacy/tests).
package main

import (
	"context"
	"flag"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/liquitask/liquitask-agentd/internal/rpc"
	"github.com/liquitask/liquitask-agentd/internal/runner"
)

func main() {
	daemonMode := flag.Bool("daemon", false, "run as a detached supervisor daemon")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	dataDir := rpc.DefaultDataDir()
	_ = os.MkdirAll(dataDir, 0o755)

	srv := rpc.NewServer(os.Stdin, os.Stdout)
	mgr := runner.New(srv, dataDir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	mgr.StartBackground(ctx)
	defer mgr.Shutdown()

	var socketLn net.Listener
	if *daemonMode {
		ln, err := srv.ListenSocket(dataDir)
		if err != nil {
			slog.Error("socket listen failed", "err", err)
			os.Exit(1)
		}
		socketLn = ln
		if err := rpc.WritePIDFile(dataDir); err != nil {
			slog.Error("pidfile write failed", "err", err)
			os.Exit(1)
		}
		defer rpc.RemovePIDFile(dataDir)
		go srv.AcceptLoop(ln, dataDir)
		slog.Info("agentd daemon listening", "socket", rpc.SocketPath(dataDir))
	}

	mgr.SetShutdownHook(func() {
		cancel()
		if socketLn != nil {
			_ = socketLn.Close()
		}
		rpc.RemovePIDFile(dataDir)
		if runtime.GOOS != "windows" {
			_ = os.Remove(rpc.SocketPath(dataDir))
		}
		os.Exit(0)
	})
	registerHandlers(srv, mgr)

	if *daemonMode {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		cancel()
		if socketLn != nil {
			_ = socketLn.Close()
		}
		rpc.RemovePIDFile(dataDir)
		return
	}

	if err := srv.Run(); err != nil {
		slog.Error("agentd exit", "err", err)
		os.Exit(1)
	}
}

func registerHandlers(srv *rpc.Server, mgr *runner.Manager) {
	srv.Register("detect", mgr.HandleDetect)
	srv.Register("skills.list", mgr.HandleSkillsList)
	srv.Register("skills.read", mgr.HandleSkillsRead)
	srv.Register("run.start", mgr.HandleStart)
	srv.Register("ssh.health", mgr.HandleSSHHealth)
	srv.Register("run.cancel", mgr.HandleCancel)
	srv.Register("run.pause", mgr.HandlePause)
	srv.Register("run.resume", mgr.HandleResume)
	srv.Register("run.inject", mgr.HandleInject)
	srv.Register("run.pty.history", mgr.HandlePtyHistory)
	srv.Register("run.pty.write", mgr.HandlePtyWrite)
	srv.Register("run.pty.takeover", mgr.HandlePtyTakeover)
	srv.Register("run.reattach", mgr.HandleReattach)
	srv.Register("sessions.discover", mgr.HandleSessionsDiscover)
	srv.Register("sessions.fork", mgr.HandleSessionsFork)
	srv.Register("sessions.truncate", mgr.HandleSessionsTruncate)
	srv.Register("sessions.messageCount", mgr.HandleSessionsMessageCount)
	srv.Register("permission.respond", mgr.HandlePermissionRespond)
	srv.Register("queue.list", mgr.HandleQueueList)
	srv.Register("queue.enqueue", mgr.HandleQueueEnqueue)
	srv.Register("queue.remove", mgr.HandleQueueRemove)
	srv.Register("queue.acquire", mgr.HandleQueueAcquire)
	srv.Register("queue.release", mgr.HandleQueueRelease)
	srv.Register("scheduler.intent.set", mgr.HandleIntentSet)
	srv.Register("scheduler.config.set", mgr.HandleSchedulerConfigSet)
	srv.Register("scheduler.intent.list", mgr.HandleSchedulerList)
	srv.Register("reservation.list", mgr.HandleReservationList)
	srv.Register("reservation.claim", mgr.HandleReservationClaim)
	srv.Register("reservation.release", mgr.HandleReservationRelease)
	srv.Register("trace.list", mgr.HandleTraceList)
	srv.Register("trace.write", mgr.HandleTraceWrite)
	srv.Register("trace.revertToStep", mgr.HandleTraceRevertToStep)
	srv.Register("trace.forkFromStep", mgr.HandleTraceForkFromStep)
	srv.Register("feedback.watch", mgr.HandleFeedbackWatch)
	srv.Register("daemon.stop", mgr.HandleDaemonStop)
	srv.Register("notify.config.set", mgr.HandleNotifyConfigSet)
}
